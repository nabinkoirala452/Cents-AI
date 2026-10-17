import { useMemo, useState } from "react"
import { ArrowRight, Bookmark, BriefcaseBusiness, Clock3, CreditCard, Laptop, Sparkles, Trash2, TrendingDown, Users, Zap, type LucideIcon } from "lucide-react"
import { ChartLegend, ForecastChart } from "../components/charts"
import { Badge, Button, Card, Field, Input, Select, Title } from "../components/ui"
import { addDays, dayInMonth, diffDays, fmtDate, fmtDay, fmtStamp } from "../lib/dates"
import { cashBalance, clientOf, forecast, monthlyPayroll, nextPayroll, receivables, type CashEvent, type ForecastMods } from "../lib/finance"
import { money } from "../lib/format"
import { go, routeParams } from "../lib/router"
import { useStore } from "../lib/store"
import type { Scenario, State } from "../lib/types"

type SimType = "hire" | "contractor" | "subscription" | "purchase" | "late" | "lose"

const TYPES: { id: SimType; label: string; detail: string; icon: LucideIcon }[] = [
  { id: "hire", label: "Hire an employee", detail: "Salary, start date and one-time setup", icon: Users },
  { id: "contractor", label: "Add a contractor", detail: "Monthly fee for a fixed period", icon: BriefcaseBusiness },
  { id: "subscription", label: "New software / tool", detail: "Recurring monthly cost", icon: CreditCard },
  { id: "purchase", label: "One-time purchase", detail: "Equipment or other spend", icon: Laptop },
  { id: "late", label: "Client pays late", detail: "Delay an open invoice", icon: Clock3 },
  { id: "lose", label: "Lose a retainer", detail: "Stop a recurring client", icon: TrendingDown },
]

type Inputs = { amount: number; start: string; oneTime: number; extraMonthly: number; months: number; invoiceId: string; days: number; projectId: string }

const buildMods = (state: State, today: string, type: SimType, x: Inputs, shift = 0): ForecastMods => {
  const start = addDays(x.start, shift)
  const payDay = Number((nextPayroll(state, today)?.date ?? dayInMonth(today, 0, 28)).slice(8, 10))
  const monthly = (label: string, amount: number, day: number, count: number): CashEvent[] =>
    Array.from({ length: count }, (_, m) => {
      const date = m === 0 ? start : dayInMonth(start, m, day)
      return { date, label, amount: -amount, kind: "simulated" as const, certainty: "Simulated" as const }
    })
  if (type === "hire") {
    const first = dayInMonth(start, start.slice(8, 10) > String(payDay).padStart(2, "0") ? 1 : 0, payDay)
    return {
      extra: [
        ...Array.from({ length: 5 }, (_, m) => ({ date: dayInMonth(first, m, payDay), label: "New hire · salary", amount: -(x.amount + x.extraMonthly), kind: "simulated" as const, certainty: "Simulated" as const })),
        ...(x.oneTime ? [{ date: start, label: "New hire · equipment & setup", amount: -x.oneTime, kind: "simulated" as const, certainty: "Simulated" as const }] : []),
      ],
    }
  }
  if (type === "contractor") return { extra: monthly("Contractor fee", x.amount, Number(start.slice(8, 10)), x.months) }
  if (type === "subscription") return { extra: monthly("New subscription", x.amount, Number(start.slice(8, 10)), 5) }
  if (type === "purchase") return { extra: [{ date: start, label: "One-time purchase", amount: -x.amount, kind: "simulated", certainty: "Simulated" }] }
  if (type === "late") return { delays: { [x.invoiceId]: x.days } }
  return { dropRetainers: [x.projectId] }
}

