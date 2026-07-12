import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { useParams, Link } from 'react-router-dom'
import useSWR, { mutate } from 'swr'
import { api } from '../lib/api'
import type { ConnectorStatus } from '../lib/api'
import { Page, Card, StatTile, colors, th, td } from '../ui'

type Tab = 'knowledge' | 'leads' | 'connectors' | 'config'

export default function ClientDetail() {
  const { id = '' } = useParams()
  const [tab, setTab] = useState<Tab>('knowledge')

  const { data: client } = useSWR(id ? ['client', id] : null, () => api.clients.get(id))
  const { data: stats } = useSWR(id ? ['stats', id] : null, () => api.clients.stats(id))

  const pct = stats ? `${Math.round(stats.resolvedRate * 100)}%` : '—'

  return (
    <Page>
      <Link to="/" style={{ fontSize: 13, color: colors.muted, textDecoration: 'none' }}>← All clients</Link>
      <h1 style={{ fontSize: 22, fontWeight: 500, margin: '0.75rem 0 1.5rem' }}>
        {client?.name ?? 'Client'}
      </h1>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '0.75rem' }}>
        <StatTile label="Messages this week" value={stats?.messagesThisWeek ?? '—'} />
        <StatTile label="Leads this week" value={stats?.leadsThisWeek ?? '—'} />
        <StatTile label="Open escalations" value={stats?.openEscalations ?? '—'} />
        <StatTile label="Resolved rate" value={pct} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '1.5rem' }}>
        <StatTile label="Conversations (lifetime)" value={stats?.totalConversations ?? '—'} />
        <StatTile label="Leads captured (lifetime)" value={stats?.totalLeadsCaptured ?? '—'} />
        <StatTile label="Questions answered" value={stats?.questionsAnswered ?? '—'} />
        <StatTile label="Est. hours saved" value={stats ? `${stats.estimatedHoursSaved}h` : '—'} />
      </div>

      <div style={{ display: 'flex', gap: 4, marginBottom: '1rem' }}>
        {(['knowledge', 'leads', 'connectors', 'config'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              fontSize: 13, padding: '6px 14px', borderRadius: 6, cursor: 'pointer',
              border: `0.5px solid ${colors.border}`, textTransform: 'capitalize',
              background: tab === t ? colors.accent : colors.card,
              color: tab === t ? '#fff' : colors.text
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'knowledge' && <KnowledgeTab clientId={id} />}
      {tab === 'leads' && <LeadsTab clientId={id} />}
      {tab === 'connectors' && <ConnectorsTab clientId={id} />}
      {tab === 'config' && client && <ConfigTab clientId={id} client={client} />}
    </Page>
  )
}

