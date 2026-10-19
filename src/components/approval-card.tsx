import { useState } from "react"
import { AlertTriangle, ArrowRight, Bot, Check, Clock, FileCheck2, Mail, ReceiptText, Send, ShieldCheck, Wallet, X, type LucideIcon } from "lucide-react"
import { fmtStamp } from "../lib/dates"
import { money } from "../lib/format"
import { go } from "../lib/router"
import { permissions, useStore } from "../lib/store"
import type { Approval, ApprovalKind, ApprovalStatus, Settings } from "../lib/types"
import { Badge, Button, Field, Input, Note, Textarea, Title, useAction, type Tone } from "./ui"

export const KIND_ICON: Record<ApprovalKind, LucideIcon> = {
  paypal_send_invoice: Send,
  send_reminder: Mail,
  record_contractor_payment: Wallet,
  cancel_subscription: ReceiptText,
}

export const STATUS_TONE: Record<ApprovalStatus, Tone> = {
  Pending: "amber",
  Submitted: "blue",
  Verified: "green",
  Rejected: "neutral",
  Failed: "red",
  Stale: "neutral",
}

export function approvalPermission(
  a: Approval,
  ctx: {
    settings: Settings
    mode: "demo" | "hosted"
    actor: string
    signedInName: string
  }
): {
  allowed: boolean
  permissionAllowed: boolean
  isSelfPrepared: boolean
  blockedReason: string
} {
  const { settings: s, mode, actor, signedInName } = ctx
  const permissionAllowed = permissions(s).approve(a.amount)
  const isSelfPrepared =
    s.role !== "Owner" &&
    (a.preparedBy === actor ||
      a.preparedBy === `CentsAI agent (for ${actor})` ||
      (mode === "hosted" &&
        (a.preparedBy === signedInName ||
          (a.preparedByAgent === true && a.preparedBy === `CentsAI agent (for ${signedInName})`))))
  const allowed = permissionAllowed && !isSelfPrepared

  const blockedReason = isSelfPrepared
    ? "Finance Managers cannot approve requests they prepared themselves (maker-checker rule). Owner approval required."
    : s.role === "Viewer"
    ? "Viewers can’t approve actions."
    : "Owner approval required."

  return { allowed, permissionAllowed, isSelfPrepared, blockedReason }
}

export function useApprovalPermissions(a: Approval) {
  const store = useStore()
  const { state, mode, actor, signedInName } = store
  const perm = approvalPermission(a, {
    settings: state.settings,
    mode,
    actor,
    signedInName,
  })
  return { ...perm, role: state.settings.role, mode }
}

export function ApprovalData({ approval: a, mode, paypalEnvironment }: { approval: Approval; mode: string; paypalEnvironment: string }) {
  return (
    <div className="approval-data">
      <span>Action <strong>{a.title}</strong></span>
      <span>Recipient <strong>{a.recipient}</strong></span>
      <span>Amount <strong>{money(a.amount, a.currency)} {a.currency}</strong></span>
      <span>Fees <strong>{a.kind === "paypal_send_invoice" ? "Charged by PayPal on receipt; shown after verification" : "None recorded"}</strong></span>
      <span>Environment <Badge tone="amber">{a.kind === "paypal_send_invoice" || a.kind === "send_reminder" ? (mode === "hosted" ? `PayPal ${paypalEnvironment}` : "PayPal Sandbox") : "Manual · bank"}</Badge></span>
      <span>Prepared by <strong>{a.preparedBy}</strong></span>
      <span>Requested <strong>{fmtStamp(a.requestedAt)}</strong></span>
      <span>Idempotency key <code>{a.idempotencyKey}</code></span>
      {a.decidedBy && <span>Decision <strong>{a.status === "Rejected" ? "Rejected" : "Approved"} by {a.decidedBy} · {fmtStamp(a.decidedAt!)}</strong></span>}
      {a.note && <span>Reason <strong>{a.note}</strong></span>}
    </div>
  )
}

