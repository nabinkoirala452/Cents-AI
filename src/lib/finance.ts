/**
 * Deterministic finance engine. Every figure the UI shows (and every answer the
 * copilot gives) is computed here from recorded data — the AI layer explains and
 * proposes, but never invents numbers.
 */
import { addDays, dayInMonth, diffDays, fmtDay, monthKey, parseISO } from "./dates"
import { changePct, money, pct } from "./format"
import type {
  Client,
  Invoice,
  Loan,
  Project,
  RecurringCost,
  Scenario,
  Settings,
  State,
  Transaction,
} from "./types"

/* ───────────── Basics ───────────── */

export const emiFor = (principal: number, rate: number, months: number) => {
  if (principal <= 0 || months <= 0 || rate < 0) return 0
  if (rate === 0) return principal / months
  const r = rate / 1200
  const f = Math.pow(1 + r, months)
  return (principal * r * f) / (f - 1)
}

export const invoiceTotal = (inv: Invoice) =>
  inv.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)

export const toINR = (amount: number, currency: Invoice["currency"], s: Settings) =>
  currency === "INR" ? amount : Math.round(amount * s.usdRate)

export const invoiceINR = (inv: Invoice, s: Settings) => toINR(invoiceTotal(inv), inv.currency, s)

export const clientOf = (state: State, id: string): Client =>
  state.clients.find((c) => c.id === id) ?? { id, name: "Unknown client", email: "", country: "", currency: "INR", avgDelayDays: 0 }

export const projectOf = (state: State, id?: string) => state.projects.find((p) => p.id === id)

export type InvoiceState = "Draft" | "Paid" | "Overdue" | "Due soon" | "Open" | "Cancelled"

export const invoiceState = (inv: Invoice, today: string): InvoiceState => {
  if (inv.status === "Draft") return "Draft"
  if (inv.status === "Paid") return "Paid"
  if (inv.status === "Cancelled") return "Cancelled"
  const days = diffDays(inv.dueDate, today)
  if (days < 0) return "Overdue"
  if (days <= 7) return "Due soon"
  return "Open"
}

export const stateTone = (s: InvoiceState) =>
  s === "Overdue" ? "red" : s === "Paid" ? "green" : s === "Due soon" ? "amber" : s === "Open" ? "blue" : "neutral"

/* ───────────── Ledger ───────────── */

export const cashBalance = (state: State, asOf: string) =>
  state.transactions.reduce(
    (bal, t) =>
      t.date >= state.settings.openingDate && t.date <= asOf
        ? bal + (t.type === "Income" ? t.amount : -t.amount)
        : bal,
    state.settings.openingBalance,
  )

export type Totals = {
  income: number
  expense: number
  net: number
  byCategory: Record<string, number>
  incomeByCategory: Record<string, number>
  count: number
}

export const periodTotals = (txns: Transaction[], from: string, to: string): Totals => {
  const out: Totals = { income: 0, expense: 0, net: 0, byCategory: {}, incomeByCategory: {}, count: 0 }
  for (const t of txns) {
    if (t.date < from || t.date > to) continue
    out.count++
    if (t.type === "Income") {
      out.income += t.amount
      out.incomeByCategory[t.category] = (out.incomeByCategory[t.category] ?? 0) + t.amount
    } else {
      out.expense += t.amount
      out.byCategory[t.category] = (out.byCategory[t.category] ?? 0) + t.amount
    }
  }
  out.net = out.income - out.expense
  return out
}

/** This month to date, compared with the same days of last month. */
export const monthToDate = (state: State, today: string) => {
  const start = `${monthKey(today)}-01`
  const day = parseISO(today).getDate()
  const prevStart = dayInMonth(today, -1, 1)
  const prevEnd = dayInMonth(today, -1, day)
  const current = periodTotals(state.transactions, start, today)
  const previous = periodTotals(state.transactions, prevStart, prevEnd)
  return {
    current,
    previous,
    incomeChange: changePct(current.income, previous.income),
    expenseChange: changePct(current.expense, previous.expense),
  }
}

