import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  ApiError,
  apiFetch,
  saveApiSession,
  getApiSession,
  clearApiSession,
  SESSION_EXPIRED_EVENT,
} from "../src/lib/api"
import { runHostedMutation } from "../src/lib/store"

describe("Frontend API client & hosted store mutations", () => {
  const memoryStore = new Map<string, string>()
  const mockSessionStorage = {
    getItem: (key: string) => memoryStore.get(key) ?? null,
    setItem: (key: string, value: string) => { memoryStore.set(key, value) },
    removeItem: (key: string) => { memoryStore.delete(key) },
    clear: () => { memoryStore.clear() },
  }

  const eventTarget = new EventTarget()
  const originalAddEventListener = globalThis.addEventListener
  const originalRemoveEventListener = globalThis.removeEventListener
  const originalDispatchEvent = globalThis.dispatchEvent

  beforeEach(() => {
    memoryStore.clear()
    vi.stubEnv("VITE_API_URL", "http://localhost:8787")
    // Setup mock sessionStorage
    Object.defineProperty(globalThis, "sessionStorage", {
      value: mockSessionStorage,
      writable: true,
      configurable: true,
    })
    globalThis.addEventListener = eventTarget.addEventListener.bind(eventTarget)
    globalThis.removeEventListener = eventTarget.removeEventListener.bind(eventTarget)
    globalThis.dispatchEvent = eventTarget.dispatchEvent.bind(eventTarget)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    globalThis.addEventListener = originalAddEventListener
    globalThis.removeEventListener = originalRemoveEventListener
    globalThis.dispatchEvent = originalDispatchEvent
  })

  it("parses problem+json responses into readable ApiError", async () => {
    const problemJson = {
      title: "Bad Request",
      detail: "Invalid transaction amount: must be positive",
      code: "invalid_input",
    }

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(problemJson), {
        status: 400,
        headers: { "Content-Type": "application/problem+json" },
      })
    )

    saveApiSession({ token: "test-token", workspaceId: "ws-123" })

    await expect(apiFetch("/transactions")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiError)
      const apiErr = err as ApiError
      expect(apiErr.message).toBe("Invalid transaction amount: must be positive")
      expect(apiErr.status).toBe(400)
      expect(apiErr.code).toBe("invalid_input")
      return true
    })
  })

  it("includes Idempotency-Key on POST and omits it on GET", async () => {
    let capturedGetHeaders: Headers | undefined
    let capturedPostHeaders: Headers | undefined

    saveApiSession({ token: "test-token", workspaceId: "ws-123" })

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers)
      if (init?.method === "POST") {
        capturedPostHeaders = headers
        return new Response(JSON.stringify({ id: "SC-1", name: "Hiring" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      }
      capturedGetHeaders = headers
      return new Response(JSON.stringify({ status: "ok" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    })

    await apiFetch("/workspace/state", { method: "GET" })
    expect(capturedGetHeaders?.has("Idempotency-Key")).toBe(false)
    expect(capturedGetHeaders?.get("Authorization")).toBe("Bearer test-token")
    expect(capturedGetHeaders?.get("X-Workspace-Id")).toBe("ws-123")

    await apiFetch("/scenarios", { method: "POST", body: JSON.stringify({ name: "Hiring" }) })
    expect(capturedPostHeaders?.has("Idempotency-Key")).toBe(true)
    expect(capturedPostHeaders?.get("Idempotency-Key")).toBeTruthy()
    expect(capturedPostHeaders?.get("Content-Type")).toBe("application/json")
  })

  it("clears the session and dispatches session-expired event on 401", async () => {
    saveApiSession({ token: "expired-token", workspaceId: "ws-123", userName: "Alex" })
    expect(getApiSession()).not.toBeNull()

    let eventFired = false
    const onExpired = () => {
      eventFired = true
    }
    globalThis.addEventListener(SESSION_EXPIRED_EVENT, onExpired)

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ title: "Unauthorized", detail: "Token expired" }), {
        status: 401,
        headers: { "Content-Type": "application/problem+json" },
      })
    )

    try {
      await expect(apiFetch("/workspace/state")).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiError)
        const apiErr = err as ApiError
        expect(apiErr.message).toBe("Your session expired. Sign in again.")
        expect(apiErr.status).toBe(401)
        expect(apiErr.code).toBe("session_expired")
        return true
      })
      expect(eventFired).toBe(true)
      expect(getApiSession()).toBeNull()
    } finally {
      globalThis.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
    }
  })

  it("hostedMutation returns ok:false without throwing or setting full-screen loadError", async () => {
    let refreshed = false
    const mockRefresh = async () => {
      refreshed = true
    }

    const failedOperation = async () => {
      throw new ApiError("Approval limit exceeded: Owner approval required", 403, "forbidden_amount")
    }

    const result = await runHostedMutation(failedOperation, mockRefresh, () => "Success")

    expect(result.ok).toBe(false)
    expect(result.message).toBe("Approval limit exceeded: Owner approval required")
    expect(refreshed).toBe(false)

    // Successful operation returns ok: true and runs refresh
    const successOperation = async () => ({ id: "123" })
    const successResult = await runHostedMutation(successOperation, mockRefresh, (v) => `Created ${v.id}`)

    expect(successResult.ok).toBe(true)
    expect(successResult.message).toBe("Created 123")
    expect(successResult.id).toBe("123")
    expect(refreshed).toBe(true)
  })
})

