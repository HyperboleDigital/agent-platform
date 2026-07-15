import { useState } from 'react'
import useSWR, { mutate } from 'swr'
import { toast } from 'sonner'
import { FileBarChart, Plus, Send, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import type { Report } from '@/lib/api'
import { useClientCtx } from '@/pages/client/ClientLayout'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatTile } from '@/components/stat-tile'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/empty-state'

function pct(n: number) {
  return `${Math.round(n * 100)}%`
}

function ReportView({ report }: { report: Report }) {
  const d = report.data
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Conversations this month" value={`${d.chat.conversationsThisMonth} / ${d.chat.monthlyCap}`} />
        <StatTile label="Resolved by bot" value={pct(d.chat.resolvedRate)} />
        <StatTile label="Est. hours saved" value={`${d.chat.estimatedHoursSaved}h`} />
        <StatTile label="Requests completed" value={d.requestsClosed} />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="SEO score"
          value={d.seo ? (
            <span className="flex items-baseline gap-1.5">
              {d.seo.lastScore}
              {d.seo.delta !== 0 && (
                <span className={d.seo.delta > 0 ? 'text-xs text-success' : 'text-xs text-destructive'}>
                  {d.seo.delta > 0 ? '+' : ''}{d.seo.delta}
                </span>
              )}
            </span>
          ) : '—'}
        />
        <StatTile label="AI mention rate" value={d.visibility ? pct(d.visibility.mentionRate) : '—'} />
        <StatTile label="Questions answered" value={d.chat.questionsAnswered} />
        <StatTile label="Leads captured" value={d.chat.totalLeadsCaptured} />
      </div>
      {d.siteHealth && (
        <div className="rounded-md border border-border bg-muted/30 p-3">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-medium">Site health</span>
            <span className="text-lg font-semibold">{d.siteHealth.score}/100</span>
          </div>
          {d.siteHealth.topIssues.length > 0 && (
            <ul className="mt-1.5 flex flex-col gap-0.5 text-xs text-muted-foreground">
              {d.siteHealth.topIssues.map((iss, i) => (
                <li key={i}>[{iss.severity}] {iss.title}{iss.count ? ` · ${iss.count}` : ''}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function SendDialog({ clientId, report, onClose }: { clientId: string; report: Report; onClose: () => void }) {
  const [to, setTo] = useState('')
  const [sending, setSending] = useState(false)

  async function send() {
    if (!to.trim()) return
    setSending(true)
    try {
      const result = await api.clients.sendReport(clientId, report.id, to.trim())
      if (result.sent) {
        toast.success(result.testMode
          ? `Test mode: sent to ${result.recipient} (redirected from ${to.trim()})`
          : `Report sent to ${result.recipient}`)
        mutate(['reports', clientId])
        onClose()
      } else {
        const reasons: Record<string, string> = {
          no_sender_configured: 'No platform sender is configured (PLATFORM_SENDER_CLIENT_ID).',
          sender_not_connected: "The platform sender's Gmail isn't connected.",
          daily_cap_reached: 'The daily email cap has been reached.'
        }
        toast.error(reasons[result.reason ?? ''] ?? 'The email was not sent.')
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Card className="w-full max-w-md" onClick={e => e.stopPropagation()}>
        <CardHeader><CardTitle>Send report</CardTitle></CardHeader>
        <CardContent className="grid gap-3 pt-0">
          <div className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>Test mode is controlled server-side. If it's on, the email is redirected to the test inbox regardless of the address below.</span>
          </div>
          <Input value={to} onChange={e => setTo(e.target.value)} placeholder="recipient@client.com" type="email" />
          <div className="flex gap-2">
            <Button onClick={send} disabled={sending || !to.trim()} size="sm">
              <Send className="h-3.5 w-3.5" />
              {sending ? 'Sending…' : 'Send email'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function Reports() {
  const { clientId } = useClientCtx()
  const { data: reports, isLoading } = useSWR(['reports', clientId], () => api.clients.reports(clientId))
  const { data: me } = useSWR('me', api.me)
  const [generating, setGenerating] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sendingReport, setSendingReport] = useState<Report | null>(null)

  const selected = reports?.find(r => r.id === selectedId) ?? reports?.[0] ?? null

  async function generate() {
    setGenerating(true)
    try {
      const report = await api.clients.generateReport(clientId)
      mutate(['reports', clientId])
      setSelectedId(report.id)
      toast.success('Report generated')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate report')
    } finally {
      setGenerating(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Reports</h2>
          <p className="text-sm text-muted-foreground">Performance snapshots across SEO, AI visibility, and your chatbot.</p>
        </div>
        <Button onClick={generate} disabled={generating} size="sm">
          <Plus className="h-3.5 w-3.5" />
          {generating ? 'Generating…' : 'Generate report'}
        </Button>
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {!isLoading && reports?.length === 0 && (
        <Card>
          <CardContent>
            <EmptyState icon={FileBarChart} title="No reports yet" description="Generate your first performance report above." />
          </CardContent>
        </Card>
      )}

      {!!reports?.length && (
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <Card className="h-fit overflow-hidden p-0">
            <div className="p-3 pb-1"><span className="text-xs font-medium text-muted-foreground">Reports</span></div>
            <div className="flex flex-col">
              {reports.map(r => (
                <button
                  key={r.id}
                  onClick={() => setSelectedId(r.id)}
                  className={`flex flex-col items-start gap-0.5 border-t border-border px-3 py-2.5 text-left text-sm transition-colors first:border-t-0 hover:bg-accent/60 ${
                    selected?.id === r.id ? 'bg-accent' : ''
                  }`}
                >
                  <span className="font-medium">{r.periodStart} – {r.periodEnd}</span>
                  <span className="text-xs text-muted-foreground">
                    {r.sentAt ? `Sent ${new Date(r.sentAt).toLocaleDateString()}` : 'Not sent'}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {selected && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>{selected.periodStart} – {selected.periodEnd}</CardTitle>
                {me?.isSuperadmin && (
                  <Button size="sm" variant="secondary" onClick={() => setSendingReport(selected)}>
                    <Send className="h-3.5 w-3.5" /> Send report
                  </Button>
                )}
              </CardHeader>
              <CardContent className="pt-0">
                <ReportView report={selected} />
                {selected.sentTo && (
                  <p className="mt-4 text-xs text-muted-foreground">
                    Last sent to {selected.sentTo} on {new Date(selected.sentAt!).toLocaleString()}.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {sendingReport && <SendDialog clientId={clientId} report={sendingReport} onClose={() => setSendingReport(null)} />}
    </div>
  )
}
