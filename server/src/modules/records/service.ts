import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import type {
  Client,
  ContractorBill,
  Employee,
  Invoice,
  Loan,
  LoanOffer,
  Project,
  RecurringCost,
  SavedScenario,
  Transaction,
} from "../../../../src/lib/types"
import { createSeed, findDuplicate, parseLooseDate } from "../../core"
import { config } from "../../config"
import { prisma } from "../../db"
import { workspaceToday } from "../../lib/dates"
import { replaceDemoWorkspaceRecords } from "../../lib/demo-seed"
import { HttpError } from "../../lib/errors"
import { requireEdit, requireOwner, requireView } from "../../lib/permissions"
import { loadState } from "../../lib/state"
import type { RequestContext } from "../../plugins/auth"
import { audit } from "../audit/service"

type TransactionInput = Omit<Transaction, "id" | "status" | "source" | "invoiceId" | "reviewReason">
type TransactionPatch = Partial<TransactionInput>
type ClientInput = Omit<Client, "id" | "currency"> & { currency?: Client["currency"] }
type ProjectInput = Omit<Project, "id">
type EmployeeInput = Omit<Employee, "id">
type ContractorBillInput = Omit<ContractorBill, "id">
type RecurringInput = Omit<RecurringCost, "id">
type LoanInput = Omit<Loan, "id">
type OfferInput = Omit<LoanOffer, "id">
type ScenarioInput = Omit<SavedScenario, "id" | "createdAt">
type InvoiceInput = Pick<Invoice, "clientId" | "kind" | "issueDate" | "dueDate" | "lineItems">
  & Partial<Pick<Invoice, "projectId" | "channel" | "notes">>
type InvoicePatch = Partial<Pick<
  Invoice,
  "clientId" | "projectId" | "kind" | "issueDate" | "dueDate" | "lineItems" | "channel"
  | "expectedDelayOverride" | "notes"
>>

type Mutation = (
  ctx: RequestContext,
  input: { action: string; ref?: string; detail: string },
  operation: (tx: Prisma.TransactionClient) => Promise<unknown>,
) => Promise<unknown>

const id = (prefix: string) => `${prefix}-${randomUUID()}`
const json = (value: unknown) => value as Prisma.InputJsonValue
const jsonArray = <T>(value: Prisma.JsonValue): T[] => value as T[]
const jsonObject = <T extends object>(value: Prisma.JsonValue): T => value as T

const mutate: Mutation = async (ctx, event, operation) => {
  requireEdit(ctx.role)
  return prisma.$transaction(async (tx) => {
    const result = await operation(tx)
    await audit(ctx, {
      action: event.action,
      detail: event.detail,
      ...(event.ref ? { ref: event.ref } : {}),
      outcome: "success",
    }, tx)
    return result
  })
}

async function requireScopedEmployees(
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  employeeIds: string[],
) {
  if (employeeIds.length === 0) return
  const employees = await tx.employee.findMany({
    where: { workspaceId: ctx.workspaceId, id: { in: employeeIds } },
    select: { id: true },
  })
  if (employees.length !== new Set(employeeIds).size) {
    throw new HttpError(404, "employee_not_found", "One or more employees were not found in this workspace.", "Not Found")
  }
}

async function rejectExecutingInvoiceApproval(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  invoiceId: string,
) {
  const submitted = await tx.approval.findFirst({
    where: { workspaceId, refId: invoiceId, status: "Submitted" },
    select: { id: true },
  })
  if (submitted) {
    throw new HttpError(
      409,
      "approval_in_progress",
      "This invoice has an approval that is currently executing.",
      "Conflict",
    )
  }
}

function notFound(kind: string): never {
  throw new HttpError(404, `${kind}_not_found`, `${kind} was not found in this workspace.`, "Not Found")
}

async function requireScopedProject(tx: Prisma.TransactionClient, ctx: RequestContext, projectId?: string) {
  if (!projectId) return
  const project = await tx.project.findUnique({
    where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: projectId } },
    select: { id: true },
  })
  if (!project) notFound("Project")
}

async function requireScopedClient(tx: Prisma.TransactionClient, ctx: RequestContext, clientId: string) {
  const client = await tx.client.findUnique({
    where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: clientId } },
    select: { id: true },
  })
  if (!client) notFound("Client")
}

async function requireProjectClient(
  tx: Prisma.TransactionClient,
  ctx: RequestContext,
  projectId: string | undefined,
  clientId: string,
) {
  if (!projectId) return
  const project = await tx.project.findUnique({
    where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: projectId } },
    select: { clientId: true },
  })
  if (!project) notFound("Project")
  if (project.clientId !== clientId) {
    throw new HttpError(400, "invoice_project_client_mismatch", "The invoice project must belong to the selected client.", "Bad Request")
  }
}

export async function currentDate(ctx: RequestContext): Promise<string> {
  return workspaceToday(ctx.workspaceId)
}

