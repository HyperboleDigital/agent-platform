import useSWR from 'swr'
import { Link } from 'react-router-dom'
import { UserButton } from '@clerk/react'
import { api } from '../lib/api'
import { Page, Card, colors, th, td } from '../ui'

export default function Dashboard() {
  const { data: clients, error, isLoading } = useSWR('clients', api.clients.list)

  return (
    <Page>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Agent platform</h1>
        <UserButton />
      </div>

      {isLoading && <Card><p style={{ fontSize: 13, color: colors.muted }}>Loading clients…</p></Card>}

      {error && (
        <Card>
          <p style={{ fontSize: 13, color: '#c0392b' }}>
            Couldn't reach the API, or your account isn't authorized. Check VITE_API_URL and that the API is running.
          </p>
        </Card>
      )}

      {clients && clients.length === 0 && (
        <Card><p style={{ fontSize: 13, color: colors.muted }}>No clients yet — your account isn't linked to one, or none exist. An admin can create one via POST /clients.</p></Card>
      )}

      {clients && clients.length > 0 && (
        <Card style={{ padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Client</th>
                <th style={th}>Domain</th>
                <th style={th}>Industry</th>
                <th style={th}>Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => (
                <tr key={c.id}>
                  <td style={td}>
                    <Link to={`/clients/${c.id}`} style={{ color: colors.accent, textDecoration: 'none', fontWeight: 500 }}>
                      {c.name}
                    </Link>
                  </td>
                  <td style={td}>{c.domain || '—'}</td>
                  <td style={td}>{c.industry || '—'}</td>
                  <td style={{ ...td, color: c.active ? '#27ae60' : colors.muted }}>
                    {c.active ? 'Active' : 'Inactive'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </Page>
  )
}
