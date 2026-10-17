import { useState } from "react"
import { AlertTriangle, Bot, Check, Download, FileCheck2, Mail, ReceiptText, Send, ShieldCheck, Wallet, X, type LucideIcon } from "lucide-react"
import { Badge, Button, Card, CardHeader, Field, Input, Modal, Note, Select, Tabs, Textarea, Title } from "../components/ui"
import { download, toCsv } from "../lib/csv"
import { fmtStamp } from "../lib/dates"
import { money } from "../lib/format"
import { PAYPAL_MODE } from "../lib/paypal"
import { ROLE_TIERS, permissions, useStore } from "../lib/store"
import type { Approval, ApprovalKind, Role } from "../lib/types"

const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  paypal_send_invoice: Send,
  send_reminder: Mail,
  record_contractor_payment: Wallet,
  cancel_subscription: ReceiptText,
}

const STATUS_TONE: Record<Approval["status"], string> = { Pending: "amber", Submitted: "blue", Verified: "green", Rejected: "neutral", Failed: "red", Stale: "neutral" }

const TABS = ["Pending", "In progress", "Completed"] as const
type Tab = (typeof TABS)[number]
const inTab = (a: Approval, tab: Tab) => (tab === "Pending" ? a.status === "Pending" : tab === "In progress" ? a.status === "Submitted" : ["Verified", "Rejected", "Failed", "Stale"].includes(a.status))