type RecordCollection =
  | "transactions" | "clients" | "projects" | "invoices" | "employees"
  | "contractorBills" | "recurring" | "loans" | "offers" | "scenarios"

async function stateRecord(
  ctx: RequestContext,
  collection: RecordCollection,
  recordId: string,
): Promise<unknown> {
  const where = { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } }
  switch (collection) {
    case "transactions": {
      const row = await prisma.transaction.findUnique({ where })
      if (!row) notFound("Transaction")
      return {
        id: row.id,
        date: row.date,
        description: row.description,
        party: row.party,
        category: row.category,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        type: row.type,
        amount: row.amount.toNumber(),
        status: row.status,
        source: row.source === "CSVImport"
          ? "CSV import"
          : row.source === "InvoicePayment"
            ? "Invoice payment"
            : row.source,
        ...(row.invoiceId ? { invoiceId: row.invoiceId } : {}),
        ...(row.reference === null ? {} : { reference: row.reference }),
        ...(row.notes === null ? {} : { notes: row.notes }),
        ...(row.reviewReason === null ? {} : { reviewReason: row.reviewReason }),
      }
    }
    case "clients": {
      const row = await prisma.client.findUnique({ where })
      if (!row) notFound("Client")
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        country: row.country,
        currency: row.currency,
        avgDelayDays: row.avgDelayDays,
      }
    }
    case "projects": {
      const row = await prisma.project.findUnique({ where })
      if (!row) notFound("Project")
      return {
        id: row.id,
        name: row.name,
        clientId: row.clientId,
        billing: row.billing,
        contractValue: row.contractValue.toNumber(),
        budgetCost: row.budgetCost.toNumber(),
        status: row.status,
        timeEntries: jsonArray<{ employeeId: string; hours: number }>(row.timeEntries),
        unassignedHours: row.unassignedHours,
        ...(row.retainer === null ? {} : { retainer: jsonObject<{ amount: number; dayOfMonth: number }>(row.retainer) }),
        ...(row.plannedBillings === null
          ? {}
          : { plannedBillings: jsonArray<{ date: string; amount: number; label: string }>(row.plannedBillings) }),
      }
    }
    case "invoices": {
      const row = await prisma.invoice.findUnique({ where })
      if (!row) notFound("Invoice")
      return {
        id: row.id,
        clientId: row.clientId,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        kind: row.kind,
        issueDate: row.issueDate,
        dueDate: row.dueDate,
        currency: row.currency,
        lineItems: jsonArray<Invoice["lineItems"][number]>(row.lineItems),
        status: row.status,
        channel: row.channel === "BankTransfer" ? "Bank transfer" : row.channel,
        ...(row.paidDate ? { paidDate: row.paidDate } : {}),
        ...(row.paypalInvoiceId && row.paypalStatus && row.paypalPayerUrl
          ? {
              paypal: {
                invoiceId: row.paypalInvoiceId,
                status: row.paypalStatus,
                payerUrl: row.paypalPayerUrl,
                ...(row.paypalSentAt ? { sentAt: row.paypalSentAt.toISOString() } : {}),
                ...(row.paypalLastCheckedAt ? { lastCheckedAt: row.paypalLastCheckedAt.toISOString() } : {}),
              },
            }
          : {}),
        reminders: jsonArray<Invoice["reminders"][number]>(row.reminders),
        ...(row.expectedDelayOverride === null ? {} : { expectedDelayOverride: row.expectedDelayOverride }),
        ...(row.notes === null ? {} : { notes: row.notes }),
      }
    }
    case "employees": {
      const row = await prisma.employee.findUnique({ where })
      if (!row) notFound("Employee")
      return {
        id: row.id,
        name: row.name,
        role: row.role,
        monthlySalary: row.monthlySalary.toNumber(),
        payDay: row.payDay,
        status: row.status,
        startDate: row.startDate,
      }
    }
    case "contractorBills": {
      const row = await prisma.contractorBill.findUnique({ where })
      if (!row) notFound("Contractor bill")
      return {
        id: row.id,
        vendor: row.vendor,
        ...(row.projectId ? { projectId: row.projectId } : {}),
        reference: row.reference,
        amount: row.amount.toNumber(),
        dueDate: row.dueDate,
        status: row.status,
        ...(row.paidDate ? { paidDate: row.paidDate } : {}),
      }
    }
    case "recurring": {
      const row = await prisma.recurringCost.findUnique({ where })
      if (!row) notFound("Recurring cost")
      return {
        id: row.id,
        vendor: row.vendor,
        category: row.category,
        kind: row.kind === "FixedCost" ? "Fixed cost" : row.kind,
        amount: row.amount.toNumber(),
        ...(row.previousAmount === null ? {} : { previousAmount: row.previousAmount.toNumber() }),
        cycle: row.cycle,
        nextDate: row.nextDate,
        startedOn: row.startedOn,
        status: row.status,
        reviewed: row.reviewed,
      }
    }
    case "loans": {
      const row = await prisma.loan.findUnique({ where })
      if (!row) notFound("Loan")
      return {
        id: row.id,
        name: row.name,
        lender: row.lender,
        principal: row.principal.toNumber(),
        rate: row.rate.toNumber(),
        tenureMonths: row.tenureMonths,
        startDate: row.startDate,
        emiDay: row.emiDay,
        ...(row.prepaymentFeePct === null ? {} : { prepaymentFeePct: row.prepaymentFeePct.toNumber() }),
      }
    }
    case "offers": {
      const row = await prisma.loanOffer.findUnique({ where })
      if (!row) notFound("Financing offer")
      return {
        id: row.id,
        name: row.name,
        principal: row.principal.toNumber(),
        rate: row.rate.toNumber(),
        months: row.months,
        fees: row.fees.toNumber(),
      }
    }
    case "scenarios": {
      const row = await prisma.savedScenario.findUnique({ where })
      if (!row) notFound("Scenario")
      return {
        id: row.id,
        name: row.name,
        createdAt: row.createdAt.toISOString(),
        type: row.type,
        inputs: jsonObject<SavedScenario["inputs"]>(row.inputs),
      }
    }
  }
}

