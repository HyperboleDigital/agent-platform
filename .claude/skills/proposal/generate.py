#!/usr/bin/env python3
"""Render a proposal from a JSON data file into the Figma-derived template.

    python3 .claude/skills/proposal/generate.py <data.json> [-o out.html]

Exists so a new proposal is a data edit rather than hand-editing HTML — and so
the arithmetic check below can never be skipped by accident.
"""
import argparse, json, re, sys
from pathlib import Path

HERE = Path(__file__).parent


def money(n):
    """Match the Figma design: '$ 2,200' — space after the sign, no decimals."""
    return f"$ {n:,.0f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data")
    ap.add_argument("-o", "--out")
    a = ap.parse_args()

    d = json.loads(Path(a.data).read_text())
    items, terms = d["items"], d["terms"]

    # ── Money check. Refuse to render a document whose numbers don't add up;
    # a wrong total in a client proposal is worse than no proposal.
    computed = sum(i["amount"] for i in items)
    stated = d.get("total", computed)
    if abs(computed - stated) > 0.005:
        sys.exit(f"REFUSING TO RENDER: items sum to {money(computed)}, "
                 f"but total says {money(stated)}. Fix the data.")
    for i in items:
        if "rate" in i and "qty" in i and abs(i["rate"] * i["qty"] - i["amount"]) > 0.005:
            sys.exit(f"REFUSING TO RENDER: '{i['name']}' has "
                     f"{i['rate']} x {i['qty']} != {i['amount']}.")

    tpl = (HERE / "template.html").read_text()

    row = re.search(r"<!-- ROW.*?-->(.*?)<!-- /ROW -->", tpl, re.S).group(1)
    rows = "".join(
        row.replace("{{ITEM_NAME}}", i["name"])
           .replace("{{ITEM_TIMELINE}}", i["timeline"])
           .replace("{{ITEM_DESC}}", i["desc"])
           .replace("{{ITEM_TOTAL}}", money(i["amount"]))
        for i in items
    )
    tpl = re.sub(r"<!-- ROW.*?-->.*?<!-- /ROW -->", rows.rstrip(), tpl, flags=re.S)

    term = re.search(r"<!-- TERM.*?-->(.*?)<!-- /TERM -->", tpl, re.S).group(1)
    tl = "".join(term.replace("{{TERM}}", t) for t in terms)
    tpl = re.sub(r"<!-- TERM.*?-->.*?<!-- /TERM -->", tl.rstrip(), tpl, flags=re.S)

    for k, v in {
        "{{TITLE}}": d.get("title", "Proposal"),
        "{{CLIENT}}": d["client"],
        "{{DATE}}": d["date"],
        "{{TOTAL}}": money(stated),
    }.items():
        tpl = tpl.replace(k, v)

    left = re.findall(r"\{\{[A-Z_]+\}\}", tpl)
    if left:
        sys.exit(f"REFUSING TO RENDER: unfilled placeholders {sorted(set(left))}")

    out = Path(a.out) if a.out else Path("proposals") / f"{d['slug']}-{d['date_slug']}.html"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(tpl)
    print(f"OK  {out}  ({len(tpl):,} bytes)")
    print(f"OK  items sum to {money(computed)} = stated total")


if __name__ == "__main__":
    main()