export default function ApprovalsPage() {
  const { state, update, log, actor, toast } = useStore()
  const s = state.settings
  const [tab, setTab] = useState<Tab>("Pending")
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [filter, setFilter] = useState("all")
  const list = state.approvals.filter((a) => inTab(a, tab))
  const counts = { Pending: state.approvals.filter((a) => inTab(a, "Pending")).length, "In progress": state.approvals.filter((a) => inTab(a, "In progress")).length, Completed: state.approvals.filter((a) => inTab(a, "Completed")).length }
  const audit = state.audit.filter((e) => filter === "all" || e.outcome === filter)
  const review = state.approvals.find((a) => a.id === reviewId)

  const exportAudit = () =>
    download(`centsai-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([["timestamp", "actor", "action", "detail", "reference", "outcome"], ...state.audit.map((e) => [e.at, e.actor, e.action, e.detail, e.ref, e.outcome])]))

  const switchRole = (role: Role) => {
    update((d) => {
      d.settings.role = role
    })
    log({ actor: "System", action: "Role switched", detail: `${actor} → acting as ${role} (demo)`, outcome: "info" })
    toast(`Now acting as ${role}`)
  }

  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Approvals & Audit</Title>
          <p>Every money-moving action is prepared, approved by an authorised person, executed once, and verified.</p>
        </div>
        <div className="intro-actions">
          <Badge tone={counts.Pending ? "amber" : "green"}>{counts.Pending} awaiting approval</Badge>
          <Button icon={Download} onClick={exportAudit}>
            Export audit log
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> PayPal {PAYPAL_MODE} · API credentials live only on the backend · Submitted ≠ paid until verified.
      </div>
      <Card className="tier-card">
        <div className="tier-grid">
          {ROLE_TIERS.map((t) => (
            <button key={t.role} className={`tier ${s.role === t.role ? "active" : ""}`} onClick={() => switchRole(t.role)}>
              <span className="eyebrow">{t.role.toUpperCase()}</span>
              <strong>{t.tier}</strong>
              <small>{t.role === "Finance Manager" ? `${t.detail.replace("the configured limit", money(s.managerApprovalLimit))}` : t.detail}</small>
              {s.role === t.role && <Badge tone="green">Acting as</Badge>}
            </button>
          ))}
        </div>
      </Card>
      <div className="approval-layout">
        <Card>
          <CardHeader title="Approval Queue" action={<Tabs options={[...TABS]} value={tab} onChange={setTab} counts={counts} />} />
          <div className="approval-list">
            {list.map((a) => {
              const Icon = KIND_ICON[a.kind]
              return (
                <div className="approval-row" key={a.id}>
                  <div className="approval-symbol">
                    <Icon size={17} />
                  </div>
                  <div>
                    <strong>{a.title}</strong>
                    <small>
                      {a.recipient} · {a.preparedBy === "CentsAI agent" ? <span className="agent-chip"><Bot size={11} /> CentsAI agent</span> : `by ${a.preparedBy}`} · {fmtStamp(a.requestedAt)}
                    </small>
                    {a.status === "Stale" && <small>Records changed after this was requested — request again</small>}
                    {a.result && <small className="approval-result">{a.result}</small>}
                  </div>
                  <b>
                    {money(a.amount, a.currency)}
                    {a.currency !== "INR" && <small className="muted"> ≈ {money(a.amountINR)}</small>}
                  </b>
                  <div>
                    <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                    <Button variant={a.status === "Pending" || (a.status === "Submitted" && a.kind === "record_contractor_payment") ? "primary" : "ghost"} onClick={() => setReviewId(a.id)}>
                      {a.status === "Pending" ? "Review" : a.status === "Submitted" && a.kind === "record_contractor_payment" ? "Confirm" : "Details"}
                    </Button>
                  </div>
                </div>
              )
            })}
            {list.length === 0 && <div className="empty">{tab === "Pending" ? "Nothing is waiting for approval." : "No items here yet."}</div>}
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Audit Trail"
            action={
              <Select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter audit events">
                <option value="all">All events</option>
                <option value="success">Verified / success</option>
                <option value="warning">Warnings</option>
                <option value="error">Errors</option>
                <option value="info">Info</option>
              </Select>
            }
          />
          <div className="audit-timeline">
            {audit.slice(0, 25).map((e) => (
              <div key={e.id}>
                <span className={e.outcome === "success" ? "done" : e.outcome === "error" ? "err" : e.outcome === "warning" ? "warn" : ""} />
                <div>
                  <strong>{e.action}</strong>
                  <p>{e.detail}</p>
                  <small>
                    {fmtStamp(e.at)} · {e.actor}
                    {e.ref ? ` · ${e.ref}` : ""}
                  </small>
                </div>
              </div>
            ))}
            {audit.length === 0 && <div className="empty">No events.</div>}
          </div>
          {audit.length > 25 && <small className="section-note">Showing latest 25 of {audit.length}. Export for the full log.</small>}
        </Card>
      </div>
      {review && <ReviewModal approval={review} close={() => setReviewId(null)} />}
    </div>
  )
}

function ReviewModal({ approval: a, close }: { approval: Approval; close: () => void }) {
  const { state, approve, reject, confirmContractorPayment, toast } = useStore()
  const s = state.settings
  const allowed = permissions(s).approve(a.amountINR)
  const [reason, setReason] = useState("")
  const [reference, setReference] = useState("")
  const [busy, setBusy] = useState(false)
  const blockedReason =
    s.role === "Viewer" ? "Viewers can’t approve actions." : `Exceeds the ${money(s.managerApprovalLimit)} Finance Manager limit — Owner approval required.`

  return (
    <Modal onClose={close} className="review-modal">
      <div className="modal-icon">
        <ShieldCheck size={22} />
      </div>
      <Title level={2}>{a.status === "Pending" ? "Approve this action?" : a.title}</Title>
      <p>{a.status === "Pending" ? "Check the recipient and amount. Submission does not mean money has moved — CentsAI verifies the result before updating records." : `Status: ${a.status}${a.result ? ` · ${a.result}` : ""}`}</p>
      <div className="approval-data">
        <span>Action <strong>{a.title}</strong></span>
        <span>Recipient <strong>{a.recipient}</strong></span>
        <span>Amount <strong>{money(a.amount, a.currency)} {a.currency}{a.currency !== "INR" ? ` (≈ ${money(a.amountINR)})` : ""}</strong></span>
        <span>Fees <strong>{a.kind === "paypal_send_invoice" ? "Charged by PayPal on receipt; shown after verification" : "None recorded"}</strong></span>
        <span>Environment <Badge tone="amber">{a.kind === "paypal_send_invoice" || a.kind === "send_reminder" ? "PayPal Sandbox" : "Manual · bank"}</Badge></span>
        <span>Prepared by <strong>{a.preparedBy}</strong></span>
        <span>Requested <strong>{fmtStamp(a.requestedAt)}</strong></span>
        <span>Idempotency key <code>{a.idempotencyKey}</code></span>
        {a.decidedBy && <span>Decision <strong>{a.status === "Rejected" ? "Rejected" : "Approved"} by {a.decidedBy} · {fmtStamp(a.decidedAt!)}</strong></span>}
        {a.note && <span>Reason <strong>{a.note}</strong></span>}
      </div>
      <div className="steps-list">
        <span className="eyebrow">WHAT HAPPENS ON APPROVAL</span>
        <ol>
          {a.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      {a.draft && (
        <div className="draft-preview">
          <span className="eyebrow">MESSAGE</span>
          <Textarea readOnly rows={7} value={a.draft} />
        </div>
      )}
      {a.status === "Pending" && !allowed && (
        <Note icon={AlertTriangle} tone="amber">
          {blockedReason}
        </Note>
      )}
      {a.status === "Pending" && (
        <>
          <Field label="Rejection reason (optional)">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client already confirmed payment" />
          </Field>
          <div className="modal-actions">
            <Button
              icon={X}
              disabled={busy}
              onClick={() => {
                const res = reject(a.id, reason)
                toast(res.message)
                if (res.ok) close()
              }}
            >
              Reject
            </Button>
            <Button
              variant="primary"
              icon={busy ? undefined : Check}
              disabled={!allowed || busy}
              onClick={async () => {
                setBusy(true)
                const res = await approve(a.id)
                setBusy(false)
                toast(res.message)
                if (res.ok) close()
              }}
            >
              {busy ? (
                <>
                  <span className="auth-spinner" /> Submitting & verifying…
                </>
              ) : (
                "Approve & submit"
              )}
            </Button>
          </div>
        </>
      )}
      {a.status === "Submitted" && a.kind === "record_contractor_payment" && (
        <>
          <Field label="Bank transfer reference (UTR)">
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ICICN52026101798765" />
          </Field>
          <div className="modal-actions">
            <Button onClick={close}>Later</Button>
            <Button
              variant="primary"
              icon={FileCheck2}
              onClick={() => {
                const res = confirmContractorPayment(a.id, reference)
                toast(res.message)
                if (res.ok) close()
              }}
            >
              Confirm transfer
            </Button>
          </div>
        </>
      )}
      {a.status !== "Pending" && !(a.status === "Submitted" && a.kind === "record_contractor_payment") && (
        <div className="modal-actions">
          <Button onClick={close}>Close</Button>
        </div>
      )}
    </Modal>
  )
}