export async function createTransaction(ctx: RequestContext, input: TransactionInput) {
  requireEdit(ctx.role)
  const today = await currentDate(ctx)
  if (input.date > today) {
    throw new HttpError(400, "future_transaction_date", "Transactions can't be dated in the future.", "Bad Request")
  }
  return mutate(ctx, {
    action: "Transaction added",
    detail: `${input.description} · ${input.amount}`,
  }, async (tx) => {
    await requireScopedProject(tx, ctx, input.projectId)
    const existing = await tx.transaction.findMany({ where: { workspaceId: ctx.workspaceId } })
    const candidates: Transaction[] = existing.map((record) => ({
      id: record.id,
      date: record.date,
      description: record.description,
      party: record.party,
      category: record.category,
      ...(record.projectId ? { projectId: record.projectId } : {}),
      type: record.type,
      amount: record.amount.toNumber(),
      status: record.status,
      source: record.source === "CSVImport"
        ? "CSV import"
        : record.source === "InvoicePayment"
          ? "Invoice payment"
          : record.source,
      ...(record.invoiceId ? { invoiceId: record.invoiceId } : {}),
      ...(record.reference === null ? {} : { reference: record.reference }),
      ...(record.notes === null ? {} : { notes: record.notes }),
      ...(record.reviewReason === null ? {} : { reviewReason: record.reviewReason }),
    }))
    const duplicate = findDuplicate(candidates, input)
    const transactionId = id("TXN")
    await tx.transaction.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: transactionId,
        ...input,
        amount: input.amount,
        status: duplicate ? "Review" : "Recorded",
        source: "Manual",
        reviewReason: duplicate
          ? `Possible duplicate of ${duplicate.id} (${duplicate.party}, same amount within 2 days)`
          : null,
      },
    })
    return transactionId
  }).then((transactionId) => stateRecord(ctx, "transactions", String(transactionId)))
}

export async function patchTransaction(ctx: RequestContext, transactionId: string, patch: TransactionPatch) {
  requireEdit(ctx.role)
  const today = await currentDate(ctx)
  return mutate(ctx, {
    action: "Transaction edited",
    ref: transactionId,
    detail: `${transactionId} updated`,
  }, async (tx) => {
    const record = await tx.transaction.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: transactionId } },
    })
    if (!record) notFound("Transaction")
    if (record.status === "Verified") {
      const disallowed = Object.keys(patch).some((key) => !["category", "projectId", "notes"].includes(key))
      if (disallowed) {
        throw new HttpError(409, "verified_transaction_locked", "Verified transactions may only update category, projectId, and notes.", "Conflict")
      }
    }
    const nextDate = patch.date ?? record.date
    if (nextDate > today) {
      throw new HttpError(400, "future_transaction_date", "Transactions can't be dated in the future.", "Bad Request")
    }
    await requireScopedProject(tx, ctx, patch.projectId ?? record.projectId ?? undefined)
    const duplicateFields = {
      date: nextDate,
      amount: patch.amount ?? record.amount.toNumber(),
      party: patch.party ?? record.party,
      description: patch.description ?? record.description,
    }
    const existing = await tx.transaction.findMany({
      where: { workspaceId: ctx.workspaceId, id: { not: transactionId } },
    })
    const candidates: Transaction[] = existing.map((item) => ({
      id: item.id,
      date: item.date,
      description: item.description,
      party: item.party,
      category: item.category,
      type: item.type,
      amount: item.amount.toNumber(),
      status: item.status,
      source: item.source === "CSVImport" ? "CSV import" : item.source === "InvoicePayment" ? "Invoice payment" : item.source,
    }))
    const duplicate = record.status === "Verified" ? undefined : findDuplicate(candidates, duplicateFields)
    await tx.transaction.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: transactionId } },
      data: {
        ...patch,
        ...(duplicate
          ? {
              status: "Review" as const,
              reviewReason: `Possible duplicate of ${duplicate.id} (${duplicate.party}, same amount within 2 days)`,
            }
          : {}),
      },
    })
    return transactionId
  }).then((result) => stateRecord(ctx, "transactions", String(result)))
}