/** Duplicate check used at entry time (manual add and CSV import). */
export const findDuplicate = (
  txns: Transaction[],
  candidate: { date: string; amount: number; party: string; description: string },
) =>
  txns.find(
    (t) =>
      t.amount === candidate.amount &&
      Math.abs(diffDays(t.date, candidate.date)) <= 2 &&
      (t.party.toLowerCase() === candidate.party.toLowerCase() ||
        t.description.toLowerCase() === candidate.description.toLowerCase()),
  )

/* ───────────── Receivables ───────────── */

export type OpenInvoice = {
  inv: Invoice
  client: Client
  state: InvoiceState
  amountINR: number
  daysOverdue: number
  priority: number
  reason: string
}

export const receivables = (state: State, today: string) => {
  const s = state.settings
  const open: OpenInvoice[] = state.invoices
    .filter((inv) => inv.status === "Sent")
    .map((inv) => {
      const client = clientOf(state, inv.clientId)
      const amountINR = invoiceINR(inv, s)
      const daysOverdue = Math.max(0, -diffDays(inv.dueDate, today))
      const st = invoiceState(inv, today)
      // Priority: bigger, older, slower-paying invoices first.
      const priority = Math.round(
        (amountINR / 1000) * (1 + daysOverdue / 7) * (client.avgDelayDays >= 10 ? 1.3 : 1) * (st === "Due soon" ? 0.6 : st === "Open" ? 0.3 : 1),
      )
      const reason =
        st === "Overdue"
          ? `${daysOverdue}d overdue · client usually pays ${client.avgDelayDays}d late`
          : st === "Due soon"
            ? `Due ${fmtDay(inv.dueDate)}`
            : `Due ${fmtDay(inv.dueDate)}`
      return { inv, client, state: st, amountINR, daysOverdue, priority, reason }
    })
    .sort((a, b) => b.priority - a.priority)
  const sum = (rows: OpenInvoice[]) => rows.reduce((acc, r) => acc + r.amountINR, 0)
  const overdue = open.filter((r) => r.state === "Overdue")
  const dueSoon = open.filter((r) => r.state === "Due soon")
  const monthStart = `${monthKey(today)}-01`
  const paidThisMonth = state.invoices
    .filter((i) => i.status === "Paid" && i.paidDate && i.paidDate >= monthStart && i.paidDate <= today)
    .reduce((acc, i) => acc + invoiceINR(i, s), 0)
  return {
    open,
    outstanding: sum(open),
    overdue,
    overdueTotal: sum(overdue),
    dueSoon,
    dueSoonTotal: sum(dueSoon),
    paidThisMonth,
    drafts: state.invoices.filter((i) => i.status === "Draft"),
  }
}

/* ───────────── Loans ───────────── */

export type AmortRow = { n: number; date?: string; opening: number; emi: number; interest: number; principal: number; closing: number }

export const amortize = (principal: number, rate: number, months: number, extraOneTime = 0, extraMonthly = 0, emiOverride?: number) => {
  const emi = emiOverride ?? emiFor(principal, rate, months)
  const r = rate / 1200
  let bal = Math.max(0, principal - extraOneTime)
  const rows: AmortRow[] = []
  let totalInterest = 0
  for (let n = 1; bal > 0.5 && n <= months * 3; n++) {
    const interest = bal * r
    const pay = Math.min(bal + interest, emi + extraMonthly)
    const principalPaid = pay - interest
    totalInterest += interest
    rows.push({ n, opening: bal, emi: pay, interest, principal: principalPaid, closing: Math.max(0, bal - principalPaid) })
    bal -= principalPaid
  }
  return { emi, rows, totalInterest, months: rows.length }
}

export const loanStatus = (loan: Loan, today: string) => {
  const full = amortize(loan.principal, loan.rate, loan.tenureMonths)
  let paid = 0
  while (paid < loan.tenureMonths && dayInMonth(loan.startDate, paid + 1, loan.emiDay) <= today) paid++
  const rows = full.rows.map((row) => ({ ...row, date: dayInMonth(loan.startDate, row.n, loan.emiDay) }))
  const outstanding = paid === 0 ? loan.principal : rows[paid - 1]?.closing ?? 0
  const remaining = rows.slice(paid)
  return {
    emi: full.emi,
    paid,
    remainingMonths: remaining.length,
    outstanding,
    remainingInterest: remaining.reduce((s, r) => s + r.interest, 0),
    nextDue: remaining[0]?.date,
    endDate: rows[rows.length - 1]?.date,
    rows,
  }
}

