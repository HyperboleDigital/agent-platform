import { useState } from 'react'
import useSWR from 'swr'
import { AlertTriangle, CheckCircle2, Circle, Play, Plus, RefreshCw, Trash2, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { api, type ClientJobs, type JobRow, type JobTypeInfo } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

// Superadmin Jobs view (handoff #2 §1) — the operational backbone, and it has
// to be honest: every client × every job their entitlements promise, with
// last-run truth on each. Warnings (promised-but-not-scheduled, failed runs,
// unimplemented handlers) are the entire point — do not soften them.

function timeAgo(iso: string | null): string {
  if (!iso) return 'never'
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function timeUntil(iso: string | null): string {
  if (!iso) return '—'
  const mins = Math.floor((new Date(iso).getTime() - Date.now()) / 60000)
  if (mins <= 0) return 'due now'
  if (mins < 60) return `in ${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 48) return `in ${hours}h`
  return `in ${Math.floor(hours / 24)}d`
}

function StatusIcon({ job }: { job: JobRow }) {
  if (!job.lastRunAt) return <Circle className="h-4 w-4 text-muted-foreground/50" />
  if (job.lastStatus === 'ok') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (job.lastStatus === 'partial') return <AlertTriangle className="h-4 w-4 text-amber-500" />
  return <XCircle className="h-4 w-4 text-red-500" />
}

function JobLine({ clientId, job, onRan }: { clientId: string; job: JobRow; onRan: () => void }) {
  const [running, setRunning] = useState(false)
  const [toggling, setToggling] = useState(false)

  // Per-client opt-out (sticky): disabling sets admin_disabled so the hourly
  // reconcile sweep leaves it off; enabling hands the row back to reconcile.
  async function toggle() {
    setToggling(true)
    try {
      await api.clients.toggleJob(clientId, job.id, !job.enabled)
      toast.success(`${job.label} ${job.enabled ? 'disabled for this client' : 're-enabled'}`)
      onRan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setToggling(false)
    }
  }

  async function runNow() {
    setRunning(true)
    try {
      const result = await api.overview.runJob(job.id)
      if (result.status === 'ok') toast.success(`${job.label}: ok${result.detail ? ` — ${result.detail}` : ''}`)
      else toast.warning(`${job.label}: ${result.status}${result.detail ? ` — ${result.detail}` : ''}`)
      onRan()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Run failed')
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-3 py-2">
      <StatusIcon job={job} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">{job.label}</span>
          <Badge variant="outline" className="text-[10px]">{job.cadence}</Badge>
          {!job.implemented && (
            <Badge variant="destructive" className="text-[10px]">no handler</Badge>
          )}
          {job.adminAdded && <Badge variant="outline" className="text-[10px]">manual</Badge>}
          {!job.enabled && (
            <Badge variant="secondary" className="text-[10px]">
              {job.adminDisabled ? 'disabled (by you — stays off)' : 'disabled'}
            </Badge>
          )}
        </div>
        {job.lastError && (
          <p className="truncate text-xs text-muted-foreground" title={job.lastError}>{job.lastError}</p>
        )}
      </div>
      <div className="hidden text-right text-xs text-muted-foreground sm:block">
        <div>ran {timeAgo(job.lastRunAt)}</div>
        <div>next {timeUntil(job.nextRunAt)}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={toggle} disabled={toggling}>
        {job.enabled ? 'Disable' : 'Enable'}
      </Button>
      {job.adminAdded && (
        <Button
          size="sm" variant="ghost" title="Remove this hand-scheduled job"
          onClick={async () => {
            try { await api.clients.removeJob(clientId, job.id); onRan() }
            catch (err) { toast.error(err instanceof Error ? err.message : 'Remove failed') }
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={runNow} disabled={running} title="Run now">
        <Play className={`h-3.5 w-3.5 ${running ? 'animate-pulse' : ''}`} />
      </Button>
    </div>
  )
}

// Hand-schedule any job for this client — including clients with no tier
// yet (pre-onboarding). The row is marked admin_added so reconcile leaves it
// alone; delete it when done.
function AddJobControl({ client, jobTypes, onAdded }: { client: ClientJobs; jobTypes: JobTypeInfo[]; onAdded: () => void }) {
  const available = jobTypes.filter(t => t.implemented && !client.jobs.some(j => j.jobType === t.jobType && j.enabled))
  const [jobType, setJobType] = useState('')
  const [cadence, setCadence] = useState<'daily' | 'weekly' | 'monthly'>('monthly')
  const [adding, setAdding] = useState(false)
  if (available.length === 0) return null

  async function add() {
    if (!jobType) return
    setAdding(true)
    try {
      await api.clients.addJob(client.clientId, jobType, cadence)
      toast.success(`${jobTypes.find(t => t.jobType === jobType)?.label ?? jobType} scheduled for ${client.clientName}`)
      setJobType('')
      onAdded()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add job')
    } finally {
      setAdding(false)
    }
  }

  return (
    <div className="flex items-center gap-2 pt-3">
      <select
        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        value={jobType}
        onChange={e => setJobType(e.target.value)}
      >
        <option value="">Add a job…</option>
        {available.map(t => (
          <option key={t.jobType} value={t.jobType} title={t.description}>{t.label}</option>
        ))}
      </select>
      <select
        className="h-8 rounded-md border border-border bg-background px-2 text-xs"
        value={cadence}
        onChange={e => setCadence(e.target.value as 'daily' | 'weekly' | 'monthly')}
      >
        <option value="daily">daily</option>
        <option value="weekly">weekly</option>
        <option value="monthly">monthly</option>
      </select>
      <Button size="sm" variant="outline" onClick={add} disabled={adding || !jobType}>
        <Plus className="h-3.5 w-3.5" /> Schedule
      </Button>
    </div>
  )
}

function ClientCard({ client, jobTypes, onRan }: { client: ClientJobs; jobTypes: JobTypeInfo[]; onRan: () => void }) {
  const failed = client.jobs.filter(j => j.enabled && j.lastStatus === 'failed').length
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {client.clientName}
          {client.tierName && <Badge variant="secondary">{client.tierName}</Badge>}
          {failed > 0 && <Badge variant="destructive">{failed} failing</Badge>}
        </CardTitle>
        {client.missing.length > 0 && (
          <div className="flex items-start gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Entitled but not scheduled: {client.missing.join(', ')}. Their plan promises this and
              nothing is delivering it — run reconcile, or check why the row was disabled.
            </span>
          </div>
        )}
      </CardHeader>
      <CardContent className="divide-y">
        {client.jobs.length === 0
          ? <p className="py-2 text-sm text-muted-foreground">No jobs scheduled{client.tierName ? '' : ' — no tier assigned; schedule manually below if needed'}.</p>
          : client.jobs.map(j => <JobLine key={j.id} clientId={client.clientId} job={j} onRan={onRan} />)}
        <AddJobControl client={client} jobTypes={jobTypes} onAdded={onRan} />
      </CardContent>
    </Card>
  )
}

export default function Jobs() {
  const { data: clients, mutate, isLoading, error } = useSWR('jobs-overview', api.overview.jobs, { refreshInterval: 30_000 })
  const { data: jobTypes } = useSWR('job-types', api.overview.jobTypes)
  const [reconciling, setReconciling] = useState(false)
  const [clientFilter, setClientFilter] = useState<string>('all')

  async function reconcile() {
    setReconciling(true)
    try {
      const fresh = await api.overview.reconcileJobs()
      await mutate(fresh, { revalidate: false })
      toast.success('Jobs reconciled against entitlements')
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Reconcile failed')
    } finally {
      setReconciling(false)
    }
  }

  const filtered = clientFilter === 'all' ? (clients ?? []) : (clients ?? []).filter(c => c.clientId === clientFilter)
  // A specifically selected client always gets a card — that's how a
  // not-yet-onboarded (no-tier) client gets jobs scheduled manually.
  const withWork = filtered.filter(c => clientFilter !== 'all' || c.jobs.length > 0 || c.missing.length > 0)
  const idle = clientFilter === 'all' ? filtered.filter(c => c.jobs.length === 0 && c.missing.length === 0) : []

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Scheduled Jobs</h1>
          <p className="text-sm text-muted-foreground">
            Every recurring deliverable per client — provisioned automatically from tier and add-ons.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            value={clientFilter}
            onChange={e => setClientFilter(e.target.value)}
            title="Show one client's jobs"
          >
            <option value="all">All clients</option>
            {(clients ?? []).map(c => (
              <option key={c.clientId} value={c.clientId}>{c.clientName}</option>
            ))}
          </select>
          <Button variant="outline" onClick={reconcile} disabled={reconciling}>
            <RefreshCw className={`h-4 w-4 ${reconciling ? 'animate-spin' : ''}`} />
            Reconcile
          </Button>
        </div>
      </div>

      {isLoading && !error && <p className="text-sm text-muted-foreground">Loading…</p>}
      {error && (
        <Card>
          <CardContent className="py-6 text-sm">
            <p className="font-medium text-red-500">Jobs backend unavailable</p>
            <p className="mt-1 text-muted-foreground">
              {error instanceof Error ? error.message : 'Failed to load jobs.'}
              {String(error).includes('scheduled_jobs') &&
                ' — the scheduled_jobs migration (supabase/migrate_2026-08-19_scheduled-jobs.sql) has not been run yet.'}
            </p>
          </CardContent>
        </Card>
      )}
      {withWork.map(c => <ClientCard key={c.clientId} client={c} jobTypes={jobTypes ?? []} onRan={() => mutate()} />)}
      {idle.length > 0 && (
        <p className="text-xs text-muted-foreground">
          No jobs (no tier): {idle.map(c => c.clientName).join(', ')} — select one above to schedule jobs manually.
        </p>
      )}
    </div>
  )
}