export async function deleteTransaction(ctx: RequestContext, transactionId: string) {
  await mutate(ctx, {
    action: "Transaction deleted",
    ref: transactionId,
    detail: `${transactionId} deleted`,
  }, async (tx) => {
    const record = await tx.transaction.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: transactionId } },
      select: { id: true, status: true, invoiceId: true },
    })
    if (!record) notFound("Transaction")
    if (record.status === "Verified") {
      throw new HttpError(409, "verified_transaction_locked", "Verified transactions cannot be deleted.", "Conflict")
    }
    if (record.invoiceId) {
      throw new HttpError(409, "invoice_transaction_locked", "Invoice-linked transactions cannot be deleted.", "Conflict")
    }
    await tx.transaction.delete({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: transactionId } } })
    return record.id
  })
}

export async function importTransactions(
  ctx: RequestContext,
  fileName: string,
  rows: unknown[],
  skipDuplicates: boolean,
) {
  requireEdit(ctx.role)
  if (rows.length > 5000) {
    throw new HttpError(400, "too_many_import_rows", "A transaction import may contain at most 5,000 rows.", "Bad Request")
  }
  const today = await currentDate(ctx)
  return prisma.$transaction(async (tx) => {
    requireEdit(ctx.role)
    const priorRecords = await tx.transaction.findMany({ where: { workspaceId: ctx.workspaceId } })
    const accepted: Transaction[] = priorRecords.map((record) => ({
      id: record.id,
      date: record.date,
      description: record.description,
      party: record.party,
      category: record.category,
      type: record.type,
      amount: record.amount.toNumber(),
      status: record.status,
      source: record.source === "CSVImport" ? "CSV import" : record.source === "InvoicePayment" ? "Invoice payment" : record.source,
    }))
    const issues: { row: number; reason: string }[] = []
    const importedRecords: Array<{
      id: string
      date: string
      description: string
      party: string
      category: string
      type: "Income" | "Expense"
      amount: number
      status: "Review" | "Recorded"
      reviewReason?: string
    }> = []
    let imported = 0
    let duplicates = 0
    let invalid = 0
    for (const [index, rawRow] of rows.entries()) {
      const row = typeof rawRow === "object" && rawRow !== null && !Array.isArray(rawRow)
        ? rawRow as Record<string, unknown>
        : {}
      const date = typeof row.date === "string" ? parseLooseDate(row.date) : null
      const amount = typeof row.amount === "number"
        ? row.amount
        : typeof row.amount === "string"
          ? Number(row.amount.trim())
          : Number.NaN
      const description = typeof row.description === "string" ? row.description.trim() : ""
      const party = typeof row.party === "string" ? row.party.trim() : ""
      const category = typeof row.category === "string" ? row.category.trim() : ""
      const type = row.type === "Income" || row.type === "Expense" ? row.type : undefined
      const invalidReason = !date
        ? "Unreadable or missing date"
        : date > today
          ? "Date is in the future"
          : !description
            ? "Missing description"
            : !Number.isFinite(amount) || amount <= 0
              ? "Amount must be greater than zero"
              : !type
                ? "Type must be Income or Expense"
                : !party
                  ? "Missing party"
                  : !category
                    ? "Missing category"
                    : undefined
      if (invalidReason) {
        invalid++
        issues.push({ row: index + 1, reason: invalidReason })
        continue
      }

      const candidate = { date: date!, amount, party, description }
      const duplicate = findDuplicate(accepted, candidate)
      if (duplicate) {
        duplicates++
        issues.push({ row: index + 1, reason: `Possible duplicate of ${duplicate.id}` })
        if (skipDuplicates) continue
      }
      const transactionId = id("TXN")
      const reviewReason = duplicate
        ? `Possible duplicate of ${duplicate.id} (imported from ${fileName})`
        : category.toLowerCase() === "uncategorized"
          ? "Imported without a category"
          : undefined
      importedRecords.push({
        id: transactionId,
        date: date!,
        description,
        party,
        category,
        type: type!,
        amount,
        status: reviewReason ? "Review" : "Recorded",
        ...(reviewReason ? { reviewReason } : {}),
      })
      accepted.push({
        id: transactionId,
        ...candidate,
        category,
        type: type!,
        status: reviewReason ? "Review" : "Recorded",
        source: "CSV import",
        ...(reviewReason ? { reviewReason } : {}),
      })
      imported++
    }
    const importJobId = id("IMP")
    await tx.importJob.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: importJobId,
        fileName,
        rowCount: rows.length,
        imported,
        duplicates,
        invalid,
        createdById: ctx.userId,
      },
    })
    if (importedRecords.length > 0) {
      await tx.transaction.createMany({
        data: importedRecords.map((record) => ({
          workspaceId: ctx.workspaceId,
          ...record,
          source: "CSVImport",
          importJobId,
        })),
      })
    }
    await audit(ctx, {
      action: "CSV imported",
      detail: `${fileName}: ${imported} imported, ${duplicates} duplicates, ${invalid} invalid rows`,
      outcome: duplicates || invalid ? "warning" : "success",
    }, tx)
    return { imported, duplicates, invalid, issues }
  })
}

