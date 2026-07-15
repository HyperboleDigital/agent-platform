import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Search, FileText } from 'lucide-react'
import { api } from '@/lib/api'
import { downloadAuditPdf } from '@/lib/audit-pdf'
import type { SeoCrawl } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { AuditReport } from '@/components/audit-report'

// Superadmin tool: run a full-site SEO audit on ANY url on demand (e.g. a sales
// prospect's site). Manual only — nothing here runs automatically. Backed by the
// overview router's superadmin-guarded /overview/audits endpoints.
const AUDITS_KEY = 'adhoc-audits'

export default function AuditTool() {
  const [url, setUrl] = useState('')
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState<SeoCrawl | null>(null)
  const { data: recent } = useSWR(AUDITS_KEY, api.overview.audits)

  async function run() {
    const target = url.trim()
    if (!target) return
    setRunning(true)
    setActive(null)
    try {
      let current = await api.overview.startAudit(target)
      setActive(current)
      while (current.status === 'running') {
        await new Promise(r => setTimeout(r, 6000))
        current = await api.overview.refreshAudit(current.id)
        setActive(current)
      }
      if (current.status === 'failed') toast.error(current.error ?? 'Audit failed')
      else toast.success('Audit complete')
      mutate(AUDITS_KEY)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold">Audit Tool</h1>
        <p className="text-sm text-muted-foreground">
          Run a full-site SEO audit on any URL — great for auditing a prospect before a sales call.
          Each run costs a few cents. Manual only; nothing runs automatically.
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center">
          <Input
            value={url}
            onChange={e => setUrl(e.target.value)}
            placeholder="example.com"
            onKeyDown={e => { if (e.key === 'Enter') run() }}
            disabled={running}
            className="flex-1"
          />
          <Button onClick={run} disabled={running || !url.trim()}>
            <Search className="h-3.5 w-3.5" />{running ? 'Auditing…' : 'Run audit'}
          </Button>
        </CardContent>
      </Card>

      {active && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <CardTitle className="truncate">{active.url}</CardTitle>
            {active.status === 'finished' && (
              <button
                onClick={() => downloadAuditPdf(active)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <FileText className="h-3.5 w-3.5" /> Download PDF
              </button>
            )}
          </CardHeader>
          <CardContent className="pt-0">
            {active.status === 'running' && (
              <p className="text-sm text-muted-foreground">
                Crawling the site{active.pagesCrawled ? ` — ${active.pagesCrawled} pages so far` : ''}… this usually takes about a minute. You can leave this page; the audit keeps running.
              </p>
            )}
            {active.status === 'failed' && <p className="text-sm text-destructive">{active.error ?? 'Audit failed'}</p>}
            {active.status === 'finished' && <AuditReport crawl={active} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent audits</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {recent && recent.length > 0 ? (
            <div className="flex flex-col divide-y divide-border">
              {recent.map(a => (
                <div key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <button onClick={() => setActive(a)} className="flex min-w-0 flex-1 items-center justify-between text-left text-muted-foreground hover:text-foreground">
                    <span className="truncate">{a.url}</span>
                    <span className="ml-3 shrink-0">
                      {a.status === 'finished' && a.onpageScore != null ? `${Math.round(a.onpageScore)}/100` : a.status}
                    </span>
                  </button>
                  {a.status === 'finished' && (
                    <button onClick={() => downloadAuditPdf(a)} className="shrink-0 text-muted-foreground hover:text-foreground" title="Download PDF">
                      <FileText className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState icon={Search} title="No audits yet" description="Enter a URL above to run your first audit." />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
