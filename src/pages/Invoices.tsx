import { useMemo, useState } from "react"
import { AlertTriangle, Check, Clock3, ExternalLink, Mail, Plus, RefreshCw, Search, Send, ShieldCheck, Sparkles, Trash2 } from "lucide-react"
import { InvoiceRows } from "../components/finance-ui"
import { Badge, Button, Card, Drawer, Field, FormModal, Input, MetricCard, Note, Select, Tabs, Textarea, Title } from "../components/ui"
import { addDays, fmtDate, fmtDay, fmtStamp, relativeDue } from "../lib/dates"
import { draftReminder, type ReminderTone } from "../lib/drafts"
import { buildEvents, clientOf, invoiceINR, invoiceState, invoiceTotal, projectOf, receivables, stateTone } from "../lib/finance"
import { money } from "../lib/format"
import { PAYPAL_MODE, paypalEligibility } from "../lib/paypal"
import { routeParams } from "../lib/router"
import { useStore } from "../lib/store"
import type { Invoice, LineItem } from "../lib/types"

const TABS = ["All", "Overdue", "Due soon", "Open", "Paid", "Draft"] as const
type Tab = (typeof TABS)[number]

export default function InvoicesPage() {
  const { state, today } = useStore()
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
      if (sort === "amount") return invoiceINR(b, state.settings) - invoiceINR(a, state.settings)
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
          <Title>Invoices & Payments</Title>
          <p>Bill clients, prioritise collections, and verify payments before they reach your ledger.</p>
        </div>
        <div className="intro-actions">
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            Create invoice
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> PayPal {PAYPAL_MODE} for USD invoices · INR invoices by bank transfer · Ledger updates only after verification.
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
  const { state, today, toast, can } = store
  const client = clientOf(state, inv.clientId)
  const project = projectOf(state, inv.projectId)
  const st = invoiceState(inv, today)
  const total = invoiceTotal(inv)
  const [busy, setBusy] = useState("")
  const [modal, setModal] = useState<"remind" | "record" | null>(null)
  const eligibility = paypalEligibility(inv, client)
  const pending = state.approvals.find((a) => a.refId === inv.id && (a.status === "Pending" || a.status === "Submitted"))
  const expected = buildEvents(state, today, 120, "expected").find((e) => e.ref === inv.id)
  const conservative = buildEvents(state, today, 120, "conservative").find((e) => e.ref === inv.id)
  const events = state.audit.filter((a) => a.ref === inv.id).reverse()

  const run = async (label: string, fn: () => Promise<{ ok: boolean; message: string }> | { ok: boolean; message: string }) => {
    setBusy(label)
    const res = await fn()
    setBusy("")
    toast(res.message)
  }

  const timeline = [
    { label: "Invoice created", date: fmtDate(inv.issueDate), done: true },
    ...(inv.status !== "Draft" ? [{ label: inv.paypal ? `Sent via PayPal · ${inv.paypal.invoiceId}` : "Issued (bank transfer)", date: inv.paypal?.sentAt ? fmtStamp(inv.paypal.sentAt) : fmtDate(inv.issueDate), done: true }] : []),
    ...inv.reminders.map((r) => ({ label: `${r.channel}`, date: `${fmtDate(r.date)} · ${r.note}`, done: true })),
    ...events.filter((e) => /verified|checked|recorded|paid/i.test(e.action)).map((e) => ({ label: e.action, date: `${fmtStamp(e.at)} · ${e.actor}`, done: e.outcome === "success" })),
    ...(inv.status === "Paid" ? [] : [{ label: "Payment verified", date: "Waiting", done: false }]),
  ]

  return (
    <Drawer
      eyebrow="INVOICE DETAIL"
      title={inv.id}
      onClose={close}
      footer={
        <>
          {inv.status === "Draft" && (
            <>
              <Button
                variant="ghost"
                icon={Trash2}
                disabled={!can.edit}
                onClick={() => {
                  store.update((d) => {
                    d.invoices = d.invoices.filter((i) => i.id !== inv.id)
                  })
                  store.log({ actor: store.actor, action: "Draft deleted", detail: inv.id, ref: inv.id, outcome: "info" })
                  close()
                  toast(`${inv.id} draft deleted`)
                }}
              >
                Delete draft
              </Button>
              {eligibility.ok ? (
                <Button variant="primary" icon={Send} disabled={!!pending} onClick={() => run("send", () => store.requestPayPalSend(inv.id))}>
                  {pending ? `${pending.id} awaiting approval` : "Send via PayPal"}
                </Button>
              ) : (
                <Button variant="primary" onClick={() => run("issue", () => store.markSentManually(inv.id))}>
                  Mark as sent
                </Button>
              )}
            </>
          )}
          {inv.status === "Sent" && (
            <>
              <Button icon={Mail} disabled={!!pending} onClick={() => setModal("remind")}>
                {pending?.kind === "send_reminder" ? "Reminder awaiting approval" : "Draft reminder"}
              </Button>
              {inv.paypal ? (
                <Button variant="primary" icon={RefreshCw} disabled={busy === "check"} onClick={() => run("check", () => store.checkPayPalStatus(inv.id))}>
                  {busy === "check" ? "Checking PayPal…" : "Verify payment status"}
                </Button>
              ) : (
                <Button variant="primary" icon={Check} disabled={!can.edit} onClick={() => setModal("record")}>
                  Record payment
                </Button>
              )}
            </>
          )}
        </>
      }
    >
      <div className="drawer-status">
        <Badge tone={stateTone(st)}>{st}</Badge>
        <div className="drawer-amount">
          <strong>{money(total, inv.currency)}</strong>
          {inv.currency !== "INR" && <small>≈ {money(invoiceINR(inv, state.settings))} at ₹{state.settings.usdRate}/USD</small>}
        </div>
      </div>
      <div className="detail-section">
        <span>CLIENT</span>
        <strong>{client.name}</strong>
        <small>
          {client.email} · {client.country} · usually pays {client.avgDelayDays === 0 ? "on time" : `${client.avgDelayDays} days late`}
        </small>
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
          <strong>{inv.channel === "PayPal" ? "PayPal Sandbox" : "Bank transfer"}</strong>
        </div>
      </div>
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
          <div className="paypal-head">
            <span className="paypal-mark">P</span>
            <div>
              <strong>PayPal Sandbox</strong>
              <small>{inv.paypal.invoiceId}</small>
            </div>
            <Badge tone={inv.paypal.status === "PAID" ? "green" : "blue"}>{inv.paypal.status}</Badge>
          </div>
          <div className="paypal-meta">
            <span>Last verified {inv.paypal.lastCheckedAt ? fmtStamp(inv.paypal.lastCheckedAt) : "never"}</span>
            <a href={inv.paypal.payerUrl} target="_blank" rel="noreferrer">
              Payer link <ExternalLink size={11} />
            </a>
          </div>
          {inv.status === "Sent" && (
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
          {pending.id} · {pending.title} is {pending.status === "Pending" ? "waiting for approval" : "submitted"}.
        </Note>
      )}

      <div className="timeline">
        <Title level={3}>Payment timeline</Title>
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

      {modal === "remind" && <ReminderModal inv={inv} close={() => setModal(null)} />}
      {modal === "record" && <RecordPaymentModal inv={inv} close={() => setModal(null)} />}
    </Drawer>
  )
}

