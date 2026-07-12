import argparse
import os
import sys
import time
from pathlib import Path
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from supabase import create_client


def load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        env[key.strip()] = value.strip()
    return env


# Load credentials from apps/api/.env
_api_env = load_env_file(Path(__file__).resolve().parent.parent / "api" / ".env")
SUPABASE_URL = _api_env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = _api_env.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")
VOYAGE_API_KEY = _api_env.get("VOYAGE_API_KEY") or os.environ.get("VOYAGE_API_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. "
        "Set them in apps/api/.env or export them in your shell."
    )

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# Set from CLI args in main().
CLIENT_ID = ""
BASE_URL = ""
BASE_HOST = ""

visited = set()
session = requests.Session()
session.headers["User-Agent"] = "AgentPlatform-KnowledgeBot/1.0"

MAX_PAGES = 50

SKIP_EXTENSIONS = {
    ".pdf", ".zip", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".mp4", ".mp3", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
}

stats = {"visited": 0, "saved": 0, "skipped": 0, "errors": 0}


def should_skip_url(url: str) -> bool:
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in SKIP_EXTENSIONS)


def is_html_response(response: requests.Response) -> bool:
    content_type = response.headers.get("Content-Type", "").lower()
    return "text/html" in content_type or "application/xhtml" in content_type


def sanitize_for_postgres(text: str) -> str:
    return text.replace("\x00", "")


def clean_text(text: str) -> str:
    return sanitize_for_postgres(" ".join(text.split()))


def chunk_text(text: str, max_chars: int = 2000) -> list[str]:
    """Split text into ~500-token (~2000 char) chunks on word boundaries."""
    words = text.split()
    chunks: list[str] = []
    current = ""
    for word in words:
        if len(current) + len(word) + 1 > max_chars:
            if current:
                chunks.append(current)
            current = word
        else:
            current = f"{current} {word}" if current else word
    if current:
        chunks.append(current)
    return chunks or [text]


def embed_documents(texts: list[str]) -> list[list[float] | None]:
    """Embed chunks via Voyage AI. Returns None per item if VOYAGE_API_KEY unset."""
    if not VOYAGE_API_KEY or not texts:
        return [None] * len(texts)
    try:
        resp = session.post(
            "https://api.voyageai.com/v1/embeddings",
            headers={"Authorization": f"Bearer {VOYAGE_API_KEY}"},
            json={"model": "voyage-3.5-lite", "input": texts, "input_type": "document"},
            timeout=30,
        )
        resp.raise_for_status()
        return [item["embedding"] for item in resp.json()["data"]]
    except Exception as e:
        print(f"Voyage embedding error: {e}")
        return [None] * len(texts)


def fetch_page(url: str) -> requests.Response | None:
    try:
        response = session.get(url, timeout=10)
        if response.status_code != 200:
            return None
        return response
    except Exception as e:
        print(f"Error fetching {url}: {e}")
        stats["errors"] += 1
        return None


def extract_page_content(url: str, response: requests.Response) -> dict | None:
    if not is_html_response(response):
        print(f"Skipped (not HTML): {url}")
        stats["skipped"] += 1
        return None

    try:
        soup = BeautifulSoup(response.text, "html.parser")

        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        title = soup.title.get_text(strip=True) if soup.title else urlparse(url).path or url
        text = clean_text(soup.get_text(separator=" "))

        if len(text) < 50:
            print(f"Skipped (too little text): {url}")
            stats["skipped"] += 1
            return None

        return {
            "client_id": CLIENT_ID,
            "url": url,
            "title": sanitize_for_postgres(title)[:500],
            "content": text[:12000],
        }

    except Exception as e:
        print(f"Error parsing {url}: {e}")
        stats["errors"] += 1
        return None


def save_to_supabase(data: dict) -> bool:
    try:
        chunks = chunk_text(data["content"])
        embeddings = embed_documents(chunks)
        rows = [
            {
                "client_id": data["client_id"],
                "url": data["url"],
                "title": data["title"],
                "content": chunk,
                "embedding": embeddings[i],
            }
            for i, chunk in enumerate(chunks)
        ]
        supabase.table("knowledge_base").insert(rows).execute()
        print(f"Saved: {data['title']} ({len(rows)} chunks)")
        stats["saved"] += 1
        return True
    except Exception as e:
        print(f"Supabase error: {e}")
        stats["errors"] += 1
        return False


def get_internal_links(url: str, response: requests.Response) -> list[str]:
    if not is_html_response(response):
        return []

    links = []
    try:
        soup = BeautifulSoup(response.text, "html.parser")

        for a in soup.find_all("a", href=True):
            full_url = urljoin(url, a["href"])
            parsed = urlparse(full_url)

            if parsed.netloc != BASE_HOST:
                continue

            clean_url = parsed.scheme + "://" + parsed.netloc + parsed.path
            if clean_url in visited or should_skip_url(clean_url):
                continue

            links.append(clean_url)

    except Exception as e:
        print(f"Link error on {url}: {e}")
        stats["errors"] += 1

    return links


def crawl(url: str) -> None:
    if url in visited or stats["visited"] >= MAX_PAGES:
        return

    if should_skip_url(url):
        print(f"Skipped (file type): {url}")
        stats["skipped"] += 1
        return

    print(f"Scraping: {url}")
    visited.add(url)
    stats["visited"] += 1

    response = fetch_page(url)
    if not response:
        return

    page_data = extract_page_content(url, response)
    if page_data:
        save_to_supabase(page_data)

    for link in get_internal_links(url, response):
        crawl(link)
        time.sleep(0.5)


def print_summary(interrupted: bool = False) -> None:
    label = "SCRAPE STOPPED (interrupted)" if interrupted else "SCRAPE COMPLETE"
    print()
    print("=" * 60)
    print(label)
    print("=" * 60)
    print(f"  Pages visited:  {stats['visited']}")
    print(f"  Saved to DB:    {stats['saved']}")
    print(f"  Skipped:        {stats['skipped']}")
    print(f"  Errors:         {stats['errors']}")
    print(f"  Max pages:      {MAX_PAGES}")
    print("=" * 60)
    sys.stdout.flush()
    # Terminal bell so you know it's done even if the window isn't focused
    print("\a", end="", flush=True)


def main() -> None:
    global CLIENT_ID, BASE_URL, BASE_HOST

    parser = argparse.ArgumentParser(description="Crawl a website into the knowledge_base table.")
    parser.add_argument("--url", required=True, help="Base URL to crawl, e.g. https://example.com")
    parser.add_argument("--client-id", required=True, help="Client UUID from the Supabase clients table")
    args = parser.parse_args()

    CLIENT_ID = args.client_id
    BASE_URL = args.url
    BASE_HOST = urlparse(BASE_URL).netloc

    embed_note = "with embeddings" if VOYAGE_API_KEY else "full-text only (no VOYAGE_API_KEY)"
    interrupted = False
    print(f"Starting crawl of {BASE_URL} (max {MAX_PAGES} pages, {embed_note})\n")
    try:
        crawl(BASE_URL)
    except KeyboardInterrupt:
        interrupted = True
        print("\n\nStopped early (Ctrl+C).")
    finally:
        print_summary(interrupted=interrupted)


if __name__ == "__main__":
    main()
