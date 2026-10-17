/**
 * CentsAI copilot — agent loop over deterministic finance tools.
 *
 * Plan → call tools → compose a grounded answer with citations, assumptions,
 * missing data and proposed actions. Actions are only *prepared*; anything
 * with side effects goes to the approval queue.
 *
 * In the prototype, intent routing is rule-based. The backend will swap
 * `route()` for an LLM with tool-calling, reusing the same tools and the same
 * answer shape, so the UI does not change.
 */
import { dayInMonth, fmtDay, parseISO } from "./dates"
import {
  buildEvents,
  cashBalance,
  expenseInsights,
  forecast,
  forecastAll,
  invoiceTotal,
  loanStatus,
  monthlyPayroll,
  monthToDate,
  nextPayroll,
  projectStats,
  receivables,
  type CashEvent,
} from "./finance"
import { money, pct } from "./format"
import type { State } from "./types"

export type TraceStep = { tool: string; input: string; output: string }

export type CopilotAction =
  | { label: string; kind: "navigate"; to: string }
  | { label: string; kind: "draft-reminders" }

export type CopilotAnswer = {
  intent: string
  headline: string
  paragraphs: string[]
  figures: { label: string; value: string; tone?: "amber" | "red" | "green" }[]
  table?: { columns: string[]; rows: string[][] }
  records: string[]
  assumptions: string[]
  missing: string[]
  trace: TraceStep[]
  actions: CopilotAction[]
}

export const SUGGESTED_QUESTIONS = [
  "Can we afford to hire another developer at $5,600 per month?",
  "Can we cover payroll if Acme pays 30 days late?",
  "Which clients have overdue invoices?",
  "How much money came in and went out this month?",
  "Which projects have the lowest margins?",
  "What do we owe in the next 14 days?",
  "Why are software costs going up?",
  "How much interest is left on our loans?",
]

const WORD_NUMBERS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, six: 6 }

const parseAmount = (q: string): number | undefined => {
  const m =
    q.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(k)?/i) ??
    q.match(/\b([\d,]+(?:\.\d+)?)\s*(k)\b/i) ??
    q.match(/\b(\d{1,3}(?:,\d{3})+|\d{4,})\b/)
  if (!m) return undefined
  const value = Number(m[1].replace(/,/g, ""))
  const unit = (m[2] ?? "").toLowerCase()
  return unit === "k" ? value * 1000 : value
}

const parseDays = (q: string, fallback: number) => {
  const m = q.match(/\b(\d+|a|an|one|two|three|four|six)\s*(day|week|month)s?\b/i)
  if (!m) return fallback
  const n = Number(m[1]) || WORD_NUMBERS[m[1].toLowerCase()] || 1
  const unit = m[2].toLowerCase()
  return unit === "week" ? n * 7 : unit === "month" ? n * 30 : n
}

const findClient = (state: State, q: string) =>
  state.clients.find((c) => q.includes(c.name.toLowerCase().split(/\s+/)[0].replace(/[^a-z]/g, "")))

const base = (intent: string, headline: string): CopilotAnswer => ({
  intent, headline, paragraphs: [], figures: [], records: [], assumptions: [], missing: [], trace: [], actions: [],
})

