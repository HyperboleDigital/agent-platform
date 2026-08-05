import type { CrawlTrendPoint } from './api'

// Diffing two audits to show what actually changed between them.
//
// This deliberately diffs `checks`, NOT `issues`. `issues` is synthesized by an
// LLM on every crawl (see dataforseo.ts synthesizeIssues), so its titles,
// severities and groupings drift run-to-run even when the underlying site is
// identical — diffing it manufactures changes that never happened. `checks` is
// the raw DataForSEO output keyed by a fixed vocabulary (PROBLEM_CHECKS), so
// the same problem carries the same key across every audit, forever.
//
// DataForSEO only returns checks with a non-zero count, so a key missing from
// an audit means zero occurrences — which is what makes "fixed" detectable at
// all: present in the earlier audit, absent from the later one.

export interface CheckDelta {
  key: string
  label: string
  from: number
  to: number
}

export interface CheckDiff {
  fixed: CheckDelta[] // went to zero
  improved: CheckDelta[] // fewer pages affected, but not gone
  worsened: CheckDelta[] // more pages affected
  appeared: CheckDelta[] // wasn't there before
  unchanged: CheckDelta[]
}

const EMPTY: CheckDiff = { fixed: [], improved: [], worsened: [], appeared: [], unchanged: [] }

function countsOf(point: CrawlTrendPoint): Map<string, { label: string; count: number }> {
  return new Map(point.checks.map(c => [c.key, { label: c.label, count: c.count }]))
}

export function diffAudits(from: CrawlTrendPoint, to: CrawlTrendPoint): CheckDiff {
  const before = countsOf(from)
  const after = countsOf(to)
  const diff: CheckDiff = { fixed: [], improved: [], worsened: [], appeared: [], unchanged: [] }

  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(key)
    const a = after.get(key)
    const delta: CheckDelta = {
      key,
      label: a?.label ?? b?.label ?? key,
      from: b?.count ?? 0,
      to: a?.count ?? 0,
    }
    if (delta.from === delta.to) diff.unchanged.push(delta)
    else if (delta.to === 0) diff.fixed.push(delta)
    else if (delta.from === 0) diff.appeared.push(delta)
    else if (delta.to < delta.from) diff.improved.push(delta)
    else diff.worsened.push(delta)
  }

  // Biggest movement first within each bucket — that's the headline in a
  // client conversation, not alphabetical order.
  const byMagnitude = (x: CheckDelta, y: CheckDelta) =>
    Math.abs(y.to - y.from) - Math.abs(x.to - x.from) || x.label.localeCompare(y.label)
  diff.fixed.sort(byMagnitude)
  diff.improved.sort(byMagnitude)
  diff.worsened.sort(byMagnitude)
  diff.appeared.sort(byMagnitude)
  diff.unchanged.sort((x, y) => y.to - x.to)
  return diff
}

export function isEmptyDiff(d: CheckDiff): boolean {
  return !d.fixed.length && !d.improved.length && !d.worsened.length && !d.appeared.length
}

export const EMPTY_DIFF = EMPTY

// A score jump isn't automatically our work: if the crawl scope changed, the
// score is being computed over a different set of pages. Surfacing this next to
// the number keeps an honest comparison honest — the per-check diff above is
// unaffected, which is part of why it's the stronger evidence.
export function scopeChanged(from: CrawlTrendPoint, to: CrawlTrendPoint): boolean {
  if (from.pagesCrawled == null || to.pagesCrawled == null) return false
  if (from.pagesCrawled === to.pagesCrawled) return false
  const larger = Math.max(from.pagesCrawled, to.pagesCrawled)
  return Math.abs(to.pagesCrawled - from.pagesCrawled) / larger >= 0.15
}
