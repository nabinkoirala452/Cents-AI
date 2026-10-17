import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { todayISO } from "./dates"
import { draftReminder, type ReminderTone } from "./drafts"
import { clientOf, findDuplicate, invoiceINR, invoiceTotal } from "./finance"
import { money, uid } from "./format"
import { paypalEligibility, paypalSandbox } from "./paypal"
import { createSeed, STATE_VERSION } from "./seed"
import type { Approval, AuditEvent, Role, Settings, State, Transaction } from "./types"

const STORAGE_KEY = "centsai.workspace"

// Several requests can be prepared in one tick (e.g. reminders for every overdue invoice).
let approvalSeq = 0

const load = (): State => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as State
      if (parsed.version === STATE_VERSION) return parsed
    }
  } catch {
    /* storage unavailable — fall back to seed */
  }
  return createSeed()
}

export const permissions = (s: Settings) => ({
  view: true,
  prepare: s.role !== "Viewer",
  edit: s.role !== "Viewer",
  approve: (amountINR: number) =>
    s.role === "Owner" || (s.role === "Finance Manager" && amountINR <= s.managerApprovalLimit),
})

export const actorName = (s: Settings) =>
  s.team.find((m) => m.role === s.role)?.name ?? (s.role === "Owner" ? s.ownerName : s.role)

export const ROLE_TIERS: { role: Role; tier: string; detail: string }[] = [
  { role: "Viewer", tier: "Read-only analysis", detail: "View dashboards, forecasts and copilot answers. Cannot prepare or approve actions." },
  { role: "Finance Manager", tier: "Prepare & limited approval", detail: "Record data and prepare actions. Approves up to the configured limit." },
  { role: "Owner", tier: "Execute with approval", detail: "Approves any amount. Every execution is verified and logged." },
]

type Result = { ok: boolean; message: string }

