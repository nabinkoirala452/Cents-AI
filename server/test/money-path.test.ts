import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { FakePayPalGateway, PayPalError, setPayPalGatewayForTests } from "../src/integrations/paypal"
import { prisma } from "../src/db"
import { buildApp } from "../src/app"
import { createAccessToken } from "../src/plugins/auth"

const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const workspaceId = `money-${suffix}`
const ownerId = `money-owner-${suffix}`
const managerId = `money-manager-${suffix}`
const viewerId = `money-viewer-${suffix}`
const secondWorkspaceId = `other-${suffix}`
const secondOwnerId = `other-owner-${suffix}`
const app = await buildApp()
const gateway = new FakePayPalGateway()
let ownerToken = ""
let managerToken = ""
let viewerToken = ""
let secondOwnerToken = ""
let invoiceSequence = 0
let clientSequence = 0

setPayPalGatewayForTests(gateway)

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "x-workspace-id": workspaceId }
}

async function createInvoice(amount: number, channel: "PayPal" | "BankTransfer" = "PayPal") {
  invoiceSequence += 1
  clientSequence += 1
  const clientId = `client-${suffix}-${clientSequence}`
  await prisma.client.create({
    data: {
      workspaceId,
      id: clientId,
      name: `Client ${clientSequence}`,
      email: `client-${clientSequence}@example.test`,
      country: "US",
      currency: "USD",
      avgDelayDays: 0,
    },
  })
  const today = new Date().toISOString().slice(0, 10)
  const invoice = await prisma.invoice.create({
    data: {
      workspaceId,
      id: `INV-MONEY-${suffix}-${invoiceSequence}`,
      clientId,
      kind: "Project",
      issueDate: today,
      dueDate: today,
      currency: "USD",
      lineItems: [{ description: "Consulting", quantity: 1, unitPrice: amount }],
      status: channel === "PayPal" ? "Draft" : "Sent",
      channel,
      reminders: [],
    },
  })
  return invoice
}

async function createWorkspaceInvoice(
  targetWorkspaceId: string,
  id: string,
  amount: number,
  email: string,
) {
  const clientId = `${id}-client-${targetWorkspaceId}`
  await prisma.client.create({
    data: {
      workspaceId: targetWorkspaceId,
      id: clientId,
      name: "Invoice Collision Client",
      email,
      country: "US",
      currency: "USD",
      avgDelayDays: 0,
    },
  })
  return prisma.invoice.create({
    data: {
      workspaceId: targetWorkspaceId,
      id,
      clientId,
      kind: "Project",
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date().toISOString().slice(0, 10),
      currency: "USD",
      lineItems: [{ description: "Consulting", quantity: 1, unitPrice: amount }],
      status: "Draft",
      channel: "PayPal",
      reminders: [],
    },
  })
}

async function propose(kind: string, refId: string, token = ownerToken, draft?: string) {
  return app.inject({
    method: "POST",
    url: "/api/v1/approvals",
    headers: headers(token),
    payload: { kind, refId, ...(draft === undefined ? {} : { draft }) },
  })
}

async function approve(id: string, token = ownerToken) {
  return app.inject({
    method: "POST",
    url: `/api/v1/approvals/${id}/approve`,
    headers: headers(token),
  })
}

