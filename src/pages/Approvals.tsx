import { useState } from "react"
import { Bot, Download, ShieldCheck } from "lucide-react"
import { ApprovalActions, ApprovalData, ApprovalDraft, ApprovalSteps, KIND_ICON, STATUS_TONE } from "../components/approval-card"
import { Badge, Button, Card, CardHeader, Modal, Select, Tabs, Title, useAction } from "../components/ui"
import { download } from "../lib/csv"
import { fmtStamp } from "../lib/dates"
import { money } from "../lib/format"
import { PAYPAL_MODE } from "../lib/paypal"
import { ROLE_TIERS, useStore } from "../lib/store"
import type { Approval, Role } from "../lib/types"

const TABS = ["Pending", "In progress", "Completed"] as const
type Tab = (typeof TABS)[number]
const inTab = (a: Approval, tab: Tab) => (tab === "Pending" ? a.status === "Pending" : tab === "In progress" ? a.status === "Submitted" : ["Verified", "Rejected", "Failed", "Stale"].includes(a.status))

export default function ApprovalsPage() {
  const { state, mode, paypalMode, paypalEnvironment, update, log, actor, toast, exportAuditCsv, highlightedId } = useStore()
  const s = state.settings
  const [tab, setTab] = useState<Tab>("Pending")
  const [reviewId, setReviewId] = useState<string | null>(null)
  const [filter, setFilter] = useState("all")
  const list = state.approvals.filter((a) => inTab(a, tab))
  const counts = { Pending: state.approvals.filter((a) => inTab(a, "Pending")).length, "In progress": state.approvals.filter((a) => inTab(a, "In progress")).length, Completed: state.approvals.filter((a) => inTab(a, "Completed")).length }
  const audit = state.audit.filter((e) => filter === "all" || e.outcome === filter)
  const review = state.approvals.find((a) => a.id === reviewId)

  const exportAuditAction = useAction(async () => {
    try {
      const csv = await exportAuditCsv()
      download(`centsai-audit-log-${new Date().toISOString().slice(0, 10)}.csv`, csv)
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Audit export failed.")
    }
  })

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
          <Button icon={Download} loading={exportAuditAction.busy} disabled={exportAuditAction.busy} onClick={() => exportAuditAction.run()}>
            Export audit log
          </Button>
        </div>
      </div>
      <div className="demo-note">
        <ShieldCheck size={14} /> PayPal {mode === "hosted" ? (paypalMode === "fake" ? "fake adapter" : paypalEnvironment) : PAYPAL_MODE} · API credentials live only on the backend · Submitted ≠ paid until verified.
      </div>
      <Card className="tier-card">
        <div className="tier-grid">
          {ROLE_TIERS.map((t) => (
            <button key={t.role} className={`tier ${s.role === t.role ? "active" : ""}`} disabled={mode === "hosted"} onClick={() => switchRole(t.role)}>
              <span className="eyebrow">{t.role.toUpperCase()}</span>
              <strong>{t.tier}</strong>
              <small>{t.role === "Finance Manager" ? `${t.detail.replace("the configured limit", money(s.managerApprovalLimit, s.currency))}` : t.detail}</small>
              {s.role === t.role && <Badge tone="green">{mode === "hosted" ? "Your role" : "Acting as"}</Badge>}
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
                <div className={`approval-row ${a.id === highlightedId ? "row-highlight" : ""}`} key={a.id}>
                  <div className="approval-symbol">
                    <Icon size={17} />
                  </div>
                  <div>
                    <strong>{a.title}</strong>
                    <small>
                      {a.recipient} · {a.preparedByAgent || a.preparedBy === "CentsAI agent" ? <span className="agent-chip"><Bot size={11} /> {a.preparedBy}</span> : `by ${a.preparedBy}`} · {fmtStamp(a.requestedAt)}
                    </small>
                    {a.status === "Stale" && <small>Records changed after this was requested — request again</small>}
                    {a.result && <small className="approval-result">{a.result}</small>}
                  </div>
                  <b>
                    {money(a.amount, a.currency)}
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
  const { state, mode, paypalEnvironment } = useStore()
  const live = state.approvals.find((x) => x.id === a.id) ?? a

  return (
    <Modal onClose={close} className="review-modal">
      <div className="modal-icon">
        <ShieldCheck size={22} />
      </div>
      <Title level={2}>{live.status === "Pending" ? "Approve this action?" : live.title}</Title>
      <p>
        {live.status === "Pending"
          ? "Check the recipient and amount. Submission does not mean money has moved — CentsAI verifies the result before updating records."
          : `Status: ${live.status}${live.result ? ` · ${live.result}` : ""}`}
      </p>
      <ApprovalData approval={live} mode={mode} paypalEnvironment={paypalEnvironment} />
      <ApprovalSteps steps={live.steps} />
      <ApprovalDraft draft={live.draft} rows={7} />
      <ApprovalActions approval={live} onDone={close} inline={false} />
    </Modal>
  )
}
