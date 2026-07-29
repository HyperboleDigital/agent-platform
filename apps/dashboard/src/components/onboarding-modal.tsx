import { useEffect, useState } from 'react'
import { useUser } from '@clerk/react'
import { mutate } from 'swr'
import { toast } from 'sonner'
import { Sparkles, Mail, Plug } from 'lucide-react'
import type { Client } from '@agent-platform/shared'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/input'

// First-login welcome + the one setup step that actually matters: WHERE to send
// chat notifications — and only when the client has the Chat Assistant unlocked
// (otherwise there's nothing to notify about). The assistant's business context
// is set up by the agency, so we don't ask the client for it. If the assistant
// gets unlocked later and no notification email is set, this reappears as a
// reminder on load.
export function OnboardingModal({ client, chatEntitled }: { client: Client; chatEntitled: boolean }) {
  const { user } = useUser()
  const cfg = client.agentConfig ?? {}
  const firstTime = !client.portalConfig?.onboardedAt
  const [open, setOpen] = useState(true)
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [seeded, setSeeded] = useState(false)

  useEffect(() => {
    if (seeded) return
    setEmail(cfg.escalationEmail ?? user?.primaryEmailAddress?.emailAddress ?? '')
    if (user) setSeeded(true)
  }, [user, seeded, cfg.escalationEmail])

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  if (!open) return null

  async function persist(opts: { saveEmail: boolean }) {
    setSaving(true)
    try {
      await api.clients.upsert({
        id: client.id,
        ...(opts.saveEmail && chatEntitled ? { agentConfig: { ...cfg, escalationEmail: email.trim() || undefined } } : {}),
        // Always mark onboarding done so the welcome doesn't nag. (The
        // notifications reminder reappears on its own condition — an unset
        // email — not on this flag.)
        portalConfig: { ...client.portalConfig, onboardedAt: new Date().toISOString() }
      })
      await mutate(['client', client.id])
      setOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" className="my-auto w-full max-w-lg rounded-lg border border-border bg-card shadow-xl">
        <div className="border-b border-border p-5">
          {firstTime ? (
            <>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-primary" /> Welcome to Hyperbole Digital 👋
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Your dashboard is ready to explore.{chatEntitled ? ' One quick thing to finish setting up your assistant.' : ''}
              </p>
            </>
          ) : (
            <>
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Mail className="h-5 w-5 text-primary" /> Quick reminder
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Let us know where to send your chat notifications so you don&apos;t miss a lead.
              </p>
            </>
          )}
        </div>

        {chatEntitled ? (
          <div className="grid gap-5 p-5">
            <div className="grid gap-1.5">
              <Label className="flex items-center gap-1.5"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> Where should we send notifications?</Label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="you@yourbusiness.com" type="email" />
              <p className="text-xs text-muted-foreground">
                When someone asks your assistant to talk to a human or fills out your contact form, we email them here. Prefilled from your login.
              </p>
            </div>
            <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <Plug className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <span>Want the assistant to book calls or send from your own email? Connect <span className="font-medium text-foreground">Gmail, Slack, or Calendly</span> anytime under <span className="font-medium text-foreground">Config → Connectors</span>.</span>
            </div>
          </div>
        ) : (
          <div className="p-5">
            <p className="text-sm text-muted-foreground">
              Everything&apos;s set up on our end. Have a look around — your reports, requests, and account details are all here. We&apos;ll reach out as new things go live.
            </p>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-border p-5">
          {firstTime ? (
            <>
              <Button variant="ghost" size="sm" onClick={() => persist({ saveEmail: false })} disabled={saving}>Skip for now</Button>
              <Button size="sm" onClick={() => persist({ saveEmail: true })} disabled={saving}>{saving ? 'Saving…' : chatEntitled ? 'Finish setup' : 'Get started'}</Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)} disabled={saving}>Remind me later</Button>
              <Button size="sm" onClick={() => persist({ saveEmail: true })} disabled={saving || !email.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
