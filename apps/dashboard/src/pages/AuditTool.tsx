import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import type { SeoCrawl } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/empty-state'
import { CrawlResults } from '@/components/crawl-results'

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
          <CardHeader>
            <CardTitle className="truncate">{active.url}</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {active.status === 'running' && <p className="text-sm text-muted-foreground">Crawling the site — this usually takes about a minute…</p>}
            {active.status === 'failed' && <p className="text-sm text-destructive">{active.error ?? 'Audit failed'}</p>}
            {active.status === 'finished' && <CrawlResults crawl={active} />}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle>Recent audits</CardTitle></CardHeader>
        <CardContent className="pt-0">
          {recent && recent.length > 0 ? (
            <div className="flex flex-col divide-y divide-border">
              {recent.map(a => (
                <button key={a.id} onClick={() => setActive(a)} className="flex items-center justify-between py-2 text-left text-sm text-muted-foreground hover:text-foreground">
                  <span className="truncate">{a.url}</span>
                  <span className="ml-3 shrink-0">
                    {a.status === 'finished' && a.onpageScore != null ? `${Math.round(a.onpageScore)}/100` : a.status}
                  </span>
                </button>
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
