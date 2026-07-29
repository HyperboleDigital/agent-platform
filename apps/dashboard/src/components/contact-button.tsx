import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { LifeBuoy } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea, Label } from '@/components/ui/input'

// Common reasons a client reaches out — picking one tags the message so it's
// easy to triage on our end, without forcing them into a rigid form. "Other"
// covers everything else; the free-text box is always there regardless.
const TOPICS = [
  'Choosing or changing my plan',
  'Billing question',
  'Something isn\'t working right',
  'General question',
  'Other'
] as const

// "Contact Hyperbole" — a way for a logged-in client to reach the agency.
// Routes to SUPERADMIN_NOTIFY_EMAIL via the guardrailed email path (see
// routes/clients contact-agency). Sender is their Clerk session, so nothing
// to type but the topic + message. Reusable anywhere (topbar, empty states,
// prompts) so "use Contact Hyperbole" is always an actual button, not just a
// pointer up to the topbar.
export function ContactButton({ clientId, variant = 'outline', size = 'sm', label = 'Contact Hyperbole', defaultTopic }: {
  clientId: string
  variant?: 'outline' | 'default' | 'secondary' | 'ghost'
  size?: 'sm' | 'default'
  label?: string
  defaultTopic?: typeof TOPICS[number]
}) {
  const [open, setOpen] = useState(false)
  const [topic, setTopic] = useState<string>(defaultTopic ?? TOPICS[0])
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = '' }
  }, [open])

  async function send() {
    if (!message.trim()) return
    setSending(true)
    try {
      await api.clients.contactAgency(clientId, `[${topic}] ${message.trim()}`)
      setMessage('')
      setOpen(false)
      toast.success("Message sent to Hyperbole — we'll get back to you shortly.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <Button variant={variant} size={size} onClick={() => { setTopic(defaultTopic ?? TOPICS[0]); setOpen(true) }}>
        <LifeBuoy className="h-3.5 w-3.5" /> {label}
      </Button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:items-center" onClick={() => setOpen(false)}>
          <div role="dialog" aria-modal="true" className="my-auto w-full max-w-md rounded-lg border border-border bg-card shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="border-b border-border p-4">
              <h2 className="flex items-center gap-2 font-semibold"><LifeBuoy className="h-4 w-4 text-primary" /> Contact Hyperbole</h2>
              <p className="mt-1 text-sm text-muted-foreground">Send us a message and we&apos;ll reply by email. For anything urgent, email hello@hyperboledigital.com directly.</p>
            </div>
            <div className="grid gap-3 p-4">
              <div className="grid gap-1.5">
                <Label>What&apos;s this about?</Label>
                <select
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  value={topic}
                  onChange={e => setTopic(e.target.value)}
                >
                  {TOPICS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid gap-1.5">
                <Label>Message</Label>
                <Textarea
                  value={message}
                  onChange={e => setMessage(e.target.value)}
                  rows={5}
                  placeholder="How can we help?"
                  autoFocus
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-border p-4">
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
              <Button size="sm" onClick={send} disabled={sending || !message.trim()}>{sending ? 'Sending…' : 'Send message'}</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
