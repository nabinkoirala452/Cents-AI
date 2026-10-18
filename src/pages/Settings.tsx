import { useState } from "react"
import { AlertTriangle, Bot, Download, Landmark, RefreshCw, ShieldCheck, Upload } from "lucide-react"
import { Badge, Button, Card, Field, Input, Modal, Select, Title, Toggle, useAction } from "../components/ui"
import { download, toCsv } from "../lib/csv"
import { fmtStamp } from "../lib/dates"
import { clientOf, invoiceTotal } from "../lib/finance"
import { money } from "../lib/format"
import { PAYPAL_MODE, paypalSandbox } from "../lib/paypal"
import { NOTIFICATION_KEYS } from "../lib/seed"
import { ROLE_TIERS, useStore } from "../lib/store"
import type { Role, Settings } from "../lib/types"

const SECTIONS = ["Agency Profile", "Financial Preferences", "Notifications", "Integrations", "Team & Permissions", "Security & Privacy", "Data Management"] as const
type Section = (typeof SECTIONS)[number]

export default function SettingsPage() {
  const [section, setSection] = useState<Section>("Agency Profile")
  return (
    <div className="page">
      <div className="page-intro">
        <div>
          <Title>Settings</Title>
          <p>Workspace details, financial controls, permissions and data.</p>
        </div>
      </div>
      <div className="settings-layout">
        <aside className="settings-nav">
          {SECTIONS.map((item) => (
            <button key={item} className={section === item ? "active" : ""} onClick={() => setSection(item)}>
              {item}
            </button>
          ))}
        </aside>
        <Card className="settings-content">
          <SectionBody key={section} section={section} />
        </Card>
      </div>
    </div>
  )
}

function Heading({ title, copy }: { title: string; copy: string }) {
  return (
    <div className="settings-heading">
      <Title level={2}>{title}</Title>
      <p>{copy}</p>
    </div>
  )
}

