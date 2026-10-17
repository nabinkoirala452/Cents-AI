import { randomInt, randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { Approval, ApprovalKind, ApprovalStatus, Currency } from "@prisma/client"
import type { FastifyBaseLogger } from "fastify"
import { config } from "../../config"
import { getPayPalGateway, PayPalError } from "../../integrations/paypal"
import type { PayPalInvoiceInput } from "../../integrations/paypal"
import { auditPayPalCalls } from "../../integrations/paypal/audit"
import type { PayPalApiCall } from "../../integrations/paypal/call-log"
import { withPayPalCallLog } from "../../integrations/paypal/call-log"
import { prisma } from "../../db"
import { dateInTimeZone, workspaceToday } from "../../lib/dates"
import { HttpError } from "../../lib/errors"
import { payloadHash } from "../../lib/hash"
import { canApprove, requireEdit, requireView } from "../../lib/permissions"
import type { RequestContext } from "../../plugins/auth"
import { audit } from "../audit/service"

type ApprovalDraft = {
  recipient: string
  recipientEmail: string
  amount: number
  currency: Currency
  title: string
  steps: string[]
  draft?: string
  lineItems: Array<{ description: string; quantity: number; unitPrice: number }>
  dueDate: string
  snapshot: Record<string, unknown>
}

const id = () => `AP-${randomUUID()}`
const json = (value: unknown) => value as Prisma.InputJsonValue
const invoiceAmount = (lineItems: Array<{ quantity: number; unitPrice: number }>) =>
  Math.round(lineItems.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100

function reminderDraft(invoiceId: string, dueDate: string, recipientName: string): string {
  return `Hello ${recipientName}, this is a reminder that invoice ${invoiceId} was due on ${dueDate}. Please let us know if you have any questions.`
}

async function lockApprovalRecord(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  kind: ApprovalKind,
  refId: string,
) {
  if (kind === "paypal_send_invoice" || kind === "send_reminder") {
    await tx.$queryRaw`
      SELECT "id" FROM "Invoice"
      WHERE "workspaceId" = ${workspaceId} AND "id" = ${refId}
      FOR UPDATE
    `
  } else if (kind === "record_contractor_payment") {
    await tx.$queryRaw`
      SELECT "id" FROM "ContractorBill"
      WHERE "workspaceId" = ${workspaceId} AND "id" = ${refId}
      FOR UPDATE
    `
  } else {
    await tx.$queryRaw`
      SELECT "id" FROM "RecurringCost"
      WHERE "workspaceId" = ${workspaceId} AND "id" = ${refId}
      FOR UPDATE
    `
  }
}

async function approvalDraft(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  kind: ApprovalKind,
  refId: string,
  requestedDraft?: string,
): Promise<ApprovalDraft> {
  const workspace = await tx.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { currency: true },
  })
  if (kind === "paypal_send_invoice" || kind === "send_reminder") {
    const invoice = await tx.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: refId } },
      include: { client: true },
    })
    if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found in this workspace.", "Not Found")
    const items = invoice.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>
    if (!invoice.client.email.trim()) {
      throw new HttpError(409, "invoice_client_email_required", "The invoice client must have an email address.", "Conflict")
    }
    if (kind === "paypal_send_invoice") {
      if (invoice.status !== "Draft" || invoice.channel !== "PayPal") {
        throw new HttpError(409, "invoice_not_eligible", "Only Draft PayPal invoices can be sent through an approval.", "Conflict")
      }
      if (!items.length || !["USD", "EUR", "GBP", "CAD"].includes(invoice.currency)) {
        throw new HttpError(409, "invoice_not_eligible", "The invoice does not contain PayPal-supported items and currency.", "Conflict")
      }
    } else if (invoice.status !== "Sent") {
      throw new HttpError(409, "invoice_not_remindable", "Only sent, unpaid invoices can be reminded.", "Conflict")
    }
    const draft = kind === "send_reminder"
      ? requestedDraft ?? reminderDraft(invoice.id, invoice.dueDate, invoice.client.name)
      : undefined
    const recipientEmail = kind === "paypal_send_invoice" && config.paypalEnv === "sandbox" && config.paypalSandboxPayerEmail
      ? config.paypalSandboxPayerEmail
      : invoice.client.email
    const snapshot = {
      kind,
      refId,
      recipientEmail,
      amount: invoiceAmount(items),
      currency: invoice.currency,
      lineItems: items,
      dueDate: invoice.dueDate,
      draft: draft ?? null,
    }
    return {
      recipient: invoice.client.name,
      recipientEmail,
      amount: invoiceAmount(items),
      currency: invoice.currency,
      title: kind === "paypal_send_invoice" ? `Send PayPal invoice · ${invoice.id}` : `Send payment reminder · ${invoice.id}`,
      steps: kind === "paypal_send_invoice"
        ? [
            "Create the invoice in PayPal",
            `Send it to ${recipientEmail}`,
            "Verify PayPal reports SENT before marking it sent",
          ]
        : invoice.paypalInvoiceId
          ? [`Send a PayPal reminder for ${invoice.paypalInvoiceId}`, "Log the reminder on the invoice timeline", "Keep the receipt uncertain until payment is verified"]
          : [`Prepare the reminder for ${invoice.client.email}`, "Log the reminder on the invoice timeline", "Email delivery is not connected"],
      ...(draft ? { draft } : {}),
      lineItems: items,
      dueDate: invoice.dueDate,
      snapshot,
    }
  }
  if (kind === "record_contractor_payment") {
    const bill = await tx.contractorBill.findUnique({ where: { workspaceId_id: { workspaceId, id: refId } } })
    if (!bill) throw new HttpError(404, "contractor_bill_not_found", "Contractor bill was not found in this workspace.", "Not Found")
    if (bill.status === "Paid") throw new HttpError(409, "contractor_bill_paid", "This contractor bill is already paid.", "Conflict")
    const snapshot = {
      kind, refId, recipientEmail: "", amount: Number(bill.amount), currency: workspace.currency,
      lineItems: [], dueDate: bill.dueDate, draft: null,
    }
    return {
      recipient: bill.vendor,
      recipientEmail: "",
      amount: Number(bill.amount),
      currency: workspace.currency,
      title: `Pay contractor invoice · ${bill.reference}`,
      steps: [
        `Owner transfers ${Number(bill.amount).toFixed(2)} from the agency bank account`,
        "Confirm the transfer reference in CentsAI",
        "Ledger records the expense only after confirmation",
      ],
      lineItems: [],
      dueDate: bill.dueDate,
      snapshot,
    }
  }
  const recurring = await tx.recurringCost.findUnique({ where: { workspaceId_id: { workspaceId, id: refId } } })
  if (!recurring) throw new HttpError(404, "recurring_cost_not_found", "Recurring cost was not found in this workspace.", "Not Found")
  if (recurring.status === "Cancelled") throw new HttpError(409, "subscription_cancelled", "This recurring cost is already cancelled.", "Conflict")
  const snapshot = {
    kind, refId, recipientEmail: "", amount: Number(recurring.amount), currency: workspace.currency,
    lineItems: [], dueDate: recurring.nextDate, draft: null,
  }
  return {
    recipient: recurring.vendor,
    recipientEmail: "",
    amount: Number(recurring.amount),
    currency: workspace.currency,
    title: `Cancel subscription · ${recurring.vendor}`,
    steps: [
      "Stop the recurring cost from the next renewal in the forecast",
      "Owner cancels with the vendor (no vendor integration)",
      "Log the decision",
    ],
    lineItems: [],
    dueDate: recurring.nextDate,
    snapshot,
  }
}

