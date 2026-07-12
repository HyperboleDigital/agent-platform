import { Router } from 'express'
import { gmailConfigured, getAuthUrl, handleCallback } from '../lib/gmail'

export const authRouter = Router()

// Kick off Gmail OAuth for a client: /auth/gmail?clientId=<uuid>
authRouter.get('/gmail', (req, res) => {
  if (!gmailConfigured()) return res.status(500).json({ error: 'Gmail OAuth not configured' })
  const clientId = req.query.clientId as string | undefined
  if (!clientId) return res.status(400).json({ error: 'clientId query param required' })
  res.redirect(getAuthUrl(clientId))
})

// OAuth redirect target — exchanges the code and stores the refresh token.
authRouter.get('/gmail/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const clientId = req.query.state as string | undefined
  if (!code || !clientId) return res.status(400).json({ error: 'Missing code or state' })

  try {
    const email = await handleCallback(clientId, code)
    res.send(`<p>Connected <b>${email}</b>. You can close this window.</p>`)
  } catch (err) {
    console.error('[auth] gmail callback error', err)
    res.status(500).json({ error: 'OAuth exchange failed' })
  }
})
