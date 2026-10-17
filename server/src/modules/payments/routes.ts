import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { HttpError } from "../../lib/errors"
import { requireContext } from "../../plugins/auth"
import { reconcileInvoice, recordManualInvoicePayment } from "./service"

const idParams = z.object({ id: z.string().trim().min(1).max(100) }).strict()
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
}, "Expected a valid ISO calendar date")
const paymentBody = z.object({
  date: isoDate,
  reference: z.string().trim().min(1).max(200),
}).strict()
const noBody = z.preprocess(
  (value) => value === undefined || value === null ? {} : value,
  z.object({}).strict(),
)

export function registerPaymentRoutes(app: FastifyInstance): void {
  app.post("/api/v1/invoices/:id/paypal/sync", {
    schema: { params: idParams, body: noBody },
    config: { allowEmptyBody: true },
  }, async (request) => {
    const ctx = requireContext(request)
    const { id } = idParams.parse(request.params)
    return reconcileInvoice(ctx.workspaceId, id, {
      actor: `Verify payment status by ${ctx.userName}`,
      actorUserId: ctx.userId,
      requestId: ctx.requestId,
      logger: request.log,
    })
  })
  app.post("/api/v1/invoices/:id/payments", {
    schema: { params: idParams, body: paymentBody },
  }, async (request) => {
    const ctx = requireContext(request)
    const { id } = idParams.parse(request.params)
    if (ctx.role === "Viewer") {
      throw new HttpError(403, "forbidden_role", "Your role does not permit recording payments.", "Forbidden")
    }
    return recordManualInvoicePayment(ctx, id, paymentBody.parse(request.body))
  })
}
