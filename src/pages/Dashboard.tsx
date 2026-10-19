import { useMemo, useState } from "react"
import { ArrowRight, CalendarDays, Download, ShieldCheck, Sparkles } from "lucide-react"
import { ChartLegend, ForecastChart } from "../components/charts"
import { InvoiceRows, PriorityList, RiskAlert } from "../components/finance-ui"
import { Badge, Button, Card, CardHeader, MetricCard, Segmented, Title } from "../components/ui"
import { download, toCsv } from "../lib/csv"
import { fmtDay, fmtLong, greeting } from "../lib/dates"
import { buildBriefing, buildEvents, monthToDate, projectStats } from "../lib/finance"
import { money, pct } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"

export default function Dashboard() {
  const { state, today, actor } = useStore()
  const s = state.settings
  const [range, setRange] = useState<7 | 30 | 90>(s.defaultHorizon)
  const brief = useMemo(() => buildBriefing(state, today, range), [state, today, range])
  const { all, rec, cash } = brief
  const month = useMemo(() => monthToDate(state, today), [state, today])
  const obligations = useMemo(() => buildEvents(state, today, 14, "expected").filter((e) => e.amount < 0), [state, today])
  const projects = useMemo(() => state.projects.map((p) => projectStats(state, p)).sort((a, b) => a.margin - b.margin), [state])
  const visible = brief.priorities.filter((p) => !state.dismissedInsights.includes(p.id))
  const worst = all.conservative.firstBreach ? all.conservative : all.expected

  const exportReport = () => {
    const rows: (string | number)[][] = [
      ["CentsAI dashboard report", s.agencyName, fmtLong(today)],
      [],
      ["Metric", "Value"],
      ["Recorded cash", cash],
      ["Money in (month to date)", month.current.income],
      ["Money out (month to date)", month.current.expense],
      [`Expected cash in ${range} days`, all.expected.end],
      [`Conservative lowest balance (${range}d)`, all.conservative.lowest],
      ["Outstanding receivables", rec.outstanding],
      ["Overdue receivables", rec.overdueTotal],
      [],
      ["Date", "Expected", "Optimistic", "Conservative"],
      ...all.rows.map((r) => [r.date, r.expected, r.optimistic, r.conservative]),
    ]
    download(`centsai-report-${today}.csv`, toCsv(rows))
  }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>
            {greeting()}, {(actor || s.ownerName).split(" ")[0]}
          </Title>
          <p>Here is your agency’s financial position and what needs your attention.</p>
        </div>
        <div className="intro-actions">
          <span className="date">
            <CalendarDays size={14} /> {fmtLong(today)}
          </span>
          <Button icon={Download} onClick={exportReport}>
            Export report
          </Button>
          <Button variant="primary" icon={Sparkles} onClick={() => go("copilot")}>
            Ask CentsAI
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Demonstration workspace · Figures come from recorded transactions and verified payments, not live bank feeds.
      </div>
      <div className="metric-grid">
        <MetricCard label="Available Cash" value={money(cash)} detail={`Recorded balance as of ${fmtDay(today)}`} />
        <MetricCard
          label="Money In This Month"
          value={money(month.current.income)}
          detail={`${month.incomeChange >= 0 ? "+" : ""}${pct(month.incomeChange)} vs same days last month`}
          positive={month.incomeChange > 0}
        />
        <MetricCard label="Money Out This Month" value={money(month.current.expense)} detail={`${month.expenseChange >= 0 ? "+" : ""}${pct(month.expenseChange)} vs same days last month`} />
        <MetricCard label={`Projected Cash · ${range} days`} value={money(Math.round(all.expected.end))} detail={`Conservative low ${money(all.conservative.lowest)}`} forecast tone={all.conservative.lowest < s.safetyThreshold ? "amber" : undefined} />
      </div>
      <div className="dashboard-grid">
        <div className="dashboard-main">
          <Card className="cash-chart-card">
            <CardHeader title="Cash Position Forecast" action={<Segmented options={[7, 30, 90] as (7 | 30 | 90)[]} value={range} onChange={setRange} labels={{ 7: "7D", 30: "30D", 90: "90D" }} />} />
            <div className="chart-summary">
              <div>
                <span>Expected cash on {fmtDay(all.expected.series[all.expected.series.length - 1].date)}</span>
                <strong>{money(Math.round(all.expected.end))}</strong>
              </div>
              <ChartLegend
                items={[
                  { color: "var(--green)", label: "Expected" },
                  { color: "var(--amber)", label: "Conservative", dashed: true },
                  { color: "var(--red)", label: `Threshold ${money(s.safetyThreshold)}`, dashed: true },
                ]}
              />
            </div>
            <div className="chart-wrap">
              <ForecastChart rows={all.rows} series={["conservative", "expected"]} focus="expected" lowPoint={{ date: all.conservative.lowestDate, value: all.conservative.lowest }} />
            </div>
            <div className="chart-foot">
              <span>Recorded through {fmtDay(today)}</span>
              <span className="forecast-line">Forecast from tomorrow</span>
              <span>{all.expected.ledger.length} scheduled items</span>
            </div>
          </Card>
          <RiskAlert fc={worst} threshold={s.safetyThreshold} />
        </div>
        <Card className="briefing-card">
          <CardHeader
            title="Today’s Finance Briefing"
            action={
              <div className="ai-label">
                <Sparkles size={13} /> Grounded in your records
              </div>
            }
          />
          <PriorityList items={visible.slice(0, 3)} compact />
          <Button className="full-button" onClick={() => go("briefing")}>
            View full briefing
          </Button>
        </Card>
      </div>
      <div className="two-column">
        <Card>
          <CardHeader
            title="Invoices Requiring Attention"
            action={
              <Button variant="ghost" onClick={() => go("invoices")}>
                View all <ArrowRight size={13} />
              </Button>
            }
          />
          <InvoiceRows rows={rec.open.filter((r) => r.state !== "Open").slice(0, 4)} state={state} today={today} onSelect={(inv) => go(`invoices?id=${inv.id}`)} />
        </Card>
        <Card>
          <CardHeader
            title="Next 14 Days of Obligations"
            action={
              <Button variant="ghost" onClick={() => go("cash-flow")}>
                Schedule <ArrowRight size={13} />
              </Button>
            }
          />
          <div className="obligation-list">
            {obligations.slice(0, 6).map((e) => (
              <div className="obligation" key={e.label + e.date}>
                <div>
                  <span className={`obligation-dot dot-${e.kind}`} />
                  <strong>{e.label}</strong>
                </div>
                <span>{money(-e.amount)}</span>
                <small>{fmtDay(e.date)}</small>
              </div>
            ))}
            {obligations.length > 6 && <small className="list-more">+{obligations.length - 6} more · {money(obligations.slice(6).reduce((sum, e) => sum - e.amount, 0))}</small>}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Project Profitability"
          action={
            <Button variant="ghost" onClick={() => go("projects")}>
              View profitability analysis <ArrowRight size={13} />
            </Button>
          }
        />
        <p className="section-note">Billed revenue minus attributed labour, contractor and direct costs — before shared overhead.</p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Billed</th>
                <th>Recorded costs</th>
                <th>Estimated contribution</th>
                <th>Margin</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.project.id} className="clickable" onClick={() => go(`projects?id=${p.project.id}`)}>
                  <td>
                    <strong>{p.project.name}</strong>
                    <small className="row-id">{p.client.name}</small>
                  </td>
                  <td>{money(p.billed)}</td>
                  <td>{money(p.cost)}</td>
                  <td>{money(p.contribution)}</td>
                  <td>
                    <Badge tone={p.margin < 25 ? "amber" : "green"}>{pct(p.margin)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  )
}