function makePayPalInput(
  invoice: {
    id: string
    paypalInvoiceNumber: string | null
    currency: Currency
    issueDate: string
    dueDate: string
    notes: string | null
    lineItems: Prisma.JsonValue
    client: { name: string; email: string }
  },
  recipientEmail: string,
): PayPalInvoiceInput {
  return {
    invoiceNumber: invoice.paypalInvoiceNumber ?? invoice.id,
    currency: invoice.currency,
    invoiceDate: invoice.issueDate,
    dueDate: invoice.dueDate,
    ...(invoice.notes ? { note: invoice.notes } : {}),
    recipientEmail,
    recipientName: invoice.client.name,
    items: (invoice.lineItems as Array<{ description: string; quantity: number; unitPrice: number }>).map((item) => ({
      name: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
    })),
  }
}

function generatedPayPalInvoiceNumber(invoiceId: string, workspaceId: string): string {
  return `${invoiceId}-${workspaceId.slice(0, 6)}-${randomInt(36 ** 6).toString(36).padStart(6, "0")}`
}

function matchesPayPalInvoice(
  paypalInvoice: Awaited<ReturnType<ReturnType<typeof getPayPalGateway>["getInvoice"]>>,
  invoice: {
    paypalInvoiceNumber: string | null
    currency: Currency
    lineItems: Prisma.JsonValue
  },
  recipientEmail: string,
): boolean {
  const items = invoice.lineItems as Array<{ quantity: number; unitPrice: number }>
  return paypalInvoice.number === invoice.paypalInvoiceNumber
    && paypalInvoice.currency === invoice.currency
    && paypalInvoice.total === invoiceAmount(items)
    && paypalInvoice.recipientEmail?.trim().toLowerCase() === recipientEmail.trim().toLowerCase()
}

