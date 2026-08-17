import 'dotenv/config'
import express from 'express'
import type { RequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { clerkMiddleware } from '@clerk/express'
import { chatRouter } from './routes/chat'
import { contactRouter } from './routes/contact'
import { authRouter } from './routes/auth'
import { clientsRouter } from './routes/clients'
import { analyticsRouter } from './routes/analytics'
import { webhookRouter, clerkWebhookHandler } from './routes/webhooks'
import { billingRouter, stripeWebhookHandler } from './routes/billing'
import { overviewRouter } from './routes/overview'
import { prospectingRouter } from './routes/prospecting'
import { previewRouter } from './routes/preview'
import { widgetConfigRouter } from './routes/widget-config'
import { getIdentity } from './lib/authz'
import { reconcileUserMembership } from './lib/clients'
import { finalizePendingCrawls } from './lib/dataforseo'
import { failOrphanedRuns } from './lib/prospect-generation-runs'
import { runMonthlyReports, isReportWindow } from './lib/report-scheduler'
import { runScheduledSiteChecks } from './lib/site-monitor'

const app = express()
const PORT = process.env.PORT ?? 3001

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet())

// CORS is deliberately split in two, and the split is load-bearing.
//
// The embeddable chat widget runs on ARBITRARY client domains — every customer
// site that pastes the script tag is a different origin, and we can't know them
// in advance. So the widget's own public routes accept any origin. They are
// already anonymous and per-client rate-limited, so allowing cross-origin calls
// doesn't widen what an unauthenticated caller can reach; it only stops the
// browser from blocking a request the server would have served anyway.
//
// Everything else — /clients, /overview, /prospecting, /billing — stays behind
// a fail-closed allow-list, because those ARE authenticated and a wildcard
// there would be a real hole. Do not "simplify" this into one app.use(cors()).
const WIDGET_PUBLIC_PATHS = ['/chat', '/contact', '/widget-config']
const widgetCors = cors({ origin: '*' })

const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)
if (!allowedOrigins?.length) {
  console.warn('[cors] ALLOWED_ORIGINS is not set — cross-origin requests will be rejected. Set it for the dashboard origins that need access.')
}
const strictCors = cors({ origin: allowedOrigins ?? [] })

app.use((req, res, next) => {
  const isWidgetPath = WIDGET_PUBLIC_PATHS.some(p => req.path === p || req.path.startsWith(`${p}/`))
  return isWidgetPath ? widgetCors(req, res, next) : strictCors(req, res, next)
})

// Stripe webhook signature verification needs the exact raw bytes Stripe
// signed — must be registered with express.raw() BEFORE the global
// express.json() below, or the body would already be parsed/mutated.
app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)

// Same reasoning as the Stripe webhook above — Svix signature verification
// needs Clerk's exact raw bytes, and this is an unauthenticated,
// signature-verified external caller, not a dashboard request.
app.post('/webhooks/clerk', express.raw({ type: 'application/json' }), clerkWebhookHandler)

app.use(express.json({ limit: '1mb' }))
app.use(clerkMiddleware()) // attaches req.auth when a Clerk session is present; doesn't block anonymous requests

// Baseline abuse limit per IP; per-client limits live on /chat and /contact
// specifically (see those routers), which is where untrusted public traffic
// actually arrives. This ceiling has to clear normal *dashboard* usage: one
// client page fans out a dozen authenticated calls, so a low cap here reads to
// the user as "the API is down" rather than "you were throttled".
//
// /health is exempt deliberately. The app shell polls it every 15s to tell
// "API is down" apart from "you're logged out" — throttling that turns a
// burst of ordinary navigation into a full-screen server-down error.
app.use(rateLimit({
  windowMs: 60_000,
  max: Number(process.env.API_RATE_LIMIT_PER_MIN ?? 300),
  standardHeaders: true,
  skip: req => req.path === '/health'
}))

