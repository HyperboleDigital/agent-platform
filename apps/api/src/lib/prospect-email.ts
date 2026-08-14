import { generateValueDrafts } from './prospecting'
import { getProspect } from './prospecting'
import { listPreviews, createPreview, previewUrl } from './prospect-previews'
import { startAdhocCrawl, refreshAdhocCrawl, crawlConfigured, type SeoCrawl } from './dataforseo'
import { claudeCostMicros } from './llm/pricing'
import type { GenerationProgress } from './prospect-mockups'
import type { RunStep } from './prospect-generation-runs'

// The one-click outreach email, counterpart to runConceptWizard in
// prospect-mockups.ts. Same reasoning: the operator had three buttons here
// ("Generate drafts", "Generate value email", "Audit site") whose relationship
// wasn't discoverable — you had to know that the audit fed nothing into the
// email, and that the value email silently used whichever preview link
// happened to exist rather than the concept on screen. One button runs the
// whole thing in the right order and wires the outputs together.
//
// Order matters and isn't arbitrary: the preview link must exist before the
// email is written (the model needs the real URL to reference), and the audit
// must finish before the email is written (its findings are the email's
// substance). So the LLM call is unavoidably last.

// Audit before link, deliberately: a preview link can carry the crawl it was
// built with (the preview page renders the audit alongside the concept), so
// creating the link first would permanently attach a link with no audit data
// to the very email that talks about the audit.
export const EMAIL_STEPS: RunStep[] = [
  { key: 'audit', label: 'Audit their site', status: 'pending', pct: 0 },
  { key: 'link', label: 'Prepare concept link', status: 'pending', pct: 0 },
  { key: 'email', label: 'Write the email', status: 'pending', pct: 0 },
]

export interface EmailWizardOptions {
  // Which concept the email should link to — the one the operator has open,
  // not necessarily the newest. Null means "use any existing active link".
  mockupId?: string | null
  // Crawling costs money and takes minutes; skippable for a prospect whose
  // site was already audited or who has no site worth auditing.
  audit?: boolean
}

// DataForSEO crawls take minutes, and the job holds no HTTP connection open,
// so polling here is fine — but it must be bounded. A crawl that never
// finishes must not leave the run spinning forever with the operator unable
// to tell whether it's working.
const AUDIT_POLL_MS = 6000
const AUDIT_TIMEOUT_MS = 5 * 60 * 1000

// Turns raw crawl output into plain statements a business owner would
// recognize. Deliberately conservative: only issues the crawl actually
// reported, worst-first, capped at five so the email prompt can't be flooded
// into listing everything it was given.
function auditPoints(crawl: SeoCrawl): string[] {
  const points: string[] = []
  if (crawl.onpageScore != null) {
    points.push(`Their site scores ${Math.round(crawl.onpageScore)}/100 on a standard technical health check.`)
  }
  const rank = { high: 0, medium: 1, low: 2 }
  const issues = [...(crawl.issues ?? [])]
    .sort((a, b) => rank[a.severity] - rank[b.severity])
    .slice(0, 5)
  for (const issue of issues) {
    points.push(`${issue.title}${issue.count > 1 ? ` (affects ${issue.count} pages)` : ''} — ${issue.explanation}`)
  }
  return points
}

// Reports WHY it gave up rather than just returning null, so the step's detail
// tells the operator whether the crawl timed out or genuinely failed — those
// call for different follow-up and the run panel is the only place they'd see it.
type CrawlOutcome =
  | { ok: true; crawl: SeoCrawl }
  | { ok: false; reason: string }

async function waitForCrawl(crawlId: string): Promise<CrawlOutcome> {
  const startedAt = Date.now()
  let crawl = await refreshAdhocCrawl(crawlId)
  while (crawl.status === 'running') {
    if (Date.now() - startedAt > AUDIT_TIMEOUT_MS) {
      return { ok: false, reason: 'Still running after 5 minutes — wrote the email without it' }
    }
    await new Promise(r => setTimeout(r, AUDIT_POLL_MS))
    crawl = await refreshAdhocCrawl(crawlId)
  }
  if (crawl.status === 'finished') return { ok: true, crawl }
  return { ok: false, reason: crawl.error ?? 'Audit failed' }
}

export async function runEmailWizard(
  prospectId: string,
  progress?: GenerationProgress,
  opts: EmailWizardOptions = {}
): Promise<void> {
  const prospect = await getProspect(prospectId)
  if (!prospect) throw new Error('Prospect not found')

  // ── 1. Audit their current site ──────────────────────────────────────────
  let points: string[] = []
  let crawlId: string | null = null
  if (opts.audit === false) {
    await progress?.skip('audit', 'Skipped')
  } else if (!prospect.website) {
    await progress?.skip('audit', 'No website to audit')
  } else if (!crawlConfigured()) {
    await progress?.skip('audit', 'Crawl auditing is not configured')
  } else {
    await progress?.begin('audit', 90_000)
    try {
      const started = await startAdhocCrawl(prospect.website)
      const outcome = await waitForCrawl(started.id)
      if (outcome.ok) {
        crawlId = outcome.crawl.id
        points = auditPoints(outcome.crawl)
        await progress?.finish('audit', points.length ? `Found ${points.length} things to mention` : 'No issues found')
      } else {
        await progress?.skip('audit', outcome.reason)
      }
    } catch (err) {
      // A failed audit must not cost the operator the email. It degrades to
      // the concept-only version, which is still worth sending.
      await progress?.skip('audit', err instanceof Error ? err.message : 'Audit failed')
    }
  }

  // ── 2. A real, shareable link to the concept the operator picked ──────────
  await progress?.begin('link', 3_000)
  let link: string | null = null
  const previews = await listPreviews(prospectId)
  const active = previews.find(p => !p.revokedAt && (!opts.mockupId || p.mockupId === opts.mockupId))
  if (active) {
    link = previewUrl(active.previewToken)
    await progress?.finish('link', 'Reused the existing link')
  } else if (opts.mockupId) {
    const created = await createPreview(prospectId, { mockupId: opts.mockupId, crawlId })
    link = previewUrl(created.previewToken)
    await progress?.finish('link', 'Created a link for the selected concept')
  } else {
    await progress?.skip('link', 'No concept selected — the email will not include a link')
  }

  // ── 3. Write it ──────────────────────────────────────────────────────────
  await progress?.begin('email', 20_000)
  await generateValueDrafts(prospectId, {
    previewLink: link,
    auditPoints: points,
    onUsage: u => {
      void progress?.addCost({
        step: 'email', provider: 'anthropic', model: u.model, kind: 'tokens',
        qty: u.inputTokens + u.outputTokens, micros: claudeCostMicros(u.model, u),
      })
    },
  })
  await progress?.finish('email', points.length ? `Wrote the email with ${points.length} audit points` : 'Wrote the email')
}
