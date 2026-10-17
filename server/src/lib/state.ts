import type {
  Approval,
  AuditEvent,
  Role,
  SavedScenario,
  State,
  Transaction,
} from "../../../src/lib/types"
import { STATE_VERSION } from "../../../src/lib/seed"
import { prisma } from "../db"

const numberValue = (value: { toNumber(): number }) => value.toNumber()
const jsonArray = <T>(value: unknown): T[] => value as T[]
const jsonObject = <T extends object>(value: unknown): T => value as T
const demoAuditIds = new Set(["AU-2", "AU-3", "AU-4", "AU-5", "AU-6", "AU-7", "AU-8", "AU-9"])

export async function loadState(workspaceId: string, role: Role): Promise<State> {
  const [
    workspace,
    settings,
    memberships,
    clients,
    projects,
    invoices,
    transactions,
    employees,
    contractorBills,
    recurring,
    loans,
    offers,
    approvals,
    audit,
    scenarios,
  ] = await prisma.$transaction([
    prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId } }),
    prisma.workspaceSettings.findUniqueOrThrow({ where: { workspaceId } }),
    prisma.membership.findMany({ where: { workspaceId }, include: { user: true } }),
    prisma.client.findMany({ where: { workspaceId } }),
    prisma.project.findMany({ where: { workspaceId } }),
    prisma.invoice.findMany({ where: { workspaceId } }),
    prisma.transaction.findMany({ where: { workspaceId } }),
    prisma.employee.findMany({ where: { workspaceId } }),
    prisma.contractorBill.findMany({ where: { workspaceId } }),
    prisma.recurringCost.findMany({ where: { workspaceId } }),
    prisma.loan.findMany({ where: { workspaceId } }),
    prisma.loanOffer.findMany({ where: { workspaceId } }),
    prisma.approval.findMany({ where: { workspaceId, status: { not: "Stale" } } }),
    prisma.auditEvent.findMany({ where: { workspaceId }, orderBy: { at: "desc" } }),
    prisma.savedScenario.findMany({ where: { workspaceId }, orderBy: { createdAt: "asc" } }),
  ])

  const team = memberships
    .sort((left, right) => {
      const order = { Owner: 0, FinanceManager: 1, Viewer: 2 }
      return order[left.role] - order[right.role]
    })
    .map(({ role: memberRole, user }) => ({
      name: user.name,
      email: user.email,
      role: memberRole === "FinanceManager" ? "Finance Manager" as const : memberRole,
    }))

  return {
    version: STATE_VERSION,
    seededOn: workspace.seededOn,
    settings: {
      agencyName: workspace.name,
      agencyType: workspace.agencyType,
      teamSize: workspace.teamSize,
      location: workspace.location,
      website: workspace.website,
      ownerName: settings.ownerName,
      ownerEmail: settings.ownerEmail,
      reportingCurrency: "INR",
      usdRate: numberValue(settings.usdRate),
      safetyThreshold: numberValue(settings.safetyThreshold),
      defaultHorizon: settings.defaultHorizon as 7 | 30 | 90,
      planningScenario: settings.planningScenario,
      managerApprovalLimit: numberValue(settings.managerApprovalLimit),
      role,
      openingBalance: numberValue(settings.openingBalance),
      openingDate: settings.openingDate,
      notifications: jsonObject<Record<string, boolean>>(settings.notifications),
      team,
      readiness: jsonArray<boolean>(settings.readiness),
    },
    clients: clients.map((client) => ({
      id: client.id,
      name: client.name,
      email: client.email,
      country: client.country,
      currency: client.currency,
      avgDelayDays: client.avgDelayDays,
    })),
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      clientId: project.clientId,
      billing: project.billing,
      contractValue: numberValue(project.contractValue),
      budgetCost: numberValue(project.budgetCost),
      status: project.status,
      timeEntries: jsonArray(project.timeEntries),
      unassignedHours: project.unassignedHours,
      ...(project.retainer === null
        ? {}
        : { retainer: jsonObject<{ amount: number; dayOfMonth: number }>(project.retainer) }),
      ...(project.plannedBillings === null
        ? {}
        : { plannedBillings: jsonArray(project.plannedBillings) }),
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      clientId: invoice.clientId,
      ...(invoice.projectId ? { projectId: invoice.projectId } : {}),
      kind: invoice.kind,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      currency: invoice.currency,
      lineItems: jsonArray(invoice.lineItems),
      status: invoice.status,
      channel: invoice.channel === "BankTransfer" ? "Bank transfer" : invoice.channel,
      ...(invoice.paidDate ? { paidDate: invoice.paidDate } : {}),
      ...(invoice.paypalInvoiceId && invoice.paypalStatus && invoice.paypalPayerUrl
        ? {
            paypal: {
              invoiceId: invoice.paypalInvoiceId,
              status: invoice.paypalStatus,
              payerUrl: invoice.paypalPayerUrl,
              ...(invoice.paypalSentAt ? { sentAt: invoice.paypalSentAt.toISOString() } : {}),
              ...(invoice.paypalLastCheckedAt
                ? { lastCheckedAt: invoice.paypalLastCheckedAt.toISOString() }
                : {}),
              ...(invoice.paypalStatus === "PAID" ? { payerPaid: true } : {}),
            },
          }
        : {}),
      reminders: jsonArray(invoice.reminders),
      ...(invoice.expectedDelayOverride === null
        ? {}
        : { expectedDelayOverride: invoice.expectedDelayOverride }),
      ...(invoice.notes === null ? {} : { notes: invoice.notes }),
    })),
    transactions: transactions.map((transaction) => ({
      id: transaction.id,
      date: transaction.date,
      description: transaction.description,
      party: transaction.party,
      category: transaction.category,
      ...(transaction.projectId ? { projectId: transaction.projectId } : {}),
      type: transaction.type,
      amount: numberValue(transaction.amount),
      status: transaction.status,
      source: transaction.source === "CSVImport"
        ? "CSV import"
        : transaction.source === "InvoicePayment"
          ? "Invoice payment"
          : transaction.source,
      ...(transaction.invoiceId ? { invoiceId: transaction.invoiceId } : {}),
      ...(transaction.reference === null ? {} : { reference: transaction.reference }),
      ...(transaction.notes === null ? {} : { notes: transaction.notes }),
      ...(transaction.reviewReason === null
        ? {}
        : { reviewReason: transaction.reviewReason }),
    } satisfies Transaction)),
    employees: employees.map((employee) => ({
      id: employee.id,
      name: employee.name,
      role: employee.role,
      monthlySalary: numberValue(employee.monthlySalary),
      payDay: employee.payDay,
      status: employee.status,
      startDate: employee.startDate,
    })),
    contractorBills: contractorBills.map((bill) => ({
      id: bill.id,
      vendor: bill.vendor,
      ...(bill.projectId ? { projectId: bill.projectId } : {}),
      reference: bill.reference,
      amount: numberValue(bill.amount),
      dueDate: bill.dueDate,
      status: bill.status,
      ...(bill.paidDate ? { paidDate: bill.paidDate } : {}),
    })),
    recurring: recurring.map((cost) => ({
      id: cost.id,
      vendor: cost.vendor,
      category: cost.category,
      kind: cost.kind === "FixedCost" ? "Fixed cost" : cost.kind,
      amount: numberValue(cost.amount),
      ...(cost.previousAmount === null
        ? {}
        : { previousAmount: numberValue(cost.previousAmount) }),
      cycle: cost.cycle,
      nextDate: cost.nextDate,
      startedOn: cost.startedOn,
      status: cost.status,
      reviewed: cost.reviewed,
    })),
    loans: loans.map((loan) => ({
      id: loan.id,
      name: loan.name,
      lender: loan.lender,
      principal: numberValue(loan.principal),
      rate: numberValue(loan.rate),
      tenureMonths: loan.tenureMonths,
      startDate: loan.startDate,
      emiDay: loan.emiDay,
      ...(loan.prepaymentFeePct === null
        ? {}
        : { prepaymentFeePct: numberValue(loan.prepaymentFeePct) }),
    })),
    offers: offers.map((offer) => ({
      id: offer.id,
      name: offer.name,
      principal: numberValue(offer.principal),
      rate: numberValue(offer.rate),
      months: offer.months,
      fees: numberValue(offer.fees),
    })),
    approvals: approvals.flatMap((approval) => {
      if (approval.status === "Stale") return []
      return [{
        id: approval.id,
        kind: approval.kind,
        title: approval.title,
        recipient: approval.recipient,
        amount: numberValue(approval.amount),
        currency: approval.currency,
        amountINR: numberValue(approval.amountINR),
        refId: approval.refId,
        preparedBy: approval.preparedBy,
        requestedAt: approval.requestedAt.toISOString(),
        status: approval.status,
        idempotencyKey: approval.idempotencyKey,
        steps: jsonArray<string>(approval.steps),
        ...(approval.draft === null ? {} : { draft: approval.draft }),
        ...(approval.decidedBy === null ? {} : { decidedBy: approval.decidedBy }),
        ...(approval.decidedAt === null
          ? {}
          : { decidedAt: approval.decidedAt.toISOString() }),
        ...(approval.note === null ? {} : { note: approval.note }),
        ...(approval.result === null ? {} : { result: approval.result }),
      } satisfies Approval]
    }),
    audit: audit.map((event) => {
      const isDemoRecord = demoAuditIds.has(event.id)
      return {
        id: event.id,
        at: event.at.toISOString(),
        actor: isDemoRecord ? "Demo seed" : event.actor,
        action: isDemoRecord ? `Sample · ${event.action}` : event.action,
        detail: isDemoRecord
          ? "Sample audit history only; no underlying operation was performed."
          : event.detail,
        ...(event.ref === null ? {} : { ref: event.ref }),
        outcome: event.outcome,
      } satisfies AuditEvent
    }),
    scenarios: scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
      createdAt: scenario.createdAt.toISOString(),
      type: scenario.type,
      inputs: jsonObject<SavedScenario["inputs"]>(scenario.inputs),
    })),
    dismissedInsights: jsonArray<string>(settings.dismissedInsights),
    chat: [],
  }
}