/* ───────────── Forecast ───────────── */

export type Certainty = "Confirmed" | "Expected" | "Uncertain" | "Simulated"

export type CashEvent = {
  date: string
  label: string
  amount: number
  kind: "receivable" | "planned" | "retainer" | "payroll" | "contractor" | "recurring" | "emi" | "simulated"
  certainty: Certainty
  ref?: string
}

export type ForecastMods = {
  extra?: CashEvent[]
  delays?: Record<string, number>
  dropRetainers?: string[]
  skipInvoices?: string[]
}

export const SCENARIO_RULES: Record<Scenario, string> = {
  expected: "Open invoices arrive after each client's usual delay; planned milestones are billed on schedule; costs on time.",
  optimistic: "Open invoices arrive on their due date (overdue ones within 3 days); planned milestones paid on time.",
  conservative: "Overdue and slow-paying clients pay 30 days later than usual, others 7 days later; planned milestones slip 15 days; retainers 10 days late.",
}

export const buildEvents = (state: State, today: string, horizonDays: number, scenario: Scenario, mods: ForecastMods = {}) => {
  const end = addDays(today, horizonDays)
  const s = state.settings
  const events: CashEvent[] = []
  const push = (e: CashEvent) => {
    if (e.date > today && e.date <= end) events.push(e)
  }

  for (const inv of state.invoices) {
    if (inv.status !== "Sent" || mods.skipInvoices?.includes(inv.id)) continue
    const client = clientOf(state, inv.clientId)
    const delay = inv.expectedDelayOverride ?? client.avgDelayDays
    const overdue = inv.dueDate < today
    let date =
      scenario === "optimistic"
        ? overdue ? addDays(today, 3) : inv.dueDate
        : scenario === "expected"
          ? addDays(inv.dueDate, delay)
          : addDays(inv.dueDate, delay + (overdue || delay >= 10 ? 30 : 7))
    date = addDays(date, mods.delays?.[inv.id] ?? 0)
    if (date <= today) date = addDays(today, 3)
    push({ date, label: `${client.name} · ${inv.id}`, amount: invoiceINR(inv, s), kind: "receivable", certainty: overdue ? "Uncertain" : "Expected", ref: inv.id })
  }

  // Draft invoices and planned milestones: billed in future, so never "Uncertain" yet, but slip in the conservative case.
  const plannedReceipt = (due: string, delay: number) =>
    scenario === "optimistic" ? due : scenario === "expected" ? addDays(due, delay) : addDays(due, delay + 15)
  for (const inv of state.invoices) {
    if (inv.status !== "Draft" || mods.skipInvoices?.includes(inv.id)) continue
    const client = clientOf(state, inv.clientId)
    const date = addDays(plannedReceipt(inv.dueDate < today ? addDays(today, 15) : inv.dueDate, client.avgDelayDays), mods.delays?.[inv.id] ?? 0)
    push({ date, label: `${client.name} · ${inv.id} (draft)`, amount: invoiceINR(inv, s), kind: "planned", certainty: "Expected", ref: inv.id })
  }
  for (const p of state.projects) {
    if (p.status !== "Active" || mods.dropRetainers?.includes(p.id)) continue
    const client = clientOf(state, p.clientId)
    for (const m of p.plannedBillings ?? []) {
      if (m.date < today) continue
      push({ date: plannedReceipt(addDays(m.date, 15), client.avgDelayDays), label: `${client.name} · ${m.label} (planned)`, amount: m.amount, kind: "planned", certainty: "Expected", ref: p.id })
    }
  }

  for (const p of state.projects) {
    if (!p.retainer || p.status !== "Active" || mods.dropRetainers?.includes(p.id)) continue
    const client = clientOf(state, p.clientId)
    for (let m = 0; m <= Math.ceil(horizonDays / 28) + 1; m++) {
      const due = dayInMonth(today, m, p.retainer.dayOfMonth)
      const invoiced = state.invoices.some(
        (i) => i.projectId === p.id && i.kind === "Retainer" && monthKey(i.dueDate) === monthKey(due),
      )
      if (invoiced) continue
      const delay = client.avgDelayDays + (scenario === "conservative" ? 10 : 0)
      push({ date: addDays(due, delay), label: `${client.name} · retainer (to be invoiced)`, amount: p.retainer.amount, kind: "retainer", certainty: "Expected", ref: p.id })
    }
  }

  const payroll = new Map<string, { amount: number; count: number }>()
  for (const e of state.employees) {
    for (let m = 0; m <= Math.ceil(horizonDays / 28) + 1; m++) {
      const date = dayInMonth(today, m, e.payDay)
      if (e.startDate > date) continue
      const cur = payroll.get(date) ?? { amount: 0, count: 0 }
      payroll.set(date, { amount: cur.amount + e.monthlySalary, count: cur.count + 1 })
    }
  }
  for (const [date, p] of payroll) push({ date, label: `Team payroll (${p.count})`, amount: -p.amount, kind: "payroll", certainty: "Confirmed" })

  for (const b of state.contractorBills) {
    if (b.status === "Paid") continue
    push({ date: b.dueDate > today ? b.dueDate : addDays(today, 1), label: `${b.vendor} · ${b.reference}`, amount: -b.amount, kind: "contractor", certainty: "Confirmed", ref: b.id })
  }

  for (const r of state.recurring) {
    if (r.status === "Cancelled") continue
    const step = r.cycle === "Annual" ? 12 : 1
    let date = r.nextDate
    let k = 0
    while (date <= today && k < 40) date = dayInMonth(r.nextDate, step * ++k, parseISO(r.nextDate).getDate())
    while (date <= end && k < 40) {
      push({ date, label: r.vendor, amount: -r.amount, kind: "recurring", certainty: "Confirmed", ref: r.id })
      date = dayInMonth(r.nextDate, step * ++k, parseISO(r.nextDate).getDate())
    }
  }

  for (const loan of state.loans) {
    const st = loanStatus(loan, today)
    for (const row of st.rows.slice(st.paid)) {
      if (row.date) push({ date: row.date, label: `EMI · ${loan.name}`, amount: -Math.round(row.emi), kind: "emi", certainty: "Confirmed", ref: loan.id })
    }
  }

  for (const e of mods.extra ?? []) push(e)
  return events.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount)
}

