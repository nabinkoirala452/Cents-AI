import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { api, ApiError, clearApiSession, getApiSession, hostedMode, saveApiSession, SESSION_EXPIRED_EVENT, subscribePendingRequests } from "./api"
import { todayISO } from "./dates"
import { draftReminder, type ReminderTone } from "./drafts"
import { toCsv } from "./csv"
import { clientOf, findDuplicate, invoiceTotal } from "./finance"
import { money, uid } from "./format"
import { paypalEligibility, paypalSandbox } from "./paypal"
import { createSeed, emptyState, STATE_VERSION } from "./seed"
import type { Approval, AuditEvent, Client, ContractorBill, Employee, Invoice, Loan, LoanOffer, Project, RecurringCost, Role, SavedScenario, Settings, State, Transaction } from "./types"

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
  approve: (amount: number) =>
    s.role === "Owner" || (s.role === "Finance Manager" && amount <= s.managerApprovalLimit),
})

export const actorName = (s: Settings) =>
  s.team.find((m) => m.role === s.role)?.name ?? (s.role === "Owner" ? s.ownerName : s.role)

export const ROLE_TIERS: { role: Role; tier: string; detail: string }[] = [
  { role: "Viewer", tier: "Read-only analysis", detail: "View dashboards, forecasts and copilot answers. Cannot prepare or approve actions." },
  { role: "Finance Manager", tier: "Prepare & limited approval", detail: "Record data and prepare actions. Approves up to the configured limit." },
  { role: "Owner", tier: "Execute with approval", detail: "Approves any amount. Every execution is verified and logged." },
]

type Result = { ok: boolean; message: string }
type WorkspacePatch = Parameters<typeof api.patchWorkspace>[0]
type SettingsPatch = Parameters<typeof api.patchSettings>[0]

export async function runHostedMutation<T>(
  operation: () => Promise<T>,
  refresh: () => Promise<void>,
  message: (value: T) => string = () => "Saved.",
): Promise<Result> {
  try {
    const value = await operation()
    await refresh()
    return { ok: true, message: message(value) }
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? cause.message : "The requested change could not be saved.",
    }
  }
}

