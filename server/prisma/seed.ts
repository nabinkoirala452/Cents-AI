import { fileURLToPath } from "node:url"
import bcrypt from "bcryptjs"
import { Prisma, type PrismaClient } from "@prisma/client"
import { createSeed } from "../src/core"
import { config } from "../src/config"
import { prisma } from "../src/db"
import { payloadHash } from "../src/lib/hash"

export const DEMO_WORKSPACE_ID = "centsai-demo"

const json = (value: unknown) => value as Prisma.InputJsonValue
const date = (value: string) => new Date(value)
export async function seedDemoWorkspace(
  database: PrismaClient,
  password: string,
) {
  const state = createSeed()
  const passwordHash = await bcrypt.hash(password, 12)
  const users = await Promise.all([
    database.user.upsert({
      where: { email: "owner@centsai.demo" },
      create: { email: "owner@centsai.demo", name: "Alex Kumar", passwordHash },
      update: { name: "Alex Kumar", passwordHash },
    }),
    database.user.upsert({
      where: { email: "finance@centsai.demo" },
      create: { email: "finance@centsai.demo", name: "Neha Shah", passwordHash },
      update: { name: "Neha Shah", passwordHash },
    }),
    database.user.upsert({
      where: { email: "viewer@centsai.demo" },
      create: { email: "viewer@centsai.demo", name: "Mina Rao", passwordHash },
      update: { name: "Mina Rao", passwordHash },
    }),
  ])
  const [owner, financeManager, viewer] = users

  await database.$transaction(async (tx) => {
    await tx.transaction.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.paymentEvent.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.invoice.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.project.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.client.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.employee.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.contractorBill.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.recurringCost.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.loan.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.loanOffer.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.savedScenario.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.approval.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.importJob.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.idempotencyKey.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })
    await tx.membership.deleteMany({ where: { workspaceId: DEMO_WORKSPACE_ID } })

    await tx.workspace.upsert({
      where: { id: DEMO_WORKSPACE_ID },
      create: {
        id: DEMO_WORKSPACE_ID,
        name: state.settings.agencyName,
        currency: state.settings.currency,
        agencyType: state.settings.agencyType,
        teamSize: state.settings.teamSize,
        location: state.settings.location,
        website: state.settings.website,
        timezone: "America/Chicago",
        seededOn: state.seededOn,
      },
      update: {
        name: state.settings.agencyName,
        currency: state.settings.currency,
        agencyType: state.settings.agencyType,
        teamSize: state.settings.teamSize,
        location: state.settings.location,
        website: state.settings.website,
        timezone: "America/Chicago",
        seededOn: state.seededOn,
      },
    })

    await tx.workspaceSettings.upsert({
      where: { workspaceId: DEMO_WORKSPACE_ID },
      create: {
        workspaceId: DEMO_WORKSPACE_ID,
        safetyThreshold: state.settings.safetyThreshold,
        defaultHorizon: state.settings.defaultHorizon,
        planningScenario: state.settings.planningScenario,
        managerApprovalLimit: state.settings.managerApprovalLimit,
        openingBalance: state.settings.openingBalance,
        openingDate: state.settings.openingDate,
        ownerName: state.settings.ownerName,
        ownerEmail: state.settings.ownerEmail,
        notifications: json(state.settings.notifications),
        readiness: json(state.settings.readiness),
        dismissedInsights: json(state.dismissedInsights),
      },
      update: {
        safetyThreshold: state.settings.safetyThreshold,
        defaultHorizon: state.settings.defaultHorizon,
        planningScenario: state.settings.planningScenario,
        managerApprovalLimit: state.settings.managerApprovalLimit,
        openingBalance: state.settings.openingBalance,
        openingDate: state.settings.openingDate,
        ownerName: state.settings.ownerName,
        ownerEmail: state.settings.ownerEmail,
        notifications: json(state.settings.notifications),
        readiness: json(state.settings.readiness),
        dismissedInsights: json(state.dismissedInsights),
      },
    })

    await tx.membership.createMany({
      data: [
        { workspaceId: DEMO_WORKSPACE_ID, userId: owner.id, role: "Owner" },
        { workspaceId: DEMO_WORKSPACE_ID, userId: financeManager.id, role: "FinanceManager" },
        { workspaceId: DEMO_WORKSPACE_ID, userId: viewer.id, role: "Viewer" },
      ],
    })

    await tx.client.createMany({
      data: state.clients.map((client) => ({ workspaceId: DEMO_WORKSPACE_ID, ...client })),
    })
    await tx.project.createMany({
      data: state.projects.map((project) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        id: project.id,
        name: project.name,
        clientId: project.clientId,
        billing: project.billing,
        contractValue: project.contractValue,
        budgetCost: project.budgetCost,
        status: project.status,
        timeEntries: json(project.timeEntries),
        unassignedHours: project.unassignedHours,
        retainer: project.retainer === undefined ? Prisma.DbNull : json(project.retainer),
        plannedBillings: project.plannedBillings === undefined
          ? Prisma.DbNull
          : json(project.plannedBillings),
      })),
    })

    await tx.invoice.createMany({
      data: state.invoices.map((invoice) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        id: invoice.id,
        clientId: invoice.clientId,
        projectId: invoice.projectId,
        kind: invoice.kind,
        issueDate: invoice.issueDate,
        dueDate: invoice.dueDate,
        currency: invoice.currency,
        lineItems: json(invoice.lineItems),
        status: invoice.status,
        channel: invoice.channel === "Bank transfer" ? "BankTransfer" : "PayPal",
        paidDate: invoice.paidDate,
        paypalInvoiceId: invoice.paypal?.invoiceId,
        paypalStatus: invoice.paypal?.status,
        paypalPayerUrl: invoice.paypal?.payerUrl,
        paypalSentAt: invoice.paypal?.sentAt ? date(invoice.paypal.sentAt) : null,
        paypalLastCheckedAt: invoice.paypal?.lastCheckedAt
          ? date(invoice.paypal.lastCheckedAt)
          : null,
        reminders: json(invoice.reminders),
        expectedDelayOverride: invoice.expectedDelayOverride,
        notes: invoice.notes,
      })),
    })

    await tx.transaction.createMany({
      data: state.transactions.map((transaction) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        id: transaction.id,
        date: transaction.date,
        description: transaction.description,
        party: transaction.party,
        category: transaction.category,
        projectId: transaction.projectId,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        source: transaction.source === "CSV import"
          ? "CSVImport"
          : transaction.source === "Invoice payment"
            ? "InvoicePayment"
            : transaction.source,
        invoiceId: transaction.invoiceId,
        reference: transaction.reference,
        notes: transaction.notes,
        reviewReason: transaction.reviewReason,
      })),
    })
    await tx.employee.createMany({
      data: state.employees.map((employee) => ({ workspaceId: DEMO_WORKSPACE_ID, ...employee })),
    })
    await tx.contractorBill.createMany({
      data: state.contractorBills.map((bill) => ({ workspaceId: DEMO_WORKSPACE_ID, ...bill })),
    })
    await tx.recurringCost.createMany({
      data: state.recurring.map((cost) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        id: cost.id,
        vendor: cost.vendor,
        category: cost.category,
        kind: cost.kind === "Fixed cost" ? "FixedCost" : cost.kind,
        amount: cost.amount,
        previousAmount: cost.previousAmount,
        cycle: cost.cycle,
        nextDate: cost.nextDate,
        startedOn: cost.startedOn,
        status: cost.status,
        reviewed: cost.reviewed ?? false,
      })),
    })
    await tx.loan.createMany({
      data: state.loans.map((loan) => ({ workspaceId: DEMO_WORKSPACE_ID, ...loan })),
    })
    await tx.loanOffer.createMany({
      data: state.offers.map((offer) => ({ workspaceId: DEMO_WORKSPACE_ID, ...offer })),
    })
    await tx.approval.createMany({
      data: state.approvals.map((approval) => {
        const preparedUser = approval.preparedBy === "Neha Shah"
          ? financeManager.id
          : approval.preparedBy === "Alex Kumar"
            ? owner.id
            : null
        const payload = {
          kind: approval.kind,
          refId: approval.refId,
          recipient: approval.recipient,
          amount: approval.amount,
          currency: approval.currency,
          draft: approval.draft,
        }
        return {
          workspaceId: DEMO_WORKSPACE_ID,
          id: approval.id,
          kind: approval.kind,
          title: approval.title,
          recipient: approval.recipient,
          amount: approval.amount,
          currency: approval.currency,
          refId: approval.refId,
          preparedBy: approval.preparedBy,
          requestedAt: date(approval.requestedAt),
          status: approval.status,
          idempotencyKey: approval.idempotencyKey,
          steps: json(approval.steps),
          draft: approval.draft,
          decidedBy: approval.decidedBy,
          decidedAt: approval.decidedAt ? date(approval.decidedAt) : null,
          note: approval.note,
          result: approval.result,
          payload: json(payload),
          payloadHash: payloadHash(payload),
          preparedByUserId: preparedUser,
          preparedByAgent: preparedUser === null,
          attempt: 1,
        }
      }),
    })
    await tx.auditEvent.createMany({
      data: state.audit.map((event) => ({
        workspaceId: DEMO_WORKSPACE_ID,
        id: event.id,
        at: date(event.at),
        actor: event.actor,
        action: event.action,
        detail: event.detail,
        ref: event.ref,
        outcome: event.outcome,
      })),
      skipDuplicates: true,
    })
  }, { maxWait: 30_000, timeout: 120_000 })
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    await seedDemoWorkspace(prisma, config.seedDemoPassword)
    console.info("Demo workspace seeded.")
  } finally {
    await prisma.$disconnect()
  }
}
