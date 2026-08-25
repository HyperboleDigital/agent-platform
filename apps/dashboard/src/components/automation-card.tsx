import { useState } from 'react'
import useSWR from 'swr'
import { toast } from 'sonner'
import { Play, Zap } from 'lucide-react'
import { api, type ClientAutomation } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge, StatusDot } from '@/components/ui/badge'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table'

// Superadmin-only "Automation" card on a client's SEO page (handoff #3 §1d):
// this client's scheduled jobs, their next/last run + cost, run-now, an
// enable/disable toggle, and the monthly paid-job budget. The fleet-wide
// twin lives at /jobs — this is the per-client slice.

function statusVariant(status: string | null): 'success' | 'warning' | 'destructive' | 'secondary' {
  switch (status) {
    case 'ok': return 'success'
    case 'partial': case 'setup_incomplete': case 'budget_exceeded': return 'warning'
    case 'failed': return 'destructive'
    default: return 'secondary'
  }
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtCost(cents: number | null): string {
  if (cents == null) return '—'
  return `$${(cents / 100).toFixed(2)}`
}

export function AutomationCard({ clientId }: { clientId: string }) {
  const { data, mutate } = useSWR(['automation', clientId], () => api.clients.automation(clientId))
  const [running, setRunning] = useState<string | null>(null)
  const [editingBudget, setEditingBudget] = useState(false)
  const [budgetInput, setBudgetInput] = useState('')

  if (!data || data.jobs.length === 0) return null

  async function runNow(jobId: string, label: string) {
    setRunning(jobId)
    try {
      const result = await api.overview.runJob(jobId)
      if (result.status === 'ok') toast.success(`${label}: ${result.detail ?? 'ok'}`)
      else toast.warning(`${label}: ${result.detail ?? result.status}`)
      void mutate()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Job run failed')
    } finally {
      setRunning(null)
    }
  }

  async function toggle(jobId: string, enabled: boolean) {
    try {
      const next = await api.clients.toggleJob(clientId, jobId, enabled)
      mutate(next, false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to toggle job')
    }
  }

  async function saveBudget() {
    const dollars = Number(budgetInput)
    if (!Number.isFinite(dollars) || dollars < 0) { toast.error('Enter a dollar amount'); return }
    try {
      const next = await api.clients.setJobBudget(clientId, Math.round(dollars * 100))
      mutate(next, false)
      setEditingBudget(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update budget')
    }
  }

  const { budget } = data

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-4 w-4" /> Automation <Badge variant="secondary">superadmin</Badge>
        </CardTitle>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {editingBudget ? (
            <span className="flex items-center gap-1">
              Budget $
              <input
                className="w-16 rounded border border-border bg-background px-1 py-0.5 text-xs"
                value={budgetInput}
                onChange={e => setBudgetInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') void saveBudget() }}
                autoFocus
              />
              <Button size="sm" variant="secondary" onClick={saveBudget}>Save</Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)}>Cancel</Button>
            </span>
          ) : (
            <button
              type="button"
              className={`underline-offset-2 hover:underline ${budget.overBudget ? 'text-destructive' : ''}`}
              onClick={() => { setBudgetInput((budget.budgetCents / 100).toFixed(2)); setEditingBudget(true) }}
              title="Monthly ceiling on paid API spend for this client's scheduled jobs — click to change"
            >
              Spend {fmtCost(budget.spentCents)} of {fmtCost(budget.budgetCents)} this month
              {budget.overBudget && ' — paid jobs paused'}
            </button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Cadence</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Next run</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.jobs.map(job => (
                <TableRow key={job.id} className={job.enabled ? '' : 'opacity-50'}>
                  <TableCell className="font-medium">
                    {job.label}
                    {!job.implemented && <Badge variant="warning" className="ml-2">no handler</Badge>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{job.cadence}</TableCell>
                  <TableCell className="text-muted-foreground">{fmtDate(job.lastRunAt)}</TableCell>
                  <TableCell>
                    {job.lastStatus ? (
                      <span className="flex items-center gap-1.5 text-xs" title={job.lastError ?? undefined}>
                        <StatusDot variant={statusVariant(job.lastStatus)} /> {job.lastStatus}
                      </span>
                    ) : <span className="text-xs text-muted-foreground">never run</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{fmtCost(job.lastCostCents)}</TableCell>
                  <TableCell className="text-muted-foreground">{job.enabled ? fmtDate(job.nextRunAt) : 'disabled'}</TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm" variant="ghost" title="Run now (bypasses the budget)"
                        onClick={() => runNow(job.id, job.label)}
                        disabled={running !== null}
                      >
                        <Play className={`h-3.5 w-3.5 ${running === job.id ? 'animate-pulse' : ''}`} />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => toggle(job.id, !job.enabled)}>
                        {job.enabled ? 'Disable' : 'Enable'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        {data.recentRuns.length > 0 && (
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted-foreground">Run history ({data.recentRuns.length})</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {data.recentRuns.map(run => (
                <li key={run.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusDot variant={statusVariant(run.status)} />
                  <span className="w-28 shrink-0">{new Date(run.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                  <span className="w-36 shrink-0 font-medium text-foreground">{run.label}</span>
                  <span className="w-14 shrink-0">{fmtCost(run.costCents)}</span>
                  <span className="truncate">{run.error ?? run.status}</span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  )
}