export async function createClient(ctx: RequestContext, input: ClientInput) {
  requireEdit(ctx.role)
  const recordId = id("c")
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: ctx.workspaceId },
    select: { currency: true },
  })
  if (input.currency !== undefined && input.currency !== workspace.currency) {
    throw new HttpError(400, "workspace_currency_mismatch", "Client currency must match the workspace currency.", "Bad Request")
  }
  await mutate(ctx, { action: "Client added", ref: recordId, detail: input.name }, async (tx) => {
    await tx.client.create({ data: { workspaceId: ctx.workspaceId, id: recordId, ...input, currency: workspace.currency } })
  })
  return stateRecord(ctx, "clients", recordId)
}

export async function patchClient(ctx: RequestContext, recordId: string, patch: Partial<ClientInput>) {
  await mutate(ctx, { action: "Client updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const record = await tx.client.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!record) notFound("Client")
    if (patch.currency !== undefined && patch.currency !== record.currency) {
      throw new HttpError(400, "workspace_currency_mismatch", "Client currency must match the workspace currency.", "Bad Request")
    }
    await tx.client.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } },
      data: { ...patch, currency: record.currency },
    })
  })
  return stateRecord(ctx, "clients", recordId)
}

export async function createProject(ctx: RequestContext, input: ProjectInput) {
  const recordId = id("p")
  await mutate(ctx, { action: "Project added", ref: recordId, detail: input.name }, async (tx) => {
    await requireScopedClient(tx, ctx, input.clientId)
    await requireScopedEmployees(tx, ctx, input.timeEntries.map((entry) => entry.employeeId))
    await tx.project.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: recordId,
        name: input.name,
        clientId: input.clientId,
        billing: input.billing,
        contractValue: input.contractValue,
        budgetCost: input.budgetCost,
        status: input.status,
        timeEntries: json(input.timeEntries),
        unassignedHours: input.unassignedHours,
        retainer: input.retainer === undefined ? Prisma.DbNull : json(input.retainer),
        plannedBillings: input.plannedBillings === undefined ? Prisma.DbNull : json(input.plannedBillings),
      },
    })
  })
  return stateRecord(ctx, "projects", recordId)
}

export async function patchProject(ctx: RequestContext, recordId: string, patch: Partial<ProjectInput>) {
  await mutate(ctx, { action: "Project updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const existing = await tx.project.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Project")
    if (patch.clientId) await requireScopedClient(tx, ctx, patch.clientId)
    if (patch.timeEntries) {
      await requireScopedEmployees(tx, ctx, patch.timeEntries.map((entry) => entry.employeeId))
    }
    await tx.project.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } },
      data: {
        ...patch,
        ...(patch.timeEntries === undefined ? {} : { timeEntries: json(patch.timeEntries) }),
        ...(patch.retainer === undefined ? {} : { retainer: json(patch.retainer) }),
        ...(patch.plannedBillings === undefined ? {} : { plannedBillings: json(patch.plannedBillings) }),
      },
    })
  })
  return stateRecord(ctx, "projects", recordId)
}

export async function addProjectTimeEntry(
  ctx: RequestContext,
  projectId: string,
  input: { employeeId: string; hours: number },
) {
  await mutate(ctx, { action: "Hours attributed", ref: projectId, detail: `${input.hours}h attributed to employee ${input.employeeId}` }, async (tx) => {
    const project = await tx.project.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: projectId } } })
    if (!project) notFound("Project")
    const employee = await tx.employee.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: input.employeeId } },
      select: { id: true },
    })
    if (!employee) notFound("Employee")
    const entries = project.timeEntries as { employeeId: string; hours: number }[]
    const existing = entries.find((entry) => entry.employeeId === input.employeeId)
    if (existing) existing.hours += input.hours
    else entries.push(input)
    await tx.project.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: projectId } },
      data: {
        timeEntries: json(entries),
        unassignedHours: Math.max(0, project.unassignedHours - input.hours),
      },
    })
  })
  return stateRecord(ctx, "projects", projectId)
}

