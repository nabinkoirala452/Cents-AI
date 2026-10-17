import {
  Area,
  ComposedChart,
  CartesianGrid,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { compactINR, money } from "../lib/format"
import type { Scenario } from "../lib/types"

export type ForecastRow = {
  date: string
  label: string
  expected: number
  optimistic: number
  conservative: number
  threshold: number
  simulated?: number
}

const COLORS: Record<Scenario | "simulated", string> = {
  expected: "var(--green)",
  optimistic: "var(--chart-gray)",
  conservative: "var(--amber)",
  simulated: "var(--red)",
}

const NAMES: Record<string, string> = {
  expected: "Expected",
  optimistic: "Optimistic",
  conservative: "Conservative",
  simulated: "With decision",
  threshold: "Safety threshold",
}

export function ForecastChart({ rows, series, focus, lowPoint, height = "100%" }: {
  rows: ForecastRow[]
  series: (Scenario | "simulated")[]
  focus?: Scenario | "simulated"
  lowPoint?: { date: string; value: number }
  height?: number | `${number}%`
}) {
  const interval = rows.length > 40 ? Math.ceil(rows.length / 8) : rows.length > 10 ? Math.ceil(rows.length / 7) : 0
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="fcFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--green)" stopOpacity={0.16} />
            <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 4" />
        <XAxis dataKey="label" axisLine={false} tickLine={false} interval={interval} tick={{ fill: "var(--muted)", fontSize: 10 }} />
        <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(v: number) => compactINR(v)} />
        <Tooltip
          contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, background: "var(--card)", color: "var(--text)" }}
          formatter={(value, name) => [money(Number(value)), NAMES[String(name)] ?? String(name)]}
        />
        <ReferenceLine y={rows[0]?.threshold} stroke="var(--red)" strokeDasharray="4 4" strokeOpacity={0.6} />
        {focus && <Area type="monotone" dataKey={focus} stroke="none" fill="url(#fcFill)" isAnimationActive={false} legendType="none" tooltipType="none" />}
        {series.map((key) => (
          <Line
            key={key}
            type="monotone"
            dataKey={key}
            stroke={COLORS[key]}
            strokeWidth={key === focus ? 2.5 : 1.6}
            strokeDasharray={key === "expected" || key === focus ? undefined : "5 4"}
            dot={false}
            isAnimationActive={false}
          />
        ))}
        {lowPoint && (
          <ReferenceDot x={rows.find((r) => r.date === lowPoint.date)?.label} y={lowPoint.value} r={4} fill="var(--red)" stroke="var(--card)" strokeWidth={2} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function ChartLegend({ items }: { items: { color: string; label: string; dashed?: boolean }[] }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span key={item.label}>
          <i style={{ borderColor: item.color, borderStyle: item.dashed ? "dashed" : "solid" }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
