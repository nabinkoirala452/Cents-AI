import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"
import { cashBalance, createSeed, forecastAll, receivables, todayISO } from "../src/core"
import { prisma } from "../src/db"
import { DEMO_WORKSPACE_ID, seedDemoWorkspace } from "../prisma/seed"
import { loadState } from "../src/lib/state"

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
      audit: actual.audit.length,
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
      audit: expected.audit.length,
      scenarios: expected.scenarios.length,
    })
    expect(cashBalance(actual, todayISO())).toBe(cashBalance(expected, todayISO()))
    expect(receivables(actual, todayISO()).outstanding)
      .toBe(receivables(expected, todayISO()).outstanding)
    expect(forecastAll(actual, todayISO(), 90).conservative.lowest)
      .toBe(forecastAll(expected, todayISO(), 90).conservative.lowest)
    expect(actual.audit.every((event) => event.action.startsWith("Sample · "))).toBe(true)
  })

  it("enforces append-only audit rows and one open approval per reference", async () => {
    await expect(prisma.auditEvent.updateMany({
      where: { workspaceId: DEMO_WORKSPACE_ID, id: "AU-9" },
      data: { detail: "must not update" },
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
        amountINR: 54_600,
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
        amountINR: 54_600,
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
})