export default function SimulatorPage() {
  const { state, today, update, toast, can } = useStore()
  const params = routeParams()
  const open = receivables(state, today).open
  const retainers = state.projects.filter((p) => p.retainer && p.status === "Active")
  const [type, setType] = useState<SimType>((params.get("type") as SimType) || "hire")
  const [horizon, setHorizon] = useState(90)
  const [scenario, setScenario] = useState<Scenario>("conservative")
  const [x, setX] = useState<Inputs>(() => {
    const clientInvoice = open.find((r) => r.inv.clientId === params.get("client"))?.inv.id
    return {
      amount: Number(params.get("salary")) || 5600,
      start: dayInMonth(today, 1, 1),
      oneTime: 8130,
      extraMonthly: 0,
      months: 3,
      invoiceId: clientInvoice ?? open[0]?.inv.id ?? "",
      days: Number(params.get("days")) || 30,
      projectId: retainers[0]?.id ?? "",
    }
  })
  const set = (patch: Partial<Inputs>) => setX({ ...x, ...patch })

  const result = useMemo(() => {
    const base = forecast(state, today, horizon, scenario)
    const after = forecast(state, today, horizon, scenario, buildMods(state, today, type, x))
    let safeShift: number | null = null
    if (after.firstBreach && !base.firstBreach && ["hire", "contractor", "subscription", "purchase"].includes(type)) {
      for (let shift = 15; shift <= 120; shift += 15) {
        const tryFc = forecast(state, today, horizon + shift, scenario, buildMods(state, today, type, x, shift))
        if (!tryFc.firstBreach) {
          safeShift = shift
          break
        }
      }
    }
    return { base, after, safeShift }
  }, [state, today, horizon, scenario, type, x])

  const { base, after, safeShift } = result
  const threshold = state.settings.safetyThreshold
  const cash = cashBalance(state, today)
  const rows = base.series.map((p, i) => ({ date: p.date, label: fmtDay(p.date), expected: p.balance, optimistic: p.balance, conservative: p.balance, threshold, simulated: after.series[i].balance }))
  const monthlyCost = type === "hire" ? x.amount + x.extraMonthly : type === "contractor" || type === "subscription" ? x.amount : 0
  const payroll = monthlyPayroll(state) + (type === "hire" ? x.amount : 0)
  const rec = receivables(state, today)
  const verdict = after.firstBreach ? (base.firstBreach ? "Cash is already tight — this makes it worse" : "This pushes cash below your safety threshold") : "Affordable within your safety threshold"
  const lateInv = state.invoices.find((i) => i.id === x.invoiceId)
  const lostProject = state.projects.find((p) => p.id === x.projectId)

  const describe = () => {
    if (type === "hire") return `hiring at ${money(x.amount)}/month from ${fmtDate(x.start)}${x.oneTime ? ` with ${money(x.oneTime)} of setup costs` : ""}`
    if (type === "contractor") return `adding a contractor at ${money(x.amount)}/month for ${x.months} months`
    if (type === "subscription") return `a new ${money(x.amount)}/month subscription`
    if (type === "purchase") return `a ${money(x.amount)} purchase on ${fmtDate(x.start)}`
    if (type === "late") return lateInv ? `${clientOf(state, lateInv.clientId).name} paying ${lateInv.id} ${x.days} days late` : "a late payment"
    return lostProject ? `losing the ${lostProject.name} retainer (${money(lostProject.retainer?.amount ?? 0)}/month)` : "losing a retainer"
  }

  const saveScenario = () => {
    if (!can.edit) return toast("Viewers can't save scenarios.")
    update((d) => {
      d.scenarios.unshift({ id: `SC-${Date.now().toString(36)}`, name: `${TYPES.find((t) => t.id === type)!.label} · ${describe()}`, createdAt: new Date().toISOString(), type, inputs: { ...x, horizon, scenario } })
    })
    toast("Scenario saved")
  }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Can we afford this?</Title>
          <p>Test a decision against your real cash-flow forecast before committing money.</p>
        </div>
        <Badge tone="blue">Deterministic forecast engine</Badge>
      </div>
      <div className="sim-types">
        {TYPES.map((t) => (
          <button key={t.id} className={`sim-type ${type === t.id ? "active" : ""}`} onClick={() => setType(t.id)}>
            <t.icon size={17} />
            <span>
              <strong>{t.label}</strong>
              <small>{t.detail}</small>
            </span>
          </button>
        ))}
      </div>
      <div className="simulator-grid">
        <Card className="scenario-form">
          {(type === "hire" || type === "contractor" || type === "subscription" || type === "purchase") && (
            <>
              <Field label={type === "hire" ? `Monthly salary (${state.settings.currency})` : type === "purchase" ? `Amount (${state.settings.currency})` : `Monthly cost (${state.settings.currency})`}>
                <Input type="number" min="0" step="1000" value={x.amount} onChange={(e) => set({ amount: Number(e.target.value) })} />
              </Field>
              <Field label={type === "purchase" ? "Purchase date" : "Start date"}>
                <Input type="date" min={today} value={x.start} onChange={(e) => set({ start: e.target.value })} />
              </Field>
            </>
          )}
          {type === "hire" && (
            <>
              <Field label={`Equipment & setup, one-time (${state.settings.currency})`}>
                <Input type="number" min="0" step="1000" value={x.oneTime} onChange={(e) => set({ oneTime: Number(e.target.value) })} />
              </Field>
              <Field label={`Other monthly costs (${state.settings.currency})`} hint="Licences, benefits, statutory contributions">
                <Input type="number" min="0" step="500" value={x.extraMonthly} onChange={(e) => set({ extraMonthly: Number(e.target.value) })} />
              </Field>
            </>
          )}
          {type === "contractor" && (
            <Field label="Duration (months)">
              <Input type="number" min="1" max="12" value={x.months} onChange={(e) => set({ months: Number(e.target.value) })} />
            </Field>
          )}
          {type === "late" && (
            <>
              <Field label="Open invoice">
                <Select value={x.invoiceId} onChange={(e) => set({ invoiceId: e.target.value })}>
                  {open.map((r) => (
                    <option key={r.inv.id} value={r.inv.id}>
                      {r.inv.id} · {r.client.name} · {money(r.amount, state.settings.currency)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Additional days late">
                <Input type="number" min="1" max="120" value={x.days} onChange={(e) => set({ days: Number(e.target.value) })} />
              </Field>
            </>
          )}
          {type === "lose" && (
            <Field label="Retainer">
              <Select value={x.projectId} onChange={(e) => set({ projectId: e.target.value })}>
                {retainers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {money(p.retainer!.amount)}/mo
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <div className="form-row">
            <label>
              Forecast horizon
              <Select value={horizon} onChange={(e) => setHorizon(Number(e.target.value))}>
                <option value={30}>30 days</option>
                <option value={60}>60 days</option>
                <option value={90}>90 days</option>
              </Select>
            </label>
            <label>
              Scenario
              <Select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
                <option value="expected">Expected</option>
                <option value="optimistic">Optimistic</option>
                <option value="conservative">Conservative</option>
              </Select>
            </label>
          </div>
          <div className="form-actions">
            <Button icon={Bookmark} onClick={saveScenario}>
              Save scenario
            </Button>
            <Button variant="primary" icon={Zap} onClick={() => go(`copilot?q=${encodeURIComponent(type === "hire" ? `Can we afford to hire at $${x.amount} per month?` : type === "late" && lateInv ? `Can we cover payroll if ${clientOf(state, lateInv.clientId).name.split(" ")[0]} pays ${x.days} days late?` : "What does our cash forecast look like?")}`)}>
              Ask CentsAI
            </Button>
          </div>
          {state.scenarios.length > 0 && (
            <div className="saved-scenarios">
              <span className="eyebrow">SAVED SCENARIOS</span>
              {state.scenarios.slice(0, 5).map((sc) => (
                <div key={sc.id}>
                  <button
                    onClick={() => {
                      setType(sc.type as SimType)
                      const { horizon: h, scenario: s2, ...rest } = sc.inputs
                      setHorizon(Number(h))
                      setScenario(s2 as Scenario)
                      setX({ ...x, ...(rest as unknown as Inputs) })
                    }}
                  >
                    <strong>{sc.name}</strong>
                    <small>{fmtStamp(sc.createdAt)}</small>
                  </button>
                  <Button variant="ghost" icon={Trash2} aria-label="Delete scenario" onClick={() => update((d) => { d.scenarios = d.scenarios.filter((y) => y.id !== sc.id) })} />
                </div>
              ))}
            </div>
          )}
        </Card>
        <div className="results-column">
          <Card>
            <div className="result-head">
              <div>
                <span className="eyebrow">SIMULATION RESULT · {horizon} DAYS</span>
                <Title level={2}>{verdict}</Title>
              </div>
              <Badge tone={after.firstBreach ? "amber" : "green"}>{scenario}</Badge>
            </div>
            <div className="comparison-grid">
              <div>
                <span>Lowest balance</span>
                <small>Without this decision</small>
                <strong>{money(base.lowest)}</strong>
              </div>
              <ArrowRight size={20} />
              <div className={after.lowest < threshold ? "after" : "after after-ok"}>
                <span>With this decision</span>
                <small>{fmtDay(after.lowestDate)}</small>
                <strong>{money(after.lowest)}</strong>
              </div>
            </div>
            <div className="sim-chart">
              <ForecastChart rows={rows} series={[scenario, "simulated"]} focus={scenario} lowPoint={{ date: after.lowestDate, value: after.lowest }} />
            </div>
            <ChartLegend
              items={[
                { color: scenario === "conservative" ? "var(--amber)" : scenario === "optimistic" ? "var(--chart-gray)" : "var(--green)", label: "Current forecast" },
                { color: "var(--red)", label: "With decision", dashed: true },
              ]}
            />
            <div className="result-metrics">
              <div>
                <span>Ending balance</span>
                <strong>{money(after.end)}</strong>
              </div>
              <div>
                <span>Days below threshold</span>
                <strong className={after.breachDays ? "danger-text" : ""}>
                  {after.breachDays} <small className="muted">(was {base.breachDays})</small>
                </strong>
              </div>
              <div>
                <span>Monthly cost increase</span>
                <strong>{monthlyCost ? money(monthlyCost) : "—"}</strong>
              </div>
              <div>
                <span>Payroll coverage</span>
                <strong>{(cash / payroll).toFixed(1)} months</strong>
              </div>
            </div>
          </Card>
          <Card className="ai-explanation">
            <div className="ai-label">
              <Sparkles size={14} /> CentsAI explanation
            </div>
            <p>
              In the {scenario} scenario, {describe()} changes your lowest projected balance from {money(base.lowest)} to {money(after.lowest)}
              {after.firstBreach ? `, dropping below your ${money(threshold)} threshold on ${fmtDay(after.firstBreach)} for ${after.breachDays} day${after.breachDays === 1 ? "" : "s"}.` : `, staying above your ${money(threshold)} threshold.`}
            </p>
            {after.firstBreach && (
              <ul className="recommend-list">
                {safeShift != null && <li>Starting on <b>{fmtDate(addDays(x.start, safeShift))}</b> ({safeShift} days later) keeps cash above the threshold in this scenario.</li>}
                {rec.overdueTotal > 0 && <li>Collecting the <b>{money(rec.overdueTotal)}</b> in overdue invoices first would cover most of the gap.</li>}
                {type === "late" && lateInv && <li>Send a reminder for {lateInv.id} now — {money(rec.open.find((item) => item.inv.id === lateInv.id)?.amount ?? 0, state.settings.currency)} depends on it.</li>}
                {type === "lose" && <li>Replacing the retainer within {Math.max(1, Math.round(diffDays(after.firstBreach, today) / 30))} month(s) avoids the shortfall.</li>}
              </ul>
            )}
            <small className="muted">Assumes all other records stay as they are. Simulations never change your data.</small>
            {after.firstBreach && rec.overdue.length > 0 && (
              <Button variant="ghost" onClick={() => go("invoices?tab=Overdue")}>
                Review overdue invoices <ArrowRight size={13} />
              </Button>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}