function responseApproval(row: Approval) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    recipient: row.recipient,
    amount: Number(row.amount),
    currency: row.currency,
    refId: row.refId,
    preparedBy: row.preparedBy,
    requestedAt: row.requestedAt.toISOString(),
    status: row.status,
    idempotencyKey: row.idempotencyKey,
    steps: row.steps as string[],
    ...(row.draft ? { draft: row.draft } : {}),
    ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
    ...(row.decidedAt ? { decidedAt: row.decidedAt.toISOString() } : {}),
    ...(row.note ? { note: row.note } : {}),
    ...(row.result ? { result: row.result } : {}),
  }
}

export async function listApprovals(ctx: RequestContext, status?: ApprovalStatus) {
  requireView(ctx.role)
  const rows = await prisma.approval.findMany({
    where: { workspaceId: ctx.workspaceId, ...(status ? { status } : {}) },
    orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
  })
  return rows.map(responseApproval)
}

export async function createApproval(
  ctx: RequestContext,
  input: { kind: ApprovalKind; refId: string; draft?: string },
) {
  requireEdit(ctx.role)
  const created = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      WITH approval_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${`approval:${ctx.workspaceId}:${input.kind}:${input.refId}`}))
      )
      SELECT 1 FROM approval_lock
    `
    await lockApprovalRecord(tx, ctx.workspaceId, input.kind, input.refId)
    const open = await tx.approval.findFirst({
      where: {
        workspaceId: ctx.workspaceId,
        kind: input.kind,
        refId: input.refId,
        status: { in: ["Pending", "Submitted"] },
      },
    })
    if (open) throw new HttpError(409, "approval_already_open", "An approval is already open for this record.", "Conflict")

    const proposal = await approvalDraft(tx, ctx.workspaceId, input.kind, input.refId, input.draft)
    const count = await tx.approval.count({
      where: { workspaceId: ctx.workspaceId, kind: input.kind, refId: input.refId },
    })
    const attempt = count + 1
    const approvalId = id()
    const key = `${input.kind}-${input.refId}-${attempt}`
    const hash = payloadHash(proposal.snapshot)
    const row = await tx.approval.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: approvalId,
        kind: input.kind,
        title: proposal.title,
        recipient: proposal.recipient,
        amount: proposal.amount,
        currency: proposal.currency,
        refId: input.refId,
        preparedBy: ctx.userName,
        preparedByUserId: ctx.userId,
        preparedByAgent: false,
        requestedAt: new Date(),
        status: "Pending",
        idempotencyKey: key,
        steps: json(proposal.steps),
        draft: proposal.draft,
        payload: json(proposal.snapshot),
        payloadHash: hash,
        attempt,
      },
    })
    await audit(ctx, {
      action: "Approval requested",
      detail: `${row.title} · ${row.amount.toString()} ${row.currency}`,
      ref: row.id,
      outcome: "info",
    }, tx)
    return row
  })
  return responseApproval(created)
}

export async function rejectApproval(ctx: RequestContext, approvalId: string, reason: string) {
  requireEdit(ctx.role)
  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT "id" FROM "Approval"
      WHERE "workspaceId" = ${ctx.workspaceId} AND "id" = ${approvalId}
      FOR UPDATE
    `
    const existing = await tx.approval.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
    })
    if (!existing) throw new HttpError(404, "approval_not_found", "Approval was not found in this workspace.", "Not Found")
    if (existing.status !== "Pending") {
      throw new HttpError(409, "approval_not_pending", "Only pending approvals can be rejected.", "Conflict")
    }
    const updated = await tx.approval.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
      data: {
        status: "Rejected",
        decidedBy: ctx.userName,
        decidedAt: new Date(),
        note: reason,
      },
    })
    await audit(ctx, { action: "Approval rejected", detail: `${existing.title} — ${reason}`, ref: approvalId, outcome: "warning" }, tx)
    return updated
  })
  return responseApproval(row)
}

