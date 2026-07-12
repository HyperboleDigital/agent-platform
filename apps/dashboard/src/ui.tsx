import type { CSSProperties, ReactNode } from 'react'

// Shared visual language for the dashboard — matches the original Dashboard look
// (system-ui, muted paper background, soft borders).
export const colors = {
  bg: '#f5f5f3',
  card: '#fff',
  border: '#e0e0d8',
  muted: '#888',
  text: '#1a1a1a',
  accent: '#6C5CE7'
}

export function Page({ children }: { children: ReactNode }) {
  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui', maxWidth: 1100, margin: '0 auto', color: colors.text }}>
      {children}
    </div>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ background: colors.card, border: `0.5px solid ${colors.border}`, borderRadius: 12, padding: '1.25rem', ...style }}>
      {children}
    </div>
  )
}

export function StatTile({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div style={{ background: colors.bg, borderRadius: 8, padding: '1rem' }}>
      <div style={{ fontSize: 12, color: colors.muted, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 500 }}>{value}</div>
    </div>
  )
}

export const th: CSSProperties = {
  textAlign: 'left', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5,
  color: colors.muted, padding: '8px 12px', borderBottom: `1px solid ${colors.border}`
}

export const td: CSSProperties = {
  fontSize: 13, padding: '10px 12px', borderBottom: `0.5px solid ${colors.border}`
}