export type Forecast = {
  scenario: Scenario
  start: number
  end: number
  lowest: number
  lowestDate: string
  firstBreach?: string
  breachDays: number
  inflow: number
  outflow: number
  uncertainInflow: number
  series: { date: string; balance: number }[]
  ledger: (CashEvent & { balance: number })[]
}

export const forecast = (state: State, today: string, horizonDays: number, scenario: Scenario, mods: ForecastMods = {}): Forecast => {
  const start = cashBalance(state, today)
  const events = buildEvents(state, today, horizonDays, scenario, mods)
  const threshold = state.settings.safetyThreshold
  const byDate = new Map<string, number>()
  for (const e of events) byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.amount)
  let bal = start
  const series = [{ date: today, balance: start }]
  for (let i = 1; i <= horizonDays; i++) {
    const date = addDays(today, i)
    bal += byDate.get(date) ?? 0
    series.push({ date, balance: bal })
  }
  let lowest = start
  let lowestDate = today
  let breachDays = 0
  let firstBreach: string | undefined
  for (const p of series) {
    if (p.balance < lowest) {
      lowest = p.balance
      lowestDate = p.date
    }
    if (p.balance < threshold) {
      breachDays++
      firstBreach ??= p.date
    }
  }
  let running = start
  const ledger = events.map((e) => ({ ...e, balance: (running += e.amount) }))
  return {
    scenario,
    start,
    end: bal,
    lowest,
    lowestDate,
    firstBreach,
    breachDays,
    inflow: events.filter((e) => e.amount > 0).reduce((s, e) => s + e.amount, 0),
    outflow: events.filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0),
    uncertainInflow: events.filter((e) => e.amount > 0 && e.certainty === "Uncertain").reduce((s, e) => s + e.amount, 0),
    series,
    ledger,
  }
}

export const forecastAll = (state: State, today: string, horizonDays: number, mods: ForecastMods = {}) => {
  const expected = forecast(state, today, horizonDays, "expected", mods)
  const optimistic = forecast(state, today, horizonDays, "optimistic", mods)
  const conservative = forecast(state, today, horizonDays, "conservative", mods)
  const rows = expected.series.map((p, i) => ({
    date: p.date,
    label: fmtDay(p.date),
    expected: p.balance,
    optimistic: optimistic.series[i].balance,
    conservative: conservative.series[i].balance,
    threshold: state.settings.safetyThreshold,
  }))
  return { expected, optimistic, conservative, rows }
}