type Store = {
  state: State
  mode: "demo" | "hosted"
  initialLoading: boolean
  loadError: string
  authMessage: string
  authenticated: boolean
  signedInName: string
  paypalMode: "sandbox" | "fake"
  paypalEnvironment: "sandbox" | "live"
  refresh: () => Promise<void>
  login: (email: string, password: string) => Promise<void>
  signOut: () => void
  today: string
  update: (mutate: (draft: State) => void) => Promise<void>
  updateWorkspace: (patch: WorkspacePatch) => Promise<Result>
  updateSettings: (patch: SettingsPatch) => Promise<Result>
  saveAssumptions: (safetyThreshold: number, invoiceOverrides: Array<{ id: string; expectedDelayOverride: number | null }>) => Promise<Result>
  dismissInsight: (id: string) => Promise<Result>
  restoreInsights: () => Promise<Result>
  addClient: (client: Omit<Client, "id">) => Promise<Result>
  patchClient: (id: string, patch: Partial<Client>) => Promise<Result>
  addProject: (project: Omit<Project, "id">) => Promise<Result>
  assignHours: (projectId: string, employeeId: string, hours: number) => Promise<Result>
  addEmployee: (employee: Omit<Employee, "id">) => Promise<Result>
  patchEmployee: (id: string, patch: Partial<Employee>) => Promise<Result>
  removeEmployee: (id: string) => Promise<Result>
  addContractorBill: (bill: Omit<ContractorBill, "id">) => Promise<Result>
  addRecurringCost: (cost: Omit<RecurringCost, "id">) => Promise<Result>
  patchRecurringCost: (id: string, patch: Partial<RecurringCost>) => Promise<Result>
  markRecurringReviewed: (id: string) => Promise<Result>
  addLoan: (loan: Omit<Loan, "id">) => Promise<Result>
  patchLoan: (id: string, patch: Partial<Loan>) => Promise<Result>
  addOffer: (offer: Omit<LoanOffer, "id">) => Promise<Result>
  removeOffer: (id: string) => Promise<Result>
  saveScenario: (scenario: Omit<SavedScenario, "id">) => Promise<Result>
  deleteScenario: (id: string) => Promise<Result>
  confirmTransaction: (id: string) => Promise<Result>
  patchTransaction: (id: string, patch: Partial<Transaction>) => Promise<Result>
  deleteTransaction: (id: string) => Promise<Result>
  patchInvoice: (id: string, patch: Partial<Pick<Invoice, "clientId" | "projectId" | "kind" | "issueDate" | "dueDate" | "lineItems" | "channel" | "expectedDelayOverride" | "notes">>) => Promise<Result>
  deleteInvoice: (id: string) => Promise<Result>
  log: (event: Omit<AuditEvent, "id" | "at">) => Promise<void>
  toast: (message: string) => void
  toastMessage: string
  clearToast: () => void
  reset: () => Promise<void>
  can: ReturnType<typeof permissions>
  actor: string
  pendingRequests: number
  highlightedId: string | null
  setHighlightedId: (id: string | null) => void
  addTransaction: (t: Omit<Transaction, "id" | "status"> & { status?: Transaction["status"] }, idempotencyKey?: string) => Promise<Transaction>
  importTransactions: (fileName: string, rows: unknown[], skipDuplicates: boolean) => Promise<{ imported: number; duplicates: number; invalid: number }>
  createInvoice: (invoice: Invoice, idempotencyKey?: string) => Promise<string>
  exportAuditCsv: () => Promise<string>
  requestApproval: (a: Omit<Approval, "id" | "requestedAt" | "status" | "idempotencyKey" | "preparedBy"> & { preparedBy?: string }, approveNow?: boolean, idempotencyKey?: string) => Promise<Result>
  prepareReminder: (invoiceId: string, opts?: { tone?: ReminderTone; preparedBy?: string; draft?: string; approveNow?: boolean }, idempotencyKey?: string) => Promise<Result>
  requestPayPalSend: (invoiceId: string, approveNow?: boolean, idempotencyKey?: string) => Promise<Result>
  requestContractorPayment: (billId: string, approveNow?: boolean, idempotencyKey?: string) => Promise<Result>
  requestCancelSubscription: (recurringId: string, approveNow?: boolean, idempotencyKey?: string) => Promise<Result>
  approve: (approvalId: string) => Promise<Result>
  reject: (approvalId: string, reason: string) => Promise<Result>
  confirmContractorPayment: (approvalId: string, reference: string) => Promise<Result>
  checkPayPalStatus: (invoiceId: string) => Promise<Result>
  simulatePayerPayment: (invoiceId: string) => void
  recordManualPayment: (invoiceId: string, date: string, reference: string) => Promise<Result>
  markSentManually: (invoiceId: string) => Promise<Result>
}