export function answerQuestion(state: State, today: string, question: string): CopilotAnswer {
  const q = question.toLowerCase()
  const s = state.settings
  const cash = cashBalance(state, today)
  const trace: TraceStep[] = [{ tool: "ledger.cash_balance", input: `as_of=${today}`, output: money(cash) }]
  const route = (): CopilotAnswer => {
    if (/hire|afford|new (developer|designer|employee)|recruit/.test(q)) return hire()
    if (/(pay|pays|paid).*(late|delay)|late|delay/.test(q) && findClient(state, q)) return latePayment()
    if (/overdue|who owes|unpaid|outstanding|receivable|collect/.test(q)) return overdue()
    if (/remind|follow up|chase/.test(q)) return overdue(true)
    if (/came in|went out|money in|money out|this month|income|revenue|spent|spending/.test(q) && !/software|subscription/.test(q)) return monthSummary()
    if (/margin|profit|project/.test(q)) return margins()
    if (/owe|obligation|due|bills|payroll|emi|salar/.test(q) && !/loan|interest/.test(q)) return obligations()
    if (/software|subscription|tool|cost|expense|cut/.test(q)) return subscriptions()
    if (/loan|interest|debt|emi/.test(q)) return loans()
    if (/forecast|runway|shortfall|cash|threshold|balance/.test(q)) return outlook()
    return help()
  }

  const hire = (): CopilotAnswer => {
    const salary = parseAmount(question) ?? 5600
    const start = dayInMonth(today, 1, 1)
    const payroll = nextPayroll(state, today)
    const payDay = payroll ? parseISO(payroll.date).getDate() : 28
    const extra: CashEvent[] = [0, 1, 2].map((m) => ({
      date: dayInMonth(start, m, payDay), label: "Simulated hire · salary", amount: -salary, kind: "simulated", certainty: "Simulated",
    }))
    const before = forecastAll(state, today, 90)
    const after = forecastAll(state, today, 90, { extra })
    trace.push(
      { tool: "forecast.run", input: "90d · all scenarios · baseline", output: `conservative low ${money(before.conservative.lowest)} on ${fmtDay(before.conservative.lowestDate)}` },
      { tool: "forecast.run", input: `90d · all scenarios · +${money(salary)}/mo from ${fmtDay(start)}`, output: `conservative low ${money(after.conservative.lowest)} on ${fmtDay(after.conservative.lowestDate)}` },
    )
    const consOk = after.conservative.lowest >= s.safetyThreshold
    const expOk = after.expected.lowest >= s.safetyThreshold
    const a = base("hire", consOk ? "Yes — affordable even in the conservative scenario." : expOk ? "Not comfortably in the conservative scenario." : "Not yet — cash would fall below your safety threshold.")
    a.paragraphs.push(
      `Hiring at ${money(salary)}/month from ${fmtDay(start)} adds ${money(salary * 3)} of salary over the next 90 days.`,
      consOk
        ? `Your lowest projected balance stays at ${money(after.conservative.lowest)}, above the ${money(s.safetyThreshold)} threshold, even if slow clients pay late.`
        : `In the conservative scenario the lowest balance becomes ${money(after.conservative.lowest)} on ${fmtDay(after.conservative.lowestDate)} — ${after.conservative.breachDays} days below your ${money(s.safetyThreshold)} threshold.${expOk ? " The expected scenario stays above it, so the decision depends on collecting overdue invoices." : ""}`,
    )
    a.figures.push(
      { label: "Lowest balance · before", value: money(before.conservative.lowest) },
      { label: "Lowest balance · after", value: money(after.conservative.lowest), tone: consOk ? "green" : "red" },
      { label: "Days below threshold", value: String(after.conservative.breachDays), tone: after.conservative.breachDays ? "amber" : "green" },
      { label: "Payroll coverage after", value: `${(cash / (monthlyPayroll(state) + salary)).toFixed(1)} months` },
    )
    const rec = receivables(state, today)
    if (!consOk && rec.overdue.length) a.actions.push({ label: "Prepare reminders for overdue invoices", kind: "draft-reminders" })
    a.actions.push({ label: "Open in Scenario Simulator", kind: "navigate", to: `simulator?type=hire&salary=${salary}` }, { label: "View forecast", kind: "navigate", to: "cash-flow?scenario=conservative&horizon=90" })
    a.assumptions.push(`Salary starts ${fmtDay(start)} and is paid on payroll day`, "Excludes equipment, recruitment fees and statutory costs", "No new revenue from the hire is assumed")
    a.records.push(`${state.employees.length} employee records`, `${rec.open.length} open invoices`, `${state.loans.length} loans`, `${state.recurring.length} recurring costs`)
    return a
  }

  const latePayment = (): CopilotAnswer => {
    const client = findClient(state, q)!
    const days = parseDays(q, 30)
    const open = state.invoices.filter((i) => i.clientId === client.id && i.status === "Sent")
    const delays = Object.fromEntries(open.map((i) => [i.id, days]))
    const payroll = nextPayroll(state, today)
    const baseFc = forecast(state, today, 60, "expected")
    const fc = forecast(state, today, 60, "expected", { delays })
    trace.push(
      { tool: "invoices.find", input: `client=${client.name} status=open`, output: open.map((i) => i.id).join(", ") || "none" },
      { tool: "forecast.run", input: `60d · expected · delay ${client.name} +${days}d`, output: `low ${money(fc.lowest)} on ${fmtDay(fc.lowestDate)}` },
    )
    if (!open.length) {
      const a = base("late-payment", `${client.name} has no open invoices.`)
      a.paragraphs.push("A late payment from this client would not change the forecast.")
      a.trace = trace
      return a
    }
    const afterPayroll = payroll ? fc.series.find((p) => p.date === payroll.date)?.balance ?? fc.end : fc.end
    const covered = afterPayroll >= 0
    const headline = !covered
      ? "No — payroll would not be fully covered."
      : afterPayroll < s.safetyThreshold
        ? "Payroll is covered, but your buffer drops below the safety threshold."
        : fc.lowest < s.safetyThreshold
          ? `Payroll is covered — but cash gets tight around ${fmtDay(fc.lowestDate)}.`
          : "Yes — payroll is covered with buffer to spare."
    const a = base("late-payment", headline)
    const amount = open.reduce((sum, i) => sum + invoiceTotal(i), 0)
    a.paragraphs.push(
      `${client.name} has ${open.length} open invoice${open.length > 1 ? "s" : ""} (${money(amount, open[0].currency)}). If they pay ${days} days later than usual, ${payroll ? `cash just after payroll on ${fmtDay(payroll.date)} would be ${money(afterPayroll)}` : "no payroll falls in the window"}.`,
      `Lowest balance over 60 days: ${money(fc.lowest)} on ${fmtDay(fc.lowestDate)} (vs ${money(baseFc.lowest)} if they pay as usual).`,
    )
    a.figures.push(
      { label: "Cash after payroll", value: money(afterPayroll), tone: afterPayroll < s.safetyThreshold ? "amber" : "green" },
      { label: "Lowest balance", value: money(fc.lowest), tone: fc.lowest < s.safetyThreshold ? "red" : "green" },
      { label: "Payroll", value: payroll ? money(-payroll.amount) : "—" },
    )
    a.records.push(...open.map((i) => `${i.id} · ${money(invoiceTotal(i), i.currency)} · due ${fmtDay(i.dueDate)}`))
    a.assumptions.push(`${client.name} pays ${days} days after their usual ${client.avgDelayDays}-day delay`, "All other receipts follow the expected scenario")
    a.actions.push({ label: "Prepare reminders for overdue invoices", kind: "draft-reminders" }, { label: "Simulate in Scenario Simulator", kind: "navigate", to: `simulator?type=late&client=${client.id}&days=${days}` })
    return a
  }

  const overdue = (remind = false): CopilotAnswer => {
    const rec = receivables(state, today)
    trace.push({ tool: "invoices.receivables", input: `as_of=${today}`, output: `${rec.overdue.length} overdue · ${money(rec.overdueTotal)}` })
    if (!rec.overdue.length && !rec.dueSoon.length) {
      const a = base("overdue", "No invoices are overdue or due this week.")
      a.trace = trace
      return a
    }
    const a = base("overdue", rec.overdue.length ? `${rec.overdue.length} invoice${rec.overdue.length > 1 ? "s are" : " is"} overdue, totalling ${money(rec.overdueTotal)}.` : "Nothing is overdue yet.")
    a.paragraphs.push(
      "Ranked by collection priority (amount × days overdue × the client's payment history):",
      remind ? "I can prepare reminder drafts for each overdue invoice. They go to the approval queue — nothing is sent until you approve." : `${rec.dueSoon.length} more invoice${rec.dueSoon.length === 1 ? " is" : "s are"} due within 7 days (${money(rec.dueSoonTotal)}).`,
    )
    a.table = {
      columns: ["Invoice", "Client", "Amount", "Status", "Why"],
      rows: [...rec.overdue, ...rec.dueSoon].map((r) => [r.inv.id, r.client.name, money(invoiceTotal(r.inv), r.inv.currency), r.state, r.reason]),
    }
    a.records.push(...rec.overdue.map((r) => `${r.inv.id} · ${r.inv.paypal ? `PayPal ${r.inv.paypal.status}` : "bank transfer"}`))
    if (rec.overdue.length) a.actions.push({ label: "Prepare reminders for overdue invoices", kind: "draft-reminders" })
    a.actions.push({ label: "Open invoices", kind: "navigate", to: "invoices?tab=Overdue" })
    a.assumptions.push(`All amounts are shown in ${s.currency}.`)
    return a
  }

  const monthSummary = (): CopilotAnswer => {
    const m = monthToDate(state, today)
    trace.push({ tool: "ledger.period_totals", input: `month_to_date=${today.slice(0, 7)}`, output: `in ${money(m.current.income)} · out ${money(m.current.expense)}` })
    const a = base("month", `${money(m.current.income)} came in and ${money(m.current.expense)} went out this month.`)
    a.paragraphs.push(
      `Net cash flow so far is ${money(m.current.net)}. Compared with the same days last month, income is ${m.incomeChange >= 0 ? "up" : "down"} ${pct(Math.abs(m.incomeChange), 0)} and spending is ${m.expenseChange >= 0 ? "up" : "down"} ${pct(Math.abs(m.expenseChange), 0)}.`,
    )
    const cats = Object.entries(m.current.byCategory).sort((x, y) => y[1] - x[1]).slice(0, 5)
    a.table = { columns: ["Spending category", "Amount"], rows: cats.map(([c, v]) => [c, money(v)]) }
    a.figures.push({ label: "Money in", value: money(m.current.income), tone: "green" }, { label: "Money out", value: money(m.current.expense) }, { label: "Net", value: money(m.current.net), tone: m.current.net < 0 ? "amber" : "green" })
    a.records.push(`${m.current.count} ledger entries this month`)
    a.assumptions.push("Only recorded transactions count; unpaid invoices are excluded")
    a.actions.push({ label: "Open transactions", kind: "navigate", to: "transactions" })
    return a
  }

  const margins = (): CopilotAnswer => {
    const stats = state.projects.map((p) => projectStats(state, p)).filter((p) => p.billed > 0).sort((x, y) => x.margin - y.margin)
    trace.push({ tool: "projects.profitability", input: `${state.projects.length} projects`, output: stats.map((p) => `${p.project.name} ${pct(p.margin, 0)}`).join(" · ") })
    const worst = stats[0]
    const a = base("margins", worst ? `${worst.project.name} has the lowest margin at ${pct(worst.margin)}.` : "No billed projects yet.")
    if (worst)
      a.paragraphs.push(
        `It has billed ${money(worst.billed)}, with recorded costs of ${money(worst.cost)} (labour ${money(worst.labour)}, contractors ${money(worst.contractors)}). Estimated contribution before shared overhead is ${money(worst.contribution)}.`,
      )
    a.table = { columns: ["Project", "Billed", "Costs", "Contribution", "Margin"], rows: stats.map((p) => [p.project.name, money(p.billed), money(p.cost), money(p.contribution), pct(p.margin)]) }
    a.missing.push(...stats.filter((p) => p.project.unassignedHours).map((p) => `${p.project.name}: ${p.project.unassignedHours} hours not yet assigned to a person`))
    a.assumptions.push("Labour cost = monthly salary ÷ 160 hours × hours logged", "Shared overhead (rent, tools) is not allocated")
    if (worst) a.actions.push({ label: `Open ${worst.project.name}`, kind: "navigate", to: `projects?id=${worst.project.id}` })
    return a
  }

  const obligations = (): CopilotAnswer => {
    const days = /this month/.test(q) ? Math.max(1, Math.round((parseISO(dayInMonth(today, 1, 1)).getTime() - parseISO(today).getTime()) / 86_400_000) - 1) : parseDays(q, 30)
    const events = buildEvents(state, today, days, "expected").filter((e) => e.amount < 0)
    const groups: Record<string, number> = {}
    for (const e of events) groups[e.kind] = (groups[e.kind] ?? 0) + -e.amount
    const total = events.reduce((sum, e) => sum - e.amount, 0)
    trace.push({ tool: "forecast.obligations", input: `next ${days} days`, output: `${events.length} items · ${money(total)}` })
    const names: Record<string, string> = { payroll: "Salaries", contractor: "Contractor invoices", recurring: "Rent, tax & subscriptions", emi: "Loan EMIs" }
    const a = base("obligations", `You owe ${money(total)} over the next ${days} days.`)
    a.table = { columns: ["Date", "Obligation", "Amount"], rows: events.map((e) => [fmtDay(e.date), e.label, money(-e.amount)]) }
    a.figures.push(...Object.entries(groups).map(([k, v]) => ({ label: names[k] ?? k, value: money(v) })))
    a.paragraphs.push(`Recorded cash today is ${money(cash)}, so these obligations are ${cash >= total ? "covered by cash on hand even before any client payments" : `${money(total - cash)} more than cash on hand — they rely on client receipts`}.`)
    a.assumptions.push("Scheduled obligations only; excludes discretionary spending")
    a.actions.push({ label: "View cash schedule", kind: "navigate", to: `cash-flow?horizon=${days <= 7 ? 7 : days <= 30 ? 30 : 90}` })
    return a
  }

  const subscriptions = (): CopilotAnswer => {
    const x = expenseInsights(state, today)
    trace.push({ tool: "expenses.subscription_review", input: `${x.subs.length} subscriptions`, output: `${money(x.current)}/mo · ${pct(x.change, 0)} vs previous` })
    const a = base("subscriptions", `Software subscriptions are ${money(x.current)}/month, ${x.change >= 0 ? "up" : "down"} ${pct(Math.abs(x.change), 0)}.`)
    const drivers = x.flags.filter((f) => f.kind !== "duplicate")
    a.paragraphs.push(drivers.length ? `${x.change >= 0 ? "The increase comes mainly from" : "Items still worth reviewing"}: ${drivers.map((f) => `${f.title} (${f.kind === "new" ? "new" : f.detail.split(" higher")[0] + " higher"})`).join("; ")}.` : "No unusual increases were found.")
    const dups = x.flags.filter((f) => f.kind === "duplicate")
    if (dups.length) a.paragraphs.push(`${dups.length} possible duplicate charge${dups.length > 1 ? "s" : ""} also need${dups.length > 1 ? "" : "s"} review: ${dups.map((d) => d.title).join(", ")}.`)
    a.paragraphs.push("I won't cancel anything automatically — cancellations go through the approval queue.")
    a.table = { columns: ["Vendor", "Now", "Before"], rows: x.subs.map((r) => [r.vendor, money(r.amount), r.previousAmount ? money(r.previousAmount) : "new"]) }
    a.actions.push({ label: "Review subscriptions", kind: "navigate", to: "expenses" })
    return a
  }

  const loans = (): CopilotAnswer => {
    const rows = state.loans.map((l) => ({ l, st: loanStatus(l, today) }))
    trace.push({ tool: "loans.status", input: `${rows.length} loans`, output: rows.map((r) => `${r.l.name} ${money(r.st.outstanding)}`).join(" · ") })
    const interest = rows.reduce((sum, r) => sum + r.st.remainingInterest, 0)
    const a = base("loans", `About ${money(interest)} of interest remains across ${rows.length} loans.`)
    a.table = { columns: ["Loan", "Outstanding", "EMI", "Next due", "Interest left"], rows: rows.map((r) => [r.l.name, money(r.st.outstanding), money(r.st.emi), r.st.nextDue ? fmtDay(r.st.nextDue) : "—", money(r.st.remainingInterest)]) }
    a.assumptions.push("Reducing-balance method, fixed rates, no fees", "Lender statements remain the source of truth")
    a.actions.push({ label: "Simulate an extra repayment", kind: "navigate", to: "loans" })
    return a
  }

  const outlook = (): CopilotAnswer => {
    const all = forecastAll(state, today, 30)
    trace.push({ tool: "forecast.run", input: "30d · all scenarios", output: `expected end ${money(all.expected.end)} · conservative low ${money(all.conservative.lowest)}` })
    const a = base("outlook", all.conservative.firstBreach ? `Cash could dip below ${money(s.safetyThreshold)} around ${fmtDay(all.conservative.firstBreach)} in the conservative case.` : "Cash stays above your threshold in all scenarios for 30 days.")
    a.figures.push(
      { label: "Recorded cash", value: money(cash) },
      { label: "Expected in 30 days", value: money(all.expected.end) },
      { label: "Conservative low", value: money(all.conservative.lowest), tone: all.conservative.lowest < s.safetyThreshold ? "red" : "green" },
      { label: "Uncertain receipts", value: money(all.expected.uncertainInflow), tone: "amber" },
    )
    a.paragraphs.push(`The difference between scenarios is mostly timing of ${money(all.expected.uncertainInflow)} in overdue receipts.`)
    a.actions.push({ label: "Open cash-flow forecast", kind: "navigate", to: "cash-flow" })
    return a
  }

  const help = (): CopilotAnswer => {
    const a = base("help", "I can answer questions about your recorded finances.")
    a.paragraphs.push(
      "Try asking about cash flow, overdue invoices, payroll coverage, project margins, subscriptions, loans, or whether you can afford a hire. I only use workspace records and say when data is missing — I won't guess numbers.",
    )
    a.missing.push("Your question didn't match a data source I can calculate from yet.")
    return a
  }

  const answer = route()
  answer.trace = [...trace, ...answer.trace.filter((t) => !trace.includes(t))]
  if (!answer.records.length && answer.intent !== "help") answer.records.push(`Ledger as of ${fmtDay(today)}`)
  return answer
}