/** The biggest outflows before the lowest point, and receipts that are still uncertain. */
export const lowPointDrivers = (fc: Forecast) => {
  const before = fc.ledger.filter((e) => e.date <= fc.lowestDate)
  const outflows = before.filter((e) => e.amount < 0).sort((a, b) => a.amount - b.amount).slice(0, 4)
  const uncertain = fc.ledger.filter((e) => e.amount > 0 && e.certainty === "Uncertain")
  return { outflows, uncertain }
}

/* ───────────── People ───────────── */

export const monthlyPayroll = (state: State, includePlanned = false) =>
  state.employees
    .filter((e) => e.status === "Active" || includePlanned)
    .reduce((s, e) => s + e.monthlySalary, 0)

export const nextPayroll = (state: State, today: string) => {
  const fc = buildEvents(state, today, 40, "expected")
  return fc.find((e) => e.kind === "payroll")
}

/* ───────────── Expenses ───────────── */

export const monthlyEquivalent = (r: RecurringCost) => (r.cycle === "Annual" ? r.amount / 12 : r.amount)

export type ExpenseFlag = {
  id: string
  kind: "increase" | "new" | "duplicate"
  title: string
  detail: string
  ref: string
  amount: number
}

export const expenseInsights = (state: State, today: string) => {
  const subs = state.recurring.filter((r) => r.kind === "Subscription" && r.status !== "Cancelled")
  const current = subs.reduce((s, r) => s + monthlyEquivalent(r), 0)
  const previous = subs.reduce(
    (s, r) => s + (diffDays(today, r.startedOn) <= 31 ? 0 : (r.previousAmount ?? r.amount) / (r.cycle === "Annual" ? 12 : 1)),
    0,
  )
  const flags: ExpenseFlag[] = []
  for (const r of subs) {
    if (r.reviewed) continue
    if (r.previousAmount && r.amount > r.previousAmount * 1.15)
      flags.push({ id: `inc-${r.id}`, kind: "increase", title: `${r.vendor} · ${money(r.amount)}`, detail: `${pct(changePct(r.amount, r.previousAmount), 0)} higher than the previous charge of ${money(r.previousAmount)}.`, ref: r.id, amount: r.amount - r.previousAmount })
    if (diffDays(today, r.startedOn) <= 31)
      flags.push({ id: `new-${r.id}`, kind: "new", title: `${r.vendor} · ${money(r.amount)}`, detail: "New recurring subscription added this month.", ref: r.id, amount: r.amount })
  }
  for (const t of state.transactions.filter((t) => t.status === "Review" && t.type === "Expense"))
    flags.push({ id: `dup-${t.id}`, kind: "duplicate", title: `${t.party} · ${money(t.amount)}`, detail: t.reviewReason ?? "Needs review before reporting.", ref: t.id, amount: t.amount })
  const newSubs = subs.filter((r) => diffDays(today, r.startedOn) <= 31)
  return { subs, current, previous, change: changePct(current, previous), flags, newSubs }
}

/* ───────────── Projects ───────────── */

export const HOURS_PER_MONTH = 160