type Store = {
  state: State
  today: string
  update: (mutate: (draft: State) => void) => void
  log: (event: Omit<AuditEvent, "id" | "at">) => void
  toast: (message: string) => void
  toastMessage: string
  clearToast: () => void
  reset: () => void
  can: ReturnType<typeof permissions>
  actor: string
  addTransaction: (t: Omit<Transaction, "id" | "status"> & { status?: Transaction["status"] }) => Transaction
  requestApproval: (a: Omit<Approval, "id" | "requestedAt" | "status" | "idempotencyKey" | "preparedBy"> & { preparedBy?: string }) => Result
  prepareReminder: (invoiceId: string, opts?: { tone?: ReminderTone; preparedBy?: string; draft?: string }) => Result
  requestPayPalSend: (invoiceId: string) => Result
  requestContractorPayment: (billId: string) => Result
  requestCancelSubscription: (recurringId: string) => Result
  approve: (approvalId: string) => Promise<Result>
  reject: (approvalId: string, reason: string) => Result
  confirmContractorPayment: (approvalId: string, reference: string) => Result
  checkPayPalStatus: (invoiceId: string) => Promise<Result>
  simulatePayerPayment: (invoiceId: string) => void
  recordManualPayment: (invoiceId: string, date: string, reference: string) => Result
  markSentManually: (invoiceId: string) => Result
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(load)
  const stateRef = useRef(state)
  stateRef.current = state
  const [toastMessage, setToastMessage] = useState("")
  const toastTimer = useRef<number | undefined>(undefined)
  const today = todayISO()

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* quota or privacy mode — state stays in memory */
    }
  }, [state])

  const update = useCallback((mutate: (draft: State) => void) => {
    setState((current) => {
      const draft = structuredClone(current)
      mutate(draft)
      return draft
    })
  }, [])

  const toast = useCallback((message: string) => {
    setToastMessage(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMessage(""), 4000)
  }, [])

  const log = useCallback(
    (event: Omit<AuditEvent, "id" | "at">) =>
      update((d) => {
        d.audit.unshift({ id: uid("AU"), at: new Date().toISOString(), ...event })
      }),
    [update],
  )

  const store = useMemo<Store>(() => {
    const s = state.settings
    const can = permissions(s)
    const actor = actorName(s)
    const fresh = () => stateRef.current

    const addTransaction: Store["addTransaction"] = (t) => {
      const dup = findDuplicate(fresh().transactions, t)
      const record: Transaction = {
        ...t,
        id: uid("TXN"),
        status: dup ? "Review" : t.status ?? "Recorded",
        reviewReason: dup ? `Possible duplicate of ${dup.id} (${dup.party}, same amount within 2 days)` : t.reviewReason,
      }
      update((d) => {
        d.transactions.unshift(record)
        d.transactions.sort((a, b) => b.date.localeCompare(a.date))
      })
      return record
    }

    const requestApproval: Store["requestApproval"] = (a) => {
      if (!can.prepare) return { ok: false, message: "Viewers can't prepare actions. Switch role in Settings → Team & Permissions." }
      const open = fresh().approvals.find(
        (x) => x.kind === a.kind && x.refId === a.refId && (x.status === "Pending" || x.status === "Submitted"),
      )
      if (open) return { ok: false, message: `${open.id} is already open for ${a.refId} — duplicate request blocked.` }
      const preparedBy = a.preparedBy ?? actor
      const attempt = fresh().approvals.filter((x) => x.kind === a.kind && x.refId === a.refId).length + 1
      const approval: Approval = {
        ...a,
        preparedBy,
        id: `AP-${3105 + fresh().approvals.length + approvalSeq++}`,
        requestedAt: new Date().toISOString(),
        status: "Pending",
        idempotencyKey: `${a.kind.split("_")[0]}-${a.refId}-${String(attempt).padStart(3, "0")}`,
      }
      update((d) => {
        d.approvals.unshift(approval)
      })
      log({ actor: preparedBy, action: "Approval requested", detail: `${approval.title} · ${money(approval.amount, approval.currency)}`, ref: approval.id, outcome: "info" })
      return { ok: true, message: `${approval.id} added to the approval queue` }
    }

    const prepareReminder: Store["prepareReminder"] = (invoiceId, opts = {}) => {
      const st = fresh()
      const inv = st.invoices.find((i) => i.id === invoiceId)
      if (!inv || inv.status !== "Sent") return { ok: false, message: "Only sent, unpaid invoices can be reminded." }
      const client = clientOf(st, inv.clientId)
      return requestApproval({
        kind: "send_reminder",
        title: `Send payment reminder · ${inv.id}`,
        recipient: client.name,
        amount: invoiceTotal(inv),
        currency: inv.currency,
        amountINR: invoiceINR(inv, st.settings),
        refId: inv.id,
        preparedBy: opts.preparedBy,
        draft: opts.draft ?? draftReminder(inv, client, st.settings, today, opts.tone),
        steps: inv.paypal
          ? [`Send a PayPal reminder for ${inv.paypal.invoiceId}`, "Log the reminder on the invoice timeline", "Forecast keeps the receipt uncertain until payment is verified"]
          : [`Copy the reminder for ${client.email}`, "Log the reminder on the invoice timeline", "Forecast keeps the receipt uncertain until payment is recorded"],
      })
    }

    const requestPayPalSend: Store["requestPayPalSend"] = (invoiceId) => {
      const st = fresh()
      const inv = st.invoices.find((i) => i.id === invoiceId)
      if (!inv) return { ok: false, message: "Invoice not found" }
      const client = clientOf(st, inv.clientId)
      const eligible = paypalEligibility(inv, client)
      if (!eligible.ok) return { ok: false, message: eligible.reason }
      return requestApproval({
        kind: "paypal_send_invoice",
        title: `Send PayPal invoice · ${inv.id}`,
        recipient: client.name,
        amount: invoiceTotal(inv),
        currency: inv.currency,
        amountINR: invoiceINR(inv, st.settings),
        refId: inv.id,
        steps: ["Create the invoice in PayPal Sandbox", `Send it to ${client.email}`, "Verify PayPal reports status SENT before marking it sent"],
      })
    }

    const requestContractorPayment: Store["requestContractorPayment"] = (billId) => {
      const bill = fresh().contractorBills.find((b) => b.id === billId)
      if (!bill || bill.status === "Paid") return { ok: false, message: "This bill is already paid." }
      return requestApproval({
        kind: "record_contractor_payment",
        title: `Pay contractor invoice · ${bill.reference}`,
        recipient: bill.vendor,
        amount: bill.amount,
        currency: "INR",
        amountINR: bill.amount,
        refId: bill.id,
        steps: [`Owner transfers ${money(bill.amount)} from the agency bank account`, "Confirm the transfer reference in CentsAI", "Ledger records the expense only after confirmation"],
      })
    }

    const requestCancelSubscription: Store["requestCancelSubscription"] = (recurringId) => {
      const r = fresh().recurring.find((x) => x.id === recurringId)
      if (!r) return { ok: false, message: "Subscription not found" }
      return requestApproval({
        kind: "cancel_subscription",
        title: `Cancel subscription · ${r.vendor}`,
        recipient: r.vendor,
        amount: r.amount,
        currency: "INR",
        amountINR: r.amount,
        refId: r.id,
        steps: ["Stop the recurring cost from the next renewal in the forecast", "Owner cancels with the vendor (no vendor integration)", "Log the decision"],
      })
    }

    const setApproval = (id: string, patch: Partial<Approval>) =>
      update((d) => {
        const a = d.approvals.find((x) => x.id === id)
        if (a) Object.assign(a, patch)
      })

    const approve: Store["approve"] = async (id) => {
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Pending") return { ok: false, message: "This request is no longer pending." }
      if (!can.approve(a.amountINR)) {
        const message =
          s.role === "Viewer"
            ? "Viewers cannot approve actions."
            : `${money(a.amountINR)} exceeds the ${money(s.managerApprovalLimit)} Finance Manager limit — Owner approval required.`
        log({ actor, action: "Approval blocked", detail: `${a.title}: ${message}`, ref: a.id, outcome: "warning" })
        return { ok: false, message }
      }
      const decidedAt = new Date().toISOString()
      setApproval(id, { status: "Submitted", decidedBy: actor, decidedAt })
      log({ actor, action: "Approved & submitted", detail: `${a.title} · ${money(a.amount, a.currency)} · key ${a.idempotencyKey}`, ref: a.id, outcome: "success" })

      try {
        if (a.kind === "paypal_send_invoice") {
          const inv = fresh().invoices.find((i) => i.id === a.refId)!
          const link = await paypalSandbox.createAndSend(inv)
          update((d) => {
            const target = d.invoices.find((i) => i.id === a.refId)!
            target.paypal = link
            target.status = "Sent"
            target.channel = "PayPal"
          })
          log({ actor: "PayPal Sandbox", action: "Invoice created & sent", detail: `${a.refId} → ${link.invoiceId}`, ref: a.refId, outcome: "info" })
          const status = await paypalSandbox.getStatus(link)
          const verified = status === "SENT"
          setApproval(id, { status: verified ? "Verified" : "Failed", result: `PayPal status ${status} · ${link.invoiceId}` })
          log({ actor: "PayPal Sandbox", action: verified ? "Status verified" : "Verification failed", detail: `${a.refId} reported ${status}`, ref: a.refId, outcome: verified ? "success" : "error" })
          return { ok: verified, message: verified ? `${a.refId} sent via PayPal Sandbox and verified` : `PayPal reported ${status}` }
        }
        if (a.kind === "send_reminder") {
          const inv = fresh().invoices.find((i) => i.id === a.refId)!
          let channel = "Email draft (copied)"
          if (inv.paypal) {
            const res = await paypalSandbox.remind(inv.paypal)
            if (!res.ok) throw new Error("PayPal rejected the reminder")
            channel = "PayPal reminder"
          } else {
            try {
              await navigator.clipboard.writeText(a.draft ?? "")
            } catch {
              /* clipboard may be blocked; the draft stays visible in the audit view */
            }
          }
          update((d) => {
            d.invoices.find((i) => i.id === a.refId)?.reminders.push({ date: today, channel, note: `Approved by ${actor}` })
          })
          const result = inv.paypal ? "PayPal accepted the reminder" : "Draft copied — email delivery isn't connected, send it from your mail client"
          setApproval(id, { status: "Verified", result })
          log({ actor: inv.paypal ? "PayPal Sandbox" : actor, action: "Reminder sent", detail: `${a.refId} · ${channel}`, ref: a.refId, outcome: "success" })
          return { ok: true, message: result }
        }
        if (a.kind === "record_contractor_payment") {
          setApproval(id, { result: "Approved — transfer the money from your bank, then confirm the reference here." })
          return { ok: true, message: "Approved. Confirm the bank transfer reference to record the payment." }
        }
        if (a.kind === "cancel_subscription") {
          update((d) => {
            const r = d.recurring.find((x) => x.id === a.refId)
            if (r) r.status = "Cancelled"
          })
          setApproval(id, { status: "Verified", result: "Removed from future obligations. Cancel with the vendor as well." })
          log({ actor, action: "Subscription cancelled", detail: `${a.recipient} removed from the forecast`, ref: a.refId, outcome: "success" })
          return { ok: true, message: `${a.recipient} removed from future obligations` }
        }
      } catch (error) {
        setApproval(id, { status: "Failed", result: String(error) })
        log({ actor: "System", action: "Execution failed", detail: `${a.title}: ${String(error)}`, ref: a.id, outcome: "error" })
        return { ok: false, message: "Execution failed — nothing was recorded." }
      }
      return { ok: false, message: "Unknown action" }
    }

    const reject: Store["reject"] = (id, reason) => {
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Pending") return { ok: false, message: "Not pending" }
      if (!can.prepare) return { ok: false, message: "Viewers cannot reject actions." }
      setApproval(id, { status: "Rejected", decidedBy: actor, decidedAt: new Date().toISOString(), note: reason || "No reason given" })
      log({ actor, action: "Rejected", detail: `${a.title}${reason ? ` — ${reason}` : ""}`, ref: a.id, outcome: "warning" })
      return { ok: true, message: `${a.id} rejected` }
    }

    const confirmContractorPayment: Store["confirmContractorPayment"] = (id, reference) => {
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Submitted" || !reference.trim()) return { ok: false, message: "Enter the bank transfer reference." }
      const bill = fresh().contractorBills.find((b) => b.id === a.refId)!
      update((d) => {
        const b = d.contractorBills.find((x) => x.id === a.refId)!
        b.status = "Paid"
        b.paidDate = today
      })
      addTransaction({ date: today, description: `Contractor invoice ${bill.reference}`, party: bill.vendor, category: "Contractors", projectId: bill.projectId, type: "Expense", amount: bill.amount, source: "Manual", reference, status: "Verified" })
      setApproval(id, { status: "Verified", result: `Transfer confirmed · ref ${reference}` })
      log({ actor, action: "Payment confirmed", detail: `${bill.vendor} ${money(bill.amount)} · ref ${reference}`, ref: bill.id, outcome: "success" })
      return { ok: true, message: "Payment recorded in the ledger" }
    }

    // A paid invoice no longer needs reminders: withdraw any that are still waiting for approval.
    const withdrawReminders = (invoiceId: string) =>
      update((d) => {
        for (const a of d.approvals)
          if (a.refId === invoiceId && a.kind === "send_reminder" && a.status === "Pending")
            Object.assign(a, { status: "Rejected", decidedBy: "System", decidedAt: new Date().toISOString(), note: "Withdrawn automatically — invoice was paid" })
      })

    const checkPayPalStatus: Store["checkPayPalStatus"] = async (invoiceId) => {
      const inv = fresh().invoices.find((i) => i.id === invoiceId)
      if (!inv?.paypal) return { ok: false, message: "This invoice was not sent through PayPal." }
      const status = await paypalSandbox.getStatus(inv.paypal)
      const now = new Date().toISOString()
      update((d) => {
        const target = d.invoices.find((i) => i.id === invoiceId)!
        target.paypal = { ...target.paypal!, status, lastCheckedAt: now }
      })
      if (status === "PAID" && inv.status !== "Paid") {
        update((d) => {
          const target = d.invoices.find((i) => i.id === invoiceId)!
          target.status = "Paid"
          target.paidDate = today
        })
        const st = fresh()
        addTransaction({ date: today, description: `Payment · ${inv.id}`, party: clientOf(st, inv.clientId).name, category: inv.kind === "Retainer" ? "Retainer income" : "Project revenue", projectId: inv.projectId, type: "Income", amount: invoiceINR(inv, st.settings), source: "PayPal", invoiceId: inv.id, reference: inv.paypal.invoiceId, status: "Verified" })
        withdrawReminders(inv.id)
        log({ actor: "PayPal Sandbox", action: "Payment verified", detail: `${inv.id} reported PAID; ledger and forecast updated.`, ref: inv.id, outcome: "success" })
        return { ok: true, message: `${inv.id} verified as PAID — ledger updated` }
      }
      log({ actor: "PayPal Sandbox", action: "Status checked", detail: `${inv.id} is ${status}; receipt stays uncertain in the forecast.`, ref: inv.id, outcome: "info" })
      return { ok: true, message: `PayPal status: ${status}. Not recorded as paid.` }
    }

    const simulatePayerPayment: Store["simulatePayerPayment"] = (invoiceId) => {
      update((d) => {
        const inv = d.invoices.find((i) => i.id === invoiceId)
        if (inv?.paypal) inv.paypal.payerPaid = true
      })
      log({ actor: "Sandbox payer", action: "Payer paid (simulation)", detail: `Test buyer completed payment for ${invoiceId}. Not yet verified.`, ref: invoiceId, outcome: "info" })
    }

    const recordManualPayment: Store["recordManualPayment"] = (invoiceId, date, reference) => {
      const st = fresh()
      const inv = st.invoices.find((i) => i.id === invoiceId)
      if (!inv || inv.status !== "Sent") return { ok: false, message: "Only sent, unpaid invoices can be recorded as paid." }
      if (!reference.trim()) return { ok: false, message: "Enter the bank reference (UTR) so the payment is traceable." }
      update((d) => {
        const target = d.invoices.find((i) => i.id === invoiceId)!
        target.status = "Paid"
        target.paidDate = date
      })
      addTransaction({ date, description: `Payment · ${inv.id}`, party: clientOf(st, inv.clientId).name, category: inv.kind === "Retainer" ? "Retainer income" : "Project revenue", projectId: inv.projectId, type: "Income", amount: invoiceINR(inv, st.settings), source: "Invoice payment", invoiceId: inv.id, reference, status: "Recorded" })
      withdrawReminders(inv.id)
      log({ actor, action: "Payment recorded", detail: `${inv.id} · ${money(invoiceTotal(inv), inv.currency)} · ref ${reference}`, ref: inv.id, outcome: "success" })
      return { ok: true, message: `${inv.id} marked paid and added to the ledger` }
    }

    const markSentManually: Store["markSentManually"] = (invoiceId) => {
      if (!can.prepare) return { ok: false, message: "Viewers can't change invoices." }
      update((d) => {
        const inv = d.invoices.find((i) => i.id === invoiceId)
        if (inv) {
          inv.status = "Sent"
          inv.channel = "Bank transfer"
        }
      })
      log({ actor, action: "Invoice issued", detail: `${invoiceId} marked as sent (bank transfer)`, ref: invoiceId, outcome: "info" })
      return { ok: true, message: `${invoiceId} is now open and included in the forecast` }
    }

    return {
      state, today, update, log, toast, toastMessage,
      clearToast: () => setToastMessage(""),
      reset: () => {
        const seed = createSeed()
        setState(seed)
      },
      can, actor, addTransaction, requestApproval, prepareReminder, requestPayPalSend,
      requestContractorPayment, requestCancelSubscription, approve, reject, confirmContractorPayment,
      checkPayPalStatus, simulatePayerPayment, recordManualPayment, markSentManually,
    }
  }, [state, today, update, log, toast, toastMessage])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export const useStore = () => {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside StoreProvider")
  return store
}
