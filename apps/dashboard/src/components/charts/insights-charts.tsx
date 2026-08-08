import { AreaChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'
import type { TrendPoint } from '@/lib/api'

function formatDay(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00Z')
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium text-popover-foreground">{formatDay(label)}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-1.5 text-muted-foreground">
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-medium text-popover-foreground">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

const axisX = {
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 },
  axisLine: { stroke: 'hsl(var(--border))' },
  tickLine: false,
  interval: 'preserveStartEnd' as const
}
const axisY = {
  allowDecimals: false,
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 },
  axisLine: false,
  tickLine: false,
  width: 28
}

// Conversations (area) with leads overlaid (line), so the correlation between
// traffic and captured leads is visible at a glance.
export function ConversationsLeadsChart({ data }: { data: TrendPoint[] }) {
  if (data.every(d => d.conversations === 0 && d.leads === 0)) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No conversations in this period yet.</div>
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="convFill2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} {...axisX} />
          <YAxis {...axisY} />
          <Tooltip content={<ChartTooltip />} />
          <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
          <Area type="monotone" dataKey="conversations" name="Conversations" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#convFill2)" isAnimationActive={false} />
          <Line type="monotone" dataKey="leads" name="Leads" stroke="hsl(var(--success))" strokeWidth={2} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// Escalations over time — should trend DOWN as the knowledge base improves.
export function EscalationsChart({ data }: { data: TrendPoint[] }) {
  if (data.every(d => d.escalations === 0)) {
    return <div className="flex h-56 items-center justify-center text-sm text-muted-foreground">No escalations in this period — the assistant handled everything on its own.</div>
  }
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="escFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--warning))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--warning))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatDay} {...axisX} />
          <YAxis {...axisY} />
          <Tooltip content={<ChartTooltip />} />
          <Area type="monotone" dataKey="escalations" name="Escalations" stroke="hsl(var(--warning))" strokeWidth={2} fill="url(#escFill)" isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