// Requires a signed-in Clerk user (any authenticated identity — per-resource
// tenant scoping happens inside the routers via lib/authz).
const requireAuth: RequestHandler = (req, res, next) => {
  if (!getIdentity(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/chat', chatRouter)                    // widget → agent (public)
app.use('/contact', contactRouter)              // widget contact form → human (public)
app.use('/widget-config', widgetConfigRouter)   // widget appearance config (public, read-only)
app.use('/auth', authRouter)                    // Gmail OAuth callback only (public — Google redirects here)
app.use('/p', previewRouter)                    // prospect mockup preview pages (public — prospects have no login)
app.use('/clients/:id/analytics', requireAuth, analyticsRouter) // client chat analytics (auth + per-tenant authz)
app.use('/clients', requireAuth, clientsRouter) // dashboard CRUD (auth + per-tenant authz)
app.use('/webhooks', requireAuth, webhookRouter) // external triggers (auth)
app.use('/billing', requireAuth, billingRouter) // Stripe checkout/portal/status (auth + per-tenant authz)
app.use('/overview', requireAuth, overviewRouter) // platform-wide rollups (auth + superadmin-only)
app.use('/prospecting', requireAuth, prospectingRouter) // cold-outreach prospecting (auth + superadmin-only)

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

// Signed-in identity, for the dashboard to render role-aware nav (superadmin
// console vs. scoped client view).
app.get('/me', requireAuth, (req, res) => {
  const identity = getIdentity(req)!
  res.json({
    userId: identity.userId,
    orgId: identity.orgId,
    orgRole: identity.orgRole,
    isSuperadmin: identity.isSuperadmin
  })
})

// Best-effort self-heal for a signed-in user with no org: if they have a
// pending client invitation for their email, join them to that org. The
// frontend calls this once when it detects no active org + no memberships, then
// reloads so Clerk picks up the new membership. Returns the joined org id.
app.post('/reconcile', requireAuth, async (req, res) => {
  const identity = getIdentity(req)!
  try {
    const orgId = await reconcileUserMembership(identity.userId)
    res.json({ orgId })
  } catch (err) {
    console.error('[reconcile] error', err)
    res.status(500).json({ error: 'Reconcile failed' })
  }
})

app.listen(PORT, () => console.log(`API running on :${PORT}`))

// In-process crawl finalizer. This platform has no general scheduler by design;
// this timer is deliberately narrow — it only drives already-started DataForSEO
// crawls to completion (or trips their timeout), so an audit finishes whether or
// not a dashboard tab is left open to poll it. It is job completion, not
// business automation. `.unref()` keeps it from holding the process open.
// A generation run lives in memory for the life of the process, so anything
// still marked 'running' at boot died with the previous one. Marking those
// failed at startup stops the dashboard polling a job that will never finish.
void failOrphanedRuns().catch(err =>
  console.error('[startup] failed to clear orphaned generation runs', err instanceof Error ? err.message : err))

// Monthly health report (Care tier). This is the ONE scheduler allowed to send
// client email — see lib/report-scheduler.ts's header for the four conditions
// that make it safe, chiefly a unique (client_id, period_key) claim row that
// makes a duplicate send impossible at the database level rather than in code.
// Checked hourly but only acts in the first days of a month, and only ever for
// the month that just ended, so there is no backfill burst after downtime.
const REPORT_CHECK_INTERVAL_MS = 60 * 60 * 1000
let reportRunning = false
setInterval(async () => {
  if (reportRunning || !isReportWindow()) return
  reportRunning = true
  try {
    await runMonthlyReports()
  } catch (err) {
    console.error('[report-scheduler] error', err instanceof Error ? err.message : err)
  } finally {
    reportRunning = false
  }
}, REPORT_CHECK_INTERVAL_MS).unref()

// Unattended uptime/SSL (daily) and PageSpeed (weekly) checks — see
// lib/site-monitor.ts for the cadences and why they differ. Ticks hourly, but
// each client is skipped unless its stored result has actually aged out, so
// this is cheap and a redeploy can't cause a burst of checks.
const SITE_CHECK_INTERVAL_MS = 60 * 60 * 1000
let siteChecking = false
setInterval(async () => {
  if (siteChecking) return
  siteChecking = true
  try {
    await runScheduledSiteChecks()
  } catch (err) {
    console.error('[site-monitor] error', err instanceof Error ? err.message : err)
  } finally {
    siteChecking = false
  }
}, SITE_CHECK_INTERVAL_MS).unref()

const FINALIZE_INTERVAL_MS = 20_000
let finalizing = false
setInterval(async () => {
  if (finalizing) return
  finalizing = true
  try {
    await finalizePendingCrawls()
  } catch (err) {
    console.error('[finalizer] error', err instanceof Error ? err.message : err)
  } finally {
    finalizing = false
  }
}, FINALIZE_INTERVAL_MS).unref()