export async function createInvoice(ctx: RequestContext, input: InvoiceInput) {
  const recordId = await prisma.$transaction(async (tx) => {
    requireEdit(ctx.role)
    await tx.$queryRaw`
      WITH invoice_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${`invoice:${ctx.workspaceId}`}))
      )
      SELECT 1 FROM invoice_lock
    `
    await requireScopedClient(tx, ctx, input.clientId)
    await requireProjectClient(tx, ctx, input.projectId, input.clientId)
    const last = await tx.invoice.findMany({
      where: { workspaceId: ctx.workspaceId, id: { startsWith: "INV-" } },
      select: { id: true },
    })
    const next = last.reduce((maximum, invoice) => {
      const match = /^INV-(\d+)$/.exec(invoice.id)
      return match ? Math.max(maximum, Number(match[1])) : maximum
    }, 0) + 1
    const invoiceId = `INV-${String(next).padStart(4, "0")}`
    const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: ctx.workspaceId }, select: { currency: true } })
    await tx.invoice.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: invoiceId,
        clientId: input.clientId,
        projectId: input.projectId,
        kind: input.kind,
        issueDate: input.issueDate,
        dueDate: input.dueDate,
        currency: workspace.currency,
        lineItems: json(input.lineItems),
        status: "Draft",
        channel: input.channel === "Bank transfer" ? "BankTransfer" : "PayPal",
        reminders: [],
        notes: input.notes,
      },
    })
    await audit(ctx, {
      action: "Invoice drafted",
      detail: `${invoiceId} created as Draft`,
      ref: invoiceId,
      outcome: "success",
    }, tx)
    return invoiceId
  })
  return stateRecord(ctx, "invoices", recordId)
}

export async function patchInvoice(ctx: RequestContext, invoiceId: string, patch: InvoicePatch) {
  await prisma.$transaction(async (tx) => {
    requireEdit(ctx.role)
    const invoice = await tx.invoice.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } },
    })
    if (!invoice) notFound("Invoice")
    await rejectExecutingInvoiceApproval(tx, ctx.workspaceId, invoiceId)
    const draftKeys = new Set(["clientId", "projectId", "kind", "issueDate", "dueDate", "lineItems", "channel", "expectedDelayOverride", "notes"])
    const restrictedKeys = Object.keys(patch).filter((key) => !["expectedDelayOverride", "notes"].includes(key))
    if (invoice.status === "Sent" && restrictedKeys.length > 0) {
      throw new HttpError(409, "sent_invoice_locked", "Sent invoices may only update expectedDelayOverride and notes.", "Conflict")
    }
    if (invoice.status !== "Draft" && invoice.status !== "Sent") {
      throw new HttpError(409, "invoice_not_editable", "Only Draft and Sent invoices can be edited.", "Conflict")
    }
    if (Object.keys(patch).some((key) => !draftKeys.has(key))) {
      throw new HttpError(400, "invalid_invoice_patch", "The invoice patch contains unsupported fields.", "Bad Request")
    }
    if (patch.clientId) await requireScopedClient(tx, ctx, patch.clientId)
    await requireProjectClient(
      tx,
      ctx,
      patch.projectId === undefined ? invoice.projectId ?? undefined : patch.projectId,
      patch.clientId ?? invoice.clientId,
    )
    const issueDate = patch.issueDate ?? invoice.issueDate
    const dueDate = patch.dueDate ?? invoice.dueDate
    if (dueDate < issueDate) {
      throw new HttpError(400, "invoice_due_before_issue", "Invoice dueDate must be on or after issueDate.", "Bad Request")
    }
    const { channel, lineItems, ...invoiceFields } = patch
    await tx.invoice.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } },
      data: {
        ...invoiceFields,
        ...(lineItems === undefined ? {} : { lineItems: json(lineItems) }),
        ...(channel === undefined ? {} : { channel: channel === "Bank transfer" ? "BankTransfer" : "PayPal" }),
      },
    })
    if (invoice.status === "Draft") {
      await tx.approval.updateMany({
        where: {
          workspaceId: ctx.workspaceId,
          refId: invoiceId,
          status: "Pending",
        },
        data: { status: "Stale", decidedBy: "System", decidedAt: new Date(), note: "Invoice draft changed" },
      })
    }
    await audit(ctx, {
      action: "Invoice updated",
      detail: `${invoiceId} updated`,
      ref: invoiceId,
      outcome: "success",
    }, tx)
  })
  return stateRecord(ctx, "invoices", invoiceId)
}

export async function deleteInvoice(ctx: RequestContext, invoiceId: string) {
  await mutate(ctx, { action: "Invoice deleted", ref: invoiceId, detail: `${invoiceId} deleted` }, async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } } })
    if (!invoice) notFound("Invoice")
    if (invoice.status !== "Draft") {
      throw new HttpError(409, "invoice_not_draft", "Only Draft invoices can be deleted.", "Conflict")
    }
    await rejectExecutingInvoiceApproval(tx, ctx.workspaceId, invoiceId)
    await tx.approval.updateMany({
      where: {
        workspaceId: ctx.workspaceId,
        refId: invoiceId,
        status: "Pending",
      },
      data: { status: "Stale", decidedBy: "System", decidedAt: new Date(), note: "Invoice draft deleted" },
    })
    await tx.invoice.delete({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } } })
  })
}

