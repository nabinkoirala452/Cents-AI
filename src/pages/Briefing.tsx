import { useMemo, useState } from "react"
import { ArrowRight, CalendarDays, Check, Download, RefreshCw, Sparkles } from "lucide-react"
import { ChartLegend, ForecastChart } from "../components/charts"
import { PriorityList } from "../components/finance-ui"
import { Badge, Button, Card, CardHeader, MetricCard, Select, Title } from "../components/ui"
import { download } from "../lib/csv"
import { fmtDay, fmtLong } from "../lib/dates"
import { buildBriefing, type CashEvent } from "../lib/finance"
import { money, signedMoney } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"

const EVENT_PAGE: Record<CashEvent["kind"], string> = {
  receivable: "invoices", planned: "projects", retainer: "projects", payroll: "payroll", contractor: "payroll", recurring: "expenses", emi: "loans", simulated: "simulator",
}

export default function BriefingPage() {
  const { state, today, restoreInsights, toast } = useStore()
  const [horizon, setHorizon] = useState<7 | 30 | 90>(state.settings.defaultHorizon)
  const [generatedAt, setGeneratedAt] = useState(() => new Date())
  const brief = useMemo(() => buildBriefing(state, today, horizon), [state, today, horizon, generatedAt])
  const { all, rec, cash } = brief
  const active = brief.priorities.filter((p) => !state.dismissedInsights.includes(p.id))
  const dismissed = brief.priorities.length - active.length
  const owed = all.expected.ledger.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0)
  const events = all.expected.ledger.filter((e) => e.date <= all.expected.series[Math.min(14, all.expected.series.length - 1)].date)
  const recordCount = state.transactions.length + state.invoices.length + state.employees.length + state.recurring.length + state.loans.length + state.contractorBills.length
  const assigned = state.projects.reduce((s, p) => s + p.timeEntries.reduce((h, t) => h + t.hours, 0), 0)
  const unassigned = state.projects.reduce((s, p) => s + p.unassignedHours, 0)
  const coverage = Math.round((assigned / (assigned + unassigned || 1)) * 100)

  const exportBrief = () => {
    const lines = [
      `# CentsAI Finance Briefing — ${state.settings.agencyName}`,
      `${fmtLong(today)} · ${horizon}-day view`,
      "",
      "## Summary",
      brief.summary,
      "",
      "## Priority actions",
      ...active.map((p, i) => `${i + 1}. **${p.title}** (${p.amount}) — ${p.detail}\n   - Evidence: ${p.evidence}\n   - Calculation: ${p.calculation}`),
      "",
      "## Next 14 days",
      ...events.map((e) => `- ${fmtDay(e.date)} · ${e.label} · ${signedMoney(e.amount)} (${e.certainty})`),
    ]
    download(`centsai-briefing-${today}.md`, lines.join("\n"), "text/markdown;charset=utf-8")
  }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>AI Finance Briefing</Title>
          <p>Your priorities, risks and upcoming money movements — generated from current records.</p>
        </div>
        <div className="intro-actions">
          <span className="date">
            <CalendarDays size={14} /> {fmtLong(today)}
          </span>
          <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value) as 7 | 30 | 90)} aria-label="Horizon">
            <option value={7}>Next 7 days</option>
            <option value={30}>Next 30 days</option>
            <option value={90}>Next 90 days</option>
          </Select>
          <Button
            icon={RefreshCw}
            onClick={() => {
              setGeneratedAt(new Date())
              toast("Briefing regenerated from current records")
            }}
          >
            Refresh
          </Button>
          <Button variant="primary" icon={Download} onClick={exportBrief}>
            Export
          </Button>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard label="Recorded Cash Balance" value={money(cash)} detail="From recorded and verified transactions" />
        <MetricCard label="Outstanding Receivables" value={money(rec.outstanding)} detail={`${money(rec.overdueTotal)} currently overdue`} tone={rec.overdueTotal ? "amber" : undefined} />
        <MetricCard label="Upcoming Obligations" value={money(owed)} detail={`Scheduled in the next ${horizon} days`} />
        <MetricCard label="Lowest Projected Cash" value={money(all.conservative.lowest)} detail={`Conservative · ${fmtDay(all.conservative.lowestDate)}`} forecast tone={all.conservative.lowest < state.settings.safetyThreshold ? "red" : undefined} />
      </div>
      <Card className="situation-card">
        <div className="situation-icon">
          <Sparkles size={18} />
        </div>
        <div>
          <div className="brief-label">EXECUTIVE SUMMARY · GENERATED {generatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
          <Title level={2}>Your financial situation</Title>
          <p>{brief.summary}</p>
          <div className="coverage-row">
            <Badge tone={coverage >= 95 ? "green" : "amber"}>
              <Check size={11} /> {coverage}% of project hours attributed
            </Badge>
            <span>{recordCount} records analysed</span>
            <span>{money(all.expected.uncertainInflow)} of receipts still uncertain</span>
            <span>Obligations assumed on schedule</span>
          </div>
        </div>
      </Card>
      <div className="briefing-workspace">
        <Card>
          <CardHeader
            title="Priority Actions"
            action={
              <div className="intro-actions">
                <Badge tone={active.length ? "amber" : "green"}>{active.length} active</Badge>
                {dismissed > 0 && (
                  <Button
                    variant="ghost"
                    onClick={async () => {
                      const res = await restoreInsights()
                      if (!res.ok) return toast(res.message)
                      toast("Dismissed insights restored")
                    }}
                  >
                    Restore {dismissed} dismissed
                  </Button>
                )}
              </div>
            }
          />
          <PriorityList items={active} />
        </Card>
        <Card>
          <CardHeader title="Cash Flow Outlook" action={<Badge tone="blue">Modelled projection</Badge>} />
          <div className="brief-chart">
            <ForecastChart rows={all.rows} series={["conservative", "expected"]} focus="expected" lowPoint={{ date: all.conservative.lowestDate, value: all.conservative.lowest }} />
          </div>
          <div className="chart-foot">
            <ChartLegend
              items={[
                { color: "var(--green)", label: "Expected" },
                { color: "var(--amber)", label: "Conservative", dashed: true },
                { color: "var(--red)", label: "Threshold", dashed: true },
              ]}
            />
          </div>
          <Button variant="ghost" className="brief-copilot" onClick={() => go(`copilot?q=${encodeURIComponent("What does our cash forecast look like?")}`)}>
            <Sparkles size={14} /> Ask CentsAI about this briefing
            <ArrowRight size={14} />
          </Button>
        </Card>
      </div>
      <Card>
        <CardHeader title="Next 14 Days of Money Movements" action={<span className="section-note">Expected scenario</span>} />
        <div className="financial-events">
          {events.map((e, i) => (
            <div className="financial-event" key={e.label + e.date + i}>
              <div className="event-date">{fmtDay(e.date)}</div>
              <span className={`event-line ${e.amount > 0 ? "" : e.certainty === "Confirmed" ? "event-out" : ""}`} />
              <div>
                <strong>{e.label}</strong>
                <small>{e.certainty}</small>
              </div>
              <b className={e.amount > 0 ? "amount-in" : ""}>{signedMoney(e.amount)}</b>
              <Button variant="ghost" onClick={() => go(EVENT_PAGE[e.kind])}>
                Review <ArrowRight size={13} />
              </Button>
            </div>
          ))}
          {events.length === 0 && <div className="empty">No scheduled movements in the next 14 days.</div>}
        </div>
      </Card>
    </div>
  )
}
