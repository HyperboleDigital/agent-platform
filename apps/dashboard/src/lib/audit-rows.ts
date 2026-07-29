import type { SeoCrawl } from './api'

// Shared audit-issue shaping used by both the on-screen AuditReport and the
// printable report page, so they never drift.

export type Severity = 'high' | 'medium' | 'low'
export const SEVERITY_RANK: Record<Severity, number> = { high: 3, medium: 2, low: 1 }

export interface AuditRow {
  category: string
  severity: Severity
  title: string
  detail: string
  count: number
  urls: string[]
}

const CATEGORY_BY_KEY: Record<string, string> = {
  no_title: 'Titles & meta', duplicate_title_tag: 'Titles & meta', title_too_long: 'Titles & meta',
  title_too_short: 'Titles & meta', irrelevant_title: 'Titles & meta', no_description: 'Titles & meta',
  duplicate_meta_tags: 'Titles & meta', irrelevant_description: 'Titles & meta', irrelevant_meta_keywords: 'Titles & meta',
  low_content_rate: 'Content', low_character_count: 'Content', low_readability_rate: 'Content', lorem_ipsum: 'Content',
  no_image_alt: 'Images', no_image_title: 'Images',
  is_http: 'Security', https_to_http_links: 'Security',
  is_4xx_code: 'Links', is_5xx_code: 'Links', is_broken: 'Links', is_orphan_page: 'Links', has_links_to_redirects: 'Links',
  canonical_to_broken: 'Canonicals & redirects', canonical_to_redirect: 'Canonicals & redirects',
  canonical_chain: 'Canonicals & redirects', recursive_canonical: 'Canonicals & redirects',
  redirect_chain: 'Canonicals & redirects', has_meta_refresh_redirect: 'Canonicals & redirects',
  large_page_size: 'Performance', size_greater_than_3mb: 'Performance', high_loading_time: 'Performance',
  high_waiting_time: 'Performance', has_render_blocking_resources: 'Performance', no_content_encoding: 'Performance',
  no_h1_tag: 'Structure', no_doctype: 'Structure', no_encoding_meta_tag: 'Structure',
  deprecated_html_tags: 'Structure', flash: 'Structure', no_favicon: 'Structure',
}

export function buildAuditRows(crawl: SeoCrawl): AuditRow[] {
  const rows: AuditRow[] = []
  for (const i of crawl.issues ?? []) {
    rows.push({ category: CATEGORY_BY_KEY[i.key ?? ''] ?? 'Other', severity: i.severity, title: i.title, detail: i.explanation, count: i.count, urls: i.urls ?? [] })
  }
  for (const i of crawl.aiSearch?.issues ?? []) {
    rows.push({ category: 'AI Search / GEO', severity: i.severity, title: i.title, detail: i.detail, count: 0, urls: [] })
  }
  return rows
}

// Group rows by category, worst-severity category first, issues within sorted by severity.
export function groupByCategory(rows: AuditRow[]): [string, AuditRow[]][] {
  const byCategory = new Map<string, AuditRow[]>()
  for (const r of rows) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, [])
    byCategory.get(r.category)!.push(r)
  }
  return [...byCategory.entries()]
    .map(([cat, rs]) => [cat, rs.sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])] as [string, AuditRow[]])
    .sort((a, b) => Math.max(...b[1].map(r => SEVERITY_RANK[r.severity])) - Math.max(...a[1].map(r => SEVERITY_RANK[r.severity])))
}
