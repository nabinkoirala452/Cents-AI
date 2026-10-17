import { Prisma, type Currency } from "@prisma/client"
import type { Prisma as PrismaNamespace } from "@prisma/client"
import type { createSeed } from "../core"
import { payloadHash } from "./hash"

type DemoState = ReturnType<typeof createSeed>
type Transaction = PrismaNamespace.TransactionClient

const json = (value: unknown) => value as Prisma.InputJsonValue
const date = (value: string) => new Date(value)

export async function replaceDemoWorkspaceRecords(
  tx: Transaction,
  workspaceId: string,
  state: DemoState,
  currency: Currency,
  preparedUsers: Map<string, string>,
  scenarioCreatorUserId: string,
) {
  await tx.transaction.deleteMany({ where: { workspaceId } })
  await tx.paymentEvent.deleteMany({ where: { workspaceId } })
  await tx.invoice.deleteMany({ where: { workspaceId } })
  await tx.project.deleteMany({ where: { workspaceId } })
  await tx.client.deleteMany({ where: { workspaceId } })
  await tx.employee.deleteMany({ where: { workspaceId } })
  await tx.contractorBill.deleteMany({ where: { workspaceId } })
  await tx.recurringCost.deleteMany({ where: { workspaceId } })
  await tx.loan.deleteMany({ where: { workspaceId } })
  await tx.loanOffer.deleteMany({ where: { workspaceId } })
  await tx.savedScenario.deleteMany({ where: { workspaceId } })
  await tx.approval.deleteMany({ where: { workspaceId } })
  await tx.importJob.deleteMany({ where: { workspaceId } })

  await tx.client.createMany({
    data: state.clients.map(({ id, ...client }) => ({
      workspaceId,
      id,
      ...client,
      currency,
    })),
  })
  await tx.project.createMany({
    data: state.projects.map((project) => ({
      workspaceId,
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
      workspaceId,
      id: invoice.id,
      clientId: invoice.clientId,
      projectId: invoice.projectId,
      kind: invoice.kind,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency,
      lineItems: json(invoice.lineItems),
      status: invoice.status,
      channel: invoice.channel === "Bank transfer" ? "BankTransfer" : "PayPal",
      paidDate: invoice.paidDate,
      paypalInvoiceId: null,
      paypalInvoiceNumber: null,
      paypalStatus: null,
      paypalPayerUrl: null,
      paypalSentAt: null,
      paypalLastCheckedAt: null,
      reminders: json(invoice.reminders),
      expectedDelayOverride: invoice.expectedDelayOverride,
      notes: invoice.notes,
    })),
  })
  await tx.transaction.createMany({
    data: state.transactions.map((transaction) => ({
      workspaceId,
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
      reference: transaction.type === "Income" && transaction.invoiceId
        ? transaction.invoiceId
        : transaction.reference,
      notes: transaction.notes,
      reviewReason: transaction.reviewReason,
    })),
  })
  await tx.employee.createMany({
    data: state.employees.map((employee) => ({ workspaceId, ...employee })),
  })
  await tx.contractorBill.createMany({
    data: state.contractorBills.map((bill) => ({ workspaceId, ...bill })),
  })
  await tx.recurringCost.createMany({
    data: state.recurring.map((cost) => ({
      workspaceId,
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
    data: state.loans.map((loan) => ({ workspaceId, ...loan })),
  })
  await tx.loanOffer.createMany({
    data: state.offers.map((offer) => ({ workspaceId, ...offer })),
  })
  await tx.savedScenario.createMany({
    data: state.scenarios.map((scenario) => ({
      workspaceId,
      id: scenario.id,
      name: scenario.name,
      type: scenario.type,
      inputs: json(scenario.inputs),
      createdById: scenarioCreatorUserId,
      createdAt: date(scenario.createdAt),
    })),
  })
  await tx.approval.createMany({
    data: state.approvals.map((approval) => {
      const preparedByUserId = preparedUsers.get(approval.preparedBy) ?? null
      const payload = {
        kind: approval.kind,
        refId: approval.refId,
        recipient: approval.recipient,
        amount: approval.amount,
        currency,
        draft: approval.draft,
      }
      return {
        workspaceId,
        id: approval.id,
        kind: approval.kind,
        title: approval.title,
        recipient: approval.recipient,
        amount: approval.amount,
        currency,
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
        preparedByUserId,
        preparedByAgent: preparedByUserId === null,
        attempt: 1,
      }
    }),
  })
}