import { approvalPermission } from "../src/components/approval-card"
import type { Approval, Settings } from "../src/lib/types"

describe("approvalPermission pure maker-checker rules", () => {
  const baseSettings: Settings = {
    agencyName: "Acme",
    agencyType: "Design",
    teamSize: "5",
    location: "US",
    website: "https://example.com",
    ownerName: "Alex Rivera",
    ownerEmail: "owner@centsai.demo",
    currency: "USD",
    safetyThreshold: 10000,
    defaultHorizon: 30,
    planningScenario: "expected",
    managerApprovalLimit: 2500,
    role: "Owner",
    openingBalance: 50000,
    openingDate: "2026-01-01",
    notifications: {},
    team: [
      { name: "Alex Rivera", email: "owner@centsai.demo", role: "Owner" },
      { name: "Morgan Chen", email: "finance@centsai.demo", role: "Finance Manager" },
      { name: "Sam Viewer", email: "viewer@centsai.demo", role: "Viewer" },
    ],
    readiness: [],
  }

  function makeApproval(overrides: Partial<Approval> = {}): Approval {
    return {
      id: "AP-101",
      kind: "send_reminder",
      title: "Reminder for INV-1001",
      recipient: "client@example.com",
      amount: 1500,
      currency: "USD",
      refId: "INV-1001",
      preparedBy: "Alex Rivera",
      requestedAt: "2026-10-19T10:00:00Z",
      status: "Pending",
      idempotencyKey: "key-101",
      steps: ["Verify reminder", "Send email"],
      ...overrides,
    }
  }

  it("Owner approves agent item", () => {
    const settings: Settings = { ...baseSettings, role: "Owner" }
    const a = makeApproval({
      preparedBy: "CentsAI agent (for Alex Rivera)",
      preparedByAgent: true,
      amount: 15000,
    })
    const perm = approvalPermission(a, {
      settings,
      mode: "hosted",
      actor: "Alex Rivera",
      signedInName: "Alex Rivera",
    })
    expect(perm.allowed).toBe(true)
    expect(perm.permissionAllowed).toBe(true)
    expect(perm.isSelfPrepared).toBe(false)
  })

  it("FM blocked on own item", () => {
    const settings: Settings = { ...baseSettings, role: "Finance Manager", managerApprovalLimit: 2500 }
    const a = makeApproval({
      preparedBy: "Morgan Chen",
      amount: 500,
    })
    const perm = approvalPermission(a, {
      settings,
      mode: "demo",
      actor: "Morgan Chen",
      signedInName: "Morgan Chen",
    })
    expect(perm.allowed).toBe(false)
    expect(perm.permissionAllowed).toBe(true)
    expect(perm.isSelfPrepared).toBe(true)
    expect(perm.blockedReason).toContain("Finance Managers cannot approve requests they prepared themselves")
  })

  it("FM blocked on 'CentsAI agent (for <FM name>)' in hosted mode", () => {
    const settings: Settings = { ...baseSettings, role: "Finance Manager", managerApprovalLimit: 2500 }
    const a = makeApproval({
      preparedBy: "CentsAI agent (for Morgan Chen)",
      preparedByAgent: true,
      amount: 500,
    })
    const perm = approvalPermission(a, {
      settings,
      mode: "hosted",
      actor: "Morgan Chen",
      signedInName: "Morgan Chen",
    })
    expect(perm.allowed).toBe(false)
    expect(perm.permissionAllowed).toBe(true)
    expect(perm.isSelfPrepared).toBe(true)
    expect(perm.blockedReason).toContain("Finance Managers cannot approve requests they prepared themselves")
  })

  it("FM blocked above the limit", () => {
    const settings: Settings = { ...baseSettings, role: "Finance Manager", managerApprovalLimit: 1000 }
    const a = makeApproval({
      preparedBy: "Someone Else",
      amount: 3000,
    })
    const perm = approvalPermission(a, {
      settings,
      mode: "hosted",
      actor: "Morgan Chen",
      signedInName: "Morgan Chen",
    })
    expect(perm.allowed).toBe(false)
    expect(perm.permissionAllowed).toBe(false)
    expect(perm.isSelfPrepared).toBe(false)
    expect(perm.blockedReason).toBe("Owner approval required.")
  })

  it("Viewer blocked", () => {
    const settings: Settings = { ...baseSettings, role: "Viewer" }
    const a = makeApproval({
      preparedBy: "Someone Else",
      amount: 100,
    })
    const perm = approvalPermission(a, {
      settings,
      mode: "hosted",
      actor: "Sam Viewer",
      signedInName: "Sam Viewer",
    })
    expect(perm.allowed).toBe(false)
    expect(perm.permissionAllowed).toBe(false)
    expect(perm.blockedReason).toBe("Viewers can’t approve actions.")
  })
})