export const projectStats = (state: State, p: Project) => {
  const s = state.settings
  const labourLines = p.timeEntries.map((t) => {
    const e = state.employees.find((x) => x.id === t.employeeId)
    const rate = e ? e.monthlySalary / HOURS_PER_MONTH : 0
    return { name: e?.name ?? "Unknown", role: e?.role ?? "", hours: t.hours, rate, cost: rate * t.hours }
  })
  const labour = labourLines.reduce((sum, l) => sum + l.cost, 0)
  const bills = state.contractorBills.filter((b) => b.projectId === p.id)
  const contractors = bills.reduce((sum, b) => sum + b.amount, 0)
  const direct = state.transactions
    .filter((t) => t.projectId === p.id && t.type === "Expense" && t.category !== "Contractors")
    .reduce((sum, t) => sum + t.amount, 0)
  const projectInvoices = state.invoices.filter((i) => i.projectId === p.id && (i.status === "Sent" || i.status === "Paid"))
  const otherIncome = state.transactions
    .filter((t) => t.projectId === p.id && t.type === "Income" && !t.invoiceId)
    .reduce((sum, t) => sum + t.amount, 0)
  const billed = projectInvoices.reduce((sum, i) => sum + invoiceINR(i, s), 0) + otherIncome
  const collected = projectInvoices.filter((i) => i.status === "Paid").reduce((sum, i) => sum + invoiceINR(i, s), 0) + otherIncome
  const cost = labour + contractors + direct
  const contribution = billed - cost
  const margin = billed > 0 ? (contribution / billed) * 100 : 0
  const hours = p.timeEntries.reduce((sum, t) => sum + t.hours, 0)
  const budgetUsed = p.budgetCost > 0 ? (cost / p.budgetCost) * 100 : 0
  const flags: string[] = []
  if (margin < 25) flags.push("Low margin")
  if (budgetUsed > 100) flags.push("Over budget")
  if (p.unassignedHours > 0) flags.push(`${p.unassignedHours} unassigned hours`)
  return {
    project: p,
    client: clientOf(state, p.clientId),
    labourLines,
    labour,
    contractors,
    bills,
    direct,
    billed,
    collected,
    unbilled: Math.max(0, p.contractValue - billed),
    cost,
    contribution,
    margin,
    hours,
    budgetUsed,
    flags,
  }
}

/* ───────────── Briefing ───────────── */

export type Priority = {
  id: string
  severity: "high" | "medium" | "low"
  title: string
  amount: string
  detail: string
  evidence: string
  calculation: string
  changeIf: string
  action: { label: string; to: string }
  secondary?: "draft-reminders"
}

