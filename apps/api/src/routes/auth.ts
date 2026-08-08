import { Router } from 'express'
import { handleCallback, handlePlatformCallback, PLATFORM_STATE } from '../lib/gmail'

export const authRouter = Router()

// OAuth redirect target — Google hits this directly (unauthenticated request,
// no Clerk session expected here). The `state` value is only ever minted by
// either the authenticated /clients/:id/gmail/auth-url endpoint (see
// routes/clients.ts) or the superadmin-only /overview/platform-gmail/auth-url
// (see routes/overview.ts), so an attacker can't obtain a valid state for a
// client they don't have dashboard access to, or for the platform sender.
// Further hardening (signed, single-use, expiring state) is a documented
// follow-up, not required for the current threat model.
//
// `state === PLATFORM_STATE` routes to the platform's own singleton
// connection instead of a client's — real client ids are uuids, which can
// never collide with that reserved word.
authRouter.get('/gmail/callback', async (req, res) => {
  const code = req.query.code as string | undefined
  const state = req.query.state as string | undefined
  if (!code || !state) return res.status(400).json({ error: 'Missing code or state' })

  try {
    const email = state === PLATFORM_STATE
      ? await handlePlatformCallback(code)
      : await handleCallback(state, code)
    const safeEmail = email.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!))
    res.send(`<p>Connected <b>${safeEmail}</b>. You can close this window.</p>`)
  } catch (err) {
    console.error('[auth] gmail callback error', err)
    res.status(500).json({ error: 'OAuth exchange failed' })
  }
})
