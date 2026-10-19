import { useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, Clock3, Copy, ExternalLink, Mail, Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react"
import { ApprovalDraft, ApprovalSteps, approvalPermission } from "../components/approval-card"
import { InvoiceRows } from "../components/finance-ui"
import { Badge, Button, Card, Drawer, Field, FormModal, Input, MetricCard, Modal, Note, Select, Tabs, Textarea, Title, useAction } from "../components/ui"
import { addDays, fmtDate, fmtDay, fmtStamp, relativeDue } from "../lib/dates"
import { draftReminder, type ReminderTone } from "../lib/drafts"
import { buildEvents, clientOf, invoiceState, invoiceTotal, projectOf, receivables, stateTone } from "../lib/finance"
import { money } from "../lib/format"
import { PAYPAL_MODE, paypalEligibility } from "../lib/paypal"
import { routeParams } from "../lib/router"
import { useStore } from "../lib/store"
import type { Invoice, LineItem } from "../lib/types"

const TABS = ["All", "Overdue", "Due soon", "Open", "Paid", "Draft"] as const
type Tab = (typeof TABS)[number]

export default function InvoicesPage() {
  const { state, today, mode, paypalMode, paypalEnvironment, can } = useStore()
  const params = routeParams()
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "All")
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState("priority")
  const [selectedId, setSelectedId] = useState<string | null>(params.get("id"))
  const [creating, setCreating] = useState(false)
  const rec = useMemo(() => receivables(state, today), [state, today])

  const priority = new Map(rec.open.map((r) => [r.inv.id, r]))
  const rows = state.invoices
    .filter((inv) => {
      const st = invoiceState(inv, today)
      const client = clientOf(state, inv.clientId)
      return (tab === "All" || st === tab) && `${client.name} ${inv.id} ${inv.lineItems[0]?.description}`.toLowerCase().includes(query.toLowerCase())
    })
    .sort((a, b) => {
      if (sort === "amount") return invoiceTotal(b) - invoiceTotal(a)
      if (sort === "due") return a.dueDate.localeCompare(b.dueDate)
      return (priority.get(b.id)?.priority ?? -1) - (priority.get(a.id)?.priority ?? -1) || b.issueDate.localeCompare(a.issueDate)
    })
    .map((inv) => priority.get(inv.id) ?? inv)

  const counts = Object.fromEntries(TABS.map((t) => [t, t === "All" ? 0 : state.invoices.filter((i) => invoiceState(i, today) === t).length])) as Record<Tab, number>
  const selected = state.invoices.find((i) => i.id === selectedId)

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Invoices & Collections</Title>
          <p>Bill clients, prioritise collections, and verify payments before they reach your ledger.</p>
        </div>
        <div className="intro-actions">
          <Button variant="primary" icon={Plus} disabled={!can.prepare} onClick={() => setCreating(true)}>
            Create invoice
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> PayPal {mode === "hosted" ? `${paypalEnvironment} (${paypalMode})` : PAYPAL_MODE} or bank transfer · Ledger updates only after verification or a recorded bank reference.
      </div>
      <div className="metric-grid">
        <MetricCard label="Total Outstanding" value={money(rec.outstanding)} detail={`Across ${rec.open.length} open invoices`} />
        <MetricCard label="Overdue" value={money(rec.overdueTotal)} detail={`${rec.overdue.length} invoice${rec.overdue.length === 1 ? "" : "s"} need follow-up`} tone={rec.overdue.length ? "red" : undefined} onClick={() => setTab("Overdue")} />
        <MetricCard label="Collected This Month" value={money(rec.paidThisMonth)} detail="Verified or recorded payments" positive={rec.paidThisMonth > 0} />
        <MetricCard label="Due Within 7 Days" value={money(rec.dueSoonTotal)} detail={`${rec.dueSoon.length} invoice${rec.dueSoon.length === 1 ? "" : "s"}`} onClick={() => setTab("Due soon")} />
      </div>
      <Card>
        <div className="invoice-toolbar">
          <Tabs options={[...TABS]} value={tab} onChange={setTab} counts={counts} />
          <div className="toolbar-actions">
            <div className="search-input">
              <Search size={15} />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search client, invoice, item" aria-label="Search invoices" />
            </div>
            <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort invoices">
              <option value="priority">Collection priority</option>
              <option value="due">Due date</option>
              <option value="amount">Amount</option>
            </Select>
          </div>
        </div>
        <InvoiceRows rows={rows} state={state} today={today} onSelect={(inv) => setSelectedId(inv.id)} showPriority={sort === "priority"} />
      </Card>
      {selected && <InvoiceDrawer inv={selected} close={() => setSelectedId(null)} />}
      {creating && <CreateInvoice close={() => setCreating(false)} onCreated={(id) => setSelectedId(id)} />}
    </div>
  )
}