export const buildBriefing = (state: State, today: string, horizonDays: number = state.settings.defaultHorizon) => {
  const s = state.settings
  const rec = receivables(state, today)
  const all = forecastAll(state, today, horizonDays)
  const cons = all.conservative
  const exp = all.expected
  const payroll = nextPayroll(state, today)
  const exp30 = expenseInsights(state, today)
  const cash = cashBalance(state, today)
  const priorities: Priority[] = []

  if (rec.overdue.length) {
    priorities.push({
      id: `overdue-${rec.overdue.map((r) => r.inv.id).join("-")}`,
      severity: "high",
      title: "Follow up on overdue invoices",
      amount: money(rec.overdueTotal),
      detail: `${rec.overdue.length} invoice${rec.overdue.length > 1 ? "s are" : " is"} overdue. These amounts are not counted in recorded cash and are treated as uncertain in the forecast.`,
      evidence: rec.overdue.map((r) => `${r.inv.id} · ${money(invoiceTotal(r.inv), r.inv.currency)} (${r.daysOverdue}d)`).join(" · "),
      calculation: "Sum of sent, unpaid invoices past their due date, converted at the workspace USD rate",
      changeIf: "A client pays, or a PayPal status check confirms payment",
      action: { label: "Review invoices", to: "invoices?tab=Overdue" },
      secondary: "draft-reminders",
    })
  }

  if (cons.firstBreach || exp.firstBreach) {
    const fc = exp.firstBreach ? exp : cons
    const drivers = lowPointDrivers(fc)
    priorities.push({
      id: `breach-${fc.scenario}-${fc.firstBreach}`,
      severity: exp.firstBreach ? "high" : "medium",
      title: `Cash may fall below ${money(s.safetyThreshold)}`,
      amount: money(fc.lowest),
      detail: `In the ${fc.scenario} scenario, cash drops to ${money(fc.lowest)} on ${fmtDay(fc.lowestDate)} (${fc.breachDays} day${fc.breachDays === 1 ? "" : "s"} below your safety threshold).`,
      evidence: drivers.outflows.map((e) => `${e.label} ${money(-e.amount)}`).join(" · "),
      calculation: `Recorded cash ${money(cash)} plus scheduled receipts minus scheduled obligations, day by day`,
      changeIf: "Overdue receipts arrive, or obligations move",
      action: { label: "View cash-flow forecast", to: `cash-flow?scenario=${fc.scenario}` },
    })
  }

  if (payroll) {
    const before = exp.series.find((p) => p.date === addDays(payroll.date, -1))?.balance ?? cash
    const after = before + payroll.amount
    priorities.push({
      id: `payroll-${payroll.date}`,
      severity: after < s.safetyThreshold ? "high" : "medium",
      title: "Protect upcoming payroll",
      amount: money(-payroll.amount),
      detail: `${payroll.label} is due ${fmtDay(payroll.date)}. Expected cash just after payroll: ${money(after)}${after < s.safetyThreshold ? " — below your safety threshold" : ""}.`,
      evidence: `${state.employees.filter((e) => e.status === "Active").length} employee records · pay day ${fmtDay(payroll.date)}`,
      calculation: "Expected balance the day before payroll minus total salaries",
      changeIf: "Salary amounts, pay day, or receipts before payroll change",
      action: { label: "Review payroll", to: "payroll" },
    })
  }

  if (exp30.change > 10) {
    priorities.push({
      id: `subs-${Math.round(exp30.current)}`,
      severity: "low",
      title: "Review increasing software costs",
      amount: `+${pct(exp30.change, 0)}`,
      detail: `Subscriptions are ${money(exp30.current)}/month vs ${money(exp30.previous)} last month. ${exp30.flags.filter((f) => f.kind !== "duplicate").length} items are flagged for review.`,
      evidence: exp30.flags.filter((f) => f.kind !== "duplicate").map((f) => f.title).join(" · "),
      calculation: "Current monthly-equivalent subscription cost vs previous charges",
      changeIf: "A subscription is cancelled or marked as reviewed",
      action: { label: "Review subscriptions", to: "expenses" },
    })
  }

  const weak = state.projects.map((p) => projectStats(state, p)).filter((p) => p.billed > 0 && p.margin < 25)
  for (const p of weak) {
    priorities.push({
      id: `margin-${p.project.id}-${Math.round(p.margin)}`,
      severity: "low",
      title: `${p.project.name} margin is ${pct(p.margin, 0)}`,
      amount: money(p.contribution),
      detail: `Billed ${money(p.billed)} against recorded costs of ${money(p.cost)}${p.project.unassignedHours ? `; ${p.project.unassignedHours} hours are still unassigned` : ""}.`,
      evidence: `Labour ${money(p.labour)} · contractors ${money(p.contractors)} · direct ${money(p.direct)}`,
      calculation: "Billed revenue minus attributed labour, contractor and direct costs (before shared overhead)",
      changeIf: "Hours or costs are re-attributed, or more milestones are billed",
      action: { label: "Open profitability", to: `projects?id=${p.project.id}` },
    })
  }

  const pending = state.approvals.filter((a) => a.status === "Pending")
  if (pending.length) {
    priorities.push({
      id: `approvals-${pending.map((a) => a.id).join("-")}`,
      severity: "medium",
      title: `${pending.length} action${pending.length > 1 ? "s" : ""} awaiting your approval`,
      amount: money(pending.reduce((s2, a) => s2 + a.amountINR, 0)),
      detail: "Nothing is sent or paid until an authorised person approves it.",
      evidence: pending.map((a) => a.title).join(" · "),
      calculation: "Pending items in the approval queue",
      changeIf: "Items are approved or rejected",
      action: { label: "Open approvals", to: "approvals" },
    })
  }

  const rank = { high: 0, medium: 1, low: 2 }
  priorities.sort((a, b) => rank[a.severity] - rank[b.severity])

  const summary = [
    `Your agency has ${money(cash)} in recorded cash.`,
    rec.overdue.length ? `${rec.overdue.length} overdue invoice${rec.overdue.length > 1 ? "s" : ""} totalling ${money(rec.overdueTotal)} may affect near-term liquidity.` : "No invoices are overdue.",
    payroll ? `Payroll of ${money(-payroll.amount)} is due ${fmtDay(payroll.date)}.` : "",
    cons.firstBreach
      ? `In the conservative scenario cash could dip to ${money(cons.lowest)} on ${fmtDay(cons.lowestDate)}, so collecting outstanding payments should be the priority.`
      : `Cash stays above your ${money(s.safetyThreshold)} threshold in all scenarios over the next ${horizonDays} days.`,
  ].filter(Boolean).join(" ")

  return { priorities, summary, rec, all, cash, payroll }
}
