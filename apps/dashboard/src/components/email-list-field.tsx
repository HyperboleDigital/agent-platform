import { Plus, Trash2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Editable list of email addresses. The backend fields this feeds
// (agentConfig.escalationEmail, notification_settings.email_to) are still a
// single string — every send path (lib/gmail.ts's sendPlainEmail/
// sendPlatformEmail) drops it verbatim into an RFC 5322 `To:` header, which
// already supports comma-separated addresses natively. So this only needed a
// friendlier list UI, not a database/API shape change: join with ', ' before
// saving, split on ',' when loading.
export function EmailListField({ emails, onChange, placeholder = 'you@yourcompany.com' }: {
  emails: string[]
  onChange: (next: string[]) => void
  placeholder?: string
}) {
  const rows = emails.length ? emails : ['']

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((email, i) => {
        const trimmed = email.trim()
        const invalid = trimmed.length > 0 && !EMAIL_RE.test(trimmed)
        return (
          <div key={i} className="flex items-center gap-2">
            <Input
              value={email}
              onChange={e => {
                const next = [...rows]; next[i] = e.target.value; onChange(next)
              }}
              placeholder={placeholder}
              type="email"
              aria-invalid={invalid}
              className={invalid ? 'border-destructive' : ''}
            />
            {rows.length > 1 && (
              <button
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
                aria-label={`Remove email ${i + 1}`}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )
      })}
      <Button variant="outline" size="sm" className="w-fit" onClick={() => onChange([...rows, ''])}>
        <Plus className="h-3.5 w-3.5" /> Add email
      </Button>
    </div>
  )
}
