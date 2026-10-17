import { diffDays, fmtDate } from "./dates"
import { invoiceTotal } from "./finance"
import { money } from "./format"
import type { Client, Invoice, Settings } from "./types"

export type ReminderTone = "Friendly" | "Firm" | "Final notice"

/** Template-driven reminder drafting. The backend LLM will replace this with a model call that uses the same inputs. */
export const draftReminder = (inv: Invoice, client: Client, s: Settings, today: string, tone: ReminderTone = "Friendly") => {
  const amount = money(invoiceTotal(inv), inv.currency)
  const overdue = -diffDays(inv.dueDate, today)
  const item = inv.lineItems[0]?.description ?? "our recent work"
  const when =
    overdue > 0 ? `was due on ${fmtDate(inv.dueDate)} (${overdue} day${overdue === 1 ? "" : "s"} ago)` : `is due on ${fmtDate(inv.dueDate)}`
  const pay = inv.paypal ? "You can pay securely using the PayPal link on the invoice." : "Bank transfer details are on the invoice."
  const opener: Record<ReminderTone, string> = {
    Friendly: `A quick reminder that invoice ${inv.id} for ${amount} (${item}) ${when}.`,
    Firm: `Our records show invoice ${inv.id} for ${amount} (${item}) ${when} and remains unpaid.`,
    "Final notice": `This is a final reminder: invoice ${inv.id} for ${amount} (${item}) ${when}. Please arrange payment within 5 business days.`,
  }
  const closer: Record<ReminderTone, string> = {
    Friendly: "If payment is already on its way, please ignore this note — and thank you!",
    Firm: "Could you confirm the expected payment date? Let us know if anything is blocking it.",
    "Final notice": "If there is a dispute about this invoice, please reply so we can resolve it quickly.",
  }
  return `Hi ${client.name} team,\n\n${opener[tone]} ${pay}\n\n${closer[tone]}\n\nBest regards,\n${s.ownerName}\n${s.agencyName}`
}
