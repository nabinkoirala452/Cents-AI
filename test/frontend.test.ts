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
    expect(refreshed).toBe(true)
  })
})