beforeAll(async () => {
  const ownerEmail = `${ownerId}@example.test`
  const managerEmail = `${managerId}@example.test`
  const viewerEmail = `${viewerId}@example.test`
  await prisma.user.createMany({
    data: [
      { id: ownerId, email: ownerEmail, name: "Money Owner", passwordHash: "unused" },
      { id: managerId, email: managerEmail, name: "Money Manager", passwordHash: "unused" },
      { id: viewerId, email: viewerEmail, name: "Money Viewer", passwordHash: "unused" },
    ],
  })
  await prisma.workspace.create({
    data: {
      id: workspaceId,
      name: "Money Path Test",
      currency: "USD",
      agencyType: "Agency",
      teamSize: "3",
      location: "Austin",
      website: "",
      timezone: "UTC",
      seededOn: new Date().toISOString().slice(0, 10),
      settings: {
        create: {
          safetyThreshold: 1000,
          defaultHorizon: 30,
          planningScenario: "expected",
          managerApprovalLimit: 6000,
          openingBalance: 10000,
          openingDate: "2026-01-01",
          ownerName: "Money Owner",
          ownerEmail,
          notifications: {},
          readiness: [],
          dismissedInsights: [],
        },
      },
    },
  })
  await prisma.membership.createMany({
    data: [
      { workspaceId, userId: ownerId, role: "Owner" },
      { workspaceId, userId: managerId, role: "FinanceManager" },
      { workspaceId, userId: viewerId, role: "Viewer" },
    ],
  })
  await prisma.user.create({
    data: { id: secondOwnerId, email: `${secondOwnerId}@example.test`, name: "Second Owner", passwordHash: "unused" },
  })
  await prisma.workspace.create({
    data: {
      id: secondWorkspaceId,
      name: "Second Money Path Test",
      currency: "USD",
      agencyType: "Agency",
      teamSize: "3",
      location: "Austin",
      website: "",
      timezone: "UTC",
      seededOn: new Date().toISOString().slice(0, 10),
      settings: {
        create: {
          safetyThreshold: 1000,
          defaultHorizon: 30,
          planningScenario: "expected",
          managerApprovalLimit: 6000,
          openingBalance: 10000,
          openingDate: "2026-01-01",
          ownerName: "Second Owner",
          ownerEmail: `${secondOwnerId}@example.test`,
          notifications: {},
          readiness: [],
          dismissedInsights: [],
        },
      },
    },
  })
  await prisma.membership.create({
    data: { workspaceId: secondWorkspaceId, userId: secondOwnerId, role: "Owner" },
  })
  ownerToken = await createAccessToken(ownerId)
  managerToken = await createAccessToken(managerId)
  viewerToken = await createAccessToken(viewerId)
  secondOwnerToken = await createAccessToken(secondOwnerId)
})

afterAll(async () => {
  setPayPalGatewayForTests(undefined)
  await app.close()
  await prisma.$disconnect()
})

