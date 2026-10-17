import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Calculator, Plus, ShieldCheck } from "lucide-react"
import { Badge, Button, Card, CardHeader, Drawer, Field, FormModal, Input, MetricCard, Note, Select, Title } from "../components/ui"
import { addDays, dayInMonth, diffDays, fmtDate, fmtDay, parseISO } from "../lib/dates"
import { amortize, emiFor, forecast, loanStatus } from "../lib/finance"
import { money } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"
import type { Loan } from "../lib/types"

export default function LoansPage() {
  const { state, today, can } = useStore()
  const loans = useMemo(() => state.loans.map((l) => ({ l, st: loanStatus(l, today) })), [state.loans, today])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [calc, setCalc] = useState({ principal: 62500, rate: 12, months: 36 })
  const [prepay, setPrepay] = useState({ loanId: state.loans[0]?.id ?? "", oneTime: 6250, monthly: 0 })

  const outstanding = loans.reduce((s, x) => s + x.st.outstanding, 0)
  const emiTotal = loans.filter((x) => x.st.remainingMonths > 0).reduce((s, x) => s + x.st.emi, 0)
  const interestLeft = loans.reduce((s, x) => s + x.st.remainingInterest, 0)
  const next = loans.filter((x) => x.st.nextDue).sort((a, b) => a.st.nextDue!.localeCompare(b.st.nextDue!))[0]

  const calcResult = amortize(calc.principal, calc.rate, calc.months)
  const calcTotal = calcResult.emi * calc.months

  const target = loans.find((x) => x.l.id === prepay.loanId)
  const prepayResult = useMemo(() => {
    if (!target) return null
    const base = amortize(target.st.outstanding, target.l.rate, target.st.remainingMonths, 0, 0, target.st.emi)
    const withExtra = amortize(target.st.outstanding, target.l.rate, target.st.remainingMonths, prepay.oneTime, prepay.monthly, target.st.emi)
    const fee = (prepay.oneTime * (target.l.prepaymentFeePct ?? 0)) / 100
    const extraEvents = [
      ...(prepay.oneTime ? [{ date: addDays(today, 1), label: "Loan prepayment", amount: -(prepay.oneTime + fee), kind: "simulated" as const, certainty: "Simulated" as const }] : []),
      ...[0, 1, 2].map((m) => ({ date: dayInMonth(today, m + 1, target.l.emiDay), label: "Extra EMI", amount: -prepay.monthly, kind: "simulated" as const, certainty: "Simulated" as const })).filter((e) => e.amount < 0),
    ]
    const cashBefore = forecast(state, today, 90, "conservative")
    const cashAfter = forecast(state, today, 90, "conservative", { extra: extraEvents })
    return { base, withExtra, fee, saved: base.totalInterest - withExtra.totalInterest, monthsSaved: base.months - withExtra.months, cashBefore, cashAfter }
  }, [target, prepay, state, today])

  const cons = useMemo(() => forecast(state, today, 90, "conservative"), [state, today])
  const tightEmis = loans.flatMap((x) =>
    x.st.rows
      .slice(x.st.paid)
      .filter((r) => r.date && r.date <= addDays(today, 90))
      .filter((r) => cons.series.some((p) => Math.abs(diffDays(p.date, r.date!)) <= 3 && p.balance < state.settings.safetyThreshold))
      .map((r) => ({ loan: x.l, date: r.date!, emi: r.emi })),
  )

  const selected = loans.find((x) => x.l.id === selectedId)

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Loans & EMIs</Title>
          <p>Understand your debt, plan repayments, and see how EMIs line up with your cash.</p>
        </div>
        <Button variant="primary" icon={Plus} disabled={!can.edit} onClick={() => setAdding(true)}>
          Add loan
        </Button>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> Calculated {fmtDate(today)} · Reducing-balance method from owner-entered terms. Lender statements remain the source of truth.
      </div>
      <div className="metric-grid">
        <MetricCard label="Outstanding Principal" value={money(outstanding)} detail={`${loans.filter((x) => x.st.remainingMonths > 0).length} active loans`} />
        <MetricCard label="Monthly EMI Obligations" value={money(emiTotal)} detail="Included in every forecast" />
        <MetricCard label="Next EMI" value={next ? money(next.st.emi) : "—"} detail={next ? `${next.l.name} · ${fmtDay(next.st.nextDue!)}` : "No upcoming EMIs"} />
        <MetricCard label="Remaining Interest" value={money(interestLeft)} detail="If paid as scheduled · excludes fees" forecast />
      </div>
      <Card>
        <CardHeader title="Loan Portfolio" action={<Badge tone="blue">Owner-entered terms</Badge>} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Loan / Lender</th>
                <th>Original</th>
                <th>Outstanding</th>
                <th>Rate</th>
                <th>EMI</th>
                <th>Next due</th>
                <th>Remaining</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {loans.map(({ l, st }) => (
                <tr key={l.id} className="clickable" onClick={() => setSelectedId(l.id)}>
                  <td>
                    <strong>{l.name}</strong>
                    <small className="row-id">{l.lender}</small>
                  </td>
                  <td>{money(l.principal)}</td>
                  <td>{money(st.outstanding)}</td>
                  <td>{l.rate}% fixed</td>
                  <td>{money(st.emi)}</td>
                  <td>{st.nextDue ? fmtDay(st.nextDue) : "—"}</td>
                  <td>{st.remainingMonths} months</td>
                  <td>
                    <Badge tone={st.remainingMonths ? "green" : "neutral"}>{st.remainingMonths ? "Current" : "Closed"}</Badge>
                  </td>
                  <td>
                    <Button variant="ghost" icon={ArrowRight} aria-label={`Open ${l.name}`} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <div className="loan-grid">
        <Card>
          <CardHeader title="EMI Calculator" action={<Calculator size={17} />} />
          <div className="compact-form-grid">
            <Field label={`Loan principal (${state.settings.currency})`}>
              <Input type="number" min="0" step="10000" value={calc.principal} onChange={(e) => setCalc({ ...calc, principal: Number(e.target.value) })} />
            </Field>
            <Field label="Annual interest rate (%)">
              <Input type="number" min="0" step="0.1" value={calc.rate} onChange={(e) => setCalc({ ...calc, rate: Number(e.target.value) })} />
            </Field>
            <Field label="Tenure (months)">
              <Input type="number" min="1" max="360" value={calc.months} onChange={(e) => setCalc({ ...calc, months: Number(e.target.value) })} />
            </Field>
            <Field label="Repayment method">
              <Select disabled>
                <option>Monthly reducing balance</option>
              </Select>
            </Field>
          </div>
          <div className="calculator-result">
            <div>
              <span>Monthly EMI</span>
              <strong>{money(calcResult.emi)}</strong>
            </div>
            <div>
              <span>Total repayment</span>
              <strong>{money(calcTotal)}</strong>
            </div>
            <div>
              <span>Total interest</span>
              <strong>{money(Math.max(0, calcTotal - calc.principal))}</strong>
            </div>
          </div>
          <div className="interest-bar">
            <span style={{ width: `${calcTotal > 0 ? Math.min(100, (calc.principal / calcTotal) * 100) : 0}%` }} />
            <div>
              <small>Principal {calcTotal > 0 ? Math.round((calc.principal / calcTotal) * 100) : 0}%</small>
              <small>Interest {calcTotal > 0 ? Math.round(100 - (calc.principal / calcTotal) * 100) : 0}%</small>
            </div>
          </div>
          <p className="section-note">Excludes processing fees, taxes, floating-rate changes and lender rounding.</p>
        </Card>
        <Card>
          <CardHeader title="Extra Repayment Simulator" />
          <div className="compact-form-grid">
            <Field label="Loan" full>
              <Select value={prepay.loanId} onChange={(e) => setPrepay({ ...prepay, loanId: e.target.value })}>
                {loans.map(({ l, st }) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {money(st.outstanding)} outstanding
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={`One-time prepayment (${state.settings.currency})`}>
              <Input type="number" min="0" step="5000" value={prepay.oneTime} onChange={(e) => setPrepay({ ...prepay, oneTime: Number(e.target.value) })} />
            </Field>
            <Field label={`Extra each month (${state.settings.currency})`}>
              <Input type="number" min="0" step="1000" value={prepay.monthly} onChange={(e) => setPrepay({ ...prepay, monthly: Number(e.target.value) })} />
            </Field>
          </div>
          {prepayResult && target && (
            <>
              <div className="repayment-compare">
                <div>
                  <span>Interest saved</span>
                  <strong className="positive">{money(prepayResult.saved)}</strong>
                </div>
                <div>
                  <span>Prepayment fee ({target.l.prepaymentFeePct ?? 0}%)</span>
                  <strong>{money(prepayResult.fee)}</strong>
                </div>
                <div>
                  <span>Net saving</span>
                  <strong>{money(prepayResult.saved - prepayResult.fee)}</strong>
                </div>
                <div>
                  <span>Loan closes</span>
                  <strong>
                    {prepayResult.monthsSaved > 0 ? `${prepayResult.monthsSaved} months earlier` : "No change"} · {prepayResult.withExtra.months} left
                  </strong>
                </div>
                <div>
                  <span>Conservative lowest cash (90d)</span>
                  <strong className={prepayResult.cashAfter.lowest < state.settings.safetyThreshold ? "danger-text" : ""}>
                    {money(prepayResult.cashBefore.lowest)} → {money(prepayResult.cashAfter.lowest)}
                  </strong>
                </div>
              </div>
              {prepayResult.cashAfter.firstBreach && !prepayResult.cashBefore.firstBreach ? (
                <Note icon={AlertTriangle} tone="amber">
                  Paying this now would push cash below your safety threshold on {fmtDay(prepayResult.cashAfter.firstBreach)}. Consider prepaying after overdue invoices are collected.
                </Note>
              ) : prepayResult.cashAfter.firstBreach ? (
                <Note icon={AlertTriangle} tone="amber">
                  Cash already dips below the threshold in the conservative scenario — prepaying deepens the dip to {money(prepayResult.cashAfter.lowest)}.
                </Note>
              ) : (
                <Note icon={ShieldCheck}>Affordable: cash stays above your threshold in the conservative scenario.</Note>
              )}
            </>
          )}
        </Card>
      </div>
      {tightEmis.length > 0 && (
        <div className="risk-alert stack-gap">
          <div className="risk-icon">
            <AlertTriangle size={18} />
          </div>
          <div className="risk-copy">
            <strong>{tightEmis.length} EMI{tightEmis.length > 1 ? "s fall" : " falls"} in a low-cash window</strong>
            <p>{tightEmis.map((t) => `${t.loan.name} on ${fmtDay(t.date)} (${money(t.emi)})`).join(" · ")} — within 3 days of a conservative-scenario dip below {money(state.settings.safetyThreshold)}.</p>
            <small>EMIs are always included in forecasts; this flags timing, not affordability on average.</small>
          </div>
          <Button variant="ghost" onClick={() => go("cash-flow?scenario=conservative&horizon=90")}>
            View cash flow <ArrowRight size={13} />
          </Button>
        </div>
      )}
      {selected && (
        <Drawer eyebrow="LOAN DETAIL" title={selected.l.name} onClose={() => setSelectedId(null)}>
          <div className="drawer-status">
            <Badge tone="green">{selected.st.remainingMonths ? "Current" : "Closed"}</Badge>
            <div className="drawer-amount">
              <strong>{money(selected.st.outstanding)}</strong>
              <small>outstanding principal</small>
            </div>
          </div>
          <div className="detail-grid">
            {[
              ["Lender", selected.l.lender],
              ["Original principal", money(selected.l.principal)],
              ["Interest rate", `${selected.l.rate}% fixed`],
              ["Tenure", `${selected.l.tenureMonths} months`],
              ["Disbursed", fmtDate(selected.l.startDate)],
              ["EMI", `${money(selected.st.emi)} on day ${selected.l.emiDay}`],
              ["Paid instalments", `${selected.st.paid} of ${selected.l.tenureMonths}`],
              ["Final EMI", selected.st.endDate ? fmtDate(selected.st.endDate) : "—"],
              ["Prepayment fee", selected.l.prepaymentFeePct != null ? `${selected.l.prepaymentFeePct}%` : "Not supplied"],
              ["Interest remaining", money(selected.st.remainingInterest)],
            ].map(([a, b]) => (
              <div key={a}>
                <span>{a}</span>
                <strong>{b}</strong>
              </div>
            ))}
          </div>
          <Title level={3}>Upcoming instalments</Title>
          <div className="mini-table">
            {selected.st.rows.slice(selected.st.paid, selected.st.paid + 12).map((r) => (
              <div key={r.n}>
                <span>
                  #{r.n} <small>{r.date ? fmtDay(r.date) : ""}</small>
                </span>
                <span>
                  {money(r.interest)} int · {money(r.principal)} prin
                </span>
                <b>{money(r.closing)}</b>
              </div>
            ))}
          </div>
          <Note icon={ShieldCheck}>User-entered terms. Confirm with the lender statement before making decisions.</Note>
        </Drawer>
      )}
      {adding && <LoanForm close={() => setAdding(false)} />}
    </div>
  )
}

function LoanForm({ close }: { close: () => void }) {
  const { state, today, update, log, actor, toast } = useStore()
  const [d, setD] = useState({ name: "", lender: "", principal: "", rate: "", tenure: "24", startDate: today, emiDay: String(Math.min(28, parseISO(today).getDate())), fee: "" })
  const emi = emiFor(Number(d.principal), Number(d.rate), Number(d.tenure))
  return (
    <FormModal
      eyebrow="DEBT RECORD"
      title="Add loan"
      submitLabel="Add loan"
      onClose={close}
      onSubmit={() => {
        const principal = Number(d.principal)
        const rate = Number(d.rate)
        const tenure = Number(d.tenure)
        if (!d.name.trim() || !d.lender.trim() || !(principal > 0) || !(rate >= 0) || !(tenure > 0)) return toast("Enter name, lender, principal, rate and tenure")
        const loan: Loan = { id: `LN-${Date.now().toString(36)}`, name: d.name.trim(), lender: d.lender.trim(), principal, rate, tenureMonths: tenure, startDate: d.startDate, emiDay: Math.min(28, Math.max(1, Number(d.emiDay))), prepaymentFeePct: d.fee === "" ? undefined : Number(d.fee) }
        update((s) => {
          s.loans.push(loan)
        })
        log({ actor, action: "Loan added", detail: `${loan.name} · ${money(principal)} at ${rate}% for ${tenure} months (EMI ${money(emi)})`, ref: loan.id, outcome: "info" })
        toast("Loan added — EMIs are now in the forecast")
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Loan name">
          <Input value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} placeholder="e.g. Office fit-out loan" required />
        </Field>
        <Field label="Lender">
          <Input value={d.lender} onChange={(e) => setD({ ...d, lender: e.target.value })} required />
        </Field>
        <Field label={`Principal (${state.settings.currency})`}>
          <Input type="number" min="1" value={d.principal} onChange={(e) => setD({ ...d, principal: e.target.value })} required />
        </Field>
        <Field label="Annual rate (%)">
          <Input type="number" min="0" step="0.01" value={d.rate} onChange={(e) => setD({ ...d, rate: e.target.value })} required />
        </Field>
        <Field label="Tenure (months)">
          <Input type="number" min="1" value={d.tenure} onChange={(e) => setD({ ...d, tenure: e.target.value })} />
        </Field>
        <Field label="Disbursement date">
          <Input type="date" value={d.startDate} onChange={(e) => setD({ ...d, startDate: e.target.value })} />
        </Field>
        <Field label="EMI day of month">
          <Input type="number" min="1" max="28" value={d.emiDay} onChange={(e) => setD({ ...d, emiDay: e.target.value })} />
        </Field>
        <Field label="Prepayment fee (%)" hint="Leave blank if unknown">
          <Input type="number" min="0" step="0.1" value={d.fee} onChange={(e) => setD({ ...d, fee: e.target.value })} />
        </Field>
      </div>
      {emi > 0 && <p className="section-note form-note">Estimated EMI {money(emi)} · first instalment {fmtDay(dayInMonth(d.startDate, 1, Number(d.emiDay) || 1))}</p>}
    </FormModal>
  )
}
