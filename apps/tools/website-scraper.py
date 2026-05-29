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


# Load Supabase credentials from apps/api/.env
_api_env = load_env_file(Path(__file__).resolve().parent.parent / "api" / ".env")
SUPABASE_URL = _api_env.get("SUPABASE_URL") or os.environ.get("SUPABASE_URL")
SUPABASE_KEY = _api_env.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_KEY:
    raise SystemExit(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_KEY. "
        "Set them in apps/api/.env or export them in your shell."
    )

supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

# ----------------------------
# CLIENT — UUID from Supabase `clients` table (same as widget data-client-id)
# ----------------------------

CLIENT_ID = _api_env.get("CLIENT_ID") or os.environ.get("CLIENT_ID") or ""

if not CLIENT_ID or CLIENT_ID == "PUT_CLIENT_UUID_HERE":
    raise SystemExit(
        "Set CLIENT_ID to your client's UUID from Supabase.\n"
        "  Option A: add CLIENT_ID=... to apps/api/.env\n"
        "  Option B: export CLIENT_ID=... before running\n"
        "  (Find it in Supabase → clients table, or in apps/widget/test.html)"
    )

# ----------------------------
# WEBSITE
# ----------------------------

BASE_URL = "https://www.spec-id.com"
BASE_HOST = urlparse(BASE_URL).netloc

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
        supabase.table("knowledge_base").insert(data).execute()
        print(f"Saved: {data['title']}")
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
    interrupted = False
    print(f"Starting crawl of {BASE_URL} (max {MAX_PAGES} pages)\n")
    try:
        crawl(BASE_URL)
    except KeyboardInterrupt:
        interrupted = True
        print("\n\nStopped early (Ctrl+C).")
    finally:
        print_summary(interrupted=interrupted)


if __name__ == "__main__":
    main()
