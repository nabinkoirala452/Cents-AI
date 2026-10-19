import { useMemo, useState } from "react"
import { AlertTriangle, ArrowRight, Check, Plus, ShieldCheck, Sparkles } from "lucide-react"
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { approvalPermission } from "../components/approval-card"
import { Badge, Button, Card, CardHeader, Field, FormModal, Input, MetricCard, Select, Title } from "../components/ui"
import { addDays, dayInMonth, fmtDay, fmtMonth } from "../lib/dates"
import { expenseInsights, monthlyEquivalent, monthToDate, periodTotals } from "../lib/finance"
import { compactMoney, money, pct } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"
import type { RecurringCost } from "../lib/types"

const TREND_CATEGORIES = ["Payroll", "Contractors", "Software", "Operations", "Tax", "Debt repayment"]
const TREND_COLORS = ["#176b52", "#56ad8d", "#a86513", "#89918c", "#b84646", "#4b6b80"]

export default function ExpensesPage() {
  const { state, today, markRecurringReviewed, log, actor, toast, can, requestCancelSubscription, approve, mode, signedInName } = useStore()
  const [adding, setAdding] = useState(false)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const month = monthToDate(state, today)
  const x = useMemo(() => expenseInsights(state, today), [state, today])
  const categories = Object.entries(month.current.byCategory).sort((a, b) => b[1] - a[1])
  const largest = categories[0]
  const maxCat = largest?.[1] ?? 1

  const trend = useMemo(
    () =>
      [-3, -2, -1, 0].map((m) => {
        const start = dayInMonth(today, m, 1)
        const end = m === 0 ? today : addDays(dayInMonth(today, m + 1, 1), -1)
        const totals = periodTotals(state.transactions, start, end)
        const row: Record<string, string | number> = { month: fmtMonth(start).slice(0, 3) + (m === 0 ? " (MTD)" : "") }
        let other = totals.expense
        for (const c of TREND_CATEGORIES) {
          row[c] = totals.byCategory[c] ?? 0
          other -= totals.byCategory[c] ?? 0
        }
        row.Other = other
        return row
      }),
    [state.transactions, today],
  )

  const markReviewed = async (r: RecurringCost) => {
    if (reviewingId) return
    setReviewingId(r.id)
    try {
      const res = await markRecurringReviewed(r.id)
      if (!res.ok) return toast(res.message)
      log({ actor, action: "Subscription reviewed", detail: `${r.vendor} kept at ${money(r.amount)}/${r.cycle === "Annual" ? "year" : "month"}`, ref: r.id, outcome: "info" })
      toast(`${r.vendor} marked as reviewed`)
    } finally {
      setReviewingId(null)
    }
  }

  const savings = x.flags.filter((f) => f.kind !== "duplicate").reduce((s, f) => s + f.amount, 0)
  const recurring = [...state.recurring].sort((a, b) => (a.status === "Cancelled" ? 1 : 0) - (b.status === "Cancelled" ? 1 : 0) || a.nextDate.localeCompare(b.nextDate))

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Expenses & Subscriptions</Title>
          <p>Where the money goes, what keeps recurring, and what changed.</p>
        </div>
        <Button variant="primary" icon={Plus} disabled={!can.edit} onClick={() => setAdding(true)}>
          Add recurring cost
        </Button>
      </div>
      <div className="metric-grid">
        <MetricCard label="Spending This Month" value={money(month.current.expense)} detail={`${month.expenseChange >= 0 ? "+" : ""}${pct(month.expenseChange)} vs same days last month`} />
        <MetricCard label="Subscriptions / Month" value={money(x.current)} detail={`${x.change >= 0 ? "+" : ""}${pct(x.change)} vs previous charges`} tone={x.change > 10 ? "amber" : undefined} />
        <MetricCard label="Flagged for Review" value={String(x.flags.length)} detail={`${x.flags.filter((f) => f.kind === "increase").length} increases · ${x.flags.filter((f) => f.kind === "new").length} new · ${x.flags.filter((f) => f.kind === "duplicate").length} duplicate`} tone={x.flags.length ? "amber" : undefined} />
        <MetricCard label="Largest Category" value={largest ? money(largest[1]) : "—"} detail={largest ? `${largest[0]} · month to date` : "No spending yet"} />
      </div>
      <div className="two-column">
        <Card>
          <CardHeader title="Spending by Category · This Month" />
          <div className="bar-list">
            {categories.map(([name, value]) => {
              const prev = month.previous.byCategory[name] ?? 0
              return (
                <div key={name}>
                  <div>
                    <span>
                      {name} {prev > 0 && <small className={value > prev * 1.1 ? "amber-text" : "muted"}>({value >= prev ? "+" : ""}{pct(((value - prev) / prev) * 100, 0)})</small>}
                    </span>
                    <strong>{money(value)}</strong>
                  </div>
                  <div className="bar">
                    <span style={{ width: `${(value / maxCat) * 100}%` }} />
                  </div>
                </div>
              )
            })}
            {categories.length === 0 && <div className="empty">No expenses recorded this month yet.</div>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Needs Review" action={<Badge tone={x.flags.length ? "amber" : "green"}>{x.flags.length} items</Badge>} />
          <div className="flag-list">
            {x.flags.map((f) => {
              const r = state.recurring.find((y) => y.id === f.ref)
              return (
                <div key={f.id}>
                  <AlertTriangle size={16} />
                  <span>
                    <strong>{f.title}</strong>
                    <small>{f.detail}</small>
                  </span>
                  {f.kind === "duplicate" ? (
                    <Button variant="ghost" onClick={() => go(`transactions?id=${f.ref}`)}>
                      Review
                    </Button>
                  ) : (
                    r && (
                      <div className="row-actions">
                        <Button
                          variant="ghost"
                          disabled={!can.edit || reviewingId === r.id}
                          loading={reviewingId === r.id}
                          onClick={() => markReviewed(r)}
                        >
                          Keep
                        </Button>
                        <Button
                          variant="ghost"
                          disabled={!can.prepare || cancellingId === r.id}
                          loading={cancellingId === r.id}
                          onClick={async () => {
                            if (cancellingId) return
                            setCancellingId(r.id)
                            try {
                              const res = await requestCancelSubscription(r.id, state.settings.role === "Owner")
                              toast(res.message)
                            } finally {
                              setCancellingId(null)
                            }
                          }}
                        >
                          {state.settings.role === "Owner" ? "Cancel subscription" : "Request approval"}
                        </Button>
                      </div>
                    )
                  )}
                </div>
              )
            })}
            {x.flags.length === 0 && (
              <div>
                <Check size={16} />
                <span>
                  <strong>Everything reviewed</strong>
                  <small>New increases, new subscriptions and duplicates will show up here.</small>
                </span>
              </div>
            )}
          </div>
          {savings > 0 && (
            <div className="savings-note">
              <Sparkles size={14} /> Reviewing flagged subscriptions could save up to <b>{money(savings)}/month</b>. CentsAI never cancels anything automatically.
            </div>
          )}
        </Card>
      </div>
      <Card>
        <CardHeader title="Monthly Spending Trend" action={<Badge tone="blue">Recorded transactions</Badge>} />
        <div className="trend-chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={trend} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} strokeDasharray="3 4" />
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "var(--muted)", fontSize: 10 }} />
              <YAxis axisLine={false} tickLine={false} width={52} tick={{ fill: "var(--muted)", fontSize: 10 }} tickFormatter={(v: number) => compactMoney(v)} />
              <Tooltip contentStyle={{ border: "1px solid var(--border)", borderRadius: 8, fontSize: 11, background: "var(--card)" }} formatter={(v) => money(Number(v))} />
              <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
              {[...TREND_CATEGORIES, "Other"].map((c, i) => (
                <Bar key={c} dataKey={c} stackId="a" fill={TREND_COLORS[i] ?? "#c9cfca"} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card>
        <CardHeader title="Recurring Costs" action={<span className="section-note">{money(state.recurring.filter((r) => r.status !== "Cancelled").reduce((s, r) => s + monthlyEquivalent(r), 0))}/month committed</span>} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Vendor</th>
                <th>Category</th>
                <th>Amount</th>
                <th>Previous</th>
                <th>Billing</th>
                <th>Next charge</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recurring.map((r) => {
                const pending = state.approvals.find((a) => a.refId === r.id && a.status === "Pending")
                return (
                  <tr key={r.id} className={r.status === "Cancelled" ? "row-muted" : ""}>
                    <td>
                      <strong>{r.vendor}</strong>
                      <small className="row-id">{r.kind}</small>
                    </td>
                    <td>{r.category}</td>
                    <td>{money(r.amount)}</td>
                    <td className={r.previousAmount && r.amount > r.previousAmount ? "amber-text" : "muted"}>{r.previousAmount ? money(r.previousAmount) : "New"}</td>
                    <td className="muted">{r.cycle}</td>
                    <td>{r.status === "Cancelled" ? "—" : fmtDay(r.nextDate)}</td>
                    <td>
                      <Badge tone={r.status === "Cancelled" ? "neutral" : r.status === "Review" && !r.reviewed ? "amber" : "green"}>{pending ? "Cancel pending" : r.status === "Review" && r.reviewed ? "Active" : r.status}</Badge>
                    </td>
                    <td>
                      {r.status !== "Cancelled" && r.kind === "Subscription" && (
                        pending ? (
                          (() => {
                            const canApprove = approvalPermission(pending, { settings: state.settings, mode, actor, signedInName }).allowed
                            return canApprove ? (
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem", alignItems: "flex-start" }}>
                                <Button
                                  variant="primary"
                                  disabled={approvingId === pending.id}
                                  loading={approvingId === pending.id}
                                  onClick={async () => {
                                    if (approvingId) return
                                    setApprovingId(pending.id)
                                    try {
                                      const res = await approve(pending.id)
                                      toast(res.message)
                                    } finally {
                                      setApprovingId(null)
                                    }
                                  }}
                                >
                                  {approvingId === pending.id ? "Approving…" : "Approve cancel"}
                                </Button>
                                {pending.steps?.length > 0 && (
                                  <small className="muted text-[10px] block leading-tight">
                                    {pending.steps.join(" · ")}
                                  </small>
                                )}
                              </div>
                            ) : (
                              <Button variant="ghost" onClick={() => go("approvals")}>
                                Awaiting approval <ArrowRight size={13} />
                              </Button>
                            )
                          })()
                        ) : (
                          <Button
                            variant="ghost"
                            disabled={!can.prepare || cancellingId === r.id}
                            loading={cancellingId === r.id}
                            onClick={async () => {
                              if (cancellingId) return
                              setCancellingId(r.id)
                              try {
                                const res = await requestCancelSubscription(r.id, state.settings.role === "Owner")
                                toast(res.message)
                              } finally {
                                setCancellingId(null)
                              }
                            }}
                          >
                            Cancel…
                          </Button>
                        )
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="section-note table-note">
          <ShieldCheck size={12} /> Cancellations need approval and only stop the cost in CentsAI’s forecast — cancel with the vendor as well.
        </p>
      </Card>
      {adding && <AddRecurring close={() => setAdding(false)} />}
    </div>
  )
}

function AddRecurring({ close }: { close: () => void }) {
  const { state, today, addRecurringCost, log, actor, toast } = useStore()
  const [d, setD] = useState({ vendor: "", category: "Software" as RecurringCost["category"], amount: "", cycle: "Monthly" as RecurringCost["cycle"], nextDate: addDays(today, 7) })
  return (
    <FormModal
      eyebrow="RECURRING COST"
      title="Add recurring cost"
      submitLabel="Add to forecast"
      onClose={close}
      onSubmit={async () => {
        const amount = Number(d.amount)
        if (!d.vendor.trim() || !(amount > 0)) {
          const msg = "Enter a vendor and a positive amount"
          toast(msg)
          throw new Error(msg)
        }
        const res = await addRecurringCost({
          vendor: d.vendor.trim(),
          category: d.category,
          kind: d.category === "Software" || d.category === "Marketing" ? "Subscription" : "Fixed cost",
          amount,
          cycle: d.cycle,
          nextDate: d.nextDate,
          startedOn: today,
          status: "Active",
        })
        if (!res.ok) {
          toast(res.message)
          throw new Error(res.message)
        }
        log({ actor, action: "Recurring cost added", detail: `${d.vendor.trim()} ${money(amount)}/${d.cycle === "Annual" ? "year" : "month"} from ${fmtDay(d.nextDate)}`, outcome: "info" })
        toast(`${d.vendor.trim()} added — the forecast now includes it`)
        close()
      }}
    >
      <div className="form-grid">
        <Field label="Vendor" full>
          <Input value={d.vendor} onChange={(e) => setD({ ...d, vendor: e.target.value })} placeholder="e.g. Slack" required />
        </Field>
        <Field label="Category">
          <Select value={d.category} onChange={(e) => setD({ ...d, category: e.target.value as RecurringCost["category"] })}>
            <option>Software</option>
            <option>Marketing</option>
            <option>Rent</option>
            <option>Utilities</option>
            <option>Tax</option>
          </Select>
        </Field>
        <Field label={`Amount (${state.settings.currency})`}>
          <Input type="number" min="1" value={d.amount} onChange={(e) => setD({ ...d, amount: e.target.value })} required />
        </Field>
        <Field label="Billing cycle">
          <Select value={d.cycle} onChange={(e) => setD({ ...d, cycle: e.target.value as RecurringCost["cycle"] })}>
            <option>Monthly</option>
            <option>Annual</option>
          </Select>
        </Field>
        <Field label="Next charge date">
          <Input type="date" min={today} value={d.nextDate} onChange={(e) => setD({ ...d, nextDate: e.target.value })} />
        </Field>
      </div>
    </FormModal>
  )
}