function ReminderModal({ inv, close }: { inv: Invoice; close: () => void }) {
  const { state, today, prepareReminder, toast } = useStore()
  const client = clientOf(state, inv.clientId)
  const [tone, setTone] = useState<ReminderTone>(inv.reminders.length ? "Firm" : "Friendly")
  const [text, setText] = useState(() => draftReminder(inv, client, state.settings, today, tone))
  return (
    <FormModal
      eyebrow="AI-DRAFTED REMINDER"
      title={`Reminder for ${inv.id}`}
      submitLabel="Request approval to send"
      onClose={close}
      onSubmit={() => {
        const res = prepareReminder(inv.id, { draft: text, tone })
        toast(res.message)
        if (res.ok) close()
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
          <Input readOnly value={inv.paypal ? "PayPal reminder (Sandbox)" : `Email to ${client.email}`} />
        </Field>
        <Field label="Message" full>
          <Textarea rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </Field>
      </div>
      <p className="section-note form-note">
        Previous reminders: {inv.reminders.length || "none"}. Nothing is sent until an authorised person approves it in Approvals & Audit.
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
      title={`Record payment · ${inv.id}`}
      submitLabel="Record payment"
      onClose={close}
      onSubmit={() => {
        const res = recordManualPayment(inv.id, date, reference)
        toast(res.message)
        if (res.ok) close()
      }}
    >
      <div className="form-grid">
        <Field label="Amount received">
          <Input readOnly value={money(invoiceTotal(inv), inv.currency)} />
        </Field>
        <Field label="Date received">
          <Input type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} required />
        </Field>
        <Field label="Bank reference (UTR)" full hint="Required — the reference links this ledger entry to your bank statement.">
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. HDFCN52026101712345" required />
        </Field>
      </div>
    </FormModal>
  )
}

function CreateInvoice({ close, onCreated }: { close: () => void; onCreated: (id: string) => void }) {
  const { state, today, update, log, actor, toast, can, requestPayPalSend } = useStore()
  const [clientId, setClientId] = useState(state.clients[0].id)
  const client = clientOf(state, clientId)
  const projects = state.projects.filter((p) => p.clientId === clientId)
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "")
  const [kind, setKind] = useState<Invoice["kind"]>("Milestone")
  const [issueDate, setIssueDate] = useState(today)
  const [terms, setTerms] = useState(15)
  const [items, setItems] = useState<LineItem[]>([{ description: "", quantity: 1, unitPrice: 0 }])
  const [sendNow, setSendNow] = useState(true)
  const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
  const nextId = `INV-${Math.max(...state.invoices.map((i) => Number(i.id.replace(/\D/g, "")) || 0)) + 1}`
  const setItem = (index: number, patch: Partial<LineItem>) => setItems(items.map((it, i) => (i === index ? { ...it, ...patch } : it)))

  return (
    <FormModal
      eyebrow="NEW CLIENT INVOICE"
      title={`Create ${nextId}`}
      submitLabel={client.currency === "USD" && sendNow ? "Create & request PayPal send" : "Save draft"}
      wide
      onClose={close}
      onSubmit={() => {
        if (!can.edit) return toast("Viewers can't create invoices.")
        const clean = items.filter((i) => i.description.trim() && i.quantity > 0 && i.unitPrice > 0)
        if (!clean.length) return toast("Add at least one line item with a description and a positive amount.")
        const inv: Invoice = {
          id: nextId, clientId, projectId: projectId || undefined, kind, issueDate, dueDate: addDays(issueDate, terms),
          currency: client.currency, lineItems: clean, status: "Draft", channel: client.currency === "USD" ? "PayPal" : "Bank transfer", reminders: [],
        }
        update((d) => {
          d.invoices.unshift(inv)
        })
        log({ actor, action: "Invoice drafted", detail: `${inv.id} · ${client.name} · ${money(total, client.currency)}`, ref: inv.id, outcome: "info" })
        close()
        if (client.currency === "USD" && sendNow) {
          setTimeout(() => toast(requestPayPalSend(inv.id).message), 0)
        } else toast(`${inv.id} saved as draft`)
        onCreated(inv.id)
      }}
    >
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
        <Field label="Currency & channel" hint={client.currency === "USD" ? "Collected through PayPal invoicing (Sandbox)." : "INR — collected by bank transfer and recorded manually."}>
          <Input readOnly value={client.currency === "USD" ? "USD · PayPal" : "INR · Bank transfer"} />
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
            {client.currency === "USD" && total > 0 && <small> ≈ {money(total * state.settings.usdRate)}</small>}
          </strong>
        </div>
      </div>
      {client.currency === "USD" && (
        <label className="check-row">
          <input type="checkbox" checked={sendNow} onChange={(e) => setSendNow(e.target.checked)} />
          <span>Prepare a PayPal send request for approval after saving</span>
        </label>
      )}
    </FormModal>
  )
}