function SectionBody({ section }: { section: Section }) {
  const store = useStore()
  const { state, update, updateWorkspace, updateSettings, log, actor, toast, can, mode } = store
  const [draft, setDraft] = useState<Settings>(state.settings)
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch })
  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings)
  const saveAction = useAction(async (fields: (keyof Settings)[]) => {
    if (!can.edit) {
      toast("Viewers can't change settings.")
      return
    }
    if (mode === "hosted") {
      if (section === "Agency Profile") {
        const res = await updateWorkspace({
          agencyName: draft.agencyName,
          agencyType: draft.agencyType,
          teamSize: draft.teamSize,
          location: draft.location,
          website: draft.website,
        })
        if (!res.ok) {
          toast(res.message)
          throw new Error(res.message)
        }
      } else {
        const patch: Record<string, unknown> = {}
        for (const f of fields) patch[f] = draft[f]
        const res = await updateSettings(patch)
        if (!res.ok) {
          toast(res.message)
          throw new Error(res.message)
        }
      }
    } else {
      await update((d) => {
        for (const f of fields) (d.settings as Record<string, unknown>)[f] = draft[f]
      })
      await log({ actor, action: "Settings updated", detail: `${section}: ${fields.join(", ")}`, outcome: "info" })
    }
    toast(`${section} saved`)
  })
  const actions = (fields: (keyof Settings)[]) => (
    <div className="settings-actions">
      <Button disabled={!dirty || saveAction.busy} onClick={() => setDraft(state.settings)}>
        Discard
      </Button>
      <Button variant="primary" disabled={!dirty || !can.edit || saveAction.busy} loading={saveAction.busy} onClick={() => saveAction.run(fields)}>
        Save changes
      </Button>
    </div>
  )

  if (section === "Agency Profile")
    return (
      <>
        <Heading title="Agency Profile" copy="Used across reports, reminders and invoices." />
        <div className="settings-form">
          <Field label="Agency name">
            <Input value={draft.agencyName} onChange={(e) => set({ agencyName: e.target.value })} />
          </Field>
          <Field label="Business type">
            <Select value={draft.agencyType} onChange={(e) => set({ agencyType: e.target.value })}>
              <option>Software agency</option>
              <option>IT consultancy</option>
              <option>Marketing agency</option>
              <option>Creative studio</option>
            </Select>
          </Field>
          <Field label="Team size">
            <Select value={draft.teamSize} onChange={(e) => set({ teamSize: e.target.value })}>
              <option>2–5</option>
              <option>6–10</option>
              <option>11–20</option>
            </Select>
          </Field>
          <Field label="Location">
            <Input value={draft.location} onChange={(e) => set({ location: e.target.value })} />
          </Field>
          <Field label="Owner name" hint="Signs payment reminders">
            <Input value={draft.ownerName} onChange={(e) => set({ ownerName: e.target.value })} />
          </Field>
          <Field label="Website">
            <Input value={draft.website} onChange={(e) => set({ website: e.target.value })} />
          </Field>
        </div>
        {actions(["agencyName", "agencyType", "teamSize", "location", "ownerName", "website"])}
      </>
    )

  if (section === "Financial Preferences")
    return (
      <>
        <Heading title="Financial Preferences" copy="Thresholds and defaults used by every forecast, alert and simulation." />
        <div className="settings-form">
          <Field label="Reporting currency" hint="Every amount uses the workspace currency; no FX conversion is applied.">
            <Input readOnly value={draft.currency} />
          </Field>
          <Field label={`Minimum cash reserve (${draft.currency})`} hint="Forecast days below this are flagged.">
            <Input type="number" min="0" step="5000" value={draft.safetyThreshold} onChange={(e) => set({ safetyThreshold: Number(e.target.value) })} />
          </Field>
          <Field label="Default forecast horizon">
            <Select value={draft.defaultHorizon} onChange={(e) => set({ defaultHorizon: Number(e.target.value) as 7 | 30 | 90 })}>
              <option value={7}>7 days</option>
              <option value={30}>30 days</option>
              <option value={90}>90 days</option>
            </Select>
          </Field>
          <Field label="Planning scenario">
            <Select value={draft.planningScenario} onChange={(e) => set({ planningScenario: e.target.value as Settings["planningScenario"] })}>
              <option value="expected">Expected</option>
              <option value="conservative">Conservative</option>
              <option value="optimistic">Optimistic</option>
            </Select>
          </Field>
        </div>
        {actions(["safetyThreshold", "defaultHorizon", "planningScenario"])}
      </>
    )

  if (section === "Notifications")
    return (
      <>
        <Heading title="Notifications" copy="Which alerts appear in the bell and the daily briefing." />
        <div className="notification-settings">
          {NOTIFICATION_KEYS.map((key) => (
            <div key={key}>
              <span>
                <strong>{key}</strong>
                <small>In-app alert</small>
              </span>
              <Toggle label={key} checked={draft.notifications[key] ?? false} onChange={(v) => set({ notifications: { ...draft.notifications, [key]: v } })} />
            </div>
          ))}
        </div>
        <p className="section-note">Email and push delivery need the backend; preferences are saved now and will apply once it’s connected.</p>
        {actions(["notifications"])}
      </>
    )

  if (section === "Integrations") return <Integrations />

  if (section === "Team & Permissions")
    return (
      <>
        <Heading title="Team & Permissions" copy="Separate read-only analysis from preparing and approving money movements." />
        <div className="table-scroll settings-table">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Permission tier</th>
                <th>Can approve</th>
              </tr>
            </thead>
            <tbody>
              {draft.team.map((m, i) => (
                <tr key={m.email}>
                  <td>
                    <strong>{m.name}</strong>
                    <small className="row-id">{m.email}</small>
                  </td>
                  <td>
                    <Select
                      value={m.role}
                      disabled={state.settings.role !== "Owner" || m.role === "Owner"}
                      onChange={(e) => set({ team: draft.team.map((x, j) => (j === i ? { ...x, role: e.target.value as Role } : x)) })}
                      aria-label={`Role for ${m.name}`}
                    >
                      <option>Owner</option>
                      <option>Finance Manager</option>
                      <option>Viewer</option>
                    </Select>
                  </td>
                  <td>{ROLE_TIERS.find((t) => t.role === m.role)?.tier}</td>
                  <td>{m.role === "Owner" ? "Any amount" : m.role === "Finance Manager" ? `Up to ${money(draft.managerApprovalLimit)}` : "No"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="settings-form">
          <Field label={`Finance Manager approval limit (${draft.currency})`} hint="Above this, only the Owner can approve.">
            <Input type="number" min="0" step="5000" disabled={state.settings.role !== "Owner"} value={draft.managerApprovalLimit} onChange={(e) => set({ managerApprovalLimit: Number(e.target.value) })} />
          </Field>
          {mode === "demo" ? (
            <Field label="Acting as (demo)" hint="Switch roles to test permission tiers.">
              <Select value={draft.role} onChange={(e) => set({ role: e.target.value as Role })}>
                <option>Owner</option>
                <option>Finance Manager</option>
                <option>Viewer</option>
              </Select>
            </Field>
          ) : (
            <Field label="Your role">
              <Input readOnly value={state.settings.role} />
            </Field>
          )}
        </div>
        <div className="settings-actions">
          <Button disabled={!dirty} onClick={() => setDraft(state.settings)}>
            Discard
          </Button>
          <Button
            variant="primary"
            disabled={!dirty}
            onClick={async () => {
              if (mode === "hosted") {
                if (state.settings.role === "Owner") {
                  const res = await updateSettings({
                    team: draft.team.map((m) => ({ email: m.email, role: m.role })),
                    managerApprovalLimit: draft.managerApprovalLimit,
                  })
                  if (!res.ok) return toast(res.message)
                }
              } else {
                await update((d) => {
                  d.settings.role = draft.role
                  if (state.settings.role === "Owner") {
                    d.settings.team = draft.team
                    d.settings.managerApprovalLimit = draft.managerApprovalLimit
                  }
                })
                await log({ actor, action: "Permissions updated", detail: `Acting as ${draft.role} · manager limit ${money(draft.managerApprovalLimit)}`, outcome: "warning" })
              }
              toast("Permissions saved")
            }}
          >
            Save changes
          </Button>
        </div>
      </>
    )

  if (section === "Security & Privacy")
    return (
      <>
        <Heading title="Security & Privacy" copy="How CentsAI protects financial data and controls actions." />
        <div className="security-list">
          {[
            ["Permission tiers", "3 roles", "Viewer: read-only · Finance Manager: prepare + limited approval · Owner: approve any amount."],
            ["Human approval", "Enforced", "Payments, PayPal sends, reminders and cancellations require approval; the agent can only prepare them."],
            ["Verify before record", "Enforced", "Ledger entries from PayPal are created only after a status check returns PAID."],
            ["Duplicate protection", "Idempotency keys", "One open request per action and record; repeated submissions are blocked."],
            ["Credentials", "Backend only", "PayPal client secret is never sent to the browser (backend phase)."],
            ["AI grounding", "Deterministic tools", "Numbers come from the finance engine; the AI explains and never invents figures."],
            ["Audit trail", `${state.audit.length} events`, "Requests, approvals, API results and edits are logged and exportable."],
          ].map(([a, b, c]) => (
            <div key={a}>
              <ShieldCheck size={17} />
              <span>
                <strong>{a}</strong>
                <small>{c}</small>
              </span>
              <Badge tone="green">{b}</Badge>
            </div>
          ))}
        </div>
      </>
    )

  return <DataManagement />
}

function Integrations() {
  const { state, log, toast, mode, paypalMode, paypalEnvironment, checkPayPalStatus } = useStore()
  const [checking, setChecking] = useState(false)
  const paypalInvoices = state.invoices.filter((i) => i.paypal)
  const lastCheck = paypalInvoices.map((i) => i.paypal!.lastCheckedAt ?? "").sort().pop()
  return (
    <>
      <Heading title="Integrations" copy="Data sources and payment connections." />
      <div className="integration-cards">
        <div>
          <div className="integration-icon">
            <span>P</span>
          </div>
          <div>
            <strong>PayPal Invoicing</strong>
            <small>{mode === "hosted" ? (paypalMode === "fake" ? "Backend fake adapter" : `PayPal ${paypalEnvironment}`) : PAYPAL_MODE}</small>
          </div>
          <Badge tone={mode === "hosted" && paypalMode === "fake" ? "neutral" : "amber"}>{mode === "hosted" ? (paypalMode === "fake" ? "Fake" : paypalEnvironment) : "Sandbox"}</Badge>
          <p>
            {paypalInvoices.length} invoices linked · last status check {lastCheck ? fmtStamp(lastCheck) : "never"}. USD invoices only; ledger updates after verification.
          </p>
          <Button
            icon={RefreshCw}
            disabled={checking}
            onClick={async () => {
              setChecking(true)
              const open = paypalInvoices.filter((i) => i.status === "Sent")
              if (mode === "hosted") {
                const results = await Promise.all(open.map((invoice) => checkPayPalStatus(invoice.id)))
                setChecking(false)
                toast(results.length ? results.map((result) => result.message).join(" · ") : "No sent PayPal invoices to verify.")
                return
              }
              const results = await Promise.all(open.map((i) => paypalSandbox.getStatus(i.paypal!)))
              setChecking(false)
              log({ actor: "PayPal Sandbox", action: "Connection test", detail: `${open.length} open invoices checked: ${results.join(", ") || "none"}`, outcome: "success" })
              toast(`Sandbox reachable · ${open.length} open invoice statuses read`)
            }}
          >
            {checking ? "Checking…" : mode === "hosted" ? "Verify open invoice statuses" : "Test connection"}
          </Button>
        </div>
        <div>
          <div className="integration-icon">
            <Upload size={17} />
          </div>
          <div>
            <strong>CSV Import</strong>
            <small>Bank & accounting exports</small>
          </div>
          <Badge tone="green">Available</Badge>
          <p>Column mapping, date-format detection, validation and duplicate checks. Source is kept on every record.</p>
          <Button onClick={() => (window.location.hash = "#/app/transactions")}>Open transactions</Button>
        </div>
        <div>
          <div className="integration-icon">
            <Bot size={17} />
          </div>
          <div>
            <strong>AI model</strong>
            <small>Copilot reasoning layer</small>
          </div>
          <Badge tone="blue">Rule-based</Badge>
          <p>The prototype agent routes questions to finance tools. An LLM with tool calling replaces the router in the backend phase.</p>
          <Button disabled>No model connection</Button>
        </div>
        <div>
          <div className="integration-icon">
            <Landmark size={17} />
          </div>
          <div>
            <strong>Bank feeds</strong>
            <small>Automatic transactions</small>
          </div>
          <Badge tone="neutral">Not connected</Badge>
          <p>No live bank connection. Import CSV statements instead.</p>
          <Button disabled>Coming later</Button>
        </div>
      </div>
    </>
  )
}

function DataManagement() {
  const { state, reset, toast, can, mode, exportAuditCsv } = useStore()
  const [confirm, setConfirm] = useState(false)
  const [resetCode, setResetCode] = useState("")
  const isOwner = state.settings.role === "Owner"
  const showReset = mode === "demo" || isOwner

  const exportAudit = async () => {
    try {
      download("centsai-audit-log.csv", await exportAuditCsv(), "text/csv")
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : "Audit export failed.")
    }
  }
  const exports: [string, string, () => void][] = [
    ["Transactions", "Ledger entries as CSV", () => download("centsai-transactions.csv", toCsv([["id", "date", "description", "party", "category", "type", "amount_inr", "status", "source", "reference"], ...state.transactions.map((t) => [t.id, t.date, t.description, t.party, t.category, t.type, t.amount, t.status, t.source, t.reference])]))],
    ["Invoices", "All client invoices as CSV", () => download("centsai-invoices.csv", toCsv([["id", "client", "issue_date", "due_date", "currency", "amount", "status", "channel", "paypal_id"], ...state.invoices.map((i) => [i.id, clientOf(state, i.clientId).name, i.issueDate, i.dueDate, i.currency, invoiceTotal(i), i.status, i.channel, i.paypal?.invoiceId])]))],
    ["Audit log", "Approvals, API results and edits", () => { void exportAudit() }],
    ["Full workspace", "Everything as JSON (backend seed)", () => download("centsai-workspace.json", JSON.stringify(state, null, 2), "application/json")],
  ]
  return (
    <>
      <Heading title="Data Management" copy="Export your records or reset the demonstration workspace." />
      <div className="data-actions">
        {exports.map(([a, b, fn]) => (
          <div key={a}>
            <div>
              <strong>{a}</strong>
              <small>{b}</small>
            </div>
            <Button icon={Download} onClick={fn}>
              Export
            </Button>
          </div>
        ))}
      </div>
      {showReset && (
        <div className="danger-zone">
          <div>
            <strong>Reset demonstration data</strong>
            <p>{mode === "hosted" ? "Wipes the shared demonstration workspace for the whole team and restores sample records. PayPal-linked invoices stay in the PayPal sandbox." : "Restores the sample agency, dated relative to today. Your local changes, approvals and chat history are removed."}</p>
          </div>
          <Button variant="danger" disabled={!can.edit} onClick={() => { setResetCode(""); setConfirm(true) }}>
            Reset demo data
          </Button>
        </div>
      )}
      {confirm && (
        <Modal onClose={() => setConfirm(false)}>
          <div className="modal-icon">
            <AlertTriangle size={22} />
          </div>
          <Title level={2}>Reset demonstration data?</Title>
          <p>
            {mode === "hosted"
              ? "This affects every teammate using this shared workspace. PayPal-linked invoices remain in the PayPal sandbox. All local changes are replaced with fresh sample records."
              : "All local changes are replaced with fresh sample records."}
          </p>
          {mode === "hosted" && (
            <Field label="Type RESET to confirm" full>
              <Input
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value)}
                placeholder="RESET"
                autoFocus
              />
            </Field>
          )}
          <div className="modal-actions">
            <Button onClick={() => setConfirm(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={mode === "hosted" && resetCode !== "RESET"}
              onClick={async () => {
                try {
                  await reset()
                  setConfirm(false)
                  toast(mode === "hosted" ? "Workspace reset" : "Demonstration data reset")
                } catch (cause) {
                  toast(cause instanceof Error ? cause.message : "Reset failed.")
                }
              }}
            >
              Reset data
            </Button>
          </div>
        </Modal>
      )}
    </>
  )
}
