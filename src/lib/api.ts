import type {
  Approval,
  AuditEvent,
  Client,
  ContractorBill,
  Employee,
  Invoice,
  Loan,
  LoanOffer,
  Project,
  RecurringCost,
  Role,
  SavedScenario,
  Settings,
  State,
  Transaction,
} from "./types"

const TOKEN_KEY = "centsai.api.token"
const WORKSPACE_KEY = "centsai.api.workspace"
const USER_NAME_KEY = "centsai.api.user-name"
const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "")
export const SESSION_EXPIRED_EVENT = "centsai:session-expired"

export type ApiSession = { token: string; workspaceId: string; userName?: string }
export type WorkspaceMembership = { id: string; name: string; role: Role }
export type LoginResponse = {
  token: string
  user: { id: string; name: string; email: string }
  workspaces: WorkspaceMembership[]
}
export type MeResponse = { user: LoginResponse["user"]; workspaces: WorkspaceMembership[] }
export type AuditPage = { items: AuditEvent[]; nextCursor: string | null }

export class ApiError extends Error {
  readonly status?: number
  readonly code?: string

  constructor(message: string, status?: number, code?: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
  }
}

export const hostedMode = Boolean(API_BASE)

export function getApiSession(): ApiSession | null {
  try {
    const token = sessionStorage.getItem(TOKEN_KEY)
    const workspaceId = sessionStorage.getItem(WORKSPACE_KEY)
    const userName = sessionStorage.getItem(USER_NAME_KEY) ?? undefined
    return token && workspaceId ? { token, workspaceId, userName } : null
  } catch {
    throw new ApiError("Session storage is unavailable. Enable browser storage and retry.")
  }
}

export function saveApiSession(session: ApiSession): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, session.token)
    sessionStorage.setItem(WORKSPACE_KEY, session.workspaceId)
    if (session.userName) sessionStorage.setItem(USER_NAME_KEY, session.userName)
    else sessionStorage.removeItem(USER_NAME_KEY)
  } catch {
    throw new ApiError("Could not save your sign-in session. Enable browser storage and retry.")
  }
}

export function clearApiSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
    sessionStorage.removeItem(WORKSPACE_KEY)
    sessionStorage.removeItem(USER_NAME_KEY)
  } catch {
    throw new ApiError("Could not clear your sign-in session.")
  }
}

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? API_BASE
  if (!base) throw new ApiError("Hosted API mode is not configured.")
  const prefix = base.endsWith("/api/v1") ? "" : "/api/v1"
  return `${base}${prefix}${path.startsWith("/") ? path : `/${path}`}`
}

let pendingCount = 0
const pendingListeners = new Set<(count: number) => void>()

