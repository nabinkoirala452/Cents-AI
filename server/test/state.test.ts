import { createHash } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { cashBalance, createSeed, forecastAll, invoiceTotal, receivables, todayISO } from "../src/core"
import { prisma } from "../src/db"
import { DEMO_WORKSPACE_ID, seedDemoWorkspace } from "../prisma/seed"
import { loadState } from "../src/lib/state"
import { buildApp } from "../src/app"
import { audit } from "../src/modules/audit/service"

describe("loadState", () => {
  beforeAll(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-10-17T09:00:00+05:30"))
    await seedDemoWorkspace(prisma, "test-only-password")
  })

  afterAll(async () => {
    vi.useRealTimers()
    await prisma.$disconnect()
  })

  it("preserves the seeded financial collections and engine figures", async () => {
    const expected = createSeed()
    const actual = await loadState(DEMO_WORKSPACE_ID, "Owner")

    expect({
      clients: actual.clients.length,
      projects: actual.projects.length,
      invoices: actual.invoices.length,
      transactions: actual.transactions.length,
      employees: actual.employees.length,
      contractorBills: actual.contractorBills.length,
      recurring: actual.recurring.length,
      loans: actual.loans.length,
      offers: actual.offers.length,
      approvals: actual.approvals.length,
      scenarios: actual.scenarios.length,
    }).toEqual({
      clients: expected.clients.length,
      projects: expected.projects.length,
      invoices: expected.invoices.length,
      transactions: expected.transactions.length,
      employees: expected.employees.length,
      contractorBills: expected.contractorBills.length,
      recurring: expected.recurring.length,
      loans: expected.loans.length,
      offers: expected.offers.length,
      approvals: expected.approvals.length,
      scenarios: expected.scenarios.length,
    })
    expect(actual.audit).toEqual([])
    expect(cashBalance(actual, todayISO())).toBe(cashBalance(expected, todayISO()))
    expect(receivables(actual, todayISO()).outstanding)
      .toBe(receivables(expected, todayISO()).outstanding)
    expect(forecastAll(actual, todayISO(), 90).conservative.lowest)
      .toBe(forecastAll(expected, todayISO(), 90).conservative.lowest)
    const actualInvoices = new Map(actual.invoices.map((invoice) => [invoice.id, invoice]))
    for (const invoice of expected.invoices) {
      const loaded = actualInvoices.get(invoice.id)!
      expect(invoiceTotal(loaded)).toBe(loaded.lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0))
      expect(invoiceTotal(loaded)).toBe(invoiceTotal(invoice))
    }
    const actualTransactions = new Map(actual.transactions.map((transaction) => [transaction.id, transaction.amount]))
    for (const transaction of expected.transactions) {
      expect(actualTransactions.get(transaction.id)).toBe(transaction.amount)
    }
    expect(actual.settings.currency).toBe("USD")
    expect(actual.clients.every((client) => client.currency === actual.settings.currency)).toBe(true)
    expect(actual.invoices.every((invoice) => invoice.currency === actual.settings.currency)).toBe(true)
  })

  it("enforces append-only audit rows and one open approval per reference", async () => {
    await prisma.auditEvent.create({
      data: {
        workspaceId: DEMO_WORKSPACE_ID,
        id: "AU-append-only-test",
        actor: "Test",
        action: "Append-only test",
        detail: "Test fixture",
        outcome: "info",
      },
    })
    await expect(prisma.auditEvent.updateMany({
      where: { workspaceId: DEMO_WORKSPACE_ID, id: "AU-append-only-test" },
      data: { detail: "must not update" },
    })).rejects.toThrow()
    await expect(prisma.auditEvent.deleteMany({
      where: { workspaceId: DEMO_WORKSPACE_ID, id: "AU-append-only-test" },
    })).rejects.toThrow()

    await expect(prisma.approval.create({
      data: {
        workspaceId: DEMO_WORKSPACE_ID,
        id: "AP-duplicate",
        kind: "send_reminder",
        title: "Duplicate pending reminder",
        recipient: "Acme Technologies",
        amount: 650,
        currency: "USD",
        refId: "INV-1042",
        preparedBy: "test",
        requestedAt: new Date(),
        status: "Pending",
        idempotencyKey: "test-duplicate-approval",
        steps: ["test"],
        payload: {},
        payloadHash: "test-hash",
      },
    })).rejects.toMatchObject({ code: "P2002" })
  })

  it("includes Stale approvals and orders collections deterministically", async () => {
    await prisma.approval.create({
      data: {
        workspaceId: DEMO_WORKSPACE_ID,
        id: "AP-stale",
        kind: "send_reminder",
        title: "Stale reminder",
        recipient: "Acme Technologies",
        amount: 650,
        currency: "USD",
        refId: "INV-1042",
        preparedBy: "test",
        requestedAt: new Date("2026-10-17T00:00:00.000Z"),
        status: "Stale",
        idempotencyKey: "test-stale-approval",
        steps: ["test"],
        payload: {},
        payloadHash: "test-hash",
      },
    })

    const state = await loadState(DEMO_WORKSPACE_ID, "Owner")
    expect(state.approvals.find((approval) => approval.id === "AP-stale")?.status).toBe("Stale")
    expect(state.transactions.map(({ date, id }) => [date, id])).toEqual(
      [...state.transactions]
        .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id))
        .map(({ date, id }) => [date, id]),
    )
    expect(state.invoices.map(({ issueDate }) => issueDate)).toEqual(
      [...state.invoices].map(({ issueDate }) => issueDate).sort().reverse(),
    )
    expect(state.contractorBills.map(({ dueDate }) => dueDate)).toEqual(
      [...state.contractorBills].map(({ dueDate }) => dueDate).sort(),
    )
    expect(state.recurring.map(({ nextDate }) => nextDate)).toEqual(
      [...state.recurring].map(({ nextDate }) => nextDate).sort(),
    )
    expect(state.approvals.map(({ requestedAt }) => requestedAt)).toEqual(
      [...state.approvals].map(({ requestedAt }) => requestedAt).sort().reverse(),
    )
  })

  it("enables row-level security on every schema table and removes anon SELECT", async () => {
    const tables = await prisma.$queryRaw<Array<{ tableName: string; rowLevelSecurity: boolean }>>`
      SELECT relation.relname AS "tableName",
             relation.relrowsecurity AS "rowLevelSecurity"
      FROM pg_class AS relation
      JOIN pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = current_schema()
        AND relation.relkind IN ('r', 'p')
      ORDER BY relation.relname
    `
    expect(tables.length).toBeGreaterThan(0)
    expect(tables.map(({ tableName }) => tableName)).toContain("_prisma_migrations")
    expect(tables.every(({ rowLevelSecurity }) => rowLevelSecurity)).toBe(true)

    const [{ anonExists }] = await prisma.$queryRaw<Array<{ anonExists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') AS "anonExists"
    `
    if (anonExists) {
      for (const { tableName } of tables) {
        const [{ canSelect }] = await prisma.$queryRaw<Array<{ canSelect: boolean }>>`
          SELECT has_table_privilege(
            'anon',
            format('%I.%I', current_schema(), ${tableName}),
            'SELECT'
          ) AS "canSelect"
        `
        expect(canSelect, `anon SELECT privilege on ${tableName}`).toBe(false)
      }
    }
  })

  it("authenticates users, enforces workspace roles, audits writes, and replays idempotent responses", async () => {
    vi.useRealTimers()
    const app = await buildApp()
    try {
      const warnSpy = vi.spyOn(app.log, "warn")
      let executions = 0
      let signalHandlerStarted = () => {}
      let releaseHandler = () => {}
      const handlerStarted = new Promise<void>((resolve) => {
        signalHandlerStarted = resolve
      })
      const handlerGate = new Promise<void>((resolve) => {
        releaseHandler = resolve
      })
      app.post("/api/v1/test/idempotent", async () => {
        executions += 1
        signalHandlerStarted()
        await handlerGate
        return { execution: executions }
      })
      let failingExecutions = 0
      app.post("/api/v1/test/retry-after-server-error", async (_request, reply) => {
        failingExecutions += 1
        if (failingExecutions === 1) return reply.code(500).send({ error: "temporary" })
        return { execution: failingExecutions }
      })
      const login = async (email: string, password = "test-only-password") =>
        app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email, password },
        })

      const ownerLogin = await login("owner@centsai.demo")
      const financeLogin = await login("finance@centsai.demo")
      const viewerLogin = await login("viewer@centsai.demo")
      expect(ownerLogin.statusCode).toBe(200)
      expect(financeLogin.statusCode).toBe(200)
      expect(viewerLogin.statusCode).toBe(200)

      const owner = ownerLogin.json()
      const finance = financeLogin.json()
      const viewer = viewerLogin.json()
      expect(owner.user.email).toBe("owner@centsai.demo")
      expect(owner.workspaces).toContainEqual({
        id: DEMO_WORKSPACE_ID,
        name: createSeed().settings.agencyName,
        role: "Owner",
      })
      const headers = (token: string, workspaceId = DEMO_WORKSPACE_ID) => ({
        authorization: `Bearer ${token}`,
        "x-workspace-id": workspaceId,
      })

      const unknownUser = await login("missing@centsai.demo", "wrong")
      const wrongPassword = await login("owner@centsai.demo", "wrong")
      expect(unknownUser.statusCode).toBe(401)
      expect(unknownUser.json()).toEqual(wrongPassword.json())
      expect(JSON.stringify(unknownUser.json())).not.toContain("missing@centsai.demo")
      expect(warnSpy).toHaveBeenCalledWith({
        emailHash: createHash("sha256").update("missing@centsai.demo").digest("hex"),
      }, "Failed sign-in")
      expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("missing@centsai.demo")

      expect((await app.inject({ method: "GET", url: "/api/v1/workspace/state" })).statusCode).toBe(401)
      expect((await app.inject({
        method: "GET",
        url: "/api/v1/workspace/state",
        headers: headers("not-a-jwt"),
      })).statusCode).toBe(401)
      expect((await app.inject({
        method: "GET",
        url: "/api/v1/workspace/state",
        headers: headers(owner.token, "not-a-member-workspace"),
      })).statusCode).toBe(404)

      for (const session of [owner, finance, viewer]) {
        const sessionHeaders = headers(session.token)
        expect((await app.inject({
          method: "GET",
          url: "/api/v1/me",
          headers: sessionHeaders,
        })).statusCode).toBe(200)
        expect((await app.inject({
          method: "GET",
          url: "/api/v1/workspace/state",
          headers: sessionHeaders,
        })).statusCode).toBe(200)
        expect((await app.inject({
          method: "GET",
          url: "/api/v1/audit-events?limit=1",
          headers: sessionHeaders,
        })).statusCode).toBe(200)
      }

      const signedInEvents = await prisma.auditEvent.findMany({
        where: { workspaceId: DEMO_WORKSPACE_ID, action: "Signed in" },
      })
      expect(signedInEvents).toHaveLength(3)
      const auditFeed = await app.inject({
        method: "GET",
        url: "/api/v1/audit-events",
        headers: headers(owner.token),
      })
      const auditCsv = await app.inject({
        method: "GET",
        url: "/api/v1/audit-events/export.csv",
        headers: headers(owner.token),
      })
      expect(auditFeed.body.toLowerCase()).not.toContain("via get")
      expect(auditFeed.body.toLowerCase()).not.toContain("paypal")
      expect(auditCsv.body.toLowerCase()).not.toContain("via get")
      expect(auditCsv.body.toLowerCase()).not.toContain("paypal")

      const originalWorkspaceName = createSeed().settings.agencyName
      const viewerPatch = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: headers(viewer.token),
        payload: { name: "Viewer cannot change this" },
      })
      expect(viewerPatch.statusCode).toBe(403)
      expect(viewerPatch.json().code).toBe("forbidden_role")

      const invalidTimezone = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: headers(finance.token),
        payload: { timezone: "Not/A_Real_Zone" },
      })
      expect(invalidTimezone.statusCode).toBe(400)
      const invalidWebsite = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: headers(finance.token),
        payload: { website: "ftp://example.com" },
      })
      expect(invalidWebsite.statusCode).toBe(400)

      const managerPatch = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: headers(finance.token),
        payload: { name: "CentsAI API integration test" },
      })
      expect(managerPatch.statusCode).toBe(200)
      expect(managerPatch.json().name).toBe("CentsAI API integration test")

      const settingBefore = await prisma.workspaceSettings.findUniqueOrThrow({
        where: { workspaceId: DEMO_WORKSPACE_ID },
      })
      const managerSettings = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: { ...headers(finance.token), "idempotency-key": "settings-replay-test" },
        payload: { safetyThreshold: 13_000 },
      })
      expect(managerSettings.statusCode).toBe(200)
      expect(managerSettings.json().safetyThreshold).toBe(13_000)
      const replay = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: { ...headers(finance.token), "idempotency-key": "settings-replay-test" },
        payload: { safetyThreshold: 14_000 },
      })
      expect(replay.statusCode).toBe(managerSettings.statusCode)
      expect(replay.json()).toEqual(managerSettings.json())
      const crossUserReplay = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: { ...headers(viewer.token), "idempotency-key": "settings-replay-test" },
        payload: { safetyThreshold: 13_000 },
      })
      expect(crossUserReplay.statusCode).toBe(409)
      expect((await prisma.workspaceSettings.findUniqueOrThrow({
        where: { workspaceId: DEMO_WORKSPACE_ID },
      })).safetyThreshold.toNumber()).toBe(13_000)

      const wrongRouteReplay = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: { ...headers(finance.token), "idempotency-key": "settings-replay-test" },
        payload: { name: "Must conflict" },
      })
      expect(wrongRouteReplay.statusCode).toBe(409)
      expect(wrongRouteReplay.json().code).toBe("idempotency_conflict")

      const managerLimit = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(finance.token),
        payload: { managerApprovalLimit: 7000 },
      })
      expect(managerLimit.statusCode).toBe(403)
      expect(managerLimit.json().code).toBe("forbidden_role")
      const viewerSettings = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(viewer.token),
        payload: { safetyThreshold: 12_000 },
      })
      expect(viewerSettings.statusCode).toBe(403)

      const ownerLimit = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(owner.token),
        payload: { managerApprovalLimit: 7000 },
      })
      expect(ownerLimit.statusCode).toBe(200)
      const managerTeam = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(finance.token),
        payload: { team: [{ email: "viewer@centsai.demo", role: "Finance Manager" }] },
      })
      expect(managerTeam.statusCode).toBe(403)
      const ownerTeam = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(owner.token),
        payload: { team: [{ email: "viewer@centsai.demo", role: "Finance Manager" }] },
      })
      expect(ownerTeam.statusCode).toBe(200)

      const dismiss = await app.inject({
        method: "PUT",
        url: "/api/v1/settings/dismissed-insights",
        headers: headers(viewer.token),
        payload: { dismissedInsights: ["cash-gap"] },
      })
      expect(dismiss.statusCode).toBe(200)

      await audit({
        userId: viewer.user.id,
        userName: viewer.user.name,
        workspaceId: DEMO_WORKSPACE_ID,
        role: "Viewer",
        requestId: "csv-test",
      }, {
        actor: "=SUM(1,1)",
        action: "CSV formula guard test",
        detail: "+unsafe",
        outcome: "info",
      })
      const csv = await app.inject({
        method: "GET",
        url: "/api/v1/audit-events/export.csv",
        headers: headers(viewer.token),
      })
      expect(csv.statusCode).toBe(200)
      expect(csv.headers["content-type"]).toContain("text/csv")
      expect(csv.body).toContain("\"'=SUM(1,1)\"")
      expect(csv.body).toContain("\"'+unsafe\"")

      const restoreWorkspace = await app.inject({
        method: "PATCH",
        url: "/api/v1/workspace",
        headers: headers(owner.token),
        payload: { name: originalWorkspaceName },
      })
      expect(restoreWorkspace.statusCode).toBe(200)
      const restoreSettings = await app.inject({
        method: "PATCH",
        url: "/api/v1/settings",
        headers: headers(owner.token),
        payload: {
          managerApprovalLimit: settingBefore.managerApprovalLimit.toNumber(),
          safetyThreshold: settingBefore.safetyThreshold.toNumber(),
          team: [{ email: "viewer@centsai.demo", role: "Viewer" }],
        },
      })
      expect(restoreSettings.statusCode).toBe(200)

      const concurrentHeaders = {
        ...headers(owner.token),
        "idempotency-key": "same-time-idempotency-test",
      }
      const firstConcurrentRequest = app.inject({
        method: "POST",
        url: "/api/v1/test/idempotent",
        headers: concurrentHeaders,
        payload: {},
      })
      await handlerStarted
      const secondConcurrentResponse = await app.inject({
        method: "POST",
        url: "/api/v1/test/idempotent",
        headers: concurrentHeaders,
        payload: {},
      })
      releaseHandler()
      const firstConcurrentResponse = await firstConcurrentRequest
      expect(executions).toBe(1)
      expect(firstConcurrentResponse.statusCode).toBe(200)
      expect(secondConcurrentResponse.statusCode).toBe(409)
      expect(secondConcurrentResponse.json().code)
        .toBe("idempotency_in_progress")

      const retryHeaders = {
        ...headers(owner.token),
        "idempotency-key": "retry-after-server-error-test",
      }
      expect((await app.inject({
        method: "POST",
        url: "/api/v1/test/retry-after-server-error",
        headers: retryHeaders,
        payload: {},
      })).statusCode).toBe(500)
      const retryResponse = await app.inject({
        method: "POST",
        url: "/api/v1/test/retry-after-server-error",
        headers: retryHeaders,
        payload: {},
      })
      expect(retryResponse.statusCode).toBe(200)
      expect(retryResponse.json()).toEqual({ execution: 2 })
      expect(failingExecutions).toBe(2)
    } finally {
      await app.close()
    }
  })
})
