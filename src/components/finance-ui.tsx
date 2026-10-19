import { useState } from "react"
import { AlertTriangle, ArrowRight, ChevronDown, ShieldCheck } from "lucide-react"
import { fmtDay, relativeDue } from "../lib/dates"
import { invoiceState, invoiceTotal, lowPointDrivers, stateTone, type Forecast, type OpenInvoice, type Priority } from "../lib/finance"
import { money } from "../lib/format"
import { go } from "../lib/router"
import { useStore } from "../lib/store"
import type { Invoice, State } from "../lib/types"
import { Badge, Button } from "./ui"

export function InvoiceRows({ rows, state, today, onSelect, showPriority }: {
  rows: (Invoice | OpenInvoice)[]
  state: State
  today: string
  onSelect: (inv: Invoice) => void
  showPriority?: boolean
}) {
  const { highlightedId } = useStore()
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Client</th>
            <th>Invoice</th>
            <th>Amount</th>
            <th>Due</th>
            <th>Status</th>
            {showPriority && <th>Why now</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const inv = "inv" in row ? row.inv : row
            const st = invoiceState(inv, today)
            const client = state.clients.find((c) => c.id === inv.clientId)
            const due =
              st === "Paid" ? `Paid ${inv.paidDate ? fmtDay(inv.paidDate) : ""}` : st === "Draft" ? "Not issued" : relativeDue(inv.dueDate, today)
            return (
              <tr key={inv.id} className={`clickable ${inv.id === highlightedId ? "row-highlight" : ""}`} tabIndex={0} onClick={() => onSelect(inv)} onKeyDown={(e) => e.key === "Enter" && onSelect(inv)}>
                <td>
                  <strong>{client?.name}</strong>
                  <small className="row-id">{inv.channel === "PayPal" ? "PayPal" : "Bank transfer"} · {inv.currency}</small>
                </td>
                <td className="muted">{inv.id}</td>
                <td>{money(invoiceTotal(inv), inv.currency)}</td>
                <td className="muted">{due}</td>
                <td>
                  <Badge tone={stateTone(st)}>{st}</Badge>
                </td>
                {showPriority && <td className="muted">{"reason" in row ? row.reason : ""}</td>}
                <td>
                  <Button variant="ghost" aria-label={`Open ${inv.id}`} icon={ArrowRight} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {rows.length === 0 && <div className="empty">No invoices match the current view.</div>}
    </div>
  )
}

export function RiskAlert({ fc, threshold, link = true }: { fc: Forecast; threshold: number; link?: boolean }) {
  if (!fc.firstBreach) {
    return (
      <div className="risk-alert risk-ok">
        <div className="risk-icon">
          <ShieldCheck size={18} />
        </div>
        <div className="risk-copy">
          <strong>Cash stays above your safety threshold</strong>
          <p>
            Lowest projected balance in the {fc.scenario} scenario is {money(fc.lowest)} on {fmtDay(fc.lowestDate)}, above {money(threshold)}.
          </p>
        </div>
      </div>
    )
  }
  const drivers = lowPointDrivers(fc)
  return (
    <div className="risk-alert">
      <div className="risk-icon">
        <AlertTriangle size={18} />
      </div>
      <div className="risk-copy">
        <strong>Potential cash shortfall</strong>
        <p>
          In the {fc.scenario} scenario, cash may fall below your {money(threshold)} safety threshold on {fmtDay(fc.firstBreach)}, reaching {money(fc.lowest)} on {fmtDay(fc.lowestDate)}.
        </p>
        <div className="risk-meta">
          {drivers.outflows.slice(0, 3).map((e) => (
            <span key={e.label + e.date}>
              {e.label} · {fmtDay(e.date)}: <b>{money(-e.amount)}</b>
            </span>
          ))}
          {drivers.uncertain.length > 0 && (
            <span>
              Uncertain receipts: <b>{money(drivers.uncertain.reduce((s, e) => s + e.amount, 0))}</b>
            </span>
          )}
        </div>
        <small>The forecast depends on the timing of uncertain client receipts.</small>
      </div>
      {link && (
        <Button variant="ghost" onClick={() => go(`cash-flow?scenario=${fc.scenario}`)}>
          View forecast <ArrowRight size={14} />
        </Button>
      )}
    </div>
  )
}

/** Priority actions with explainable evidence. Used by the dashboard and the briefing page. */
export function PriorityList({ items, compact }: { items: Priority[]; compact?: boolean }) {
  const { state, today, dismissInsight, prepareReminder, toast, can } = useStore()
  const [expanded, setExpanded] = useState<string | null>(compact ? null : items[0]?.id ?? null)

  const draftReminders = async () => {
    const overdue = state.invoices.filter((i) => i.status === "Sent" && i.dueDate < today)
    const results = await Promise.all(overdue.map((i) => prepareReminder(i.id, { preparedBy: "CentsAI agent" })))
    const ok = results.filter((r) => r.ok).length
    toast(ok ? `${ok} reminder draft${ok > 1 ? "s" : ""} prepared — review them in Approvals` : results[0]?.message ?? "No overdue invoices")
  }

  if (items.length === 0) return <div className="empty">Nothing needs your attention right now.</div>

  return (
    <div className="priority-actions">
      {items.map((item, index) => (
        <div className="priority-action" key={item.id}>
          <div className={`priority-number priority-${item.severity === "high" ? "red" : item.severity === "medium" ? "amber" : "neutral"}`}>{index + 1}</div>
          <div className="priority-copy">
            <div className="priority-title">
              <strong>{item.title}</strong>
              <b>{item.amount}</b>
            </div>
            <p>{item.detail}</p>
            {!compact && (
              <button className="explain-toggle" onClick={() => setExpanded(expanded === item.id ? null : item.id)} aria-expanded={expanded === item.id}>
                Why this insight? <ChevronDown size={13} />
              </button>
            )}
            {expanded === item.id && (
              <div className="insight-detail">
                <div>
                  <span>Supporting records</span>
                  <strong>{item.evidence || "—"}</strong>
                </div>
                <div>
                  <span>Calculation</span>
                  <strong>{item.calculation}</strong>
                </div>
                <div>
                  <span>Could change if</span>
                  <strong>{item.changeIf}</strong>
                </div>
              </div>
            )}
            <div className="priority-buttons">
              <Button variant={compact ? "ghost" : "primary"} onClick={() => go(item.action.to)}>
                {item.action.label} {compact && <ArrowRight size={13} />}
              </Button>
              {!compact && item.secondary === "draft-reminders" && <Button disabled={!can.prepare} onClick={draftReminders}>Draft reminders</Button>}
              {!compact && (
                <Button
                  variant="ghost"
                  disabled={!can.edit}
                  onClick={async () => {
                    const res = await dismissInsight(item.id)
                    if (!res.ok) return toast(res.message)
                    toast("Insight dismissed")
                  }}
                >
                  Dismiss
                </Button>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
