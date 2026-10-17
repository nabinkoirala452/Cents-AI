import { useMemo, useState } from "react"
import { AlertTriangle, Check, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react"
import { Badge, Button, Card, CardHeader, Field, FormModal, Input, Select, Title } from "../components/ui"
import { addDays, dayInMonth, fmtDate, fmtDay } from "../lib/dates"
import { buildEvents, cashBalance, emiFor, expenseInsights, forecast, loanStatus, periodTotals, projectStats, receivables, type CashEvent } from "../lib/finance"
import { money } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"
import type { LoanOffer, Scenario } from "../lib/types"

const CHECKLIST = [
  "Recent revenue and expense records",
  "Outstanding receivables and payables",
  "Existing loan details",
  "Current cash-flow forecast",
  "Business registration and tax documents",
  "Last 6 months of bank statements",
]

export default function FinancingPage() {
  const { state, today, update, log, actor, toast, can } = useStore()
  const s = state.settings
  const [purpose, setPurpose] = useState("Hiring or expansion")
  const [spend, setSpend] = useState(37500)
  const [needDate, setNeedDate] = useState(addDays(today, 30))
  const [reserve, setReserve] = useState(s.safetyThreshold)
  const [scenario, setScenario] = useState<Scenario>("conservative")
  const [selectedOffer, setSelectedOffer] = useState(state.offers[0]?.id ?? "")
  const [adding, setAdding] = useState(false)

  const rec = receivables(state, today)
  const cash = cashBalance(state, today)
  const horizon = 120
  const fc = useMemo(() => forecast(state, today, horizon, scenario), [state, today, scenario])
  const atNeed = fc.series.find((p) => p.date === needDate)?.balance ?? fc.end
  const minAfterNeed = Math.min(...fc.series.filter((p) => p.date >= needDate).map((p) => p.balance))
  const available = Math.min(atNeed, minAfterNeed)
  const gap = Math.max(0, spend + reserve - available)
  const owed30 = buildEvents(state, today, 30, "expected").filter((e) => e.amount < 0).reduce((sum, e) => sum - e.amount, 0)
  const emis = state.loans.map((l) => loanStatus(l, today)).filter((x) => x.remainingMonths > 0).reduce((sum, x) => sum + x.emi, 0)
  const lastMonth = periodTotals(state.transactions, dayInMonth(today, -1, 1), addDays(dayInMonth(today, 0, 1), -1))
  const subsSaving = expenseInsights(state, today).flags.filter((f) => f.kind !== "duplicate").reduce((sum, f) => sum + f.amount, 0)
  const unbilled = state.projects.map((p) => projectStats(state, p)).reduce((sum, p) => sum + p.unbilled, 0)

  const offerRows = useMemo(
    () =>
      state.offers.map((o) => {
        const emi = emiFor(o.principal, o.rate, o.months)
        const total = emi * o.months
        const events: CashEvent[] = [
          { date: needDate, label: "Planned spend", amount: -spend, kind: "simulated", certainty: "Simulated" },
          { date: needDate, label: `${o.name} disbursed`, amount: o.principal - o.fees, kind: "simulated", certainty: "Simulated" },
          ...Array.from({ length: o.months }, (_, m) => ({ date: dayInMonth(needDate, m + 1, Number(needDate.slice(8, 10))), label: `${o.name} EMI`, amount: -emi, kind: "simulated" as const, certainty: "Simulated" as const })),
        ]
        const withLoan = forecast(state, today, horizon, "conservative", { extra: events })
        return { o, emi, total, cost: total - o.principal + o.fees, withLoan }
      }),
    [state, today, needDate, spend],
  )
  const noLoan = useMemo(() => forecast(state, today, horizon, "conservative", { extra: [{ date: needDate, label: "Planned spend", amount: -spend, kind: "simulated", certainty: "Simulated" }] }), [state, today, needDate, spend])
  const chosen = offerRows.find((r) => r.o.id === selectedOffer) ?? offerRows[0]
  const cheapest = [...offerRows].filter((r) => r.o.principal >= gap).sort((a, b) => a.cost - b.cost)[0]

  const meaning =
    gap === 0
      ? { title: "Borrowing looks avoidable.", body: `In the ${scenario} scenario you’d have ${money(available)} available around ${fmtDay(needDate)} — enough for ${money(spend)} while keeping your ${money(reserve)} reserve.` }
      : gap <= rec.overdueTotal
        ? { title: "Collecting overdue invoices could close the gap.", body: `The estimated gap is ${money(gap)}, which is less than the ${money(rec.overdueTotal)} currently overdue. Borrowing may be avoidable if those receipts arrive before ${fmtDay(needDate)}.` }
        : { title: `You may need about ${money(gap)} of financing.`, body: `Even with expected receipts, ${money(spend)} on ${fmtDay(needDate)} plus a ${money(reserve)} reserve exceeds the ${money(available)} projected to be available.${cheapest ? ` ${cheapest.o.name} has the lowest total cost among offers that cover the gap.` : " None of the entered offers fully covers it."}` }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Financing Assistant</Title>
          <p>Estimate how much you actually need, and compare borrowing with other options.</p>
        </div>
        <Button icon={Sparkles} onClick={() => go(`copilot?q=${encodeURIComponent("What does our cash forecast look like?")}`)}>
          Ask CentsAI
        </Button>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Decision support only · Offers are entered by you · CentsAI does not predict approval or contact lenders.
      </div>
      <Card className="readiness-card">
        <CardHeader title="Financial Snapshot" action={<Badge tone={gap ? "amber" : "green"}>{gap ? `Gap ${money(gap)}` : "No funding gap"}</Badge>} />
        <div className="readiness-grid">
          {[
            ["Recorded cash", money(cash), "Ledger"],
            ["Funding gap", money(gap), `${scenario} · ${fmtDay(needDate)}`],
            ["30-day obligations", money(owed30), "Scheduled"],
            ["Receivables", money(rec.outstanding), `${money(rec.overdueTotal)} overdue`],
            ["Existing EMIs", `${money(emis)} / mo`, `${state.loans.length} loans`],
            ["Last month net", money(lastMonth.net), "Recorded"],
          ].map(([a, b, c]) => (
            <div key={a}>
              <span>{a}</span>
              <strong>{b}</strong>
              <small>{c}</small>
            </div>
          ))}
        </div>
      </Card>
      <div className="financing-grid">
        <Card>
          <CardHeader title="Estimate Funding Need" />
          <div className="form-grid">
            <Field label="Purpose" full>
              <Select value={purpose} onChange={(e) => setPurpose(e.target.value)}>
                <option>Working-capital gap</option>
                <option>Hiring or expansion</option>
                <option>Equipment purchase</option>
                <option>Project delivery</option>
                <option>Refinancing existing debt</option>
              </Select>
            </Field>
            <Field label={`Planned spend (${state.settings.currency})`}>
              <Input type="number" min="0" step="10000" value={spend} onChange={(e) => setSpend(Number(e.target.value))} />
            </Field>
            <Field label="Needed by">
              <Input type="date" min={addDays(today, 1)} max={addDays(today, horizon)} value={needDate} onChange={(e) => setNeedDate(e.target.value)} />
            </Field>
            <Field label={`Minimum cash reserve (${state.settings.currency})`}>
              <Input type="number" min="0" step="10000" value={reserve} onChange={(e) => setReserve(Number(e.target.value))} />
            </Field>
            <Field label="Forecast scenario">
              <Select value={scenario} onChange={(e) => setScenario(e.target.value as Scenario)}>
                <option value="expected">Expected</option>
                <option value="conservative">Conservative</option>
                <option value="optimistic">Optimistic</option>
              </Select>
            </Field>
          </div>
          <div className="funding-result">
            <div>
              <span>Spend + reserve</span>
              <strong>{money(spend + reserve)}</strong>
            </div>
            <span>− cash available from {fmtDay(needDate)} onward</span>
            <div>
              <span>Estimated funding gap</span>
              <strong className={gap ? "amber-text" : "positive"}>{money(gap)}</strong>
            </div>
          </div>
          <p className="section-note">Available cash = the lowest {scenario} balance on or after the need date ({money(available)}), so later obligations are protected too.</p>
        </Card>
        <Card className="meaning-card">
          <div className="ai-label">
            <Sparkles size={14} /> What this means for your agency
          </div>
          <Title level={2}>{meaning.title}</Title>
          <p>{meaning.body}</p>
          <div className="assumption-list">
            <p>
              <Check size={14} /> Uses your {scenario} forecast, including receipts and EMIs
            </p>
            {rec.overdueTotal > 0 && (
              <p>
                <AlertTriangle size={14} /> {money(rec.overdueTotal)} of overdue receipts has uncertain timing
              </p>
            )}
            <p>
              <Check size={14} /> Existing {money(emis)}/month EMIs continue
            </p>
          </div>
          <Button variant="primary" onClick={() => go("simulator?type=purchase")}>
            Test in scenario simulator
          </Button>
        </Card>
      </div>
      <Card>
        <CardHeader
          title="Compare Owner-Provided Offers"
          action={
            <Button icon={Plus} disabled={!can.edit} onClick={() => setAdding(true)}>
              Add offer
            </Button>
          }
        />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Offer</th>
                <th>Principal</th>
                <th>Rate</th>
                <th>Monthly EMI</th>
                <th>Total repayment</th>
                <th>Fees</th>
                <th>Total borrowing cost</th>
                <th>Conservative low</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {offerRows.map((r) => (
                <tr key={r.o.id} className={`clickable ${chosen?.o.id === r.o.id ? "selected-row" : ""}`} onClick={() => setSelectedOffer(r.o.id)}>
                  <td>
                    <strong>{r.o.name}</strong>
                    <small className="row-id">
                      {r.o.months} months · {r.o.principal < gap ? "doesn’t cover the gap" : "covers the gap"}
                      {cheapest?.o.id === r.o.id ? " · lowest cost" : ""}
                    </small>
                  </td>
                  <td>{money(r.o.principal)}</td>
                  <td>{r.o.rate}%</td>
                  <td>{money(r.emi)}</td>
                  <td>{money(r.total)}</td>
                  <td>{money(r.o.fees)}</td>
                  <td>{money(r.cost)}</td>
                  <td>
                    <Badge tone={r.withLoan.lowest < s.safetyThreshold ? "amber" : "green"}>{money(r.withLoan.lowest)}</Badge>
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      icon={Trash2}
                      aria-label={`Remove ${r.o.name}`}
                      disabled={!can.edit}
                      onClick={(e) => {
                        e.stopPropagation()
                        update((d) => {
                          d.offers = d.offers.filter((x) => x.id !== r.o.id)
                        })
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {offerRows.length === 0 && <div className="empty">Add an offer you’ve received to compare its cost and cash impact.</div>}
        </div>
      </Card>
      <div className="two-column">
        <Card>
          <CardHeader title={`Affordability · ${chosen?.o.name ?? "no offer"}`} action={<Badge tone="blue">Conservative · {horizon} days</Badge>} />
          <div className="affordability-bars">
            {[
              ["Today’s forecast, no spend", forecast(state, today, horizon, "conservative").lowest],
              ["Spend without borrowing", noLoan.lowest],
              ...(chosen ? [[`Spend with ${chosen.o.name}`, chosen.withLoan.lowest] as [string, number]] : []),
            ].map(([label, value]) => (
              <div key={label as string}>
                <div>
                  <span>{label}</span>
                  <strong className={(value as number) < s.safetyThreshold ? "danger-text" : ""}>{money(value as number)}</strong>
                </div>
                <div className="bar">
                  <span className={(value as number) < s.safetyThreshold ? "bar-risk" : ""} style={{ width: `${Math.max(3, Math.min(100, ((value as number) / Math.max(cash, 1)) * 100))}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="risk-inline">
            <AlertTriangle size={15} />
            <span>Bars show the lowest projected balance. A loan that is affordable on average can still fail on timing — check the dips.</span>
          </div>
        </Card>
        <Card>
          <CardHeader title="Alternatives to Borrowing" />
          <div className="alternative-list">
            {[
              ["Collect overdue invoices", rec.overdueTotal ? `+${money(rec.overdueTotal)}` : "Nothing overdue", `${rec.overdue.length} invoice(s)`, "invoices?tab=Overdue"],
              ["Review flagged subscriptions", subsSaving ? `Up to ${money(subsSaving)}/mo` : "—", "Requires approval to cancel", "expenses"],
              ["Bill remaining project milestones", unbilled ? `${money(unbilled)} unbilled` : "—", "Depends on delivery & client agreement", "projects"],
              ["Delay the spend", `${money(spend)}`, "Test later dates in the simulator", "simulator?type=purchase"],
            ].map(([a, b, c, to]) => (
              <button key={a} onClick={() => go(to)}>
                <div>
                  <strong>{a}</strong>
                  <small>{c}</small>
                </div>
                <b>{b}</b>
              </button>
            ))}
          </div>
        </Card>
      </div>
      <Card>
        <CardHeader title="Loan Readiness Checklist" action={<span className="section-note">Requirements vary by lender and jurisdiction.</span>} />
        <div className="checklist-grid">
          {CHECKLIST.map((item, index) => {
            const checked = s.readiness[index] ?? false
            return (
              <label key={item}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={!can.edit}
                  onChange={() =>
                    update((d) => {
                      const list = [...CHECKLIST.map((_, i) => d.settings.readiness[i] ?? false)]
                      list[index] = !checked
                      d.settings.readiness = list
                    })
                  }
                />
                <span>
                  <strong>{item}</strong>
                  <small>{checked ? "Available" : "Still to prepare"}</small>
                </span>
              </label>
            )
          })}
        </div>
      </Card>
      {adding && (
        <OfferForm
          close={() => setAdding(false)}
          onAdd={(o) => {
            update((d) => {
              d.offers.push(o)
            })
            log({ actor, action: "Loan offer added", detail: `${o.name} · ${money(o.principal)} at ${o.rate}% for ${o.months} months`, outcome: "info" })
            setSelectedOffer(o.id)
            toast("Offer added to the comparison")
          }}
        />
      )}
      <p className="section-note page-foot">Figures as of {fmtDate(today)}. CentsAI does not guarantee approval or terms from any lender.</p>
    </div>
  )
}

function OfferForm({ close, onAdd }: { close: () => void; onAdd: (o: LoanOffer) => void }) {
  const { state, toast } = useStore()
  const [d, setD] = useState({ name: "", principal: "", rate: "", months: "24", fees: "0" })
  return (
    <FormModal
      eyebrow="OWNER-PROVIDED OFFER"
      title="Add financing offer"
      submitLabel="Add offer"
      onClose={close}
      onSubmit={() => {
        const o: LoanOffer = { id: `OF-${Date.now().toString(36)}`, name: d.name.trim(), principal: Number(d.principal), rate: Number(d.rate), months: Number(d.months), fees: Number(d.fees) || 0 }
        if (!o.name || !(o.principal > 0) || !(o.rate >= 0) || !(o.months > 0)) return toast("Enter a name, principal, rate and tenure")
        onAdd(o)
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Offer name" full>
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Bank term loan" required />
        </Field>
        <Field label={`Principal (${state.settings.currency})`}>
          <Input type="number" min="1" value={d.principal} onChange={(e) => setD({ ...d, principal: e.target.value })} required />
        </Field>
        <Field label="Annual rate (%)">
          <Input type="number" min="0" step="0.01" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} required />
        </Field>
        <Field label="Tenure (months)">
          <Input type="number" min="1" value={d.months} onChange={(e) => setD({ ...d, months: e.target.value })} />
        </Field>
        <Field label={`Fees (${state.settings.currency})`} hint="Processing, documentation and other known fees">
          <Input type="number" min="0" value={d.fees} onChange={(e) => setD({ ...d, fees: e.target.value })} />
        </Field>
      </div>
    </FormModal>
  )
}