function InvoiceDrawer({ inv, close }: { inv: Invoice; close: () => void }) {
  const store = useStore()
  const { state, today, toast, can, mode, paypalEnvironment } = store
  const client = clientOf(state, inv.clientId)
  const project = projectOf(state, inv.projectId)
  const st = invoiceState(inv, today)
  const total = invoiceTotal(inv)
  const [modal, setModal] = useState<"remind" | "record" | null>(null)
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirm24hReminder, setConfirm24hReminder] = useState(false)
  const eligibility = paypalEligibility(inv, client)
  const pending = state.approvals.find((a) => a.refId === inv.id && (a.status === "Pending" || a.status === "Submitted"))
  const expected = buildEvents(state, today, 120, "expected").find((e) => e.ref === inv.id)
  const conservative = buildEvents(state, today, 120, "conservative").find((e) => e.ref === inv.id)
  const events = state.audit.filter((a) => a.ref === inv.id).reverse()

  const role = state.settings.role
  const isOwner = role === "Owner"
  const isFinanceManager = role === "Finance Manager"
  const isViewer = role === "Viewer"

  const canApprovePending = Boolean(
    pending &&
      approvalPermission(pending, {
        settings: state.settings,
        mode,
        actor: store.actor,
        signedInName: store.signedInName,
      }).allowed,
  )

  const lastReminder = inv.reminders.length > 0 ? inv.reminders[inv.reminders.length - 1] : null
  const isWithin24h = Boolean(lastReminder && lastReminder.date >= today)

  const deleteDraftAction = useAction(async () => {
    const res = await store.deleteInvoice(inv.id)
    if (!res.ok) {
      toast(res.message)
      throw new Error(res.message)
    }
    store.log({ actor: store.actor, action: "Draft deleted", detail: inv.id, ref: inv.id, outcome: "info" })
    close()
    toast(`${inv.id} draft deleted`)
  })

  const markSentAction = useAction(async () => {
    const res = await store.markSentManually(inv.id)
    toast(res.message)
    if (!res.ok) throw new Error(res.message)
  })

  const verifyPayPalAction = useAction(async () => {
    const res = await store.checkPayPalStatus(inv.id)
    toast(res.message)
    if (!res.ok) throw new Error(res.message)
  })

  const requestApprovalAction = useAction(async () => {
    const res = await store.requestPayPalSend(inv.id, false)
    if (!res.ok) {
      if (/already\s+(open|in approval|in progress)/i.test(res.message)) {
        toast("A send is already in progress for this invoice")
      } else {
        toast(res.message)
      }
      throw new Error(res.message)
    }
    toast(res.message)
  })

  const ownerSendAction = useAction(async () => {
    const res = await store.requestPayPalSend(inv.id, true)
    if (!res.ok) {
      if (/already\s+(open|in approval|in progress)/i.test(res.message)) {
        toast("A send is already in progress for this invoice")
      } else {
        toast(res.message)
      }
      setConfirmSend(false)
      throw new Error(res.message)
    }
    toast(`${inv.id} sent via PayPal Sandbox`)
    setConfirmSend(false)
  })

  const approvePendingAction = useAction(async () => {
    if (!pending) return
    const res = await store.approve(pending.id)
    toast(res.message)
  })

  const handleReminderClick = () => {
    if (isWithin24h) {
      if (!isOwner) {
        toast("A reminder was already recorded today. Second reminders within 24 hours require Owner confirmation.")
        return
      }
      setConfirm24hReminder(true)
      return
    }
    setModal("remind")
  }

  const reminderButtonText = pending?.kind === "send_reminder"
    ? "Reminder awaiting approval"
    : inv.paypal
    ? "Remind via PayPal"
    : "Prepare reminder"

  const timeline = [
    { label: "Invoice created", date: fmtDate(inv.issueDate), done: true },
    ...(inv.status !== "Draft" ? [{ label: inv.paypal ? `Sent via PayPal · ${inv.paypal.invoiceId}` : "Issued (bank transfer)", date: inv.paypal?.sentAt ? fmtStamp(inv.paypal.sentAt) : fmtDate(inv.issueDate), done: true }] : []),
    ...inv.reminders.map((r) => ({ label: `${r.channel}`, date: `${fmtDate(r.date)} · ${r.note}`, done: true })),
    ...events.filter((e) => /verified|checked|recorded|paid/i.test(e.action)).map((e) => ({ label: e.action, date: `${fmtStamp(e.at)} · ${e.actor}`, done: e.outcome === "success" })),
    ...(inv.status === "Paid" ? [] : [{ label: "Payment verified", date: "Waiting", done: false }]),
  ]

  const approvedReminder = state.approvals.find((a) => a.refId === inv.id && a.kind === "send_reminder" && (a.status === "Verified" || a.status === "Submitted"))
  const savedReminderDraft = approvedReminder?.draft ?? (lastReminder?.channel?.includes("Email draft") ? lastReminder.note : null)

  return (
    <Drawer
      eyebrow="INVOICE DETAIL"
      title={inv.id}
      onClose={close}
      footer={
        <>
          {pending?.status === "Pending" && (
            <div className="w-full mb-3 text-left space-y-2 border-b border-[var(--border)] pb-3">
              <ApprovalSteps steps={pending.steps} />
              {pending.draft && <ApprovalDraft draft={pending.draft} rows={4} />}
            </div>
          )}
          {inv.status === "Draft" && (
            <>
              <Button
                variant="ghost"
                icon={Trash2}
                disabled={!can.edit || deleteDraftAction.busy}
                loading={deleteDraftAction.busy}
                onClick={() => deleteDraftAction.run()}
              >
                Delete draft
              </Button>
              {eligibility.ok ? (
                pending?.status === "Submitted" ? (
                  <Button variant="primary" loading disabled>
                    Sending to PayPal…
                  </Button>
                ) : pending?.status === "Pending" ? (
                  canApprovePending ? (
                    <Button
                      variant="primary"
                      disabled={approvePendingAction.busy}
                      loading={approvePendingAction.busy}
                      onClick={() => approvePendingAction.run()}
                    >
                      Approve & send
                    </Button>
                  ) : (
                    <a href="#app/approvals" className="button button-secondary">
                      Awaiting approval
                    </a>
                  )
                ) : isOwner ? (
                  <Button
                    variant="primary"
                    icon={Send}
                    disabled={ownerSendAction.busy}
                    loading={ownerSendAction.busy}
                    onClick={() => setConfirmSend(true)}
                  >
                    Send via PayPal
                  </Button>
                ) : isFinanceManager ? (
                  <Button
                    variant="primary"
                    icon={Send}
                    disabled={requestApprovalAction.busy}
                    loading={requestApprovalAction.busy}
                    onClick={() => requestApprovalAction.run()}
                  >
                    Request approval from Owner
                  </Button>
                ) : (
                  <Button variant="primary" icon={Send} disabled={true}>
                    Send via PayPal
                  </Button>
                )
              ) : (
                <Button
                  variant="primary"
                  disabled={!can.edit || markSentAction.busy}
                  loading={markSentAction.busy}
                  onClick={() => markSentAction.run()}
                >
                  Mark as sent
                </Button>
              )}
            </>
          )}
          {inv.status === "Sent" && (
            <>
              {pending?.kind === "send_reminder" && pending.status === "Pending" && canApprovePending ? (
                <Button
                  variant="primary"
                  icon={Mail}
                  disabled={approvePendingAction.busy}
                  loading={approvePendingAction.busy}
                  onClick={() => approvePendingAction.run()}
                >
                  Approve reminder
                </Button>
              ) : (
                <Button
                  icon={Mail}
                  title={inv.paypal ? "PayPal emails the client directly" : "Prepare reminder draft"}
                  disabled={isViewer || !!pending}
                  onClick={handleReminderClick}
                >
                  {reminderButtonText}
                </Button>
              )}
              {inv.paypal ? (
                <Button
                  variant="primary"
                  icon={RefreshCw}
                  disabled={verifyPayPalAction.busy}
                  loading={verifyPayPalAction.busy}
                  onClick={() => verifyPayPalAction.run()}
                >
                  Verify payment status
                </Button>
              ) : (
                <Button variant="primary" icon={Check} disabled={!can.edit} onClick={() => setModal("record")}>
                  Record bank transfer received
                </Button>
              )}
              <div className="drawer-footer-hint">
                {inv.paypal
                  ? "PayPal emails the client directly."
                  : "Prepare a reminder draft to copy or send via email."}
              </div>
            </>
          )}
        </>
      }
    >
      <div className="drawer-status">
        <Badge tone={stateTone(st)}>{st}</Badge>
        <div className="drawer-amount">
          <strong>{money(total, inv.currency)}</strong>
        </div>
      </div>
      <div className="detail-section">
        <span>CLIENT</span>
        <strong>{client.name}</strong>
        <small>
          {client.email} · {client.country} · usually pays {client.avgDelayDays === 0 ? "on time" : `${client.avgDelayDays} days late`}
        </small>
      </div>

      <div className="help-box">
        You are billing {client.name}. They pay you. Status becomes Paid only after PayPal confirms or you record the bank reference.
      </div>

      <div className="detail-grid">
        <div>
          <span>Issued</span>
          <strong>{fmtDate(inv.issueDate)}</strong>
        </div>
        <div>
          <span>Due</span>
          <strong>
            {fmtDate(inv.dueDate)} {inv.status === "Sent" && <small className="muted">({relativeDue(inv.dueDate, today)})</small>}
          </strong>
        </div>
        <div>
          <span>Project</span>
          <strong>{project?.name ?? "—"}</strong>
        </div>
        <div>
          <span>Collection channel</span>
          <strong>{inv.currency} · {inv.channel === "PayPal" ? "PayPal" : "Bank transfer"}</strong>
        </div>
      </div>

      {lastReminder && (
        <div className="detail-section">
          <span className="eyebrow">LAST REMINDER</span>
          <strong>{fmtDate(lastReminder.date)} ({lastReminder.channel})</strong>
          <small>{lastReminder.note}</small>
        </div>
      )}

      {!inv.paypal && savedReminderDraft && (
        <div className="detail-section">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span className="eyebrow">SAVED REMINDER DRAFT</span>
            <small className="muted">Email draft (not sent)</small>
          </div>
          <p className="section-note" style={{ margin: "4px 0" }}>
            CentsAI doesn't send email in this prototype.
          </p>
          <div className="help-box" style={{ whiteSpace: "pre-wrap", maxHeight: "140px", overflowY: "auto", fontSize: "11px" }}>
            {savedReminderDraft}
          </div>
          <div style={{ display: "flex", gap: "8px", paddingTop: "4px" }}>
            <Button
              variant="secondary"
              icon={Copy}
              onClick={() => {
                navigator.clipboard.writeText(savedReminderDraft)
                toast("Reminder text copied to clipboard")
              }}
            >
              Copy text
            </Button>
            <a
              href={`mailto:${client.email}?subject=${encodeURIComponent(`Payment reminder: Invoice ${inv.id}`)}&body=${encodeURIComponent(savedReminderDraft)}`}
              className="button button-secondary"
            >
              Open in email app
              <ExternalLink size={12} />
            </a>
          </div>
        </div>
      )}

      <div className="line-items">
        {inv.lineItems.map((item, i) => (
          <div className="line-item" key={i}>
            <div>
              <strong>{item.description}</strong>
              <small>
                {item.quantity} × {money(item.unitPrice, inv.currency)}
              </small>
            </div>
            <strong>{money(item.quantity * item.unitPrice, inv.currency)}</strong>
          </div>
        ))}
      </div>

      {inv.paypal && (
        <div className="paypal-panel">
          <div className="paypal-row paypal-row-title">
            <div className="paypal-brand">
              <span className="paypal-mark">P</span>
              <strong>PayPal {mode === "hosted" ? paypalEnvironment : "Sandbox"}</strong>
            </div>
            <Badge tone={inv.paypal.status === "PAID" ? "green" : "blue"}>{inv.paypal.status}</Badge>
          </div>

          <div className="paypal-row">
            <span className="paypal-label">PayPal Invoice ID</span>
            <span className="paypal-value font-mono">{inv.paypal.invoiceId}</span>
          </div>

          <div className="paypal-row">
            <span className="paypal-label">Last verified</span>
            <span className="paypal-value">{inv.paypal.lastCheckedAt ? fmtStamp(inv.paypal.lastCheckedAt) : "never"}</span>
          </div>

          <div className="paypal-row">
            <span className="paypal-label">Payment link</span>
            <a href={inv.paypal.payerUrl} target="_blank" rel="noreferrer" className="paypal-payer-link">
              Payer link <ExternalLink size={11} />
            </a>
          </div>

          {inv.status === "Sent" && mode === "hosted" && (
            <p className="paypal-hint">
              Pay it in the PayPal sandbox with your sandbox personal account, then click Verify payment status.
            </p>
          )}

          {inv.status === "Sent" && mode === "demo" && (
            <div className="sandbox-tools">
              <span>
                <Clock3 size={12} /> Sandbox test tool
              </span>
              <Button
                variant="ghost"
                disabled={inv.paypal.payerPaid}
                onClick={() => {
                  store.simulatePayerPayment(inv.id)
                  toast("Test buyer paid in Sandbox — now verify the status to update the ledger")
                }}
              >
                {inv.paypal.payerPaid ? "Test payment made — verify it" : "Simulate client payment"}
              </Button>
            </div>
          )}
        </div>
      )}

      {inv.status === "Draft" && !eligibility.ok && (
        <Note icon={AlertTriangle} tone="amber">
          {eligibility.reason}
        </Note>
      )}

      {inv.status === "Sent" && (
        <div className="collection-insight">
          <div className="ai-label">
            <Sparkles size={13} /> Collection outlook
          </div>
          <div className="detail-grid">
            <div>
              <span>Expected receipt</span>
              <strong>{expected ? fmtDay(expected.date) : "Beyond 120 days"}</strong>
            </div>
            <div>
              <span>Conservative receipt</span>
              <strong>{conservative ? fmtDay(conservative.date) : "Beyond 120 days"}</strong>
            </div>
          </div>
          <small>Treated as {st === "Overdue" ? "uncertain" : "expected"} cash until payment is verified.</small>
        </div>
      )}

      {pending && (
        <Note icon={ShieldCheck}>
          {pending.title} is {pending.status === "Pending" ? "waiting for approval" : "submitted"}.
        </Note>
      )}

      <div className="timeline">
        <Title level={3}>Collection timeline</Title>
        {timeline.map((row, i) => (
          <div className="timeline-row" key={row.label + i}>
            <span className={row.done ? "done" : ""} />
            <div>
              <strong>{row.label}</strong>
              <small>{row.date}</small>
            </div>
          </div>
        ))}
      </div>

      {confirmSend && (
        <Modal onClose={() => !ownerSendAction.busy && setConfirmSend(false)}>
          <div className="p-4 space-y-3">
            <Title level={2}>Send via PayPal Sandbox</Title>
            <div className="space-y-1 text-sm my-3">
              <div><span className="text-muted">Recipient:</span> <strong>{client.name}</strong></div>
              <div><span className="text-muted">Amount:</span> <strong>{money(total, inv.currency)} {inv.currency}</strong></div>
              <p className="text-xs text-muted-foreground mt-2">
                This sends a real PayPal Sandbox invoice to <strong>{client.email}</strong>.
              </p>
            </div>
            <div className="modal-actions">
              <Button disabled={ownerSendAction.busy} onClick={() => setConfirmSend(false)}>
                Cancel
              </Button>
              <Button variant="primary" icon={Send} loading={ownerSendAction.busy} disabled={ownerSendAction.busy} onClick={() => ownerSendAction.run()}>
                Send via PayPal
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirm24hReminder && (
        <Modal onClose={() => setConfirm24hReminder(false)}>
          <div className="p-4 space-y-3">
            <Title level={2}>Send second reminder within 24 hours?</Title>
            <p className="text-sm my-3">
              A reminder was already recorded on <strong>{lastReminder ? fmtDate(lastReminder.date) : "today"}</strong> ({lastReminder?.channel}).
              As workspace Owner, confirm you want to proceed with another reminder within 24 hours.
            </p>
            <div className="modal-actions">
              <Button onClick={() => setConfirm24hReminder(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => { setConfirm24hReminder(false); setModal("remind") }}>
                Confirm & proceed
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {modal === "remind" && <ReminderModal inv={inv} close={() => setModal(null)} />}
      {modal === "record" && <RecordPaymentModal inv={inv} close={() => setModal(null)} />}
    </Drawer>
  )
}

function ReminderModal({ inv, close }: { inv: Invoice; close: () => void }) {
  const { state, today, prepareReminder, toast, mode } = useStore()
  const client = clientOf(state, inv.clientId)
  const isOwner = state.settings.role === "Owner"
  const [tone, setTone] = useState<ReminderTone>(inv.reminders.length ? "Firm" : "Friendly")
  const [text, setText] = useState(() => draftReminder(inv, client, state.settings, today, tone))

  const submitLabel = isOwner
    ? (inv.paypal ? "Send reminder via PayPal" : "Save reminder draft")
    : "Request approval from Owner"

  return (
    <FormModal
      eyebrow="AI-DRAFTED REMINDER"
      title={`Reminder for ${inv.id}`}
      submitLabel={submitLabel}
      onClose={close}
      onSubmit={async () => {
        const res = await prepareReminder(inv.id, { draft: text, tone, approveNow: isOwner })
        toast(res.message)
        if (res.ok) close()
        else throw new Error(res.message)
      }}
    >
      <div className="form-grid">
        <Field label="Tone">
          <Select
            value={tone}
            onChange={(e) => {
              const next = e.target.value as ReminderTone
              setTone(next)
              setText(draftReminder(inv, client, state.settings, today, next))
            }}
          >
            <option>Friendly</option>
            <option>Firm</option>
            <option>Final notice</option>
          </Select>
        </Field>
        <Field label="Delivery">
          <Input readOnly value={inv.paypal ? `PayPal reminder (${mode === "hosted" ? "PayPal Sandbox" : "Sandbox"})` : `Email draft (CentsAI doesn't send email in this prototype)`} />
        </Field>
        <Field label="Message" full>
          <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <p className="section-note form-note">
        {inv.paypal
          ? "PayPal will email the client directly."
          : "CentsAI doesn't send email in this prototype. Saving this draft lets you copy the text and send it from your email client."}
      </p>
    </FormModal>
  )
}

function RecordPaymentModal({ inv, close }: { inv: Invoice; close: () => void }) {
  const { today, recordManualPayment, toast } = useStore()
  const [date, setDate] = useState(today)
  const [reference, setReference] = useState("")
  return (
    <FormModal
      eyebrow="BANK TRANSFER RECEIVED"
      title={`Record bank transfer received · ${inv.id}`}
      submitLabel="Record bank transfer"
      onClose={close}
      onSubmit={async () => {
        const res = await recordManualPayment(inv.id, date, reference)
        toast(res.message)
        if (res.ok) close()
        else throw new Error(res.message)
      }}
    >
      <div className="form-grid">
        <Field label="Amount received">
          <Input readOnly value={money(invoiceTotal(inv), inv.currency)} />
        </Field>
        <Field label="Date received">
          <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Bank transfer reference" full hint="Required — the reference links this ledger entry to your bank statement.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ACH-20261017-12345" required />
        </Field>
      </div>
    </FormModal>
  )
}

function CreateInvoice({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const { state, today, update, log, actor, toast, can, mode, paypalEnvironment, createInvoice, requestPayPalSend } = useStore()
  const [clientId, setClientId] = useState(state.clients[0].id)
  const client = clientOf(state, clientId)
  const projects = state.projects.filter((p) => p.clientId === clientId)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [kind, setKind] = useState<Invoice["kind"]>("Milestone")
  const [channel, setChannel] = useState<Invoice["channel"]>("PayPal")
  const [issueDate, setIssueDate] = useState(today)
  const [terms, setTerms] = useState(15)
  const [items, setItems] = useState<LineItem[]>([{ description: "", quantity: 1, unitPrice: 0 }])
  const [sendNow, setSendNow] = useState(true)
  const submitKeyRef = useRef<string | null>(null)
  if (!submitKeyRef.current) {
    submitKeyRef.current = Math.random().toString(36).slice(2) + Date.now().toString(36)
  }
  const createdInvoiceIdRef = useRef<string | null>(null)

  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const nextId = `INV-${Math.max(...state.invoices.map((i) => Number(i.id.replace(/\D/g, "")) || 0)) + 1}`
  const setItem = (index: number, patch: Partial<LineItem>) => setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))

  const isOwner = state.settings.role === "Owner"
  const submitLabel = channel === "PayPal" && sendNow
    ? (isOwner ? "Create & send via PayPal" : "Create & request approval")
    : "Save draft"

  return (
    <FormModal
      eyebrow="NEW CLIENT INVOICE"
      title={`Create ${nextId}`}
      submitLabel={submitLabel}
      wide
      onClose={close}
      onSubmit={async (setStep) => {
        if (!can.edit) {
          toast("Viewers can't create invoices.")
          throw new Error("Viewers can't create invoices.")
        }
        const clean = items.filter((i) => i.description.trim() && i.quantity > 0 && i.unitPrice > 0)
        if (!clean.length) {
          const msg = "Add at least one line item with a description and a positive amount."
          toast(msg)
          throw new Error(msg)
        }
        const inv: Invoice = {
          id: nextId, clientId, projectId: projectId || undefined, kind, issueDate, dueDate: addDays(issueDate, terms),
          currency: state.settings.currency, lineItems: clean, status: "Draft", channel, reminders: [],
        }

        if (mode === "demo") {
          setStep?.("Creating invoice…")
          let id = createdInvoiceIdRef.current
          if (!id) {
            update((d) => {
              d.invoices.unshift(inv)
            })
            log({ actor, action: "Invoice drafted", detail: `${inv.id} · ${client.name} · ${money(total, client.currency)}`, ref: inv.id, outcome: "info" })
            id = inv.id
            createdInvoiceIdRef.current = id
          }
          if (channel === "PayPal" && sendNow) {
            setStep?.(isOwner ? "Sending to PayPal…" : "Requesting approval…")
            const result = await requestPayPalSend(id, isOwner)
            if (!result.ok) {
              close()
              onCreated(id)
              toast(`${id} saved as draft. PayPal send failed: ${result.message}`)
              return
            }
            close()
            onCreated(id)
            if (isOwner) {
              toast(`${id} sent via PayPal Sandbox`)
            } else {
              toast("Sent to Owner for approval")
            }
          } else {
            close()
            onCreated(id)
            toast(`${id} saved as draft`)
          }
          return
        }

        // Hosted mode
        setStep?.("Creating invoice…")
        let id = createdInvoiceIdRef.current
        if (!id) {
          try {
            id = await createInvoice(inv, `inv-${submitKeyRef.current}`)
            createdInvoiceIdRef.current = id
          } catch (cause) {
            const msg = cause instanceof Error ? cause.message : "Invoice could not be created."
            toast(msg)
            throw cause
          }
        }

        if (channel === "PayPal" && sendNow) {
          setStep?.(isOwner ? "Sending to PayPal…" : "Requesting approval…")
          const result = await requestPayPalSend(id, isOwner, `appr-${submitKeyRef.current}`)
          if (!result.ok) {
            close()
            onCreated(id)
            toast(`${id} saved as draft. PayPal send failed: ${result.message}`)
            return
          }
          close()
          onCreated(id)
          if (isOwner) {
            toast(`${id} sent via PayPal Sandbox`)
          } else {
            toast("Sent to Owner for approval")
          }
        } else {
          close()
          onCreated(id)
          toast(`${id} saved as draft`)
        }
      }}
    >
      <div className="help-box" style={{ marginBottom: "14px" }}>
        You are billing {client.name}. They pay you. Status becomes Paid only after PayPal confirms or you record the bank reference.
      </div>
      <div className="form-grid">
        <Field label="Client">
          <Select
            value={clientId}
            onChange={(e) => {
              setClientId(e.target.value)
              setProjectId(state.projects.find((p) => p.clientId === e.target.value)?.id ?? "")
            }}
          >
            {state.clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.currency}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Project">
          <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">No project</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Invoice type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as Invoice["kind"])}>
            <option>Milestone</option>
            <option>Retainer</option>
            <option>Project</option>
          </Select>
        </Field>
        <Field label="Issue date">
          <Input type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field label="Payment terms" hint={`Due ${fmtDate(addDays(issueDate, terms))}`}>
          <Select value={terms} onChange={(e) => setTerms(Number(e.target.value))}>
            <option value={7}>Net 7</option>
            <option value={15}>Net 15</option>
            <option value={30}>Net 30</option>
            <option value={45}>Net 45</option>
          </Select>
        </Field>
        <Field label="Currency & channel" hint={channel === "PayPal" ? `Collected through PayPal invoicing (${mode === "hosted" ? `${paypalEnvironment} backend` : PAYPAL_MODE}).` : "The client pays by ACH or wire; record payment with the bank reference."}>
          <Select value={channel} onChange={(e) => setChannel(e.target.value as Invoice["channel"])}>
            <option value="PayPal">{state.settings.currency} · PayPal</option>
            <option value="Bank transfer">{state.settings.currency} · Bank transfer</option>
          </Select>
        </Field>
      </div>
      <div className="line-editor">
        <div className="line-editor-head">
          <span>Description</span>
          <span>Qty</span>
          <span>Unit price ({client.currency})</span>
          <span />
        </div>
        {items.map((item, i) => (
          <div className="line-editor-row" key={i}>
            <Input value={item.description} onChange={(e) => setItem(i, { description: e.target.value })} placeholder="e.g. Sprint 3 delivery" aria-label="Line description" />
            <Input type="number" min="1" value={item.quantity} onChange={(e) => setItem(i, { quantity: Number(e.target.value) })} aria-label="Quantity" />
            <Input type="number" min="0" step="0.01" value={item.unitPrice || ""} onChange={(e) => setItem(i, { unitPrice: Number(e.target.value) })} placeholder="0" aria-label="Unit price" />
            <Button variant="ghost" icon={Trash2} aria-label="Remove line" disabled={items.length === 1} onClick={() => setItems(items.filter((_, x) => x !== i))} />
          </div>
        ))}
        <div className="line-editor-foot">
          <Button variant="ghost" icon={Plus} onClick={() => setItems([...items, { description: "", quantity: 1, unitPrice: 0 }])}>
            Add line
          </Button>
          <strong>
            Total {money(total, client.currency)}
          </strong>
        </div>
      </div>
      {channel === "PayPal" && (
        <label className="check-row">
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          <span>Prepare a PayPal send request for approval after saving</span>
        </label>
      )}
    </FormModal>
  )
}