type PreparedExecution = {
  approval: Approval
  snapshot: ApprovalDraft
}

async function runApproval(
  ctx: RequestContext,
  approvalId: string,
  logger: FastifyBaseLogger,
  retry: boolean,
) {
  const prepared = await prisma.$transaction(async (tx): Promise<PreparedExecution> => {
    await tx.$queryRaw`
      SELECT "id" FROM "Approval"
      WHERE "workspaceId" = ${ctx.workspaceId} AND "id" = ${approvalId}
      FOR UPDATE
    `
    const approval = await tx.approval.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
    })
    if (!approval) throw new HttpError(404, "approval_not_found", "Approval was not found in this workspace.", "Not Found")
    if (retry) {
      if (
        approval.status !== "Submitted"
        || !["paypal_send_invoice", "send_reminder", "cancel_subscription"].includes(approval.kind)
        || !approval.decidedAt
        || approval.decidedAt.getTime() > Date.now() - 2 * 60_000
      ) {
        throw new HttpError(409, "approval_not_retryable", "Only supported approvals submitted more than two minutes ago can be retried.", "Conflict")
      }
    } else if (approval.status !== "Pending") {
      throw new HttpError(409, "approval_not_pending", "Only pending approvals can be approved.", "Conflict")
    }
    const settings = await tx.workspaceSettings.findUniqueOrThrow({
      where: { workspaceId: ctx.workspaceId },
      select: { managerApprovalLimit: true },
    })
    if (!canApprove(ctx.role, Number(approval.amount), Number(settings.managerApprovalLimit))) {
      throw new HttpError(403, "forbidden_role", "Your role or approval limit does not permit this action.", "Forbidden")
    }
    await lockApprovalRecord(tx, ctx.workspaceId, approval.kind, approval.refId)
    let snapshot: ApprovalDraft
    let actualHash: string
    try {
      snapshot = await approvalDraft(tx, ctx.workspaceId, approval.kind, approval.refId, approval.draft ?? undefined)
      actualHash = payloadHash(snapshot.snapshot)
    } catch (error) {
      if (!(error instanceof HttpError)) throw error
      snapshot = {
        recipient: approval.recipient,
        recipientEmail: "",
        amount: Number(approval.amount),
        currency: approval.currency,
        title: approval.title,
        steps: [],
        lineItems: [],
        dueDate: "",
        snapshot: {},
      }
      actualHash = payloadHash({ missingRecord: approval.refId, kind: approval.kind })
    }
    if (approval.draft !== (snapshot.draft ?? null) || actualHash !== approval.payloadHash) {
      if (retry) {
        throw new HttpError(409, "approval_stale", "The records changed after this approval was requested.", "Conflict")
      }
      const stale = await tx.approval.update({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
        data: {
          status: "Stale",
          decidedBy: "System",
          decidedAt: new Date(),
          note: "Records changed after approval was requested",
        },
      })
      await audit(ctx, { action: "Approval stale", detail: `${approval.title} no longer matches current records`, ref: approvalId, outcome: "warning" }, tx)
      return { approval: stale, snapshot, stale: true } as PreparedExecution & { stale: boolean }
    }
    const submitted = await tx.approval.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
      data: {
        status: "Submitted",
        decidedBy: ctx.userName,
        decidedAt: new Date(),
        ...(retry ? { result: null } : {}),
        ...(approval.kind === "record_contractor_payment"
          ? { result: "Approved — transfer the money from your bank, then confirm the reference here." }
          : {}),
      },
    })
    await audit(ctx, {
      action: retry ? "Approval retry submitted" : "Approved & submitted",
      detail: `${approval.title} · key ${approval.idempotencyKey}`,
      ref: approvalId,
      outcome: "success",
    }, tx)
    return { approval: submitted, snapshot, stale: false } as PreparedExecution & { stale: boolean }
  })

  if ("stale" in prepared && prepared.stale) {
    throw new HttpError(409, "approval_stale", "The records changed after this approval was requested.", "Conflict")
  }
  if (prepared.approval.kind === "record_contractor_payment") {
    return responseApproval(prepared.approval)
  }

  const calls: PayPalApiCall[] = []
  try {
    const result = await withPayPalCallLog(logger, calls, () => executeApproval(ctx, prepared))
    return await prisma.$transaction(async (tx) => {
      if (result.invoiceUpdate) {
        await tx.invoice.update({
          where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: prepared.approval.refId } },
          data: result.invoiceUpdate,
        })
      }
      if (result.reminder) {
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: prepared.approval.refId } },
        })
        const reminders = invoice.reminders as Array<{ date: string; channel: string; note: string }>
        await tx.invoice.update({
          where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoice.id } },
          data: { reminders: json([...reminders, result.reminder]) },
        })
      }
      if (result.cancelSubscription) {
        await tx.recurringCost.update({
          where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: prepared.approval.refId } },
          data: { status: "Cancelled" },
        })
      }
      const updated = await tx.approval.update({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
        data: { status: "Verified", result: result.message },
      })
      await audit(ctx, {
        action: result.auditAction,
        detail: result.auditDetail,
        ref: prepared.approval.refId,
        outcome: "success",
      }, tx)
      await auditPayPalCalls(tx, {
        workspaceId: ctx.workspaceId,
        actor: ctx.userName,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        ref: prepared.approval.refId,
        calls,
      })
      return responseApproval(updated)
    })
  } catch (error) {
    const safeMessage = error instanceof PayPalError
      ? `${error.message}${error.debugId ? ` · debug_id ${error.debugId}` : ""}`
      : error instanceof Error ? error.message : "Execution failed"
    const failed = await prisma.$transaction(async (tx) => {
      const updated = await tx.approval.update({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
        data: { status: "Failed", result: safeMessage },
      })
      await audit(ctx, {
        action: "Execution failed",
        detail: `${prepared.approval.title}: ${safeMessage}`,
        ref: approvalId,
        outcome: "error",
      }, tx)
      await auditPayPalCalls(tx, {
        workspaceId: ctx.workspaceId,
        actor: ctx.userName,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        ref: prepared.approval.refId,
        calls,
      })
      return updated
    })
    return responseApproval(failed)
  }
}

