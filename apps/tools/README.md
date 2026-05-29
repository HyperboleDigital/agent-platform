# Tools

Standalone Python scripts (not part of the pnpm monorepo).

## Setup

```bash
cd apps/tools
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Uses Supabase credentials from `../api/.env`.

## Run scraper

```bash
python test.py
```

(Inside the venv, `python` works; outside, use `python3`.)