const StoreContext = createContext<Store | null>(null)

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>(() => hostedMode ? emptyState() : load())
  const stateRef = useRef(state)
  stateRef.current = state
  const [initialLoading, setInitialLoading] = useState(() => {
    if (!hostedMode) return false
    try {
      return Boolean(getApiSession())
    } catch {
      return false
    }
  })
  const [loadError, setLoadError] = useState("")
  const [authMessage, setAuthMessage] = useState("")
  const [authenticated, setAuthenticated] = useState(!hostedMode)
  const [signedInName, setSignedInName] = useState(() => {
    try {
      return getApiSession()?.userName ?? ""
    } catch {
      return ""
    }
  })
  const hasHydrated = useRef(false)
  const healthRequest = useRef<Promise<Awaited<ReturnType<typeof api.health>>> | null>(null)
  const [paypalMode, setPaypalMode] = useState<"sandbox" | "fake">("fake")
  const [paypalEnvironment, setPaypalEnvironment] = useState<"sandbox" | "live">("sandbox")
  const [toastMessage, setToastMessage] = useState("")
  const toastTimer = useRef<number | undefined>(undefined)
  const [pendingRequests, setPendingRequests] = useState(0)
  const [highlightedId, setHighlightedIdState] = useState<string | null>(null)
  const highlightTimer = useRef<number | undefined>(undefined)

  const setHighlightedId = useCallback((id: string | null) => {
    setHighlightedIdState(id)
    if (highlightTimer.current !== undefined) {
      window.clearTimeout(highlightTimer.current)
    }
    if (id) {
      highlightTimer.current = window.setTimeout(() => {
        setHighlightedIdState((curr) => (curr === id ? null : curr))
      }, 2000)
    }
  }, [])

  useEffect(() => {
    return subscribePendingRequests(setPendingRequests)
  }, [])

  const today = todayISO()

  useEffect(() => {
    if (hostedMode) return
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
      /* quota or privacy mode — state stays in memory */
    }
  }, [state])

  const refresh = useCallback(async () => {
    if (!hostedMode) return
    let session: ReturnType<typeof getApiSession>
    try {
      session = getApiSession()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Browser session storage is unavailable."
      setLoadError(message)
      throw cause
    }
    if (!session) {
      setAuthenticated(false)
      stateRef.current = emptyState()
      setState(stateRef.current)
      setInitialLoading(false)
      setLoadError("")
      return
    }
    setAuthenticated(true)
    try {
      setSignedInName(session.userName ?? "")
      if (!healthRequest.current) {
        healthRequest.current = api.health().catch((cause: unknown) => {
          healthRequest.current = null
          throw cause
        })
      }
      const [workspace, health] = await Promise.all([api.workspaceState(), healthRequest.current])
      const refreshed = { ...workspace, chat: stateRef.current.chat }
      stateRef.current = refreshed
      setState(refreshed)
      if (health.paypalMode) setPaypalMode(health.paypalMode)
      if (health.paypalEnvironment) setPaypalEnvironment(health.paypalEnvironment)
      hasHydrated.current = true
      setInitialLoading(false)
      setLoadError("")
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) return
      const message = cause instanceof Error ? cause.message : "The workspace could not be loaded."
      setLoadError(message)
      throw cause
    }
  }, [])

  useEffect(() => {
    if (hostedMode) void refresh().catch(() => undefined)
  }, [refresh])

  useEffect(() => {
    const onSessionExpired = () => {
      stateRef.current = emptyState()
      setState(stateRef.current)
      setAuthenticated(false)
      setSignedInName("")
      setInitialLoading(false)
      setLoadError("")
      setAuthMessage("Your session expired. Sign in again.")
    }
    globalThis.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
    return () => globalThis.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const response = await api.login(email, password)
    const membership = response.workspaces[0]
    if (!membership) throw new ApiError("This account is not a member of a workspace.")
    saveApiSession({ token: response.token, workspaceId: membership.id, userName: response.user.name })
    setSignedInName(response.user.name)
    setAuthMessage("")
    setLoadError("")
    if (!hasHydrated.current) setInitialLoading(true)
    setAuthenticated(true)
    await refresh()
  }, [refresh])

  const signOut = useCallback(() => {
    if (hostedMode) clearApiSession()
    setAuthenticated(!hostedMode)
    setAuthMessage("")
    setLoadError("")
    setInitialLoading(false)
    setSignedInName("")
    if (hostedMode) {
      hasHydrated.current = false
      stateRef.current = emptyState()
      setState(stateRef.current)
    }
  }, [])

  const update = useCallback((mutate: (draft: State) => void): Promise<void> => {
    const current = stateRef.current
    const draft = structuredClone(current)
    mutate(draft)
    if (!hostedMode) {
      stateRef.current = draft
      setState(draft)
      return Promise.resolve()
    }
    const withoutChat = structuredClone(draft)
    withoutChat.chat = current.chat
    if (JSON.stringify(current) !== JSON.stringify(withoutChat)) {
      throw new ApiError("Use a hosted workspace action to save financial or workspace data.")
    }
    stateRef.current = draft
    setState(draft)
    return Promise.resolve()
  }, [])

  const toast = useCallback((message: string) => {
    setToastMessage(message)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMessage(""), 4000)
  }, [])

  const log = useCallback(
    (event: Omit<AuditEvent, "id" | "at">) => {
      if (hostedMode) return Promise.resolve()
      return update((d) => {
        d.audit.unshift({ id: uid("AU"), at: new Date().toISOString(), ...event })
      })
    },
    [update],
  )

  const store = useMemo<Store>(() => {
    const s = state.settings
    const can = permissions(s)
    const actor = hostedMode && signedInName ? signedInName : actorName(s)
    const fresh = () => stateRef.current
    const hostedMutation = <T,>(operation: () => Promise<T>, message: (value: T) => string): Promise<Result> =>
      runHostedMutation(operation, refresh, message)
    const demoOk = (fn: () => Promise<void>, message = "Saved."): Promise<Result> =>
      fn().then(() => ({ ok: true, message }))

    const updateWorkspace: Store["updateWorkspace"] = (patch) => hostedMode
      ? hostedMutation(() => api.patchWorkspace(patch), () => "Workspace profile saved.")
      : demoOk(() => update((draft) => Object.assign(draft.settings, patch)), "Workspace profile saved.")

    const updateSettings: Store["updateSettings"] = (patch) => hostedMode
      ? hostedMutation(() => api.patchSettings(patch), () => "Settings saved.")
      : demoOk(() => update((draft) => Object.assign(draft.settings, patch)), "Settings saved.")

    const saveAssumptions: Store["saveAssumptions"] = (safetyThreshold, invoiceOverrides) => hostedMode
      ? hostedMutation(
          () => api.saveAssumptions(safetyThreshold, invoiceOverrides),
          () => "Forecast assumptions saved.",
        )
      : demoOk(() => update((draft) => {
          draft.settings.safetyThreshold = safetyThreshold
          for (const item of invoiceOverrides) {
            const invoice = draft.invoices.find((candidate) => candidate.id === item.id)
            if (invoice) invoice.expectedDelayOverride = item.expectedDelayOverride ?? undefined
          }
        }), "Forecast assumptions saved.")

    const dismissInsight: Store["dismissInsight"] = (id) => hostedMode
      ? hostedMutation(
          () => api.replaceDismissedInsights([...new Set([...fresh().dismissedInsights, id])]),
          () => "Insight dismissed.",
        )
      : demoOk(() => update((draft) => {
          if (!draft.dismissedInsights.includes(id)) draft.dismissedInsights.push(id)
        }), "Insight dismissed.")

    const restoreInsights: Store["restoreInsights"] = () => hostedMode
      ? hostedMutation(() => api.replaceDismissedInsights([]), () => "Dismissed insights restored.")
      : demoOk(() => update((draft) => { draft.dismissedInsights = [] }), "Dismissed insights restored.")

    const addClient: Store["addClient"] = (client) => hostedMode
      ? hostedMutation(() => api.createClient(client), (created) => `${created.name} added.`)
      : demoOk(() => update((draft) => { draft.clients.push({ ...client, id: uid("C") }) }), `${client.name} added.`)

    const patchClient: Store["patchClient"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchClient(id, patch), (updated) => `${updated.name} saved.`)
      : demoOk(() => update((draft) => {
          const target = draft.clients.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Client saved.")

    const addProject: Store["addProject"] = (project) => hostedMode
      ? hostedMutation(() => api.createProject(project), (created) => `${created.name} added.`)
      : demoOk(() => update((draft) => { draft.projects.push({ ...project, id: uid("P") }) }), `${project.name} added.`)

    const assignHours: Store["assignHours"] = (projectId, employeeId, hours) => hostedMode
      ? hostedMutation(
          () => api.addProjectTimeEntry(projectId, employeeId, hours),
          () => `${hours}h assigned.`,
        )
      : demoOk(() => update((draft) => {
          const project = draft.projects.find((item) => item.id === projectId)
          if (!project) return
          const existing = project.timeEntries.find((entry) => entry.employeeId === employeeId)
          if (existing) existing.hours += hours
          else project.timeEntries.push({ employeeId, hours })
          project.unassignedHours = Math.max(0, project.unassignedHours - hours)
        }), `${hours}h assigned.`)

    const addEmployee: Store["addEmployee"] = (employee) => hostedMode
      ? hostedMutation(() => api.createEmployee(employee), (created) => `${created.name} added.`)
      : demoOk(() => update((draft) => { draft.employees.push({ ...employee, id: uid("E") }) }), `${employee.name} added.`)

    const patchEmployee: Store["patchEmployee"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchEmployee(id, patch), () => "Employee saved.")
      : demoOk(() => update((draft) => {
          const target = draft.employees.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Employee saved.")

    const removeEmployee: Store["removeEmployee"] = (id) => hostedMode
      ? hostedMutation(() => api.deleteEmployee(id), () => "Employee removed.")
      : demoOk(() => update((draft) => { draft.employees = draft.employees.filter((item) => item.id !== id) }), "Employee removed.")

    const addContractorBill: Store["addContractorBill"] = (bill) => hostedMode
      ? hostedMutation(() => api.createContractorBill(bill), (created) => `${created.vendor} bill added.`)
      : demoOk(() => update((draft) => { draft.contractorBills.push({ ...bill, id: uid("CB") }) }), `${bill.vendor} bill added.`)

    const addRecurringCost: Store["addRecurringCost"] = (cost) => hostedMode
      ? hostedMutation(() => api.createRecurringCost(cost), (created) => `${created.vendor} added.`)
      : demoOk(() => update((draft) => { draft.recurring.push({ ...cost, id: uid("RC") }) }), `${cost.vendor} added.`)

    const patchRecurringCost: Store["patchRecurringCost"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchRecurringCost(id, patch), () => "Recurring cost saved.")
      : demoOk(() => update((draft) => {
          const target = draft.recurring.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Recurring cost saved.")

    const markRecurringReviewed: Store["markRecurringReviewed"] = (id) => hostedMode
      ? hostedMutation(() => api.reviewRecurringCost(id), () => "Recurring cost marked as reviewed.")
      : demoOk(() => update((draft) => {
          const target = draft.recurring.find((item) => item.id === id)
          if (target) {
            target.reviewed = true
            if (target.status === "Review") target.status = "Active"
          }
        }), "Recurring cost marked as reviewed.")

    const addLoan: Store["addLoan"] = (loan) => hostedMode
      ? hostedMutation(() => api.createLoan(loan), (created) => `${created.name} added.`)
      : demoOk(() => update((draft) => { draft.loans.push({ ...loan, id: uid("LN") }) }), `${loan.name} added.`)

    const patchLoan: Store["patchLoan"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchLoan(id, patch), () => "Loan saved.")
      : demoOk(() => update((draft) => {
          const target = draft.loans.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Loan saved.")

    const addOffer: Store["addOffer"] = (offer) => hostedMode
      ? hostedMutation(() => api.createOffer(offer), (created) => `${created.name} added.`)
      : demoOk(() => update((draft) => { draft.offers.push({ ...offer, id: uid("OF") }) }), `${offer.name} added.`)

    const removeOffer: Store["removeOffer"] = (id) => hostedMode
      ? hostedMutation(() => api.deleteOffer(id), () => "Offer removed.")
      : demoOk(() => update((draft) => { draft.offers = draft.offers.filter((item) => item.id !== id) }), "Offer removed.")

    const saveScenario: Store["saveScenario"] = (scenario) => hostedMode
      ? hostedMutation(() => api.createScenario(scenario), (created) => `${created.name} saved.`)
      : demoOk(() => update((draft) => { draft.scenarios.unshift({ ...scenario, id: uid("SC") }) }), `${scenario.name} saved.`)

    const deleteScenario: Store["deleteScenario"] = (id) => hostedMode
      ? hostedMutation(() => api.deleteScenario(id), () => "Scenario deleted.")
      : demoOk(() => update((draft) => { draft.scenarios = draft.scenarios.filter((item) => item.id !== id) }), "Scenario deleted.")

    const confirmTransaction: Store["confirmTransaction"] = (id) => hostedMode
      ? hostedMutation(() => api.patchTransaction(id, { status: "Recorded" }), () => "Transaction confirmed as recorded.")
      : demoOk(() => update((draft) => {
          const target = draft.transactions.find((item) => item.id === id)
          if (target) {
            target.status = "Recorded"
            target.reviewReason = undefined
          }
        }), "Transaction confirmed as recorded.")

    const patchTransaction: Store["patchTransaction"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchTransaction(id, patch), () => "Transaction saved.")
      : demoOk(() => update((draft) => {
          const target = draft.transactions.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Transaction saved.")

    const deleteTransaction: Store["deleteTransaction"] = (id) => hostedMode
      ? hostedMutation(() => api.deleteTransaction(id), () => "Transaction deleted.")
      : demoOk(() => update((draft) => { draft.transactions = draft.transactions.filter((item) => item.id !== id) }), "Transaction deleted.")

    const patchInvoice: Store["patchInvoice"] = (id, patch) => hostedMode
      ? hostedMutation(() => api.patchInvoice(id, patch), () => "Invoice saved.")
      : demoOk(() => update((draft) => {
          const target = draft.invoices.find((item) => item.id === id)
          if (target) Object.assign(target, patch)
        }), "Invoice saved.")

    const deleteInvoice: Store["deleteInvoice"] = (id) => hostedMode
      ? hostedMutation(() => api.deleteInvoice(id), () => "Invoice deleted.")
      : demoOk(() => update((draft) => { draft.invoices = draft.invoices.filter((item) => item.id !== id) }), "Invoice deleted.")

    const addTransaction: Store["addTransaction"] = async (t, idempotencyKey?: string) => {
      if (hostedMode) {
        const record = await api.createTransaction({
          date: t.date,
          description: t.description,
          party: t.party,
          category: t.category,
          projectId: t.projectId,
          type: t.type,
          amount: t.amount,
          reference: t.reference,
          notes: t.notes,
        }, idempotencyKey)
        await refresh()
        setHighlightedId(record.id)
        return record
      }
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
      setHighlightedId(record.id)
      return record
    }

    const importTransactions: Store["importTransactions"] = async (fileName, rows, skipDuplicates) => {
      if (!hostedMode) throw new ApiError("Use the local demo import flow in demo mode.")
      const result = await api.importTransactions(fileName, rows, skipDuplicates)
      await refresh()
      return result
    }

    const createInvoice: Store["createInvoice"] = async (invoice, idempotencyKey) => {
      if (hostedMode) {
        const created = await api.createInvoice({
          clientId: invoice.clientId,
          projectId: invoice.projectId,
          kind: invoice.kind,
          issueDate: invoice.issueDate,
          dueDate: invoice.dueDate,
          lineItems: invoice.lineItems,
          channel: invoice.channel,
          notes: invoice.notes,
        }, idempotencyKey)
        await refresh()
        setHighlightedId(created.id)
        return created.id
      }
      await update((draft) => draft.invoices.unshift(invoice))
      setHighlightedId(invoice.id)
      return invoice.id
    }

    const exportAuditCsv: Store["exportAuditCsv"] = async () => hostedMode
      ? api.exportAudit()
      : toCsv([["timestamp", "actor", "action", "detail", "reference", "outcome"],
        ...fresh().audit.map((event) => [event.at, event.actor, event.action, event.detail, event.ref, event.outcome])])

    const requestApproval: Store["requestApproval"] = async (a, approveNow?: boolean, idempotencyKey?: string) => {
      if (hostedMode) {
        return hostedMutation(
          () => api.createApproval(a.kind, a.refId, a.draft, approveNow, idempotencyKey),
          (approval) => {
            setHighlightedId(approval.id)
            return approval.status === "Verified" || approval.status === "Submitted"
              ? `${approval.id} approved and executed`
              : "Sent to Owner for approval"
          },
        )
      }
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
        idempotencyKey: idempotencyKey ?? `${a.kind.split("_")[0]}-${a.refId}-${String(attempt).padStart(3, "0")}`,
      }
      update((d) => {
        d.approvals.unshift(approval)
      })
      setHighlightedId(approval.id)
      log({ actor: preparedBy, action: "Approval requested", detail: `${approval.title} · ${money(approval.amount, approval.currency)}`, ref: approval.id, outcome: "info" })
      if (approveNow && s.role === "Owner") {
        return approve(approval.id)
      }
      return { ok: true, message: s.role === "Owner" ? `${approval.id} added to the approval queue` : "Sent to Owner for approval" }
    }

    const prepareReminder: Store["prepareReminder"] = async (invoiceId, opts = {}, idempotencyKey?: string) => {
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
        refId: inv.id,
        preparedBy: opts.preparedBy,
        draft: opts.draft ?? draftReminder(inv, client, st.settings, today, opts.tone),
        steps: inv.paypal
          ? [`Send a PayPal reminder for ${inv.paypal.invoiceId}`, "Log the reminder on the invoice timeline", "Forecast keeps the receipt uncertain until payment is verified"]
          : [`Copy the reminder for ${client.email}`, "Log the reminder on the invoice timeline", "Forecast keeps the receipt uncertain until payment is recorded"],
      }, opts.approveNow, idempotencyKey)
    }

    const requestPayPalSend: Store["requestPayPalSend"] = async (invoiceId, approveNow?: boolean, idempotencyKey?: string) => {
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
        refId: inv.id,
        steps: ["Create the invoice in PayPal Sandbox", `Send it to ${client.email}`, "Verify PayPal reports status SENT before marking it sent"],
      }, approveNow, idempotencyKey)
    }

    const requestContractorPayment: Store["requestContractorPayment"] = async (billId, approveNow?: boolean, idempotencyKey?: string) => {
      const bill = fresh().contractorBills.find((b) => b.id === billId)
      if (!bill || bill.status === "Paid") return { ok: false, message: "This bill is already paid." }
      return requestApproval({
        kind: "record_contractor_payment",
        title: `Pay contractor invoice · ${bill.reference}`,
        recipient: bill.vendor,
        amount: bill.amount,
        currency: fresh().settings.currency,
        refId: bill.id,
        steps: [`Owner transfers ${money(bill.amount)} from the agency bank account`, "Confirm the transfer reference in CentsAI", "Ledger records the expense only after confirmation"],
      }, approveNow, idempotencyKey)
    }

    const requestCancelSubscription: Store["requestCancelSubscription"] = async (recurringId, approveNow?: boolean, idempotencyKey?: string) => {
      const r = fresh().recurring.find((x) => x.id === recurringId)
      if (!r) return { ok: false, message: "Subscription not found" }
      return requestApproval({
        kind: "cancel_subscription",
        title: `Cancel subscription · ${r.vendor}`,
        recipient: r.vendor,
        amount: r.amount,
        currency: fresh().settings.currency,
        refId: r.id,
        steps: ["Stop the recurring cost from the next renewal in the forecast", "Owner cancels with the vendor (no vendor integration)", "Log the decision"],
      }, approveNow, idempotencyKey)
    }

    const setApproval = (id: string, patch: Partial<Approval>) =>
      update((d) => {
        const a = d.approvals.find((x) => x.id === id)
        if (a) Object.assign(a, patch)
      })

    const approve: Store["approve"] = async (id) => {
      setHighlightedId(id)
      if (hostedMode) {
        return hostedMutation(
          () => api.approve(id),
          (approval) => approval.result ?? `Approval ${approval.status.toLowerCase()}`,
        )
      }
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Pending") return { ok: false, message: "This request is no longer pending." }
      if (s.role !== "Owner" && (a.preparedBy === actor)) {
        return { ok: false, message: "Finance Managers cannot approve requests they prepared themselves." }
      }
      if (!can.approve(a.amount)) {
        const message =
          s.role === "Viewer"
            ? "Viewers cannot approve actions."
            : `${money(a.amount, a.currency)} exceeds the ${money(s.managerApprovalLimit, s.currency)} Finance Manager limit — Owner approval required.`
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
          let channel = "Email draft (not sent)"
          if (inv.paypal) {
            const res = await paypalSandbox.remind(inv.paypal)
            if (!res.ok) throw new Error("PayPal rejected the reminder")
            channel = "PayPal reminder (PayPal emailed client)"
          }
          update((d) => {
            d.invoices.find((i) => i.id === a.refId)?.reminders.push({ date: today, channel, note: `Approved by ${actor}` })
          })
          const result = inv.paypal ? "PayPal accepted the reminder" : "Email draft saved (CentsAI doesn't send email in this prototype)"
          setApproval(id, { status: "Verified", result })
          log({ actor: inv.paypal ? "PayPal Sandbox" : actor, action: "Reminder recorded", detail: `${a.refId} · ${channel}`, ref: a.refId, outcome: "success" })
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

    const reject: Store["reject"] = async (id, reason) => {
      setHighlightedId(id)
      if (hostedMode) {
        return hostedMutation(() => api.reject(id, reason || "No reason given"), () => `${id} rejected`)
      }
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Pending") return { ok: false, message: "Not pending" }
      if (!can.prepare) return { ok: false, message: "Viewers cannot reject actions." }
      setApproval(id, { status: "Rejected", decidedBy: actor, decidedAt: new Date().toISOString(), note: reason || "No reason given" })
      log({ actor, action: "Rejected", detail: `${a.title}${reason ? ` — ${reason}` : ""}`, ref: a.id, outcome: "warning" })
      return { ok: true, message: `${a.id} rejected` }
    }

    const confirmContractorPayment: Store["confirmContractorPayment"] = async (id, reference) => {
      setHighlightedId(id)
      if (hostedMode) {
        return hostedMutation(() => api.confirmTransfer(id, reference), () => "Payment recorded in the ledger")
      }
      const a = fresh().approvals.find((x) => x.id === id)
      if (!a || a.status !== "Submitted" || !reference.trim()) return { ok: false, message: "Enter the bank transfer reference." }
      const bill = fresh().contractorBills.find((b) => b.id === a.refId)!
      update((d) => {
        const b = d.contractorBills.find((x) => x.id === a.refId)!
        b.status = "Paid"
        b.paidDate = today
      })
      await addTransaction({ date: today, description: `Contractor invoice ${bill.reference}`, party: bill.vendor, category: "Contractors", projectId: bill.projectId, type: "Expense", amount: bill.amount, source: "Manual", reference, status: "Verified" })
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
      if (hostedMode) {
        return hostedMutation(
          () => api.syncPayPalInvoice(invoiceId),
          (response) => {
            const status = response.status ?? fresh().invoices.find((item) => item.id === invoiceId)?.paypal?.status
            return response.paid
              ? `${invoiceId} verified as PAID — ledger updated`
              : response.warning
                ? response.warning
              : `PayPal status: ${status ?? "checked"}. Not recorded as paid.`
          },
        )
      }
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
        addTransaction({ date: today, description: `Payment · ${inv.id}`, party: clientOf(st, inv.clientId).name, category: inv.kind === "Retainer" ? "Retainer income" : "Project revenue", projectId: inv.projectId, type: "Income", amount: invoiceTotal(inv), source: "PayPal", invoiceId: inv.id, reference: inv.paypal.invoiceId, status: "Verified" })
        withdrawReminders(inv.id)
        log({ actor: "PayPal Sandbox", action: "Payment verified", detail: `${inv.id} reported PAID; ledger and forecast updated.`, ref: inv.id, outcome: "success" })
        return { ok: true, message: `${inv.id} verified as PAID — ledger updated` }
      }
      log({ actor: "PayPal Sandbox", action: "Status checked", detail: `${inv.id} is ${status}; receipt stays uncertain in the forecast.`, ref: inv.id, outcome: "info" })
      return { ok: true, message: `PayPal status: ${status}. Not recorded as paid.` }
    }

    const simulatePayerPayment: Store["simulatePayerPayment"] = (invoiceId) => {
      if (hostedMode) throw new ApiError("Payer-payment simulation is only available in demo mode.")
      update((d) => {
        const inv = d.invoices.find((i) => i.id === invoiceId)
        if (inv?.paypal) inv.paypal.payerPaid = true
      })
      log({ actor: "Sandbox payer", action: "Payer paid (simulation)", detail: `Test buyer completed payment for ${invoiceId}. Not yet verified.`, ref: invoiceId, outcome: "info" })
    }

    const recordManualPayment: Store["recordManualPayment"] = async (invoiceId, date, reference) => {
      if (hostedMode) {
        return hostedMutation(() => api.recordInvoicePayment(invoiceId, date, reference), () => `${invoiceId} marked paid and added to the ledger`)
      }
      const st = fresh()
      const inv = st.invoices.find((i) => i.id === invoiceId)
      if (!inv || inv.status !== "Sent") return { ok: false, message: "Only sent, unpaid invoices can be recorded as paid." }
      if (!reference.trim()) return { ok: false, message: "Enter the bank reference so the payment is traceable." }
      update((d) => {
        const target = d.invoices.find((i) => i.id === invoiceId)!
        target.status = "Paid"
        target.paidDate = date
      })
      addTransaction({ date, description: `Payment · ${inv.id}`, party: clientOf(st, inv.clientId).name, category: inv.kind === "Retainer" ? "Retainer income" : "Project revenue", projectId: inv.projectId, type: "Income", amount: invoiceTotal(inv), source: "Invoice payment", invoiceId: inv.id, reference, status: "Recorded" })
      withdrawReminders(inv.id)
      log({ actor, action: "Payment recorded", detail: `${inv.id} · ${money(invoiceTotal(inv), inv.currency)} · ref ${reference}`, ref: inv.id, outcome: "success" })
      return { ok: true, message: `${inv.id} marked paid and added to the ledger` }
    }

    const markSentManually: Store["markSentManually"] = async (invoiceId) => {
      if (hostedMode) {
        return hostedMutation(() => api.issueInvoice(invoiceId), () => `${invoiceId} is now open and included in the forecast`)
      }
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
      state, mode: hostedMode ? "hosted" : "demo", initialLoading, loadError, authMessage, authenticated,
      signedInName, paypalMode, paypalEnvironment, refresh, login, signOut,
      today, update, log, toast, toastMessage,
      pendingRequests, highlightedId, setHighlightedId,
      clearToast: () => setToastMessage(""),
      reset: async () => {
        if (hostedMode) {
          await api.resetDemo()
          await refresh()
          return
        }
        const seed = createSeed()
        setState(seed)
      },
      can, actor, updateWorkspace, updateSettings, saveAssumptions, dismissInsight, restoreInsights,
      addClient, patchClient, addProject, assignHours, addEmployee, patchEmployee, removeEmployee,
      addContractorBill, addRecurringCost, patchRecurringCost, markRecurringReviewed, addLoan, patchLoan,
      addOffer, removeOffer, saveScenario, deleteScenario, confirmTransaction, patchTransaction,
      deleteTransaction, patchInvoice, deleteInvoice,
      addTransaction, importTransactions, createInvoice, exportAuditCsv, requestApproval, prepareReminder, requestPayPalSend,
      requestContractorPayment, requestCancelSubscription, approve, reject, confirmContractorPayment,
      checkPayPalStatus, simulatePayerPayment, recordManualPayment, markSentManually,
    }
  }, [state, today, update, log, toast, toastMessage, initialLoading, loadError, authMessage, authenticated,
    signedInName, paypalMode, paypalEnvironment, refresh, login, signOut, pendingRequests, highlightedId, setHighlightedId])

  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>
}

export const useStore = () => {
  const store = useContext(StoreContext)
  if (!store) throw new Error("useStore must be used inside StoreProvider")
  return store
}