export function ApprovalSteps({ steps, title = "WHAT HAPPENS ON APPROVAL" }: { steps: string[]; title?: string }) {
  if (!steps || steps.length === 0) return null
  return (
    <div className="steps-list">
      <span className="eyebrow">{title}</span>
      <ol>
        {steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  )
}

export function ApprovalDraft({ draft, rows = 6 }: { draft?: string; rows?: number }) {
  if (!draft) return null
  return (
    <div className="draft-preview">
      <span className="eyebrow">MESSAGE PREVIEW</span>
      <Textarea readOnly rows={rows} value={draft} />
    </div>
  )
}

export function ApprovalActions({
  approval: a,
  onDone,
  inline = false,
  disabled = false,
}: {
  approval: Approval
  onDone?: () => void
  inline?: boolean
  disabled?: boolean
}) {
  const { approve, reject, confirmContractorPayment, toast } = useStore()
  const { allowed, permissionAllowed, isSelfPrepared, blockedReason, role, mode } = useApprovalPermissions(a)
  const [reason, setReason] = useState("")
  const [showRejectReason, setShowRejectReason] = useState(!inline)
  const [reference, setReference] = useState("")
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const rejectAction = useAction(async () => {
    setErrorMsg(null)
    const res = await reject(a.id, reason)
    toast(res.message)
    if (res.ok) {
      if (onDone) onDone()
    } else {
      setErrorMsg(res.message)
    }
  })

  const approveAction = useAction(async () => {
    setErrorMsg(null)
    const res = await approve(a.id)
    toast(res.message)
    if (res.ok) {
      if (onDone) onDone()
    } else {
      setErrorMsg(res.message)
    }
  })

  const confirmTransferAction = useAction(async () => {
    setErrorMsg(null)
    const res = await confirmContractorPayment(a.id, reference)
    toast(res.message)
    if (res.ok) {
      if (onDone) onDone()
    } else {
      setErrorMsg(res.message)
    }
  })

  const isBusy = approveAction.busy || rejectAction.busy || confirmTransferAction.busy

  return (
    <div className="approval-actions-container">
      {errorMsg && (
        <div className="banner banner-danger mb-2" role="alert">
          {errorMsg}
        </div>
      )}

      {a.status === "Pending" && (!permissionAllowed || isSelfPrepared) && (
        <div className="mb-2">
          <Note icon={AlertTriangle} tone="amber">
            {mode === "hosted" ? `${blockedReason} The server will enforce this limit when you submit.` : blockedReason}
          </Note>
        </div>
      )}

      {a.status === "Pending" && (
        <>
          {(!inline || showRejectReason) && (
            <div className="mb-2">
              <Field label="Rejection reason (optional)">
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Client already confirmed payment"
                  disabled={disabled || isBusy}
                />
              </Field>
            </div>
          )}

          <div className={inline ? "approval-inline-buttons" : "modal-actions"}>
            {allowed ? (
              <>
                <Button
                  icon={X}
                  disabled={role === "Viewer" || disabled || isBusy}
                  loading={rejectAction.busy}
                  onClick={() => {
                    if (inline && !showRejectReason) {
                      setShowRejectReason(true)
                      return
                    }
                    void rejectAction.run()
                  }}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  icon={Check}
                  disabled={disabled || isBusy}
                  loading={approveAction.busy}
                  onClick={() => void approveAction.run()}
                >
                  {approveAction.busy ? "Submitting & verifying…" : inline ? "Approve & send" : "Approve & submit"}
                </Button>
              </>
            ) : (
              <Badge tone="amber">Sent to Owner for approval</Badge>
            )}
          </div>
        </>
      )}

      {a.status === "Submitted" && a.kind === "record_contractor_payment" && (
        <>
          <Field label="Bank transfer reference" hint="Required — paste the reference from your bank to enable Confirm transfer.">
            <Input
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. ACH-20261017-98765"
              disabled={disabled || isBusy}
            />
          </Field>
          <div className={inline ? "approval-inline-buttons" : "modal-actions"}>
            {onDone && !inline && (
              <Button disabled={isBusy} onClick={onDone}>
                Later
              </Button>
            )}
            <Button
              variant="primary"
              icon={FileCheck2}
              disabled={disabled || isBusy || !reference.trim()}
              loading={confirmTransferAction.busy}
              onClick={() => void confirmTransferAction.run()}
            >
              Confirm transfer
            </Button>
          </div>
        </>
      )}

      {!inline && a.status !== "Pending" && !(a.status === "Submitted" && a.kind === "record_contractor_payment") && onDone && (
        <div className="modal-actions">
          <Button onClick={onDone}>Close</Button>
        </div>
      )}
    </div>
  )
}

export function ApprovalReviewCard({
  approvalId,
  initialApproval,
  onApproved,
  disabled = false,
}: {
  approvalId?: string
  initialApproval?: Approval
  onApproved?: () => void
  disabled?: boolean
}) {
  const { state } = useStore()
  const [showDetails, setShowDetails] = useState(false)
  const a = state.approvals.find((x) => x.id === (approvalId ?? initialApproval?.id)) ?? initialApproval

  if (!a) {
    return (
      <div className="approval-review-card text-muted text-xs p-3">
        Loading approval {approvalId}…
      </div>
    )
  }

  const Icon = KIND_ICON[a.kind]
  const isPending = a.status === "Pending"

  return (
    <div className="approval-review-card">
      <div className="approval-card-head">
        <div className="flex items-center gap-2 min-w-0">
          <div className="approval-symbol">
            <Icon size={16} />
          </div>
          <div className="min-w-0">
            <strong className="block text-xs font-semibold truncate text-[var(--text)]">{a.title}</strong>
            <small className="block text-[11px] text-[var(--muted)]">
              {a.recipient} · {a.preparedByAgent || a.preparedBy === "CentsAI agent" ? (
                <span className="agent-chip">
                  <Bot size={11} /> {a.preparedBy}
                </span>
              ) : (
                `by ${a.preparedBy}`
              )} · {fmtStamp(a.requestedAt)}
            </small>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
          <strong className="text-xs">{money(a.amount, a.currency)}</strong>
        </div>
      </div>

      {a.status === "Verified" && (
        <div className="approval-banner approval-banner-verified">
          <Check size={14} className="flex-shrink-0" />
          <span>{a.result || "Approved and executed"}</span>
        </div>
      )}

      {a.status === "Submitted" && (
        <div className="approval-banner approval-banner-submitted">
          <Clock size={14} className="flex-shrink-0" />
          <span>{a.result || "Submitted — awaiting verification or transfer confirmation"}</span>
        </div>
      )}

      {a.status === "Rejected" && (
        <div className="approval-banner approval-banner-rejected">
          <X size={14} className="flex-shrink-0" />
          <span>Rejected{a.note ? `: ${a.note}` : ""}</span>
        </div>
      )}

      {a.status === "Failed" && (
        <div className="approval-banner approval-banner-failed">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>Failed{a.result ? `: ${a.result}` : ""}</span>
        </div>
      )}

      {a.status === "Stale" && (
        <div className="approval-banner approval-banner-rejected">
          <AlertTriangle size={14} className="flex-shrink-0" />
          <span>Records changed after this was requested — request again.</span>
        </div>
      )}

      {isPending ? (
        <>
          <ApprovalSteps steps={a.steps} />
          {a.draft && <ApprovalDraft draft={a.draft} rows={4} />}
        </>
      ) : (
        <div className="approval-card-details-toggle mt-2">
          <button
            type="button"
            onClick={() => setShowDetails((prev) => !prev)}
            className="text-[11px] text-[var(--muted)] hover:text-[var(--text)] underline cursor-pointer inline-flex items-center gap-1"
          >
            {showDetails ? "Hide details" : "Show details"}
          </button>
          {showDetails && (
            <div className="mt-2 space-y-2">
              <ApprovalSteps steps={a.steps} />
              {a.draft && <ApprovalDraft draft={a.draft} rows={4} />}
            </div>
          )}
        </div>
      )}

      <div className="approval-card-actions">
        <ApprovalActions approval={a} inline onDone={onApproved} disabled={disabled} />
        <Button variant="ghost" onClick={() => go("approvals")} className="open-approvals-link">
          Open in Approvals <ArrowRight size={12} />
        </Button>
      </div>
    </div>
  )
}

export function ApprovalGroup({ approvalIds, disabled = false }: { approvalIds: string[]; disabled?: boolean }) {
  const { state, mode, actor, signedInName, approve, toast } = useStore()
  const [running, setRunning] = useState(false)
  const [currentStep, setCurrentStep] = useState<{ index: number; total: number } | null>(null)
  const [resultLine, setResultLine] = useState<string | null>(null)

  const liveApprovals = approvalIds
    .map((id) => state.approvals.find((x) => x.id === id))
    .filter((a): a is Approval => Boolean(a))

  const s = state.settings
  const pendingApprovals = liveApprovals.filter((a) => {
    if (a.status !== "Pending") return false
    return approvalPermission(a, { settings: s, mode, actor, signedInName }).allowed
  })

  const handleApproveAll = async () => {
    if (running) return
    const snapshot = [...pendingApprovals]
    if (snapshot.length === 0) return
    setRunning(true)
    setResultLine(null)
    let approvedCount = 0
    let stoppedReason: string | null = null

    for (let i = 0; i < snapshot.length; i++) {
      setCurrentStep({ index: i + 1, total: snapshot.length })
      const item = snapshot[i]
      const current = state.approvals.find((x) => x.id === item.id)
      if (!current || current.status !== "Pending") {
        continue
      }
      const res = await approve(item.id)
      if (!res.ok) {
        stoppedReason = `Stopped at ${item.id}: ${res.message}`
        break
      }
      approvedCount++
    }

    setRunning(false)
    setCurrentStep(null)
    if (stoppedReason) {
      setResultLine(stoppedReason)
      toast(stoppedReason)
    } else {
      const summary = `${approvedCount} of ${snapshot.length} approved`
      setResultLine(summary)
      toast(summary)
    }
  }

  const showBar = running || pendingApprovals.length > 1 || Boolean(resultLine)

  return (
    <div className="approval-group space-y-3 my-2">
      {showBar && (
        <div className="approve-all-bar">
          {running ? (
            <>
              <span className="text-xs font-medium text-[var(--text)]">
                Approving drafts…
              </span>
              <Button variant="primary" disabled loading>
                {`Approving ${currentStep?.index ?? 1} of ${currentStep?.total ?? 1}…`}
              </Button>
            </>
          ) : pendingApprovals.length > 1 ? (
            <>
              <div className="flex flex-col">
                <span className="text-xs font-medium text-[var(--text)]">
                  {pendingApprovals.length} drafts awaiting your approval
                </span>
                {resultLine && <span className="text-[11px] text-[var(--muted)]">{resultLine}</span>}
              </div>
              <Button
                variant="primary"
                disabled={disabled}
                onClick={handleApproveAll}
              >
                {`Approve all (${pendingApprovals.length})`}
              </Button>
            </>
          ) : resultLine ? (
            <div className="flex items-center justify-between w-full">
              <span className="text-xs font-medium text-[var(--text)]">{resultLine}</span>
            </div>
          ) : null}
        </div>
      )}

      {approvalIds.map((id) => (
        <ApprovalReviewCard key={id} approvalId={id} disabled={disabled || running} />
      ))}
    </div>
  )
}
