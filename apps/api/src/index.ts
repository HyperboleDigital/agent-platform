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
import { webhookRouter } from './routes/webhooks'
import { billingRouter, stripeWebhookHandler } from './routes/billing'
import { overviewRouter } from './routes/overview'
import { getIdentity } from './lib/authz'
import { reconcileUserMembership } from './lib/clients'
import { finalizePendingCrawls } from './lib/dataforseo'

const app = express()
const PORT = process.env.PORT ?? 3001

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet())

// Fail closed: an explicit allow-list is required. A wildcard CORS default on
// an API that also serves authenticated admin routes is a real hole.
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(o => o.trim()).filter(Boolean)
if (!allowedOrigins?.length) {
  console.warn('[cors] ALLOWED_ORIGINS is not set — cross-origin requests will be rejected. Set it for the dashboard/widget origins that need access.')
}
app.use(cors({ origin: allowedOrigins ?? [] }))

// Stripe webhook signature verification needs the exact raw bytes Stripe
// signed — must be registered with express.raw() BEFORE the global
// express.json() below, or the body would already be parsed/mutated.
app.post('/billing/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler)

app.use(express.json({ limit: '1mb' }))
app.use(clerkMiddleware()) // attaches req.auth when a Clerk session is present; doesn't block anonymous requests

// Rate limit: 60 requests/min per IP (baseline; per-client limits live on
// /chat and /contact specifically — see those routers)
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true }))

// Requires a signed-in Clerk user (any authenticated identity — per-resource
// tenant scoping happens inside the routers via lib/authz).
const requireAuth: RequestHandler = (req, res, next) => {
  if (!getIdentity(req)) return res.status(401).json({ error: 'Unauthorized' })
  next()
}

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/chat', chatRouter)                    // widget → agent (public)
app.use('/contact', contactRouter)              // widget contact form → human (public)
app.use('/auth', authRouter)                    // Gmail OAuth callback only (public — Google redirects here)
app.use('/clients', requireAuth, clientsRouter) // dashboard CRUD (auth + per-tenant authz)
app.use('/webhooks', requireAuth, webhookRouter) // external triggers (auth)
app.use('/billing', requireAuth, billingRouter) // Stripe checkout/portal/status (auth + per-tenant authz)
app.use('/overview', requireAuth, overviewRouter) // platform-wide rollups (auth + superadmin-only)

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

// Signed-in identity, for the dashboard to render role-aware nav (superadmin
// console vs. scoped client view).
app.get('/me', requireAuth, (req, res) => {
  const identity = getIdentity(req)!
  res.json({ userId: identity.userId, orgId: identity.orgId, isSuperadmin: identity.isSuperadmin })
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