function KnowledgeTab({ clientId }: { clientId: string }) {
  const key = ['knowledge', clientId]
  const { data: docs } = useSWR(key, () => api.clients.knowledge(clientId))
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function add() {
    if (!title || !content) return
    setSaving(true)
    try {
      await api.clients.addKnowledge(clientId, title, content)
      setTitle(''); setContent('')
      mutate(key)
    } finally {
      setSaving(false)
    }
  }

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      await api.clients.uploadKnowledge(clientId, file)
      mutate(key)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  return (
    <>
      <Card style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button onClick={() => fileInputRef.current?.click()} disabled={uploading} style={btnStyle}>
              {uploading ? 'Uploading…' : 'Upload file (PDF, Word, txt, md)'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.txt,.md"
              onChange={onFileChosen}
              style={{ display: 'none' }}
            />
            {uploadError && <span style={{ fontSize: 12, color: '#c0392b' }}>{uploadError}</span>}
          </div>

          <div style={{ fontSize: 11, color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5, margin: '4px 0' }}>
            or paste text directly
          </div>

          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Document title"
            style={inputStyle} />
          <textarea value={content} onChange={e => setContent(e.target.value)} placeholder="Content…"
            rows={4} style={inputStyle} />
          <button onClick={add} disabled={saving} style={btnStyle}>
            {saving ? 'Adding…' : 'Add document'}
          </button>
        </div>
      </Card>

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr><th style={th}>Title</th><th style={th}>Source</th><th style={th}>Added</th></tr></thead>
          <tbody>
            {docs?.length ? docs.map(d => (
              <tr key={d.id}>
                <td style={td}>{d.title}</td>
                <td style={td}>{d.url ? <a href={d.url} target="_blank" rel="noreferrer">{d.url}</a> : '—'}</td>
                <td style={td}>{new Date(d.created_at).toLocaleDateString()}</td>
              </tr>
            )) : <tr><td style={{ ...td, color: colors.muted }} colSpan={3}>No documents yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  )
}

function LeadsTab({ clientId }: { clientId: string }) {
  const { data: leads } = useSWR(['leads', clientId], () => api.clients.leads(clientId))
  return (
    <Card style={{ padding: 0, overflow: 'hidden' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead><tr>
          <th style={th}>Email</th><th style={th}>Name</th><th style={th}>Intent</th><th style={th}>When</th>
        </tr></thead>
        <tbody>
          {leads?.length ? leads.map(l => (
            <tr key={l.id}>
              <td style={td}>{l.email}</td>
              <td style={td}>{l.name || '—'}</td>
              <td style={td}>{l.intent || '—'}</td>
              <td style={td}>{new Date(l.createdAt).toLocaleDateString()}</td>
            </tr>
          )) : <tr><td style={{ ...td, color: colors.muted }} colSpan={4}>No leads yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  )
}

function statusColor(status: ConnectorStatus['gmail']['status']): string {
  if (status === 'ok') return '#27ae60'
  if (status === 'error') return '#c0392b'
  return colors.muted
}

function statusLabel(status: ConnectorStatus['gmail']['status']): string {
  switch (status) {
    case 'ok': return 'Connected'
    case 'error': return 'Needs reconnect'
    case 'not_connected': return 'Not connected'
    case 'not_configured': return 'Not available'
  }
}

function ConnectorsTab({ clientId }: { clientId: string }) {
  const key = ['connectors', clientId]
  const { data, isLoading } = useSWR(key, () => api.clients.connectors(clientId), { refreshInterval: 30_000 })
  const [connecting, setConnecting] = useState(false)

  async function connectGmail() {
    setConnecting(true)
    try {
      const { url } = await api.clients.gmailAuthUrl(clientId)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to start Gmail connection')
    } finally {
      setConnecting(false)
    }
  }

  if (isLoading || !data) return <Card><p style={{ fontSize: 13, color: colors.muted }}>Checking connectors…</p></Card>

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Gmail (sends escalation emails)</div>
            <div style={{ fontSize: 12, color: statusColor(data.gmail.status) }}>
              ● {statusLabel(data.gmail.status)}
              {data.gmail.email ? ` — ${data.gmail.email}` : ''}
            </div>
            {data.gmail.connectedAt && (
              <div style={{ fontSize: 11, color: colors.muted, marginTop: 2 }}>
                Connected {new Date(data.gmail.connectedAt).toLocaleDateString()}
              </div>
            )}
            {data.gmail.status === 'error' && (
              <div style={{ fontSize: 11, color: '#c0392b', marginTop: 4, maxWidth: 400 }}>
                {data.gmail.error ?? 'Token is no longer valid.'} Escalation emails can't be sent until reconnected (Slack still works).
              </div>
            )}
            {!data.gmail.configured && (
              <div style={{ fontSize: 11, color: colors.muted, marginTop: 4 }}>
                Gmail OAuth isn't configured on this deployment — escalations go to Slack only.
              </div>
            )}
          </div>
          {data.gmail.configured && data.gmail.status !== 'ok' && (
            <button onClick={connectGmail} disabled={connecting} style={btnStyle}>
              {connecting ? 'Opening…' : data.gmail.status === 'not_connected' ? 'Connect' : 'Reconnect'}
            </button>
          )}
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Slack escalations</div>
        <div style={{ fontSize: 12, color: data.slack.configured ? '#27ae60' : colors.muted }}>
          ● {data.slack.configured ? 'Configured' : 'Not configured'}
        </div>
      </Card>

      <Card>
        <div style={{ fontWeight: 500, marginBottom: 4 }}>Calendly</div>
        <div style={{ fontSize: 12, color: data.calendly.configured ? '#27ae60' : colors.muted }}>
          ● {data.calendly.configured ? 'Configured' : 'Not configured — set a link in Config'}
        </div>
      </Card>
    </div>
  )
}

function ConfigTab({ clientId, client }: { clientId: string; client: import('@agent-platform/shared').Client }) {
  const cfg = client.agentConfig ?? {}
  const [systemPromptExtra, setExtra] = useState(cfg.systemPromptExtra ?? '')
  const [calendlyLink, setCalendly] = useState(cfg.calendlyLink ?? '')
  const [escalationEmail, setEscalationEmail] = useState(cfg.escalationEmail ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true); setSaved(false)
    try {
      await api.clients.upsert({
        id: client.id,
        agentConfig: { ...cfg, systemPromptExtra, calendlyLink, escalationEmail }
      })
      mutate(['client', clientId])
      setSaved(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div style={{ display: 'grid', gap: 12 }}>
        <label style={labelStyle}>
          Extra system prompt
          <textarea value={systemPromptExtra} onChange={e => setExtra(e.target.value)} rows={4} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Calendly link
          <input value={calendlyLink} onChange={e => setCalendly(e.target.value)} style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Escalation email (where "get a human" requests are sent)
          <input value={escalationEmail} onChange={e => setEscalationEmail(e.target.value)}
            placeholder="support@yourcompany.com" style={inputStyle} />
        </label>
        <button onClick={save} disabled={saving} style={btnStyle}>
          {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save config'}
        </button>
      </div>
    </Card>
  )
}

const inputStyle: CSSProperties = {
  fontFamily: 'system-ui', fontSize: 13, padding: '8px 10px',
  border: `0.5px solid ${colors.border}`, borderRadius: 6, width: '100%', boxSizing: 'border-box'
}
const btnStyle: CSSProperties = {
  fontSize: 13, padding: '8px 16px', borderRadius: 6, border: 'none',
  background: colors.accent, color: '#fff', cursor: 'pointer', justifySelf: 'start'
}
const labelStyle: CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, color: colors.muted
}
