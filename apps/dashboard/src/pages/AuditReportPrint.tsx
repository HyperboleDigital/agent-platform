import { useParams, Link } from 'react-router-dom'
import useSWR from 'swr'
import { Printer, ArrowLeft } from 'lucide-react'
import { api } from '@/lib/api'
import { buildAuditRows, groupByCategory, type Severity } from '@/lib/audit-rows'

// Chromeless, light-themed, Hyperbole-branded audit report designed to be saved
// as a PDF (browser Print → Save as PDF) and then emailed / dropped in Drive.
// Rendered outside the AppShell so there's no sidebar in the printout.

const ACCENT = '#BA9E66'
const path = (u: string) => { try { return new URL(u).pathname || '/' } catch { return u } }

function sevStyle(s: Severity): { bg: string; text: string; label: string } {
  if (s === 'high') return { bg: '#fee2e2', text: '#b91c1c', label: 'High' }
  if (s === 'medium') return { bg: '#fef3c7', text: '#b45309', label: 'Medium' }
  return { bg: '#d1fae5', text: '#047857', label: 'Low' }
}
function scoreColor(score: number): string {
  if (score >= 90) return '#047857'
  if (score >= 50) return '#b45309'
  return '#b91c1c'
}

function ScoreBlock({ label, score }: { label: string; score: number }) {
  const s = Math.round(score)
  return (
    <div className="rounded-lg border border-neutral-200 px-5 py-4">
      <div className="text-sm font-medium text-neutral-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-4xl font-bold leading-none" style={{ color: scoreColor(score) }}>{s}</span>
        <span className="text-sm text-neutral-400">/100</span>
      </div>
      <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-100">
        <div className="h-full rounded-full" style={{ width: `${s}%`, background: scoreColor(score) }} />
      </div>
    </div>
  )
}

export default function AuditReportPrint() {
  const { crawlId } = useParams()
  const { data: crawl, isLoading } = useSWR(crawlId ? ['audit-report', crawlId] : null, () => api.overview.refreshAudit(crawlId!))

  if (isLoading) return <div className="p-10 text-sm text-neutral-500">Loading report…</div>
  if (!crawl) return <div className="p-10 text-sm text-neutral-500">Audit not found.</div>
  if (crawl.status !== 'finished') return <div className="p-10 text-sm text-neutral-500">This audit hasn’t finished yet.</div>

  const rows = buildAuditRows(crawl)
  const categories = groupByCategory(rows)
  const date = new Date(crawl.createdAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="min-h-screen bg-white text-neutral-900">
      <style>{`@media print { body { background: #fff; } .no-print { display: none !important; } }`}</style>

      <div className="no-print flex items-center justify-between border-b border-neutral-200 px-8 py-3">
        <Link to="/audit-tool" className="flex items-center gap-1.5 text-sm text-neutral-500 hover:text-neutral-900">
          <ArrowLeft className="h-4 w-4" /> Back to Audit Tool
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-white"
          style={{ background: ACCENT }}
        >
          <Printer className="h-4 w-4" /> Save as PDF / Print
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-8 py-10">
        <div className="border-b-2 pb-4" style={{ borderColor: ACCENT }}>
          <div className="text-xs font-semibold tracking-widest" style={{ color: ACCENT }}>HYPERBOLE DIGITAL</div>
          <h1 className="mt-1 text-2xl font-bold">SEO Audit Report</h1>
          <div className="mt-1 text-sm text-neutral-500">
            {crawl.url} · {date}{crawl.pagesCrawled != null ? ` · ${crawl.pagesCrawled} pages analyzed` : ''}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4">
          {crawl.onpageScore != null && <ScoreBlock label="Site Health" score={crawl.onpageScore} />}
          {crawl.aiSearch && <ScoreBlock label="AI Search Health" score={crawl.aiSearch.score} />}
        </div>

        <p className="mt-6 text-sm text-neutral-600">
          {rows.length === 0
            ? 'No significant issues were found — the site is in good shape.'
            : `We found ${rows.length} issue${rows.length === 1 ? '' : 's'} across ${categories.length} categor${categories.length === 1 ? 'y' : 'ies'}, prioritized below.`}
        </p>

        {categories.map(([cat, rs]) => (
          <section key={cat} className="mt-7" style={{ breakInside: 'avoid' }}>
            <h2 className="border-b border-neutral-200 pb-1 text-lg font-semibold">
              {cat} <span className="text-neutral-400">· {rs.length}</span>
            </h2>
            {rs.map((r, i) => {
              const st = sevStyle(r.severity)
              return (
                <div key={i} className="mt-3" style={{ breakInside: 'avoid' }}>
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: st.bg, color: st.text }}>{st.label}</span>
                    <span className="font-medium">{r.title}</span>
                    {r.count > 0 && <span className="text-sm text-neutral-400">{r.count} page{r.count === 1 ? '' : 's'}</span>}
                  </div>
                  <p className="mt-0.5 text-sm text-neutral-600">{r.detail}</p>
                  {r.urls.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-xs text-neutral-500">
                      {r.urls.slice(0, 10).map(u => <li key={u}>{path(u)}</li>)}
                      {r.urls.length > 10 && <li>+{r.urls.length - 10} more</li>}
                    </ul>
                  )}
                </div>
              )
            })}
          </section>
        ))}

        <div className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-400">
          Prepared by Hyperbole Digital · {date}
        </div>
      </div>
    </div>
  )
}
