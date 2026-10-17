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
})