describe("approval and payment money path", () => {
  it("sends PayPal invoices and enforces approval permission, limit, and current payload", async () => {
    const invoice = await createInvoice(400)
    const proposed = await propose("paypal_send_invoice", invoice.id)
    expect(proposed.statusCode).toBe(200)
    expect(proposed.json()).toMatchObject({ status: "Pending", amount: 400, currency: "USD" })
    const sent = await approve(proposed.json().id)
    expect(sent.statusCode).toBe(200)
    expect(sent.json()).toMatchObject({ status: "Verified" })
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
    })).toMatchObject({ status: "Sent", paypalStatus: "SENT" })
    expect(await prisma.auditEvent.count({
      where: { workspaceId, action: "PayPal API call", ref: invoice.id },
    })).toBeGreaterThanOrEqual(4)

    const expensive = await createInvoice(6000.01)
    const expensiveApproval = await propose("paypal_send_invoice", expensive.id)
    expect((await approve(expensiveApproval.json().id, managerToken)).statusCode).toBe(403)
    expect((await approve(expensiveApproval.json().id, viewerToken)).statusCode).toBe(403)
    expect((await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: expensiveApproval.json().id } },
    }))?.status).toBe("Pending")

    const staleInvoice = await createInvoice(250)
    const staleApproval = await propose("paypal_send_invoice", staleInvoice.id)
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: staleInvoice.id } },
      data: { dueDate: "2027-01-01" },
    })
    const staleResponse = await approve(staleApproval.json().id)
    expect(staleResponse.statusCode).toBe(409)
    expect(staleResponse.json()).toMatchObject({ code: "approval_stale" })
    expect(await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: staleApproval.json().id } },
    })).toMatchObject({ status: "Stale" })
  })

  it("isolates PayPal invoice numbers across workspaces and rejects a mismatched pre-existing result", async () => {
    const first = await createWorkspaceInvoice(workspaceId, "INV-1061", 1061, "first-client@example.test")
    const firstNumber = `INV-1061-${workspaceId.slice(0, 6)}-aaaaaa`
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: first.id } },
      data: { paypalInvoiceNumber: firstNumber },
    })
    const foreignInvoice = await gateway.createDraftInvoice({
      invoiceNumber: firstNumber,
      currency: "USD",
      invoiceDate: first.issueDate,
      dueDate: first.dueDate,
      recipientEmail: "different-client@example.test",
      recipientName: "Different Client",
      items: [{ name: "Different work", quantity: 1, unitPrice: 999 }],
    })
    const firstApproval = await propose("paypal_send_invoice", first.id)
    const rejected = await approve(firstApproval.json().id)
    expect(rejected.json()).toMatchObject({ status: "Failed" })
    expect(rejected.json().result).toContain("PayPal invoice number already used by a different invoice")
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: first.id } },
    })).toMatchObject({ paypalInvoiceId: null, paypalInvoiceNumber: firstNumber })

    const second = await createWorkspaceInvoice(secondWorkspaceId, "INV-1061", 1061, "second-client@example.test")
    const secondApproval = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: { authorization: `Bearer ${secondOwnerToken}`, "x-workspace-id": secondWorkspaceId },
      payload: { kind: "paypal_send_invoice", refId: second.id },
    })
    expect(secondApproval.statusCode).toBe(200)
    const secondResult = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${secondApproval.json().id}/approve`,
      headers: { authorization: `Bearer ${secondOwnerToken}`, "x-workspace-id": secondWorkspaceId },
    })
    expect(secondResult.json()).toMatchObject({ status: "Verified" })
    const linked = await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId: secondWorkspaceId, id: second.id } },
    })
    expect(linked?.paypalInvoiceNumber).toMatch(new RegExp(`^INV-1061-other--[0-9a-z]{6}$`))
    expect(linked?.paypalInvoiceNumber).not.toBe(firstNumber)
    expect(linked?.paypalInvoiceId).not.toBe(foreignInvoice.id)
    expect(gateway.invoices.get(linked!.paypalInvoiceId!)?.number).toBe(linked?.paypalInvoiceNumber)
  })

  it("executes concurrent approvals once and recovers a created invoice after send failure", async () => {
    const concurrentInvoice = await createInvoice(100)
    const approval = await propose("paypal_send_invoice", concurrentInvoice.id)
    gateway.calls.splice(0)
    const results = await Promise.all([
      approve(approval.json().id),
      approve(approval.json().id),
    ])
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(1)
    expect(results.filter((result) => result.statusCode === 409)).toHaveLength(1)
    expect(gateway.calls.filter((call) => call.method === "createDraftInvoice")).toHaveLength(1)

    const interruptedInvoice = await createInvoice(150)
    gateway.failNext("sendInvoice", new Error("Injected interruption after create"))
    const firstApproval = await propose("paypal_send_invoice", interruptedInvoice.id)
    expect((await approve(firstApproval.json().id)).json()).toMatchObject({ status: "Failed" })
    const persisted = await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: interruptedInvoice.id } },
    })
    expect(persisted?.paypalInvoiceId).toBeTruthy()
    const secondApproval = await propose("paypal_send_invoice", interruptedInvoice.id)
    const recovered = await approve(secondApproval.json().id)
    expect(recovered.json()).toMatchObject({ status: "Verified" })
    const persistedNumber = (await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: interruptedInvoice.id } },
    }))?.paypalInvoiceNumber
    expect(persistedNumber).toMatch(new RegExp(`^${interruptedInvoice.id}-money--[0-9a-z]{6}$`))
    expect(gateway.calls.filter((call) =>
      call.method === "createDraftInvoice" && call.invoiceNumber === persistedNumber,
    )).toHaveLength(1)
    expect(gateway.calls.filter((call) =>
      call.method === "searchInvoiceByNumber" && call.invoiceNumber === persistedNumber,
    )).toHaveLength(2)
    const recoverySearches = gateway.calls.filter((call) =>
      call.method === "searchInvoiceByNumber" && call.invoiceNumber === persistedNumber,
    )
    const recoveredSearchIndex = gateway.calls.indexOf(recoverySearches[recoverySearches.length - 1])
    expect(gateway.calls[recoveredSearchIndex + 1]).toMatchObject({
      method: "getInvoice",
      id: persisted?.paypalInvoiceId,
    })
  })

  it("retries an aged Submitted PayPal approval exactly once", async () => {
    const invoice = await createInvoice(175)
    const proposed = await propose("paypal_send_invoice", invoice.id)
    await prisma.approval.update({
      where: { workspaceId_id: { workspaceId, id: proposed.json().id } },
      data: { status: "Submitted", decidedAt: new Date(Date.now() - 3 * 60_000) },
    })
    gateway.calls.splice(0)

    const retried = await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${proposed.json().id}/retry`,
      headers: headers(ownerToken),
    })

    expect(retried.statusCode).toBe(200)
    expect(retried.json()).toMatchObject({ status: "Verified" })
    expect(gateway.calls.filter((call) => call.method === "createDraftInvoice")).toHaveLength(1)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
    })).toMatchObject({ status: "Sent" })
  })

  it("runs reminder, contractor transfer, and subscription cancellation executors", async () => {
    const reminderInvoice = await createInvoice(300)
    const paypalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: reminderInvoice.id,
      currency: "USD",
      invoiceDate: reminderInvoice.issueDate,
      dueDate: reminderInvoice.dueDate,
      recipientEmail: `reminder-${suffix}@example.test`,
      recipientName: "Reminder Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 300 }],
    })
    await gateway.sendInvoice(paypalInvoice.id)
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: reminderInvoice.id } },
      data: {
        status: "Sent",
        paypalInvoiceId: paypalInvoice.id,
        paypalStatus: "SENT",
        paypalPayerUrl: paypalInvoice.payerUrl,
      },
    })
    const reminderText = "Hello, checking on the approved invoice."
    const reminderApproval = await propose("send_reminder", reminderInvoice.id, ownerToken, reminderText)
    expect((await approve(reminderApproval.json().id)).json()).toMatchObject({ status: "Verified" })
    expect(gateway.calls.find((call) => call.method === "remindInvoice")?.note).toBe(reminderText)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: reminderInvoice.id } },
    })).toMatchObject({ reminders: [expect.objectContaining({ channel: "PayPal reminder" })] })
    const invalidDraftKind = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: headers(ownerToken),
      payload: { kind: "paypal_send_invoice", refId: reminderInvoice.id, draft: "not allowed" },
    })
    expect(invalidDraftKind.statusCode).toBe(400)

    const billId = `CB-${suffix}`
    await prisma.contractorBill.create({
      data: {
        workspaceId,
        id: billId,
        vendor: "Studio Contractor",
        reference: `INV-${suffix}`,
        amount: 700,
        dueDate: "2026-11-01",
        status: "Pending",
      },
    })
    const contractorApproval = await propose("record_contractor_payment", billId)
    expect((await approve(contractorApproval.json().id)).json()).toMatchObject({ status: "Submitted" })
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/approvals/${contractorApproval.json().id}/confirm-transfer`,
      headers: headers(ownerToken),
      payload: { reference: "BANK-TRANSFER-001" },
    })).json()).toMatchObject({ status: "Verified" })
    expect(await prisma.contractorBill.findUnique({
      where: { workspaceId_id: { workspaceId, id: billId } },
    })).toMatchObject({ status: "Paid" })
    expect(await prisma.transaction.findFirst({
      where: { workspaceId, reference: "BANK-TRANSFER-001" },
    })).toMatchObject({ status: "Verified", source: "Manual", type: "Expense" })

    const recurringId = `RC-${suffix}`
    await prisma.recurringCost.create({
      data: {
        workspaceId,
        id: recurringId,
        vendor: "Cloud Tools",
        category: "Software",
        kind: "Subscription",
        amount: 80,
        cycle: "Monthly",
        nextDate: "2026-11-01",
        startedOn: "2026-01-01",
        status: "Active",
      },
    })
    const cancelApproval = await propose("cancel_subscription", recurringId)
    expect((await approve(cancelApproval.json().id)).json()).toMatchObject({ status: "Verified" })
    expect(await prisma.recurringCost.findUnique({
      where: { workspaceId_id: { workspaceId, id: recurringId } },
    })).toMatchObject({ status: "Cancelled" })
  })

  it("reconciles each verified PayPal payment once and ignores pending payments", async () => {
    const paidInvoice = await createInvoice(500)
    const paidPayPalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: paidInvoice.id,
      currency: "USD",
      invoiceDate: paidInvoice.issueDate,
      dueDate: paidInvoice.dueDate,
      recipientEmail: `paid-${suffix}@example.test`,
      recipientName: "Paid Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 500 }],
    })

    await gateway.sendInvoice(paidPayPalInvoice.id)
    gateway.markPaid(paidPayPalInvoice.id, undefined, "2026-10-14")
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: paidInvoice.id } },
      data: { status: "Sent", paypalInvoiceId: paidPayPalInvoice.id, paypalStatus: "SENT" },
    })
    const syncUrl = `/api/v1/invoices/${paidInvoice.id}/paypal/sync`
    expect((await app.inject({ method: "POST", url: syncUrl, headers: headers(viewerToken) })).statusCode).toBe(200)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: paidInvoice.id } },
    })).toMatchObject({ status: "Paid", paidDate: "2026-10-14" })
    expect((await app.inject({ method: "POST", url: syncUrl, headers: headers(viewerToken) })).statusCode).toBe(200)
    expect(await prisma.paymentEvent.count({
      where: { workspaceId, invoiceId: paidInvoice.id, source: "PayPal" },
    })).toBe(1)
    expect(await prisma.transaction.count({
      where: { workspaceId, invoiceId: paidInvoice.id, source: "PayPal", status: "Verified" },
    })).toBe(1)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: paidInvoice.id } },
    })).toMatchObject({ status: "Paid", paypalStatus: "PAID", paidDate: "2026-10-14" })
    expect(await prisma.auditEvent.count({
      where: { workspaceId, ref: paidInvoice.id, action: "Payment verified" },
    })).toBe(1)
    expect(await prisma.auditEvent.count({
      where: { workspaceId, ref: paidInvoice.id, action: "Status checked" },
    })).toBe(1)

    const pendingInvoice = await createInvoice(800)
    const pendingPayPalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: pendingInvoice.id,
      currency: "USD",
      invoiceDate: pendingInvoice.issueDate,
      dueDate: pendingInvoice.dueDate,
      recipientEmail: `pending-${suffix}@example.test`,
      recipientName: "Pending Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 800 }],
    })
    await gateway.sendInvoice(pendingPayPalInvoice.id)
    gateway.setInvoiceStatus(pendingPayPalInvoice.id, "PAYMENT_PENDING")
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: pendingInvoice.id } },
      data: { status: "Sent", paypalInvoiceId: pendingPayPalInvoice.id, paypalStatus: "SENT" },
    })
    await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${pendingInvoice.id}/paypal/sync`,
      headers: headers(viewerToken),
    })
    expect(await prisma.paymentEvent.count({ where: { workspaceId, invoiceId: pendingInvoice.id } })).toBe(0)
    expect(await prisma.transaction.count({ where: { workspaceId, invoiceId: pendingInvoice.id } })).toBe(0)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: pendingInvoice.id } },
    })).toMatchObject({ status: "Sent" })

    const unverifiedPaidInvoice = await createInvoice(900)
    const noDetailPayPalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: unverifiedPaidInvoice.id,
      currency: "USD",
      invoiceDate: unverifiedPaidInvoice.issueDate,
      dueDate: unverifiedPaidInvoice.dueDate,
      recipientEmail: `unverified-${suffix}@example.test`,
      recipientName: "Unverified Paid Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 900 }],
    })
    gateway.setInvoiceStatus(noDetailPayPalInvoice.id, "PAID")
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: unverifiedPaidInvoice.id } },
      data: { status: "Sent", paypalInvoiceId: noDetailPayPalInvoice.id, paypalStatus: "SENT" },
    })
    const unverifiedResponse = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${unverifiedPaidInvoice.id}/paypal/sync`,
      headers: headers(viewerToken),
    })
    expect(unverifiedResponse.json()).toMatchObject({
      paid: false,
      warning: "PayPal reports PAID but payment details could not be verified",
    })
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: unverifiedPaidInvoice.id } },
    })).toMatchObject({ status: "Sent", paypalStatus: "PAID", paidDate: null })
    expect(await prisma.paymentEvent.count({
      where: { workspaceId, invoiceId: unverifiedPaidInvoice.id },
    })).toBe(0)
    expect(await prisma.transaction.count({
      where: { workspaceId, invoiceId: unverifiedPaidInvoice.id },
    })).toBe(0)
    expect(await prisma.auditEvent.findFirst({
      where: { workspaceId, ref: unverifiedPaidInvoice.id, outcome: "warning" },
      orderBy: { at: "desc" },
    })).toMatchObject({
      actor: "Verify payment status by Money Viewer",
      detail: "PayPal reports PAID but payment details could not be verified",
    })
  })

  it("maps PayPal sync errors and audits their debug IDs", async () => {
    const invoice = await createInvoice(50)
    const paypalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: `sync-error-${suffix}`,
      currency: "USD",
      invoiceDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      recipientEmail: `sync-error-${suffix}@example.test`,
      recipientName: "Sync Error Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 50 }],
    })
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
      data: { status: "Sent", paypalInvoiceId: paypalInvoice.id },
    })
    gateway.failNext("getInvoice", new PayPalError("HTTP 503", "DEBUG-SYNC-503", 503))
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/paypal/sync`,
      headers: headers(viewerToken),
    })
    expect(response.statusCode).toBe(502)
    expect(response.headers["content-type"]).toContain("application/problem+json")
    expect(response.json()).toMatchObject({
      code: "paypal_error",
      detail: "PayPal request failed (HTTP 503) · debug_id DEBUG-SYNC-503",
    })
    expect(await prisma.auditEvent.findFirst({
      where: { workspaceId, action: "Payment verification failed", ref: invoice.id },
      orderBy: { at: "desc" },
    })).toMatchObject({ outcome: "error", detail: `${invoice.id} · debug_id DEBUG-SYNC-503` })
    gateway.failNext("getInvoice", new PayPalError("HTTP 404", "DEBUG-SYNC-404", 404))
    const missing = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/paypal/sync`,
      headers: headers(viewerToken),
    })
    expect(missing.statusCode).toBe(409)
    expect(missing.json()).toMatchObject({ code: "paypal_invoice_not_found" })
  })

  it("records manual bank receipts by reference and withdraws pending reminders on payment", async () => {
    const invoice = await createInvoice(125, "BankTransfer")
    const reminder = await propose("send_reminder", invoice.id)
    const invalidDates = await Promise.all(["9999-01-01", "2000-01-01"].map((date) =>
      app.inject({
        method: "POST",
        url: `/api/v1/invoices/${invoice.id}/payments`,
        headers: headers(ownerToken),
        payload: { date, reference: `INVALID-${date}` },
      }),
    ))
    expect(invalidDates.map((response) => response.statusCode)).toEqual([400, 400])
    const missingReference = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: headers(ownerToken),
      payload: { date: new Date().toISOString().slice(0, 10) },
    })
    expect(missingReference.statusCode).toBe(400)
    const receipt = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${invoice.id}/payments`,
      headers: headers(ownerToken),
      payload: { date: new Date().toISOString().slice(0, 10), reference: "ACH-RECEIPT-77" },
    })
    expect(receipt.statusCode).toBe(200)
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
    })).toMatchObject({ status: "Paid" })
    expect(await prisma.transaction.findFirst({
      where: { workspaceId, invoiceId: invoice.id },
    })).toMatchObject({ status: "Recorded", source: "Manual", reference: "ACH-RECEIPT-77" })
    expect(await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: reminder.json().id } },
    })).toMatchObject({
      status: "Rejected",
      decidedBy: "System",
      note: "Withdrawn automatically — invoice was paid",
    })
    expect(await prisma.paymentEvent.count({ where: { workspaceId, invoiceId: invoice.id } })).toBe(1)
  })

  it("stores bad-signature webhooks and treats duplicate provider IDs as no-ops", async () => {
    const eventId = `WH-${suffix}`
    const rawBody = JSON.stringify({
      id: eventId,
      event_type: "INVOICING.INVOICE.PAID",
      resource: { id: `unknown-paypal-${suffix}` },
    })
    const webhookUrl = "/api/v1/webhooks/paypal"
    const first = await app.inject({
      method: "POST",
      url: webhookUrl,
      headers: {
        "content-type": "application/json",
        "paypal-auth-algo": "SHA256withRSA",
        "paypal-cert-url": "https://api-m.sandbox.paypal.com/cert",
        "paypal-transmission-id": `trans-${suffix}`,
        "paypal-transmission-sig": "fake-signature",
        "paypal-transmission-time": new Date().toISOString(),
      },
      payload: rawBody,
    })
    expect(first.statusCode).toBe(200)
    expect(first.json()).toMatchObject({ processed: false })
    expect(await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    })).toMatchObject({ signatureVerified: false, processedAt: null })
    const verifyCalls = gateway.calls.filter((call) => call.method === "verifyWebhookSignature").length

    const replay = await app.inject({
      method: "POST",
      url: webhookUrl,
      headers: { "content-type": "application/json" },
      payload: rawBody,
    })
    expect(replay.statusCode).toBe(200)
    expect(replay.json()).toMatchObject({ status: "duplicate" })
    expect(gateway.calls.filter((call) => call.method === "verifyWebhookSignature")).toHaveLength(verifyCalls)
    expect(await prisma.webhookEvent.count({ where: { providerEventId: eventId } })).toBe(1)
  })

  it("retries webhook signature verification errors and rejects malformed bodies without storing them", async () => {
    const eventId = `WH-RETRY-${suffix}`
    const payload = JSON.stringify({ id: eventId, event_type: "OTHER.EVENT", resource: {} })
    gateway.setWebhookSignatureValid(true)
    gateway.failNext("verifyWebhookSignature", new Error("temporary verifier outage"))
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload,
    })
    expect(first.statusCode).toBe(503)
    expect(await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    })).toMatchObject({ signatureVerified: false, processedAt: null })

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload,
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ processed: true })
    expect(await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    })).toMatchObject({ signatureVerified: true, processedAt: expect.any(Date) })

    const malformed = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload: "{not-json",
    })
    expect(malformed.statusCode).toBe(400)
    const missingFields = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ event_type: "OTHER.EVENT" }),
    })
    expect(missingFields.statusCode).toBe(400)
    expect(await prisma.webhookEvent.count({
      where: { providerEventId: { startsWith: "invalid-" } },
    })).toBe(0)
  })

  it("returns 503 when verified webhook reconciliation fails and processes its retry", async () => {
    const invoice = await createInvoice(75)
    const paypalInvoice = await gateway.createDraftInvoice({
      invoiceNumber: `webhook-retry-${suffix}`,
      currency: "USD",
      invoiceDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      recipientEmail: `webhook-retry-${suffix}@example.test`,
      recipientName: "Webhook Retry Client",
      items: [{ name: "Consulting", quantity: 1, unitPrice: 75 }],
    })
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
      data: { status: "Sent", paypalInvoiceId: paypalInvoice.id },
    })
    const eventId = `WH-RECONCILE-${suffix}`
    const payload = JSON.stringify({
      id: eventId,
      event_type: "INVOICING.INVOICE.PAID",
      resource: { id: paypalInvoice.id },
    })
    gateway.setWebhookSignatureValid(true)
    gateway.failNext("getInvoice", new Error("temporary GET failure"))

    const failed = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload,
    })
    expect(failed.statusCode).toBe(503)
    expect(await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    })).toMatchObject({ signatureVerified: true, processedAt: null })

    const retry = await app.inject({
      method: "POST",
      url: "/api/v1/webhooks/paypal",
      headers: { "content-type": "application/json" },
      payload,
    })
    expect(retry.statusCode).toBe(200)
    expect(retry.json()).toMatchObject({ processed: true })
    expect(await prisma.webhookEvent.findUnique({
      where: { providerEventId: eventId },
    })).toMatchObject({ signatureVerified: true, processedAt: expect.any(Date), error: null })
  })

  it("executes Owner approveNow immediately, ending in Verified with exactly one audit trail", async () => {
    const invoice = await createInvoice(180)
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: headers(ownerToken),
      payload: {
        kind: "paypal_send_invoice",
        refId: invoice.id,
        approveNow: true,
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({
      status: "Verified",
      preparedBy: "Money Owner",
      decidedBy: "Money Owner",
    })

    const auditEvents = await prisma.auditEvent.findMany({
      where: { workspaceId },
      orderBy: { at: "asc" },
    })
    const requested = auditEvents.find((a) => a.action === "Approval requested" && a.ref === res.json().id)
    const approved = auditEvents.find(
      (a) => a.action === "Approved & submitted" && a.ref === res.json().id && a.detail.includes("auto-approved by Owner (self-requested)"),
    )
    const executed = auditEvents.find(
      (a) => a.action === "Invoice created & sent" && a.ref === invoice.id && a.detail.includes(invoice.id),
    )
    expect(requested).toBeDefined()
    expect(approved).toBeDefined()
    expect(executed).toBeDefined()
  })

  it("refuses approveNow for non-Owners with 403 forbidden_role", async () => {
    const invoice = await createInvoice(190)
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: headers(managerToken),
      payload: {
        kind: "paypal_send_invoice",
        refId: invoice.id,
        approveNow: true,
      },
    })
    expect(res.statusCode).toBe(403)
    expect(res.json()).toMatchObject({ code: "forbidden_role" })
  })

  it("prevents Finance Managers from approving requests they prepared themselves (maker-checker)", async () => {
    const invoice = await createInvoice(220)
    const propRes = await propose("paypal_send_invoice", invoice.id, managerToken)
    expect(propRes.statusCode).toBe(200)
    const approvalId = propRes.json().id

    const selfApprove = await approve(approvalId, managerToken)
    expect(selfApprove.statusCode).toBe(403)
    expect(selfApprove.json()).toMatchObject({ code: "maker_checker_violation" })

    const ownerApprove = await approve(approvalId, ownerToken)
    expect(ownerApprove.statusCode).toBe(200)
    expect(ownerApprove.json()).toMatchObject({ status: "Verified" })
  })

  it("does not call PayPal twice when replaying the same Idempotency-Key on approveNow", async () => {
    const invoice = await createInvoice(240)
    const callsBefore = gateway.calls.filter((c) => c.method === "sendInvoice").length
    const replayKey = `idemp-approve-now-${suffix}`

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: { ...headers(ownerToken), "idempotency-key": replayKey },
      payload: {
        kind: "paypal_send_invoice",
        refId: invoice.id,
        approveNow: true,
      },
    })
    expect(first.statusCode).toBe(200)
    expect(gateway.calls.filter((c) => c.method === "sendInvoice").length).toBe(callsBefore + 1)

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/approvals",
      headers: { ...headers(ownerToken), "idempotency-key": replayKey },
      payload: {
        kind: "paypal_send_invoice",
        refId: invoice.id,
        approveNow: true,
      },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().id).toBe(first.json().id)
    expect(gateway.calls.filter((c) => c.method === "sendInvoice").length).toBe(callsBefore + 1)
  })
})

