export default function Dashboard() {
  const stats = [
    { label: 'Messages today', value: 47 },
    { label: 'Leads this week', value: 12 },
    { label: 'Open escalations', value: 2 },
    { label: 'Resolved rate', value: '91%' }
  ]
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: '1.5rem' }}>Agent platform</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: '2rem' }}>
        {stats.map(s => (
          <div key={s.label} style={{ background: '#f5f5f3', borderRadius: 8, padding: '1rem' }}>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 24, fontWeight: 500 }}>{s.value}</div>
          </div>
        ))}
      </div>
      <div style={{ background: '#fff', border: '0.5px solid #e0e0d8', borderRadius: 12, padding: '1.25rem' }}>
        <p style={{ fontSize: 13, color: '#888' }}>Connect Supabase in src/lib/api.ts to load live data.</p>
      </div>
    </div>
  )
}