export function subscribePendingRequests(fn: (count: number) => void): () => void {
  pendingListeners.add(fn)
  fn(pendingCount)
  return () => {
    pendingListeners.delete(fn)
  }
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  authenticated = true,
  idempotencyKey?: string,
): Promise<T> {
  pendingCount += 1
  pendingListeners.forEach((fn) => fn(pendingCount))
  try {
    const method = (options.method ?? "GET").toUpperCase()
    const headers = new Headers(options.headers)
    if (options.body !== undefined) headers.set("Content-Type", "application/json")
    if (method !== "GET" && method !== "HEAD") {
      headers.set("Idempotency-Key", idempotencyKey ?? crypto.randomUUID())
    }

    if (authenticated) {
      const session = getApiSession()
      if (!session) throw new ApiError("Sign in to access this workspace.")
      headers.set("Authorization", `Bearer ${session.token}`)
      headers.set("X-Workspace-Id", session.workspaceId)
    }

    let response: Response
    try {
      response = await fetch(apiUrl(path), { ...options, method, headers })
    } catch (error) {
      throw new ApiError(error instanceof Error ? `Could not reach the CentsAI API: ${error.message}` : "Could not reach the CentsAI API.")
    }

    if (response.status === 204) return undefined as T
    const contentType = response.headers.get("content-type") ?? ""
    const isJson = contentType.includes("json")
    const payload: unknown = isJson ? await response.json() : await response.text()
    if (!response.ok) {
      if (response.status === 401 && authenticated) {
        try {
          clearApiSession()
        } finally {
          if (typeof globalThis.dispatchEvent === "function") {
            globalThis.dispatchEvent(new Event(SESSION_EXPIRED_EVENT))
          }
        }
        throw new ApiError("Your session expired. Sign in again.", response.status, "session_expired")
      }
      const problem = payload && typeof payload === "object" ? payload as { detail?: unknown; title?: unknown; code?: unknown } : undefined
      const message = typeof problem?.detail === "string"
        ? problem.detail
        : typeof problem?.title === "string"
          ? problem.title
          : typeof payload === "string" && payload.trim()
            ? payload
            : `The API request failed (${response.status}).`
      throw new ApiError(message, response.status, typeof problem?.code === "string" ? problem.code : undefined)
    }
    return payload as T
  } finally {
    pendingCount = Math.max(0, pendingCount - 1)
    pendingListeners.forEach((fn) => fn(pendingCount))
  }
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const idPath = (collection: string, id: string) => `/${collection}/${encodeURIComponent(id)}`

export const api = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>("/auth/login", json("POST", { email, password }), false),
  me: () => apiFetch<MeResponse>("/me"),
  workspaceState: () => apiFetch<State>("/workspace/state"),
  patchWorkspace: (body: Partial<Pick<Settings, "agencyName" | "agencyType" | "teamSize" | "location" | "website">>) =>
    apiFetch("/workspace", json("PATCH", {
      ...(body.agencyName === undefined ? {} : { name: body.agencyName }),
      agencyType: body.agencyType,
      teamSize: body.teamSize,
      location: body.location,
      website: body.website,
    })),
  patchSettings: (body: Partial<Pick<Settings, "ownerName" | "ownerEmail" | "safetyThreshold" | "defaultHorizon" | "planningScenario" | "notifications" | "managerApprovalLimit">> & {
    team?: Array<{ email: string; role: Role }>
  }) =>
    apiFetch("/settings", json("PATCH", body)),
  saveAssumptions: (safetyThreshold: number, invoiceOverrides: Array<{ id: string; expectedDelayOverride: number | null }>) =>
    apiFetch("/settings/forecast-assumptions", json("PUT", { safetyThreshold, invoiceOverrides })),
  replaceDismissedInsights: (dismissedInsights: string[]) =>
    apiFetch<string[]>("/settings/dismissed-insights", json("PUT", { dismissedInsights })),
  createTransaction: (body: Omit<Transaction, "id" | "status" | "source">, idempotencyKey?: string) =>
    apiFetch<Transaction>("/transactions", json("POST", body), true, idempotencyKey),
  patchTransaction: (id: string, body: Partial<Transaction>) =>
    apiFetch<Transaction>(idPath("transactions", id), json("PATCH", body)),
  deleteTransaction: (id: string) => apiFetch(idPath("transactions", id), json("DELETE")),
  importTransactions: (fileName: string, rows: unknown[], skipDuplicates = true) =>
    apiFetch<{ imported: number; duplicates: number; invalid: number }>(
      `/transactions/import?skipDuplicates=${skipDuplicates}`,
      json("POST", { fileName, rows }),
    ),
  createClient: (body: Omit<Client, "id">) => apiFetch<Client>("/clients", json("POST", body)),
  patchClient: (id: string, body: Partial<Client>) => apiFetch<Client>(idPath("clients", id), json("PATCH", body)),
  createProject: (body: Omit<Project, "id">) => apiFetch<Project>("/projects", json("POST", body)),
  patchProject: (id: string, body: Partial<Project>) => apiFetch<Project>(idPath("projects", id), json("PATCH", body)),
  addProjectTimeEntry: (id: string, employeeId: string, hours: number) =>
    apiFetch(idPath("projects", id) + "/time-entries", json("POST", { employeeId, hours })),
  createInvoice: (body: Pick<Invoice, "clientId" | "projectId" | "kind" | "issueDate" | "dueDate" | "lineItems" | "channel" | "notes">, idempotencyKey?: string) =>
    apiFetch<Invoice>("/invoices", json("POST", body), true, idempotencyKey),
  patchInvoice: (id: string, body: Partial<Pick<Invoice, "clientId" | "projectId" | "kind" | "issueDate" | "dueDate" | "lineItems" | "channel" | "expectedDelayOverride" | "notes">>) =>
    apiFetch<Invoice>(idPath("invoices", id), json("PATCH", body)),
  deleteInvoice: (id: string) => apiFetch(idPath("invoices", id), json("DELETE")),
  issueInvoice: (id: string) => apiFetch(idPath("invoices", id) + "/issue", json("POST")),
  recordInvoicePayment: (id: string, date: string, reference: string) =>
    apiFetch(idPath("invoices", id) + "/payments", json("POST", { date, reference })),
  syncPayPalInvoice: (id: string) => apiFetch<{ status?: string; paid?: boolean; warning?: string }>(idPath("invoices", id) + "/paypal/sync", json("POST")),
  createEmployee: (body: Omit<Employee, "id">) => apiFetch<Employee>("/employees", json("POST", body)),
  patchEmployee: (id: string, body: Partial<Employee>) => apiFetch<Employee>(idPath("employees", id), json("PATCH", body)),
  deleteEmployee: (id: string) => apiFetch(idPath("employees", id), json("DELETE")),
  createContractorBill: (body: Omit<ContractorBill, "id">) => apiFetch<ContractorBill>("/contractor-bills", json("POST", body)),
  patchContractorBill: (id: string, body: Partial<ContractorBill>) => apiFetch<ContractorBill>(idPath("contractor-bills", id), json("PATCH", body)),
  createRecurringCost: (body: Omit<RecurringCost, "id">) => apiFetch<RecurringCost>("/recurring-costs", json("POST", body)),
  patchRecurringCost: (id: string, body: Partial<RecurringCost>) => apiFetch<RecurringCost>(idPath("recurring-costs", id), json("PATCH", body)),
  reviewRecurringCost: (id: string) => apiFetch(idPath("recurring-costs", id) + "/review", json("POST")),
  createLoan: (body: Omit<Loan, "id">) => apiFetch<Loan>("/loans", json("POST", body)),
  patchLoan: (id: string, body: Partial<Loan>) => apiFetch<Loan>(idPath("loans", id), json("PATCH", body)),
  createOffer: (body: Omit<LoanOffer, "id">) => apiFetch<LoanOffer>("/financing/offers", json("POST", body)),
  deleteOffer: (id: string) => apiFetch(idPath("financing/offers", id), json("DELETE")),
  createScenario: (body: Omit<SavedScenario, "id">) => apiFetch<SavedScenario>("/scenarios", json("POST", body)),
  deleteScenario: (id: string) => apiFetch(idPath("scenarios", id), json("DELETE")),
  forecast: (query = "") => apiFetch<unknown>(`/cashflow/forecast${query ? `?${query}` : ""}`),
  dashboardSummary: (horizon?: number) =>
    apiFetch<unknown>(`/dashboard/summary${horizon ? `?horizon=${horizon}` : ""}`),
  briefing: (horizon?: number) => apiFetch<unknown>(`/briefing${horizon ? `?horizon=${horizon}` : ""}`),
  listApprovals: (status?: Approval["status"]) =>
    apiFetch<Approval[]>(`/approvals${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createApproval: (kind: Approval["kind"], refId: string, draft?: string, approveNow?: boolean, idempotencyKey?: string) =>
    apiFetch<Approval>(
      "/approvals",
      json("POST", { kind, refId, ...(draft === undefined ? {} : { draft }), ...(approveNow ? { approveNow: true } : {}) }),
      true,
      idempotencyKey,
    ),
  approve: (id: string) => apiFetch<Approval>(idPath("approvals", id) + "/approve", json("POST")),
  retryApproval: (id: string) => apiFetch<Approval>(idPath("approvals", id) + "/retry", json("POST")),
  reject: (id: string, reason: string) => apiFetch<Approval>(idPath("approvals", id) + "/reject", json("POST", { reason })),
  confirmTransfer: (id: string, reference: string) =>
    apiFetch<Approval>(idPath("approvals", id) + "/confirm-transfer", json("POST", { reference })),
  auditEvents: (query = "") => apiFetch<AuditPage>(`/audit-events${query ? `?${query}` : ""}`),
  exportAudit: () => apiFetch<string>("/audit-events/export.csv"),
  resetDemo: () => apiFetch("/admin/reset-demo", json("POST")),
  health: () => apiFetch<{ status: string; paypalMode?: "sandbox" | "fake"; paypalEnvironment?: "sandbox" | "live" }>("/health", {}, false),
}
