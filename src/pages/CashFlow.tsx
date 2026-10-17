import { useMemo, useState } from "react"
import { AlertTriangle, Download, SlidersHorizontal, TrendingUp } from "lucide-react"
import { ChartLegend, ForecastChart } from "../components/charts"
import { RiskAlert } from "../components/finance-ui"
import { Badge, Button, Card, CardHeader, Field, FormModal, Input, MetricCard, Segmented, Select, Title } from "../components/ui"
import { download, toCsv } from "../lib/csv"
import { fmtDay } from "../lib/dates"
import { clientOf, forecastAll, invoiceTotal, lowPointDrivers, SCENARIO_RULES } from "../lib/finance"
import { money, signedMoney } from "../lib/format"
import { routeParams } from "../lib/router"
import { useStore } from "../lib/store"
import type { Scenario } from "../lib/types"

const KIND_LABEL: Record<string, string> = {
  receivable: "Client invoice", planned: "Planned billing", retainer: "Retainer", payroll: "Payroll", contractor: "Contractor", recurring: "Recurring cost", emi: "Loan EMI", simulated: "Simulated",
}

export default function CashFlowPage() {
  const { state, today } = useStore()
  const s = state.settings
  const params = routeParams()
  const [horizon, setHorizon] = useState<7 | 30 | 90>(([7, 30, 90] as const).find((h) => String(h) === params.get("horizon")) ?? s.defaultHorizon)
  const [scenario, setScenario] = useState<Scenario>((params.get("scenario") as Scenario) || s.planningScenario)
  const [compare, setCompare] = useState(true)
  const [editing, setEditing] = useState(false)
  const all = useMemo(() => forecastAll(state, today, horizon), [state, today, horizon])
  const fc = all[scenario]
  const drivers = lowPointDrivers(fc)

  const exportSchedule = () =>
    download(
      `centsai-cash-schedule-${scenario}-${today}.csv`,
      toCsv([["Date", "Item", "Type", "Certainty", "Amount (INR)", "Projected balance (INR)"], ...fc.ledger.map((e) => [e.date, e.label, KIND_LABEL[e.kind], e.certainty, e.amount, e.balance])]),
    )

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Cash Flow</Title>
          <p>Recorded cash today, and what scheduled receipts and obligations do to it next.</p>
        </div>
        <div className="intro-actions">
          <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value) as 7 | 30 | 90)} aria-label="Forecast horizon">
            <option value={7}>Next 7 days</option>
            <option value={30}>Next 30 days</option>
            <option value={90}>Next 90 days</option>
          </Select>
          <Button icon={SlidersHorizontal} onClick={() => setEditing(true)}>
            Adjust assumptions
          </Button>
        </div>
      </div>
      <div className="metric-grid">
        <MetricCard label="Recorded Starting Balance" value={money(fc.start)} detail={`As of ${fmtDay(today)}`} />
        <MetricCard label="Expected Inflows" value={money(fc.inflow)} detail={fc.uncertainInflow ? `${money(fc.uncertainInflow)} is uncertain (overdue)` : "From open invoices and retainers"} />
        <MetricCard label="Scheduled Outflows" value={money(fc.outflow)} detail={`${fc.ledger.filter((e) => e.amount < 0).length} obligations in ${horizon} days`} />
        <MetricCard label="Projected Ending Balance" value={money(fc.end)} detail={`${horizon}-day ${scenario} scenario`} forecast tone={fc.lowest < s.safetyThreshold ? "amber" : undefined} />
      </div>
      <div className="cash-page-grid">
        <Card>
          <CardHeader title="Projected Cash Position" action={<Segmented options={["expected", "optimistic", "conservative"] as Scenario[]} value={scenario} onChange={setScenario} labels={{ expected: "Expected", optimistic: "Optimistic", conservative: "Conservative" }} />} />
          <div className="forecast-chart">
            <ForecastChart rows={all.rows} series={compare ? ["optimistic", "conservative", "expected"].filter((x) => x !== scenario).concat(scenario) as Scenario[] : [scenario]} focus={scenario} lowPoint={{ date: fc.lowestDate, value: fc.lowest }} />
          </div>
          <div className="chart-foot">
            <ChartLegend
              items={[
                { color: scenario === "conservative" ? "var(--amber)" : scenario === "optimistic" ? "var(--chart-gray)" : "var(--green)", label: `${scenario[0].toUpperCase()}${scenario.slice(1)} (selected)` },
                { color: "var(--red)", label: `${money(s.safetyThreshold)} threshold`, dashed: true },
              ]}
            />
            <label className="inline-check">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare scenarios
            </label>
            <span>Lowest {money(fc.lowest)} · {fmtDay(fc.lowestDate)}</span>
          </div>
        </Card>
        <Card className="explanation-panel">
          <div className={`panel-icon ${fc.firstBreach ? "" : "panel-icon-ok"}`}>{fc.firstBreach ? <AlertTriangle size={18} /> : <TrendingUp size={18} />}</div>
          <Title level={2}>{fc.firstBreach ? "Why could cash become tight?" : "What drives this forecast?"}</Title>
          <p>{SCENARIO_RULES[scenario]}</p>
          <div className="cause-list">
            {drivers.outflows.map((e) => (
              <div key={e.label + e.date}>
                <span>{fmtDay(e.date)}</span>
                <strong>{e.label}</strong>
                <b>{signedMoney(e.amount)}</b>
              </div>
            ))}
            {drivers.uncertain.map((e) => (
              <div className="uncertain" key={e.label + e.date}>
                <span>Uncertain</span>
                <strong>{e.label}</strong>
                <b>{signedMoney(e.amount)}</b>
              </div>
            ))}
          </div>
          <Button className="full-button" onClick={() => setEditing(true)}>
            Edit receipt assumptions
          </Button>
        </Card>
      </div>
      <div className="stack-gap">
        <RiskAlert fc={fc} threshold={s.safetyThreshold} link={false} />
      </div>
      <Card>
        <CardHeader
          title={`${horizon}-Day Cash Schedule`}
          action={
            <div className="intro-actions">
              <Badge tone="blue">{scenario} scenario</Badge>
              <Button icon={Download} onClick={exportSchedule}>
                Export CSV
              </Button>
            </div>
          }
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Record</th>
                <th>Type</th>
                <th>Certainty</th>
                <th>Cash movement</th>
                <th>Projected balance</th>
              </tr>
            </thead>
            <tbody>
              {fc.ledger.map((e, i) => (
                <tr key={e.label + e.date + i} className={e.balance < s.safetyThreshold ? "row-risk" : ""}>
                  <td className="muted">{fmtDay(e.date)}</td>
                  <td>
                    <strong>{e.label}</strong>
                  </td>
                  <td className="muted">{KIND_LABEL[e.kind]}</td>
                  <td>
                    <Badge tone={e.certainty === "Uncertain" ? "amber" : e.certainty === "Confirmed" ? "green" : "blue"}>{e.certainty}</Badge>
                  </td>
                  <td className={e.amount > 0 ? "amount-in" : ""}>{signedMoney(e.amount)}</td>
                  <td className={e.balance < s.safetyThreshold ? "danger-text" : ""}>{money(e.balance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {fc.ledger.length === 0 && <div className="empty">No scheduled cash movements in this period.</div>}
        </div>
      </Card>
      {editing && <AssumptionsModal close={() => setEditing(false)} />}
    </div>
  )
}

function AssumptionsModal({ close }: { close: () => void }) {
  const { state, update, log, actor, toast, can } = useStore()
  const open = state.invoices.filter((i) => i.status === "Sent")
  const [threshold, setThreshold] = useState(state.settings.safetyThreshold)
  const [rate, setRate] = useState(state.settings.usdRate)
  const [overrides, setOverrides] = useState<Record<string, string>>(
    Object.fromEntries(open.map((i) => [i.id, i.expectedDelayOverride == null ? "" : String(i.expectedDelayOverride)])),
  )
  return (
    <FormModal
      eyebrow="FORECAST ASSUMPTIONS"
      title="Adjust assumptions"
      submitLabel="Apply to forecast"
      wide
      onClose={close}
      onSubmit={() => {
        if (!can.edit) return toast("Viewers can't change assumptions.")
        update((d) => {
          d.settings.safetyThreshold = Math.max(0, threshold)
          d.settings.usdRate = rate > 0 ? rate : d.settings.usdRate
          for (const inv of d.invoices) {
            if (!(inv.id in overrides)) continue
            const v = overrides[inv.id]
            inv.expectedDelayOverride = v === "" ? undefined : Math.max(0, Number(v))
          }
        })
        log({ actor, action: "Assumptions updated", detail: `Threshold ${money(threshold)} · USD rate ₹${rate} · ${Object.values(overrides).filter(Boolean).length} receipt overrides`, outcome: "info" })
        toast("Forecast recalculated with your assumptions")
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Safety threshold (₹)" hint="Days below this are flagged as risk.">
          <Input type="number" min="0" step="1000" value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
        </Field>
        <Field label="USD → INR rate" hint="Used to convert USD invoices for reporting.">
          <Input type="number" min="1" step="0.01" value={rate} onChange={(e) => setRate(Number(e.target.value))} />
        </Field>
      </div>
      <div className="assumption-table">
        <div className="assumption-row assumption-head">
          <span>Open invoice</span>
          <span>Amount</span>
          <span>Client history</span>
          <span>Expected days late</span>
        </div>
        {open.map((inv) => {
          const client = clientOf(state, inv.clientId)
          return (
            <div className="assumption-row" key={inv.id}>
              <span>
                <strong>{inv.id}</strong> {client.name}
              </span>
              <span>{money(invoiceTotal(inv), inv.currency)}</span>
              <span className="muted">{client.avgDelayDays}d late on average</span>
              <Input type="number" min="0" placeholder={`${client.avgDelayDays} (history)`} value={overrides[inv.id]} onChange={(e) => setOverrides({ ...overrides, [inv.id]: e.target.value })} aria-label={`Expected delay for ${inv.id}`} />
            </div>
          )
        })}
      </div>
      <p className="section-note form-note">Leave blank to use the client’s payment history. Conservative and optimistic scenarios are applied on top.</p>
    </FormModal>
  )
}
