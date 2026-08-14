import { jsPDF } from 'jspdf'
import type { SeoCrawl } from './api'
import { buildAuditRows, groupByCategory, type Severity } from './audit-rows'
import { HYPERBOLE_ICON_PNG_BASE64 } from './hyperbole-icon-base64'

// Generates and downloads a branded PDF audit report directly (no print dialog).
// Text is drawn with jsPDF primitives so it's crisp and selectable, not a
// screenshot. One artifact to save to disk, drop in Drive, or attach to email.

const ACCENT: [number, number, number] = [186, 158, 102]
const DARK: [number, number, number] = [23, 23, 23]
const GRAY: [number, number, number] = [110, 110, 110]
const FAINT: [number, number, number] = [160, 160, 160]

function scoreRGB(s: number): [number, number, number] {
  return s >= 90 ? [4, 120, 87] : s >= 50 ? [180, 83, 9] : [185, 28, 28]
}
function sevRGB(s: Severity): [number, number, number] {
  return s === 'high' ? [185, 28, 28] : s === 'medium' ? [180, 83, 9] : [4, 120, 87]
}
function sevLabel(s: Severity): string {
  return s === 'high' ? 'High' : s === 'medium' ? 'Medium' : 'Low'
}
const pathOf = (u: string) => { try { return new URL(u).pathname || '/' } catch { return u } }

export function buildAuditPdf(crawl: SeoCrawl): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  const CW = W - M * 2
  let y = M

  const ensure = (h: number) => { if (y + h > H - M) { doc.addPage(); y = M } }
  const date = new Date(crawl.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  // Header. The icon works on white paper (the H is dark regardless of its
  // disc), unlike the wordmark used elsewhere in the app, which is white text
  // built for a dark surface and would be invisible here.
  doc.addImage(HYPERBOLE_ICON_PNG_BASE64, 'PNG', M, y - 9, 12, 12)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...ACCENT)
  doc.text('HYPERBOLE DIGITAL', M + 16, y); y += 20
  doc.setFontSize(20); doc.setTextColor(...DARK)
  doc.text('SEO Audit Report', M, y); y += 16
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY)
  doc.text(`${crawl.url}   ·   ${date}${crawl.pagesCrawled != null ? `   ·   ${crawl.pagesCrawled} pages analyzed` : ''}`, M, y); y += 12
  doc.setDrawColor(...ACCENT); doc.setLineWidth(1.5); doc.line(M, y, M + CW, y); y += 24

  // Score boxes
  const boxW = (CW - 16) / 2, boxH = 78 // tall enough for the score + a two-line caption
  // Keep the caption in sync with ScoreCard in components/audit-report.tsx —
  // this PDF goes to the client, so an unqualified "95/100" is the version
  // most likely to be misread as an overall SEO or keyword score.
  const drawScore = (x: number, label: string, score: number, hint: string) => {
    doc.setDrawColor(229, 229, 229); doc.setLineWidth(1); doc.rect(x, y, boxW, boxH)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...GRAY)
    doc.text(label, x + 14, y + 20)
    const n = String(Math.round(score))
    doc.setFont('helvetica', 'bold'); doc.setFontSize(26); doc.setTextColor(...scoreRGB(score))
    const nW = doc.getTextWidth(n)
    doc.text(n, x + 14, y + 44)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...FAINT)
    doc.text('/100', x + 14 + nW + 6, y + 44)
    doc.setFontSize(7); doc.setTextColor(...FAINT)
    for (const [i, line] of doc.splitTextToSize(hint, boxW - 28).slice(0, 2).entries()) {
      doc.text(line, x + 14, y + 54 + i * 8)
    }
  }
  if (crawl.onpageScore != null) {
    drawScore(M, 'Technical Health', crawl.onpageScore, 'On-page issues only — not keywords or rankings')
  }
  if (crawl.aiSearch) {
    drawScore(M + boxW + 16, 'AI Search Health', crawl.aiSearch.score, 'Whether AI engines can crawl and read the site')
  }
  y += boxH + 22

  const rows = buildAuditRows(crawl)
  const categories = groupByCategory(rows)

  // Summary
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(80, 80, 80)
  const summary = rows.length === 0
    ? 'No significant issues were found — the site is in good shape.'
    : `We found ${rows.length} issue${rows.length === 1 ? '' : 's'} across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}, prioritized below.`
  for (const line of doc.splitTextToSize(summary, CW)) { ensure(14); doc.text(line, M, y); y += 14 }
  y += 10

  // Categories & issues
  for (const [cat, rs] of categories) {
    ensure(30)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...DARK)
    doc.text(`${cat}   ·   ${rs.length}`, M, y); y += 7
    doc.setDrawColor(229, 229, 229); doc.setLineWidth(0.5); doc.line(M, y, M + CW, y); y += 16

    for (const r of rs) {
      ensure(18)
      // severity pill
      const label = sevLabel(r.severity)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8)
      const pillW = doc.getTextWidth(label) + 10
      doc.setFillColor(...sevRGB(r.severity)); doc.rect(M, y - 8, pillW, 12, 'F')
      doc.setTextColor(255, 255, 255); doc.text(label, M + 5, y)
      // title (wraps under the pill's right edge, continuation flush left)
      const titleX = M + pillW + 8
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.setTextColor(...DARK)
      const titleText = r.count > 0 ? `${r.title}  (${r.count} page${r.count === 1 ? '' : 's'})` : r.title
      const titleLines = doc.splitTextToSize(titleText, CW - (pillW + 8))
      doc.text(titleLines[0], titleX, y); y += 13
      for (let i = 1; i < titleLines.length; i++) { ensure(13); doc.text(titleLines[i], M, y); y += 13 }

      // detail
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(105, 105, 105)
      for (const line of doc.splitTextToSize(r.detail, CW)) { ensure(12); doc.text(line, M, y); y += 12 }

      // affected urls
      if (r.urls.length) {
        doc.setFontSize(8.5); doc.setTextColor(...FAINT)
        for (const u of r.urls.slice(0, 10)) { ensure(11); doc.text(`•  ${pathOf(u)}`, M + 8, y); y += 11 }
        if (r.urls.length > 10) { ensure(11); doc.text(`•  +${r.urls.length - 10} more`, M + 8, y); y += 11 }
      }
      y += 9
    }
    y += 6
  }

  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(...FAINT)
  doc.text(`Prepared by Hyperbole Digital · ${date}`, M, H - 28)

  return doc
}

export function downloadAuditPdf(crawl: SeoCrawl) {
  const doc = buildAuditPdf(crawl)
  const safeDomain = crawl.url.replace(/^https?:\/\//i, '').replace(/[^a-z0-9.-]/gi, '_')
  const safeDate = new Date(crawl.createdAt).toISOString().slice(0, 10)
  doc.save(`SEO-Audit-${safeDomain}-${safeDate}.pdf`)
}