export async function issueBankTransferInvoice(ctx: RequestContext, invoiceId: string) {
  await mutate(ctx, { action: "Invoice issued", ref: invoiceId, detail: `${invoiceId} issued by bank transfer` }, async (tx) => {
    const invoice = await tx.invoice.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } } })
    if (!invoice) notFound("Invoice")
    if (invoice.status !== "Draft" || invoice.channel !== "BankTransfer") {
      throw new HttpError(409, "invoice_cannot_be_issued", "Only Draft bank-transfer invoices can be issued here. PayPal invoices require approval.", "Conflict")
    }
    await tx.invoice.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } },
      data: { status: "Sent" },
    })
  })
  return stateRecord(ctx, "invoices", invoiceId)
}

export async function createEmployee(ctx: RequestContext, input: EmployeeInput) {
  const recordId = id("e")
  await mutate(ctx, { action: "Employee added", ref: recordId, detail: input.name }, async (tx) => {
    await tx.employee.create({ data: { workspaceId: ctx.workspaceId, id: recordId, ...input } })
  })
  return stateRecord(ctx, "employees", recordId)
}

export async function patchEmployee(ctx: RequestContext, recordId: string, patch: Partial<EmployeeInput>) {
  await mutate(ctx, { action: "Employee updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Employee")
    await tx.employee.update({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } }, data: patch })
  })
  return stateRecord(ctx, "employees", recordId)
}

export async function deleteEmployee(ctx: RequestContext, recordId: string) {
  await mutate(ctx, { action: "Employee deleted", ref: recordId, detail: `${recordId} deleted` }, async (tx) => {
    const existing = await tx.employee.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Employee")
    await tx.employee.delete({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
  })
}

export async function createContractorBill(ctx: RequestContext, input: ContractorBillInput) {
  requireEdit(ctx.role)
  if (input.status === "Paid" || input.paidDate !== undefined) {
    throw new HttpError(409, "contractor_payment_requires_approval", "A contractor bill can only be marked Paid by the authorised approval flow.", "Conflict")
  }
  const recordId = id("CB")
  await mutate(ctx, { action: "Contractor bill added", ref: recordId, detail: input.reference }, async (tx) => {
    await requireScopedProject(tx, ctx, input.projectId)
    await tx.contractorBill.create({ data: { workspaceId: ctx.workspaceId, id: recordId, ...input } })
  })
  return stateRecord(ctx, "contractorBills", recordId)
}

export async function patchContractorBill(ctx: RequestContext, recordId: string, patch: Partial<ContractorBillInput>) {
  await mutate(ctx, { action: "Contractor bill updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const existing = await tx.contractorBill.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Contractor bill")
    if (existing.status === "Paid") {
      throw new HttpError(409, "contractor_bill_paid_locked", "Paid contractor bills cannot be edited.", "Conflict")
    }
    if (patch.status === "Paid" || patch.paidDate !== undefined) {
      throw new HttpError(409, "contractor_payment_requires_approval", "A contractor bill can only be marked Paid by the authorised approval flow.", "Conflict")
    }
    if (patch.projectId !== undefined) await requireScopedProject(tx, ctx, patch.projectId)
    await tx.contractorBill.update({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } }, data: patch })
  })
  return stateRecord(ctx, "contractorBills", recordId)
}

export async function createRecurringCost(ctx: RequestContext, input: RecurringInput) {
  requireEdit(ctx.role)
  if (input.status === "Cancelled") {
    throw new HttpError(409, "subscription_cancellation_requires_approval", "A subscription can only be cancelled by the authorised approval flow.", "Conflict")
  }
  const recordId = id("RC")
  await mutate(ctx, { action: "Recurring cost added", ref: recordId, detail: input.vendor }, async (tx) => {
    await tx.recurringCost.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: recordId,
        ...input,
        kind: input.kind === "Fixed cost" ? "FixedCost" : "Subscription",
        reviewed: input.reviewed ?? false,
      },
    })
  })
  return stateRecord(ctx, "recurring", recordId)
}

export async function patchRecurringCost(ctx: RequestContext, recordId: string, patch: Partial<RecurringInput>) {
  requireEdit(ctx.role)
  if (patch.status === "Cancelled") {
    throw new HttpError(409, "subscription_cancellation_requires_approval", "A subscription can only be cancelled by the authorised approval flow.", "Conflict")
  }
  await mutate(ctx, { action: "Recurring cost updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const existing = await tx.recurringCost.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Recurring cost")
    const { kind, ...costFields } = patch
    await tx.recurringCost.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } },
      data: {
        ...costFields,
        ...(kind === undefined ? {} : { kind: kind === "Fixed cost" ? "FixedCost" : "Subscription" }),
      },
    })
  })
  return stateRecord(ctx, "recurring", recordId)
}