export function approveApproval(ctx: RequestContext, approvalId: string, logger: FastifyBaseLogger) {
  return runApproval(ctx, approvalId, logger, false)
}

export function retryApproval(ctx: RequestContext, approvalId: string, logger: FastifyBaseLogger) {
  return runApproval(ctx, approvalId, logger, true)
}

type ExecutionResult = {
  message: string
  auditAction: string
  auditDetail: string
  invoiceUpdate?: Prisma.InvoiceUpdateInput
  reminder?: { date: string; channel: string; note: string }
  cancelSubscription?: boolean
}

async function executeApproval(ctx: RequestContext, prepared: PreparedExecution): Promise<ExecutionResult> {
  const { approval, snapshot } = prepared
  if (approval.kind === "paypal_send_invoice") {
    let invoice = await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approval.refId } },
      include: { client: true },
    })
    if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found.", "Not Found")
    if (!invoice.paypalInvoiceNumber) {
      const candidate = generatedPayPalInvoiceNumber(invoice.id, ctx.workspaceId)
      await prisma.invoice.updateMany({
        where: { workspaceId: ctx.workspaceId, id: invoice.id, paypalInvoiceNumber: null },
        data: { paypalInvoiceNumber: candidate },
      })
      invoice = await prisma.invoice.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoice.id } },
        include: { client: true },
      })
    }
    if (!invoice.paypalInvoiceNumber) throw new Error("PayPal invoice number was not persisted")
    const gateway = getPayPalGateway()
    let paypalInvoice = await gateway.searchInvoiceByNumber(invoice.paypalInvoiceNumber)
    if (paypalInvoice?.id) {
      paypalInvoice = await gateway.getInvoice(paypalInvoice.id)
    }
    if (paypalInvoice && !matchesPayPalInvoice(paypalInvoice, invoice, snapshot.recipientEmail)) {
      throw new PayPalError("PayPal invoice number already used by a different invoice")
    }
    if (!paypalInvoice && invoice.paypalInvoiceId) {
      paypalInvoice = await gateway.getInvoice(invoice.paypalInvoiceId)
      if (!matchesPayPalInvoice(paypalInvoice, invoice, snapshot.recipientEmail)) {
        throw new PayPalError("PayPal invoice number already used by a different invoice")
      }
    }
    if (!paypalInvoice) {
      try {
        paypalInvoice = await gateway.createDraftInvoice(makePayPalInput(invoice, snapshot.recipientEmail))
      } catch (createError) {
        const recovered = await gateway.searchInvoiceByNumber(invoice.paypalInvoiceNumber)
        if (!recovered) throw createError
        paypalInvoice = recovered.id ? await gateway.getInvoice(recovered.id) : recovered
        if (!matchesPayPalInvoice(paypalInvoice, invoice, snapshot.recipientEmail)) {
          throw new PayPalError("PayPal invoice number already used by a different invoice")
        }
      }
    }
    if (
      paypalInvoice.id
      && (paypalInvoice.total === undefined || paypalInvoice.currency === undefined || paypalInvoice.recipientEmail === undefined)
    ) {
      paypalInvoice = await gateway.getInvoice(paypalInvoice.id)
    }
    if (!matchesPayPalInvoice(paypalInvoice, invoice, snapshot.recipientEmail)) {
      throw new PayPalError("PayPal invoice number already used by a different invoice")
    }
    if (!paypalInvoice.id) throw new Error("PayPal returned an invoice without an id")
    await prisma.invoice.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoice.id } },
      data: {
        paypalInvoiceId: paypalInvoice.id,
        paypalStatus: "DRAFT",
        paypalPayerUrl: paypalInvoice.payerUrl ?? null,
      },
    })
    if (paypalInvoice.status === "DRAFT") {
      await gateway.sendInvoice(paypalInvoice.id)
    }
    const verified = await gateway.getInvoice(paypalInvoice.id)
    if (!["SENT", "UNPAID"].includes(verified.status)) {
      throw new PayPalError(
        `PayPal reported invoice status ${verified.status}`,
        verified.debugId,
      )
    }
    return {
      message: `PayPal status ${verified.status} · ${paypalInvoice.id}`,
      auditAction: "Invoice created & sent",
      auditDetail: `${invoice.id} sent via PayPal as ${paypalInvoice.id}`,
      invoiceUpdate: {
        status: "Sent",
        channel: "PayPal",
        paypalInvoiceId: paypalInvoice.id,
        paypalStatus: verified.status === "PAID" || verified.status === "CANCELLED"
          ? verified.status
          : verified.status === "DRAFT" ? "DRAFT" : "SENT",
        paypalPayerUrl: verified.payerUrl ?? paypalInvoice.payerUrl ?? null,
        paypalSentAt: new Date(),
        paypalLastCheckedAt: new Date(),
      },
    }
  }
  if (approval.kind === "send_reminder") {
    const invoice = await prisma.invoice.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approval.refId } },
    })
    if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found.", "Not Found")
    if (invoice.status !== "Sent") throw new HttpError(409, "invoice_not_remindable", "Only sent, unpaid invoices can be reminded.", "Conflict")
    const date = await workspaceToday(ctx.workspaceId)
    if (invoice.paypalInvoiceId) {
      await getPayPalGateway().remindInvoice(invoice.paypalInvoiceId, snapshot.draft)
      return {
        message: "PayPal accepted the reminder",
        auditAction: "Reminder sent",
        auditDetail: `${invoice.id} · PayPal reminder`,
        reminder: { date, channel: "PayPal reminder", note: snapshot.draft ?? `Approved by ${ctx.userName}` },
      }
    }
    return {
      message: "Reminder logged — email delivery is not connected; send it from your mail client.",
      auditAction: "Reminder logged",
      auditDetail: `${invoice.id} · email delivery is not connected`,
      reminder: { date, channel: "Email draft (not sent)", note: snapshot.draft ?? `Approved by ${ctx.userName}` },
    }
  }
  return {
    message: "Removed from future obligations. Cancel with the vendor as well.",
    auditAction: "Subscription cancelled",
    auditDetail: `${approval.recipient} removed from the forecast`,
    cancelSubscription: true,
  }
}

