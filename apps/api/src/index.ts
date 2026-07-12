import 'dotenv/config'
import express from 'express'
import type { RequestHandler } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { chatRouter } from './routes/chat'
import { contactRouter } from './routes/contact'
import { authRouter } from './routes/auth'
import { clientsRouter } from './routes/clients'
import { webhookRouter } from './routes/webhooks'

const app = express()
const PORT = process.env.PORT ?? 3001

// Bearer-token auth for admin/integration routes. Public routes (chat, email,
// health) are unauthenticated — the widget calls them anonymously and the rate
// limiter is the only gate there.
const requireSecret: RequestHandler = (req, res, next) => {
  const secret = process.env.API_SECRET
  if (!secret) return res.status(500).json({ error: 'API_SECRET not configured' })
  if (req.get('authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }))
app.use(express.json({ limit: '1mb' }))

// Rate limit: 60 requests/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true }))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/chat', chatRouter)                    // widget → agent (public)
app.use('/contact', contactRouter)              // widget contact form → human (public)
app.use('/auth', authRouter)                    // Gmail OAuth connect flow
app.use('/clients', requireSecret, clientsRouter) // dashboard CRUD (auth)
app.use('/webhooks', requireSecret, webhookRouter) // external triggers (auth)

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

app.listen(PORT, () => console.log(`API running on :${PORT}`))