export async function reviewRecurringCost(ctx: RequestContext, recordId: string) {
  await mutate(ctx, { action: "Subscription reviewed", ref: recordId, detail: `${recordId} marked as reviewed` }, async (tx) => {
    const existing = await tx.recurringCost.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Recurring cost")
    await tx.recurringCost.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } },
      data: { reviewed: true, ...(existing.status === "Review" ? { status: "Active" } : {}) },
    })
  })
  return stateRecord(ctx, "recurring", recordId)
}

export async function createLoan(ctx: RequestContext, input: LoanInput) {
  const recordId = id("L")
  await mutate(ctx, { action: "Loan added", ref: recordId, detail: input.name }, async (tx) => {
    await tx.loan.create({ data: { workspaceId: ctx.workspaceId, id: recordId, ...input } })
  })
  return stateRecord(ctx, "loans", recordId)
}

export async function patchLoan(ctx: RequestContext, recordId: string, patch: Partial<LoanInput>) {
  await mutate(ctx, { action: "Loan updated", ref: recordId, detail: `${recordId} updated` }, async (tx) => {
    const existing = await tx.loan.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Loan")
    await tx.loan.update({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } }, data: patch })
  })
  return stateRecord(ctx, "loans", recordId)
}

export async function createOffer(ctx: RequestContext, input: OfferInput) {
  const recordId = id("O")
  await mutate(ctx, { action: "Financing offer added", ref: recordId, detail: input.name }, async (tx) => {
    await tx.loanOffer.create({ data: { workspaceId: ctx.workspaceId, id: recordId, ...input } })
  })
  return stateRecord(ctx, "offers", recordId)
}

export async function deleteOffer(ctx: RequestContext, recordId: string) {
  await mutate(ctx, { action: "Financing offer deleted", ref: recordId, detail: `${recordId} deleted` }, async (tx) => {
    const existing = await tx.loanOffer.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Financing offer")
    await tx.loanOffer.delete({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
  })
}

export async function createScenario(ctx: RequestContext, input: ScenarioInput) {
  const recordId = id("SC")
  await mutate(ctx, { action: "Scenario saved", ref: recordId, detail: input.name }, async (tx) => {
    await tx.savedScenario.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: recordId,
        name: input.name,
        type: input.type,
        inputs: json(input.inputs),
        createdById: ctx.userId,
      },
    })
  })
  return stateRecord(ctx, "scenarios", recordId)
}

export async function deleteScenario(ctx: RequestContext, recordId: string) {
  await mutate(ctx, { action: "Scenario deleted", ref: recordId, detail: `${recordId} deleted` }, async (tx) => {
    const existing = await tx.savedScenario.findUnique({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
    if (!existing) notFound("Scenario")
    await tx.savedScenario.delete({ where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: recordId } } })
  })
}

export async function resetDemoWorkspace(ctx: RequestContext) {
  requireOwner(ctx.role)
  if (!config.allowDemoReset) {
    throw new HttpError(403, "demo_reset_disabled", "Demo reset is disabled on this server.", "Forbidden")
  }
  const seed = createSeed()
  await prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: ctx.workspaceId },
      select: { currency: true },
    })
    const memberships = await tx.membership.findMany({
      where: { workspaceId: ctx.workspaceId },
      include: { user: { select: { id: true, name: true } } },
    })
    const preparedUsers = new Map(memberships.map(({ user }) => [user.name, user.id]))
    await tx.workspaceSettings.update({
      where: { workspaceId: ctx.workspaceId },
      data: {
        safetyThreshold: seed.settings.safetyThreshold,
        defaultHorizon: seed.settings.defaultHorizon,
        planningScenario: seed.settings.planningScenario,
        managerApprovalLimit: seed.settings.managerApprovalLimit,
        openingBalance: seed.settings.openingBalance,
        openingDate: seed.settings.openingDate,
        ownerName: seed.settings.ownerName,
        ownerEmail: seed.settings.ownerEmail,
        notifications: json(seed.settings.notifications),
        readiness: json(seed.settings.readiness),
        dismissedInsights: json(seed.dismissedInsights),
      },
    })
    await tx.workspace.update({
      where: { id: ctx.workspaceId },
      data: {
        name: seed.settings.agencyName,
        agencyType: seed.settings.agencyType,
        teamSize: seed.settings.teamSize,
        location: seed.settings.location,
        website: seed.settings.website,
        seededOn: seed.seededOn,
      },
    })
    await replaceDemoWorkspaceRecords(
      tx,
      ctx.workspaceId,
      seed,
      workspace.currency,
      preparedUsers,
      ctx.userId,
    )
    await tx.auditEvent.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: id("AU"),
        actorUserId: ctx.userId,
        actor: ctx.userName,
        action: "Demo data reset",
        detail: "Workspace demo records were reset using the current seed data.",
        outcome: "success",
        requestId: ctx.requestId,
      },
    })
  })
  return { status: "reset" }
}

export async function readComputedState(ctx: RequestContext) {
  requireView(ctx.role)
  return loadState(ctx.workspaceId, ctx.role === "FinanceManager" ? "Finance Manager" : ctx.role)
}
