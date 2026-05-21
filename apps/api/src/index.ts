import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { chatRouter } from './routes/chat'
import { emailRouter } from './routes/email'
import { clientsRouter } from './routes/clients'
import { webhookRouter } from './routes/webhooks'

const app = express()
const PORT = process.env.PORT ?? 3001

// ── Security middleware ───────────────────────────────────────────────────────
app.use(helmet())
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*' }))
app.use(express.json({ limit: '1mb' }))

// Rate limit: 60 requests/min per IP
app.use(rateLimit({ windowMs: 60_000, max: 60, standardHeaders: true }))

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/chat', chatRouter)           // widget → agent
app.use('/email', emailRouter)         // Gmail webhook → agent
app.use('/clients', clientsRouter)     // dashboard CRUD
app.use('/webhooks', webhookRouter)    // n8n or external triggers

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }))

app.listen(PORT, () => console.log(`API running on :${PORT}`))
