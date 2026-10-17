import { randomUUID } from "node:crypto"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createSeed } from "../src/core"
import { prisma } from "../src/db"
import { buildApp } from "../src/app"
import { createAccessToken } from "../src/plugins/auth"

const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
const workspaceId = `records-${suffix}`
const otherWorkspaceId = `records-other-${suffix}`
const ownerId = `user-owner-${suffix}`
const viewerId = `user-viewer-${suffix}`
const ownerEmail = `records-owner-${suffix}@example.test`
const viewerEmail = `records-viewer-${suffix}@example.test`
const app = await buildApp()
let ownerToken = ""
let viewerToken = ""
let otherWorkspaceToken = ""

const headers = (token: string, workspace = workspaceId) => ({
  authorization: `Bearer ${token}`,
  "x-workspace-id": workspace,
})

async function createTestWorkspace(id: string) {
  const seed = createSeed()
  await prisma.workspace.create({
    data: {
      id,
      name: "Records Test",
      currency: "USD",
      agencyType: "Agency",
      teamSize: "1",
      location: "Austin",
      website: "",
      timezone: "UTC",
      seededOn: seed.seededOn,
      settings: {
        create: {
          safetyThreshold: 1000,
          defaultHorizon: 30,
          planningScenario: "expected",
          managerApprovalLimit: 6000,
          openingBalance: 10000,
          openingDate: "2026-01-01",
          ownerName: "Test Owner",
          ownerEmail,
          notifications: {},
          readiness: [],
          dismissedInsights: [],
        },
      },
    },
  })
}

beforeAll(async () => {
  await prisma.user.createMany({
    data: [
      { id: ownerId, email: ownerEmail, name: "Records Owner", passwordHash: "unused" },
      { id: viewerId, email: viewerEmail, name: "Records Viewer", passwordHash: "unused" },
    ],
  })
  await createTestWorkspace(workspaceId)
  await createTestWorkspace(otherWorkspaceId)
  await prisma.membership.createMany({
    data: [
      { workspaceId, userId: ownerId, role: "Owner" },
      { workspaceId, userId: viewerId, role: "Viewer" },
      { workspaceId: otherWorkspaceId, userId: ownerId, role: "Owner" },
    ],
  })
  ownerToken = await createAccessToken(ownerId)
  viewerToken = await createAccessToken(viewerId)
  otherWorkspaceToken = ownerToken
})

afterAll(async () => {
  await app.close()
  await prisma.$disconnect()
})

