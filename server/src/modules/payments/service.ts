import { randomUUID } from "node:crypto"
import { Prisma } from "@prisma/client"
import type { Currency, PayPalStatus } from "@prisma/client"
import type { FastifyBaseLogger } from "fastify"
import { getPayPalGateway, PayPalError } from "../../integrations/paypal"
import type { PayPalPayment } from "../../integrations/paypal"
import { auditPayPalCalls } from "../../integrations/paypal/audit"
import type { PayPalApiCall } from "../../integrations/paypal/call-log"
import { withPayPalCallLog } from "../../integrations/paypal/call-log"
import { prisma } from "../../db"
import { dateInTimeZone, workspaceToday } from "../../lib/dates"
import { HttpError } from "../../lib/errors"
import { requireEdit } from "../../lib/permissions"
import type { RequestContext } from "../../plugins/auth"
import { audit } from "../audit/service"
import { withdrawPendingReminders } from "../approvals/service"

type InvoiceForPayment = {
  id: string
  status: string
  channel: string
  currency: Currency
  issueDate: string
  dueDate: string
  lineItems: Prisma.JsonValue
  paypalInvoiceId: string | null
}

const json = (value: unknown) => value as Prisma.InputJsonValue

function invoiceTotal(invoice: { lineItems: Prisma.JsonValue }): number {
  const items = invoice.lineItems as Array<{ quantity: number; unitPrice: number }>
  return Math.round(items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0) * 100) / 100
}

function databasePayPalStatus(status: string): PayPalStatus {
  if (status === "PAID") return "PAID"
  if (status === "CANCELLED") return "CANCELLED"
  if (status === "DRAFT") return "DRAFT"
  return "SENT"
}

function isSettled(payment: PayPalPayment): boolean {
  return payment.status === undefined || payment.status === "PAID" || payment.status === "COMPLETED"
}