export async function confirmContractorTransfer(
  ctx: RequestContext,
  approvalId: string,
  reference: string,
) {
  const date = await workspaceToday(ctx.workspaceId)
  const outcome = await prisma.$transaction(async (tx): Promise<{ row?: Approval; stale?: boolean }> => {
    await tx.$queryRaw`
      SELECT "id" FROM "Approval"
      WHERE "workspaceId" = ${ctx.workspaceId} AND "id" = ${approvalId}
      FOR UPDATE
    `
    const approval = await tx.approval.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
    })
    if (!approval) throw new HttpError(404, "approval_not_found", "Approval was not found in this workspace.", "Not Found")
    if (approval.kind !== "record_contractor_payment" || approval.status !== "Submitted") {
      throw new HttpError(409, "approval_not_confirmable", "Only submitted contractor payments can be confirmed.", "Conflict")
    }
    const settings = await tx.workspaceSettings.findUniqueOrThrow({
      where: { workspaceId: ctx.workspaceId },
      select: { managerApprovalLimit: true },
    })
    if (!canApprove(ctx.role, Number(approval.amount), Number(settings.managerApprovalLimit))) {
      throw new HttpError(403, "forbidden_role", "Your role or approval limit does not permit this action.", "Forbidden")
    }
    await lockApprovalRecord(tx, ctx.workspaceId, approval.kind, approval.refId)
    const current = await approvalDraft(tx, ctx.workspaceId, approval.kind, approval.refId)
    if (payloadHash(current.snapshot) !== approval.payloadHash) {
      const stale = await tx.approval.update({
        where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
        data: { status: "Stale", decidedBy: "System", decidedAt: new Date(), note: "Records changed after approval was requested" },
      })
      await audit(ctx, { action: "Approval stale", detail: `${approval.title} no longer matches current records`, ref: approvalId, outcome: "warning" }, tx)
      return { row: stale, stale: true }
    }
    const bill = await tx.contractorBill.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approval.refId } },
    })
    if (!bill) throw new HttpError(404, "contractor_bill_not_found", "Contractor bill was not found.", "Not Found")
    await tx.contractorBill.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: bill.id } },
      data: { status: "Paid", paidDate: date },
    })
    await tx.transaction.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: `TXN-${randomUUID()}`,
        date,
        description: `Contractor invoice ${bill.reference}`,
        party: bill.vendor,
        category: "Contractors",
        projectId: bill.projectId,
        type: "Expense",
        amount: bill.amount,
        status: "Verified",
        source: "Manual",
        reference,
      },
    })
    const updated = await tx.approval.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: approvalId } },
      data: { status: "Verified", result: `Transfer confirmed · ref ${reference}` },
    })
    await audit(ctx, { action: "Payment confirmed", detail: `${bill.vendor} ${bill.amount.toString()} ${approval.currency} · ref ${reference}`, ref: bill.id, outcome: "success" }, tx)
    return { row: updated }
  })
  if (outcome.stale) {
    throw new HttpError(409, "approval_stale", "The records changed after this approval was requested.", "Conflict")
  }
  if (!outcome.row) throw new Error("Contractor transfer confirmation did not return an approval")
  return responseApproval(outcome.row)
}

export async function withdrawPendingReminders(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  invoiceId: string,
  reason: "invoice was paid" | "invoice was cancelled",
) {
  await tx.approval.updateMany({
    where: { workspaceId, kind: "send_reminder", refId: invoiceId, status: "Pending" },
    data: {
      status: "Rejected",
      decidedBy: "System",
      decidedAt: new Date(),
      note: `Withdrawn automatically — ${reason}`,
    },
  })
}