describe("record routes", () => {
  it("returns problem+json validation errors and denies Viewer mutations across record modules", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const mutations: Array<{ url: string; payload?: object }> = [
      {
        url: "/api/v1/transactions",
        payload: { date: today, description: "Expense", party: "Vendor", category: "Other", type: "Expense", amount: 1 },
      },
      { url: "/api/v1/transactions/import", payload: { fileName: "empty.csv", rows: [] } },
      { url: "/api/v1/clients", payload: { name: "Client", email: "valid@example.test", country: "US", avgDelayDays: 0 } },
      {
        url: "/api/v1/projects",
        payload: { name: "Project", clientId: "client-id", billing: "Fixed", contractValue: 1, budgetCost: 1, status: "Active", timeEntries: [], unassignedHours: 0 },
      },
      { url: "/api/v1/projects/project-id/time-entries", payload: { employeeId: "employee-id", hours: 1 } },
      {
        url: "/api/v1/invoices",
        payload: { clientId: "client-id", kind: "Project", issueDate: today, dueDate: today, lineItems: [{ description: "Work", quantity: 1, unitPrice: 1 }] },
      },
      { url: "/api/v1/employees", payload: { name: "Employee", role: "Designer", monthlySalary: 1, payDay: 1, status: "Active", startDate: today } },
      { url: "/api/v1/contractor-bills", payload: { vendor: "Vendor", reference: "R1", amount: 1, dueDate: today, status: "Pending" } },
      {
        url: "/api/v1/recurring-costs",
        payload: { vendor: "Service", category: "Software", kind: "Subscription", amount: 1, cycle: "Monthly", nextDate: today, startedOn: today, status: "Active" },
      },
      { url: "/api/v1/loans", payload: { name: "Loan", lender: "Bank", principal: 1, rate: 0, tenureMonths: 12, startDate: today, emiDay: 1 } },
      { url: "/api/v1/financing/offers", payload: { name: "Offer", principal: 1, rate: 0, months: 12, fees: 0 } },
      { url: "/api/v1/scenarios", payload: { name: "Scenario", type: "cash", inputs: { amount: 1 } } },
    ]

    for (const mutation of mutations) {
      const invalid = await app.inject({
        method: "POST",
        url: mutation.url,
        headers: headers(ownerToken),
        payload: {},
      })
      expect(invalid.statusCode, `${mutation.url} validation`).toBe(400)
      expect(invalid.headers["content-type"]).toContain("application/problem+json")

      const denied = await app.inject({
        method: "POST",
        url: mutation.url,
        headers: headers(viewerToken),
        payload: mutation.payload,
      })
      expect(denied.statusCode, `${mutation.url} permission`).toBe(403)
    }
  })

  it("enforces transaction validation, duplicates, immutability, deletion rules, and workspace scope", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const payload = {
      date: today,
      description: "Consulting payment",
      party: "Example Client",
      category: "Project revenue",
      type: "Income",
      amount: 240,
    }
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: headers(ownerToken),
      payload,
    })
    expect(created.statusCode).toBe(200)
    expect(created.json()).toMatchObject({ id: expect.stringMatching(/^TXN-/), status: "Recorded" })

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: headers(ownerToken),
      payload,
    })
    expect(duplicate.statusCode).toBe(200)
    expect(duplicate.json()).toMatchObject({
      status: "Review",
      reviewReason: expect.stringContaining(created.json().id),
    })

    const future = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)
    const futureResponse = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: headers(ownerToken),
      payload: { ...payload, date: future },
    })
    expect(futureResponse.statusCode).toBe(400)
    expect(futureResponse.headers["content-type"]).toContain("application/problem+json")

    const invalid = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: headers(ownerToken),
      payload: { ...payload, amount: 0 },
    })
    expect(invalid.statusCode).toBe(400)

    const verifiedId = `verified-${suffix}`
    await prisma.transaction.create({
      data: {
        workspaceId,
        id: verifiedId,
        date: today,
        description: "Verified receipt",
        party: "Example Client",
        category: "Project revenue",
        type: "Income",
        amount: 100,
        status: "Verified",
        source: "PayPal",
      },
    })
    const verifiedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${verifiedId}`,
      headers: headers(ownerToken),
      payload: { description: "Change not allowed" },
    })
    expect(verifiedEdit.statusCode).toBe(409)
    const verifiedAllowed = await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${verifiedId}`,
      headers: headers(ownerToken),
      payload: { category: "Other" },
    })
    expect(verifiedAllowed.statusCode).toBe(200)
    const verifiedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${verifiedId}`,
      headers: headers(ownerToken),
    })
    expect(verifiedDelete.statusCode).toBe(409)

    const linkedId = `linked-${suffix}`
    await prisma.transaction.create({
      data: {
        workspaceId,
        id: linkedId,
        date: today,
        description: "Invoice receipt",
        party: "Example Client",
        category: "Project revenue",
        type: "Income",
        amount: 100,
        status: "Recorded",
        source: "InvoicePayment",
        invoiceId: "INV-linked",
      },
    })
    const linkedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/transactions/${linkedId}`,
      headers: headers(ownerToken),
    })
    expect(linkedDelete.statusCode).toBe(409)

    const wrongWorkspace = await app.inject({
      method: "PATCH",
      url: `/api/v1/transactions/${created.json().id}`,
      headers: headers(otherWorkspaceToken, otherWorkspaceId),
      payload: { notes: "cross workspace" },
    })
    expect(wrongWorkspace.statusCode).toBe(404)

    const denied = await app.inject({
      method: "POST",
      url: "/api/v1/transactions",
      headers: headers(viewerToken),
      payload,
    })
    expect(denied.statusCode).toBe(403)
  })

  it("imports valid, duplicate, and invalid rows and records its ImportJob", async () => {
    const today = new Date().toISOString().slice(0, 10)
    await prisma.transaction.create({
      data: {
        workspaceId,
        id: `import-existing-${suffix}`,
        date: today,
        description: "Consulting payment",
        party: "Example Client",
        category: "Project revenue",
        type: "Income",
        amount: 240,
        status: "Recorded",
        source: "Manual",
      },
    })
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/transactions/import?skipDuplicates=false",
      headers: headers(ownerToken),
      payload: {
        fileName: "monthly.csv",
        rows: [
          { date: today, description: "New import", amount: 75, type: "Expense", party: "Vendor A", category: "Software" },
          { date: today, description: "Consulting payment", amount: 240, type: "Income", party: "Example Client", category: "Project revenue" },
          { date: "not-a-date", description: "Broken row", amount: 1, type: "Expense", party: "Vendor B", category: "Other" },
          { date: today, description: "Bad row", amount: 0, type: "Expense", party: "Vendor C", category: "Other" },
          { date: today, description: "", amount: 1, type: "Something", party: "", category: "" },
        ],
      },
    })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      imported: 2,
      duplicates: 1,
      invalid: 3,
    })
    expect(response.json().issues).toHaveLength(4)
    expect(await prisma.importJob.count({
      where: { workspaceId, fileName: "monthly.csv", imported: 2, duplicates: 1, invalid: 3 },
    })).toBe(1)

    const tooMany = await app.inject({
      method: "POST",
      url: "/api/v1/transactions/import",
      headers: headers(ownerToken),
      payload: { fileName: "large.csv", rows: Array.from({ length: 5001 }, () => ({})) },
    })
    expect(tooMany.statusCode).toBe(400)
  })

  it("creates and edits clients and projects, assigning hours from the unassigned pool", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const client = await app.inject({
      method: "POST",
      url: "/api/v1/clients",
      headers: headers(ownerToken),
      payload: { name: "Test Client", email: "client@example.test", country: "United States", avgDelayDays: 5 },
    })
    expect(client.statusCode).toBe(200)
    expect(client.json()).toMatchObject({ id: expect.stringMatching(/^c-/), currency: "USD" })

    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: headers(ownerToken),
      payload: { name: "Engineer", role: "Developer", monthlySalary: 5000, payDay: 15, status: "Active", startDate: today },
    })
    expect(employee.statusCode).toBe(200)

    const project = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: headers(ownerToken),
      payload: {
        name: "Test Project",
        clientId: client.json().id,
        billing: "Fixed",
        contractValue: 10000,
        budgetCost: 5000,
        status: "Active",
        timeEntries: [],
        unassignedHours: 12,
      },
    })
    expect(project.statusCode).toBe(200)
    const assigned = await app.inject({
      method: "POST",
      url: `/api/v1/projects/${project.json().id}/time-entries`,
      headers: headers(ownerToken),
      payload: { employeeId: employee.json().id, hours: 5 },
    })
    expect(assigned.statusCode).toBe(200)
    expect(assigned.json()).toMatchObject({
      unassignedHours: 7,
      timeEntries: [{ employeeId: employee.json().id, hours: 5 }],
    })
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/projects/${project.json().id}`,
      headers: headers(ownerToken),
      payload: { status: "Completed" },
    })
    expect(edited.statusCode).toBe(200)
    expect(edited.json().status).toBe("Completed")

    const foreign = await app.inject({
      method: "POST",
      url: "/api/v1/projects",
      headers: headers(ownerToken, otherWorkspaceId),
      payload: {
        name: "Foreign client ref",
        clientId: client.json().id,
        billing: "Fixed",
        contractValue: 1,
        budgetCost: 1,
        status: "Active",
        timeEntries: [],
        unassignedHours: 0,
      },
    })
    expect(foreign.statusCode).toBe(404)
  })

  it("enforces invoice creation, edit, issue, and approval-staleness rules", async () => {
    const client = await app.inject({
      method: "POST",
      url: "/api/v1/clients",
      headers: headers(ownerToken),
      payload: { name: "Invoice Client", email: "invoice@example.test", country: "United States", avgDelayDays: 0 },
    })
    const today = new Date().toISOString().slice(0, 10)
    const draft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Project",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "Design", quantity: 2, unitPrice: 250 }],
      },
    })
    expect(draft.statusCode).toBe(200)
    expect(draft.json()).toMatchObject({ id: expect.stringMatching(/^INV-\d{4,}$/), status: "Draft", channel: "PayPal", currency: "USD" })

    await prisma.approval.create({
      data: {
        workspaceId,
        id: `approval-${suffix}`,
        kind: "paypal_send_invoice",
        title: "Send invoice",
        recipient: "Invoice Client",
        amount: 500,
        currency: "USD",
        refId: draft.json().id,
        preparedBy: "Records Owner",
        requestedAt: new Date(),
        status: "Pending",
        idempotencyKey: `invoice-approval-${suffix}`,
        steps: ["send"],
        payload: {},
        payloadHash: "test",
      },
    })
    const edited = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${draft.json().id}`,
      headers: headers(ownerToken),
      payload: { notes: "Updated draft" },
    })
    expect(edited.statusCode).toBe(200)
    expect(await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: `approval-${suffix}` } },
    })).toMatchObject({ status: "Stale", decidedBy: "System" })
    const paypalIssue = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${draft.json().id}/issue`,
      headers: headers(ownerToken),
    })
    expect(paypalIssue.statusCode).toBe(409)
    const deleteDraft = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${draft.json().id}`,
      headers: headers(ownerToken),
    })
    expect(deleteDraft.statusCode).toBe(200)

    const executingDraft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Project",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "Executing approval", quantity: 1, unitPrice: 100 }],
      },
    })
    const submittedApprovalId = `approval-submitted-${suffix}`
    await prisma.approval.create({
      data: {
        workspaceId,
        id: submittedApprovalId,
        kind: "paypal_send_invoice",
        title: "Executing send",
        recipient: "Invoice Client",
        amount: 100,
        currency: "USD",
        refId: executingDraft.json().id,
        preparedBy: "Records Owner",
        requestedAt: new Date(),
        status: "Submitted",
        idempotencyKey: `invoice-submitted-${suffix}`,
        steps: ["send"],
        payload: {},
        payloadHash: "test",
      },
    })
    const blockedEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${executingDraft.json().id}`,
      headers: headers(ownerToken),
      payload: { notes: "Must not race with send" },
    })
    expect(blockedEdit.statusCode).toBe(409)
    expect(blockedEdit.json()).toMatchObject({ code: "approval_in_progress" })
    const blockedDelete = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${executingDraft.json().id}`,
      headers: headers(ownerToken),
    })
    expect(blockedDelete.statusCode).toBe(409)
    expect(blockedDelete.json()).toMatchObject({ code: "approval_in_progress" })
    expect(await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: submittedApprovalId } },
    })).toMatchObject({ status: "Submitted" })
    expect(await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: executingDraft.json().id } },
    })).not.toBeNull()

    const pendingDeleteDraft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Project",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "Pending delete", quantity: 1, unitPrice: 100 }],
      },
    })
    const pendingDeleteApprovalId = `approval-pending-delete-${suffix}`
    await prisma.approval.create({
      data: {
        workspaceId,
        id: pendingDeleteApprovalId,
        kind: "paypal_send_invoice",
        title: "Pending send",
        recipient: "Invoice Client",
        amount: 100,
        currency: "USD",
        refId: pendingDeleteDraft.json().id,
        preparedBy: "Records Owner",
        requestedAt: new Date(),
        status: "Pending",
        idempotencyKey: `invoice-pending-delete-${suffix}`,
        steps: ["send"],
        payload: {},
        payloadHash: "test",
      },
    })
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${pendingDeleteDraft.json().id}`,
      headers: headers(ownerToken),
    })).statusCode).toBe(200)
    expect(await prisma.approval.findUnique({
      where: { workspaceId_id: { workspaceId, id: pendingDeleteApprovalId } },
    })).toMatchObject({ status: "Stale", decidedBy: "System" })

    const invalidDates = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Project",
        issueDate: today,
        dueDate: "2020-01-01",
        lineItems: [{ description: "Design", quantity: 1, unitPrice: 100 }],
      },
    })
    expect(invalidDates.statusCode).toBe(400)

    const sent = await prisma.invoice.create({
      data: {
        workspaceId,
        id: `INV-sent-${suffix}`,
        clientId: client.json().id,
        kind: "Project",
        issueDate: today,
        dueDate: today,
        currency: "USD",
        lineItems: [{ description: "Design", quantity: 1, unitPrice: 100 }],
        status: "Sent",
        channel: "BankTransfer",
        reminders: [],
      },
    })
    const sentNotes = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${sent.id}`,
      headers: headers(ownerToken),
      payload: { expectedDelayOverride: 10, notes: "Payment expected later" },
    })
    expect(sentNotes.statusCode).toBe(200)
    const deleteSent = await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${sent.id}`,
      headers: headers(ownerToken),
    })
    expect(deleteSent.statusCode).toBe(409)
    const sentDateEdit = await app.inject({
      method: "PATCH",
      url: `/api/v1/invoices/${sent.id}`,
      headers: headers(ownerToken),
      payload: { dueDate: today },
    })
    expect(sentDateEdit.statusCode).toBe(409)

    const bankDraft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Retainer",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "Retainer", quantity: 1, unitPrice: 100 }],
        channel: "Bank transfer",
      },
    })
    const issue = await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${bankDraft.json().id}/issue`,
      headers: headers(ownerToken),
    })
    expect(issue.statusCode).toBe(200)
    expect(issue.json().status).toBe("Sent")

    const emptyObjectDraft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Retainer",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "No body validation", quantity: 1, unitPrice: 100 }],
        channel: "Bank transfer",
      },
    })
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${emptyObjectDraft.json().id}/issue`,
      headers: headers(ownerToken),
      payload: {},
    })).statusCode).toBe(200)
    const emptyBodyDraft = await app.inject({
      method: "POST",
      url: "/api/v1/invoices",
      headers: headers(ownerToken),
      payload: {
        clientId: client.json().id,
        kind: "Retainer",
        issueDate: today,
        dueDate: today,
        lineItems: [{ description: "Empty body", quantity: 1, unitPrice: 100 }],
        channel: "Bank transfer",
      },
    })
    expect((await app.inject({
      method: "POST",
      url: `/api/v1/invoices/${emptyBodyDraft.json().id}/issue`,
      headers: { ...headers(ownerToken), "content-type": "application/json" },
      payload: "",
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${executingDraft.json().id}`,
      headers: headers(ownerToken),
      payload: {},
    })).statusCode).toBe(409)
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/invoices/${emptyObjectDraft.json().id}`,
      headers: headers(ownerToken),
      payload: {},
    })).statusCode).toBe(409)
  })

  it("covers employees, bills, recurring reviews, loans, offers, scenarios, computed reads, and audit", async () => {
    const today = new Date().toISOString().slice(0, 10)
    const employee = await app.inject({
      method: "POST",
      url: "/api/v1/employees",
      headers: headers(ownerToken),
      payload: { name: "Temp Employee", role: "Designer", monthlySalary: 4500, payDay: 5, status: "Planned", startDate: today },
    })
    expect(employee.statusCode).toBe(200)
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/employees/${employee.json().id}`,
      headers: headers(ownerToken),
    })).statusCode).toBe(200)

    const bill = await app.inject({
      method: "POST",
      url: "/api/v1/contractor-bills",
      headers: headers(ownerToken),
      payload: { vendor: "Contractor", reference: "B-1", amount: 150, dueDate: today, status: "Pending" },
    })
    expect(bill.statusCode).toBe(200)
    const directPayment = await app.inject({
      method: "PATCH",
      url: `/api/v1/contractor-bills/${bill.json().id}`,
      headers: headers(ownerToken),
      payload: { status: "Paid" },
    })
    expect(directPayment.statusCode).toBe(409)
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/contractor-bills/${bill.json().id}`,
      headers: headers(ownerToken),
      payload: { status: "Scheduled" },
    })).statusCode).toBe(200)

    const recurring = await app.inject({
      method: "POST",
      url: "/api/v1/recurring-costs",
      headers: headers(ownerToken),
      payload: {
        vendor: "SaaS Vendor",
        category: "Software",
        kind: "Subscription",
        amount: 20,
        cycle: "Monthly",
        nextDate: today,
        startedOn: today,
        status: "Review",
      },
    })
    expect(recurring.statusCode).toBe(200)
    const directCancellation = await app.inject({
      method: "PATCH",
      url: `/api/v1/recurring-costs/${recurring.json().id}`,
      headers: headers(ownerToken),
      payload: { status: "Cancelled" },
    })
    expect(directCancellation.statusCode).toBe(409)
    const reviewed = await app.inject({
      method: "POST",
      url: `/api/v1/recurring-costs/${recurring.json().id}/review`,
      headers: headers(ownerToken),
    })
    expect(reviewed.json()).toMatchObject({ status: "Active", reviewed: true })

    const loan = await app.inject({
      method: "POST",
      url: "/api/v1/loans",
      headers: headers(ownerToken),
      payload: { name: "Equipment Loan", lender: "Bank", principal: 10000, rate: 8, tenureMonths: 24, startDate: today, emiDay: 10 },
    })
    expect(loan.statusCode).toBe(200)
    expect((await app.inject({
      method: "PATCH",
      url: `/api/v1/loans/${loan.json().id}`,
      headers: headers(ownerToken),
      payload: { rate: 7.5 },
    })).statusCode).toBe(200)

    const offer = await app.inject({
      method: "POST",
      url: "/api/v1/financing/offers",
      headers: headers(ownerToken),
      payload: { name: "Offer", principal: 5000, rate: 10, months: 12, fees: 100 },
    })
    expect(offer.statusCode).toBe(200)
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/financing/offers/${offer.json().id}`,
      headers: headers(ownerToken),
    })).statusCode).toBe(200)

    const scenario = await app.inject({
      method: "POST",
      url: "/api/v1/scenarios",
      headers: headers(ownerToken),
      payload: { name: "Hiring plan", type: "payroll", inputs: { hires: 2, date: today } },
    })
    expect(scenario.statusCode).toBe(200)
    expect((await app.inject({
      method: "DELETE",
      url: `/api/v1/scenarios/${scenario.json().id}`,
      headers: headers(ownerToken),
    })).statusCode).toBe(200)

    for (const url of [
      "/api/v1/cashflow/forecast?horizon=7&scenario=conservative",
      "/api/v1/cashflow/forecast?horizon=7&scenario=expected,conservative",
      "/api/v1/dashboard/summary?horizon=30",
      "/api/v1/briefing?horizon=90",
    ]) {
      const response = await app.inject({ method: "GET", url, headers: headers(viewerToken) })
      expect(response.statusCode).toBe(200)
    }
    const selectedForecast = await app.inject({
      method: "GET",
      url: "/api/v1/cashflow/forecast?horizon=7&scenario=expected,conservative",
      headers: headers(viewerToken),
    })
    expect(Object.keys(selectedForecast.json()).sort()).toEqual(["conservative", "expected"])
    const defaultForecast = await app.inject({
      method: "GET",
      url: "/api/v1/cashflow/forecast?horizon=7",
      headers: headers(viewerToken),
    })
    expect(defaultForecast.json()).toMatchObject({
      conservative: expect.any(Object),
      expected: expect.any(Object),
      optimistic: expect.any(Object),
    })
    expect((await app.inject({
      method: "GET",
      url: "/api/v1/cashflow/forecast?horizon=7&scenario=expected,bogus",
      headers: headers(viewerToken),
    })).statusCode).toBe(400)
    expect(await prisma.auditEvent.count({ where: { workspaceId } })).toBeGreaterThan(0)
  })
})