async function reconcilePayPalStatus(
  workspaceId: string,
  invoice: InvoiceForPayment,
  external: Awaited<ReturnType<ReturnType<typeof getPayPalGateway>["getInvoice"]>>,
  calls: PayPalApiCall[],
  actor: string,
  actorUserId?: string,
  requestId?: string,
) {
  const paidPayments = external.payments.filter(isSettled)
  const cancelled = external.status === "CANCELLED"
  const checkedAt = new Date()

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      WITH invoice_payment_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${`payment:${workspaceId}:${invoice.id}`}))
      )
      SELECT 1 FROM invoice_payment_lock
    `
    const current = await tx.invoice.findUnique({
      where: { workspaceId_id: { workspaceId, id: invoice.id } },
      select: {
        id: true,
        status: true,
        currency: true,
        lineItems: true,
        paypalInvoiceId: true,
        issueDate: true,
      },
    })
    if (!current) throw new HttpError(404, "invoice_not_found", "Invoice was not found in this workspace.", "Not Found")
    const workspace = await tx.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
      select: { timezone: true },
    })

    let insertedPayments = 0
    if (external.status === "PAID" || external.status === "PARTIALLY_PAID") {
      for (const payment of paidPayments) {
        if (payment.currency !== current.currency) {
          throw new HttpError(409, "payment_currency_mismatch", "PayPal payment currency does not match the invoice.", "Conflict")
        }
        const exists = await tx.paymentEvent.findFirst({
          where: {
            workspaceId,
            source: "PayPal",
            externalId: payment.id,
          },
          select: { id: true },
        })
        if (exists) continue

        const eventId = `PE-${randomUUID()}`
        const occurredAt = /^\d{4}-\d{2}-\d{2}$/.test(payment.occurredAt)
          ? new Date(`${payment.occurredAt}T12:00:00.000Z`)
          : new Date(payment.occurredAt)
        if (Number.isNaN(occurredAt.getTime())) {
          throw new HttpError(502, "invalid_paypal_payment_date", "PayPal returned an invalid payment date.", "Bad Gateway")
        }
        await tx.paymentEvent.create({
          data: {
            workspaceId,
            id: eventId,
            invoiceId: current.id,
            source: "PayPal",
            externalId: payment.id,
            status: payment.status ?? "PAID",
            gross: payment.amount,
            fee: payment.fee,
            net: payment.net,
            currency: payment.currency,
            occurredAt,
            verifiedAt: checkedAt,
            raw: json(payment),
          },
        })
        await tx.transaction.create({
          data: {
            workspaceId,
            id: `TXN-${randomUUID()}`,
            date: /^\d{4}-\d{2}-\d{2}$/.test(payment.occurredAt)
              ? payment.occurredAt
              : dateInTimeZone(occurredAt, workspace.timezone),
            description: `PayPal payment for invoice ${current.id}`,
            party: "PayPal",
            category: "Project revenue",
            type: "Income",
            amount: payment.amount,
            status: "Verified",
            source: "PayPal",
            invoiceId: current.id,
            paymentEventId: eventId,
          },
        })
        insertedPayments += 1
      }
    }

    const storedPayments = await tx.paymentEvent.aggregate({
      where: { workspaceId, invoiceId: current.id, source: "PayPal" },
      _sum: { gross: true },
    })
    const storedTotal = Math.round(Number(storedPayments._sum.gross ?? 0) * 100) / 100
    const fullyPaid = storedTotal >= invoiceTotal(current)
    const paidUnverified = external.status === "PAID" && !fullyPaid
    const date = dateInTimeZone(checkedAt, workspace.timezone)
    await tx.invoice.update({
      where: { workspaceId_id: { workspaceId, id: current.id } },
      data: {
        paypalStatus: databasePayPalStatus(external.status),
        paypalLastCheckedAt: checkedAt,
        ...(fullyPaid ? { status: "Paid", paidDate: date } : {}),
        ...(cancelled ? { status: "Cancelled" } : {}),
        ...(paidUnverified ? { status: "Sent", paidDate: null } : {}),
      },
    })
    if (fullyPaid) await withdrawPendingReminders(tx, workspaceId, current.id, "invoice was paid")
    else if (cancelled) await withdrawPendingReminders(tx, workspaceId, current.id, "invoice was cancelled")
    await auditPayPalCalls(tx, {
      workspaceId,
      actor,
      actorUserId,
      requestId,
      ref: current.id,
      calls,
    })
    await tx.auditEvent.create({
      data: {
        workspaceId,
        id: `AU-${randomUUID()}`,
        actorUserId,
        actor,
        action: fullyPaid ? "Payment verified" : "Status checked",
        detail: paidUnverified
          ? "PayPal reports PAID but payment details could not be verified"
          : `${current.id} PayPal status ${external.status}; ${insertedPayments} new payment(s)`,
        ref: current.id,
        outcome: paidUnverified ? "warning" : fullyPaid ? "success" : "info",
        requestId,
      },
    })
    return {
      status: external.status,
      paid: fullyPaid,
      cancelled,
      insertedPayments,
      paypalInvoiceId: external.id,
      ...(paidUnverified
        ? { warning: "PayPal reports PAID but payment details could not be verified" }
        : {}),
    }
  })
}

export async function reconcileInvoice(
  workspaceId: string,
  invoiceId: string,
  options: {
    actor: string
    actorUserId?: string
    requestId?: string
    logger: FastifyBaseLogger
    initialCalls?: PayPalApiCall[]
  },
) {
  const invoice = await prisma.invoice.findUnique({
    where: { workspaceId_id: { workspaceId, id: invoiceId } },
  })
  if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found in this workspace.", "Not Found")
  if (!invoice.paypalInvoiceId || invoice.channel !== "PayPal") {
    throw new HttpError(409, "paypal_invoice_required", "This invoice has not been sent through PayPal.", "Conflict")
  }
  const calls: PayPalApiCall[] = [...(options.initialCalls ?? [])]
  try {
    const external = await withPayPalCallLog(options.logger, calls, () =>
      getPayPalGateway().getInvoice(invoice.paypalInvoiceId!),
    )
    return await reconcilePayPalStatus(
      workspaceId,
      invoice,
      external,
      calls,
      options.actor,
      options.actorUserId,
      options.requestId,
    )
  } catch (error) {
    const paypalError = error instanceof PayPalError && error.status === 404
      ? new HttpError(409, "paypal_invoice_not_found", "The PayPal invoice was not found.", "Conflict")
      : error
    const debugId = error instanceof PayPalError && error.debugId ? ` · debug_id ${error.debugId}` : ""
    await prisma.$transaction(async (tx) => {
      await auditPayPalCalls(tx, {
        workspaceId,
        actor: options.actor,
        actorUserId: options.actorUserId,
        requestId: options.requestId,
        ref: invoiceId,
        calls,
      })
      await tx.auditEvent.create({
        data: {
          workspaceId,
          id: `AU-${randomUUID()}`,
          actorUserId: options.actorUserId,
          actor: options.actor,
          action: "Payment verification failed",
          detail: `${invoiceId}${debugId}`,
          ref: invoiceId,
          outcome: "error",
          requestId: options.requestId,
        },
      })
    })
    throw paypalError
  }
}

export async function recordManualInvoicePayment(
  ctx: RequestContext,
  invoiceId: string,
  input: { date: string; reference: string },
) {
  requireEdit(ctx.role)
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      WITH invoice_payment_lock AS MATERIALIZED (
        SELECT pg_advisory_xact_lock(hashtext(${`payment:${ctx.workspaceId}:${invoiceId}`}))
      )
      SELECT 1 FROM invoice_payment_lock
    `
    const invoice = await tx.invoice.findUnique({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } },
      include: { client: { select: { name: true } } },
    })
    if (!invoice) throw new HttpError(404, "invoice_not_found", "Invoice was not found in this workspace.", "Not Found")
    if (invoice.channel !== "BankTransfer") {
      throw new HttpError(409, "manual_payment_requires_bank_transfer", "Manual receipts are only available for bank-transfer invoices.", "Conflict")
    }
    if (invoice.status !== "Sent") {
      throw new HttpError(409, "invoice_not_payable", "Only sent bank-transfer invoices can have a manual receipt recorded.", "Conflict")
    }
    const today = await workspaceToday(ctx.workspaceId)
    if (input.date > today || input.date < invoice.issueDate) {
      throw new HttpError(400, "invalid_payment_date", "Payment date must be on or after the invoice issue date and no later than today in the workspace timezone.", "Bad Request")
    }
    const externalId = `${invoiceId}:${input.reference.trim()}`
    const existing = await tx.paymentEvent.findFirst({
      where: { workspaceId: ctx.workspaceId, source: "Manual", externalId },
    })
    if (existing) {
      throw new HttpError(409, "payment_reference_used", "This payment reference has already been recorded for the invoice.", "Conflict")
    }
    const total = invoiceTotal(invoice)
    const occurredAt = new Date(`${input.date}T12:00:00.000Z`)
    const eventId = `PE-${randomUUID()}`
    await tx.paymentEvent.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: eventId,
        invoiceId,
        source: "Manual",
        externalId,
        status: "RECORDED",
        gross: total,
        currency: invoice.currency,
        occurredAt,
        verifiedAt: new Date(),
        raw: json({ reference: input.reference.trim() }),
      },
    })
    await tx.transaction.create({
      data: {
        workspaceId: ctx.workspaceId,
        id: `TXN-${randomUUID()}`,
        date: input.date,
        description: `Bank transfer for invoice ${invoiceId}`,
        party: invoice.client.name,
        category: "Project revenue",
        type: "Income",
        amount: total,
        status: "Recorded",
        source: "Manual",
        invoiceId,
        reference: input.reference.trim(),
        paymentEventId: eventId,
      },
    })
    await tx.invoice.update({
      where: { workspaceId_id: { workspaceId: ctx.workspaceId, id: invoiceId } },
      data: { status: "Paid", paidDate: input.date },
    })
    await withdrawPendingReminders(tx, ctx.workspaceId, invoiceId, "invoice was paid")
    await audit(ctx, {
      action: "Manual payment recorded",
      detail: `${invoiceId} · ${total.toFixed(2)} ${invoice.currency} · bank reference ${input.reference.trim()}`,
      ref: invoiceId,
      outcome: "success",
    }, tx)
    return { invoiceId, amount: total, currency: invoice.currency, reference: input.reference.trim() }
  })
  return result
}
