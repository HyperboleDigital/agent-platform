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
import { getIdentity } from './lib/authz'

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

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

// Signed-in identity, for the dashboard to render role-aware nav (superadmin
// console vs. scoped client view).
app.get('/me', requireAuth, (req, res) => {
  const identity = getIdentity(req)!
  res.json({ userId: identity.userId, orgId: identity.orgId, isSuperadmin: identity.isSuperadmin })
})

app.listen(PORT, () => console.log(`API running on :${PORT}`))
