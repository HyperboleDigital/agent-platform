import { randomUUID } from 'crypto'
import type { SiteImportResult } from './site-import'

// In-memory progress tracking for website imports, so the dashboard can show
// "Importing… 12/20 pages" instead of a spinner that sits there for a minute.
// Same single-instance assumption as lib/rate-limit.ts: the API runs as one
// Railway process, so a Map is enough — no table, no scheduler. Jobs are
// pruned after an hour; the dashboard only polls while one is running.

export interface ImportJob {
  id: string
  clientId: string
  status: 'running' | 'done' | 'failed'
  // Total pages queued for import. 0 until discovery finishes.
  total: number
  // Pages processed so far (imported + skipped).
  done: number
  imported: number
  skipped: number
  // Pages stored without vectors (Voyage rate-limited mid-import). They're
  // still live via keyword search and get embedded by the backfill script.
  unembedded: number
  discovery: SiteImportResult['discovery'] | null
  error: string | null
  result: SiteImportResult | null
  startedAt: number
}

const jobs = new Map<string, ImportJob>()
const JOB_TTL_MS = 60 * 60 * 1000

function prune(): void {
  const cutoff = Date.now() - JOB_TTL_MS
  for (const [id, job] of jobs) {
    if (job.startedAt < cutoff) jobs.delete(id)
  }
}

export function createImportJob(clientId: string): ImportJob {
  prune()
  const job: ImportJob = {
    id: randomUUID(),
    clientId,
    status: 'running',
    total: 0,
    done: 0,
    imported: 0,
    skipped: 0,
    unembedded: 0,
    discovery: null,
    error: null,
    result: null,
    startedAt: Date.now()
  }
  jobs.set(job.id, job)
  return job
}

// clientId scopes the lookup so one client's job id can't read another's.
export function getImportJob(clientId: string, jobId: string): ImportJob | null {
  const job = jobs.get(jobId)
  return job && job.clientId === clientId ? job : null
}
