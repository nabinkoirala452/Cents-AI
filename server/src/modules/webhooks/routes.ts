import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { getPayPalGateway } from "../../integrations/paypal"
import { auditPayPalCalls } from "../../integrations/paypal/audit"
import type { PayPalApiCall } from "../../integrations/paypal/call-log"
import { withPayPalCallLog } from "../../integrations/paypal/call-log"
import { prisma } from "../../db"
import { HttpError } from "../../lib/errors"
import type { PayPalWebhookHeaders } from "../../integrations/paypal"
import { reconcileInvoice } from "../payments/service"

const eventSchema = z.object({
  id: z.string().min(1),
  event_type: z.string().min(1),
  resource: z.object({
    id: z.string().optional(),
  }).passthrough().optional(),
}).passthrough()
const rawBodySchema = z.string().max(64 * 1024)

function headerValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined
}

export function registerPayPalWebhookRoute(app: FastifyInstance): void {
  app.register(async (webhookApp) => {
    webhookApp.removeContentTypeParser("application/json")
    webhookApp.addContentTypeParser(
      "application/json",
      { parseAs: "string", bodyLimit: 64 * 1024 },
      (_request, body, done) => done(null, body),
    )
    webhookApp.post("/api/v1/webhooks/paypal", {
      schema: { body: rawBodySchema },
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    }, async (request, reply) => {
      const rawBody = rawBodySchema.parse(request.body)
      let decoded: unknown
      try {
        decoded = JSON.parse(rawBody)
      } catch {
        throw new HttpError(400, "invalid_webhook_body", "Webhook body must be valid JSON.", "Bad Request")
      }
      const parsed = eventSchema.safeParse(decoded)
      if (!parsed.success) {
        throw new HttpError(400, "invalid_webhook_body", "Webhook body must include id and event_type.", "Bad Request")
      }
      let event = parsed.data
      const providerEventId = event.id
      const headers = {
        authAlgo: headerValue(request.headers["paypal-auth-algo"]),
        certUrl: headerValue(request.headers["paypal-cert-url"]),
        transmissionId: headerValue(request.headers["paypal-transmission-id"]),
        transmissionSignature: headerValue(request.headers["paypal-transmission-sig"]),
        transmissionTime: headerValue(request.headers["paypal-transmission-time"]),
      } satisfies PayPalWebhookHeaders
      let stored = await prisma.webhookEvent.findUnique({ where: { providerEventId } })
      if (stored?.processedAt || (stored && !stored.signatureVerified && stored.error === "signature_failure")) {
        return reply.code(200).send({ status: "duplicate" })
      }

      if (!stored) {
        try {
          stored = await prisma.webhookEvent.create({
            data: {
              providerEventId,
              eventType: event.event_type,
              resourceId: event.resource?.id ?? "",
              rawBody,
              headers: headers as object,
              signatureVerified: false,
            },
          })
        } catch (error) {
          if (!(error instanceof Error) || !("code" in error) || error.code !== "P2002") throw error
          stored = await prisma.webhookEvent.findUnique({ where: { providerEventId } })
          if (!stored) throw error
          if (stored.processedAt || (!stored.signatureVerified && stored.error === "signature_failure")) {
            return reply.code(200).send({ status: "duplicate" })
          }
        }
      }
      event = eventSchema.parse(JSON.parse(stored.rawBody))

      const paypalInvoice = stored.resourceId
        ? await prisma.invoice.findFirst({
            where: { paypalInvoiceId: stored.resourceId },
            select: { workspaceId: true, id: true },
          })
        : null
      const calls: PayPalApiCall[] = []
      let verified: boolean
      try {
        verified = await withPayPalCallLog(request.log, calls, () =>
          getPayPalGateway().verifyWebhookSignature(stored!.rawBody, stored!.headers as PayPalWebhookHeaders),
        )
      } catch (error) {
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: { signatureVerified: false, error: error instanceof Error ? error.message : "Signature verification errored" },
        })
        if (paypalInvoice) {
          await prisma.$transaction((tx) => auditPayPalCalls(tx, {
            workspaceId: paypalInvoice.workspaceId,
            actor: "PayPal webhook",
            ref: paypalInvoice.id,
            calls,
          }))
        }
        request.log.warn({ providerEventId }, "PayPal webhook signature verification errored")
        return reply.code(503).send({ status: "retry" })
      }
      if (!verified) {
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: { signatureVerified: false, error: "signature_failure" },
        })
        if (paypalInvoice) {
          await prisma.$transaction((tx) => auditPayPalCalls(tx, {
            workspaceId: paypalInvoice.workspaceId,
            actor: "PayPal webhook",
            ref: paypalInvoice.id,
            calls,
          }))
        }
        request.log.warn({ providerEventId }, "PayPal webhook signature rejected")
        return reply.code(200).send({ status: "stored", processed: false })
      }

      await prisma.webhookEvent.update({
        where: { providerEventId },
        data: { signatureVerified: true, error: null },
      })
      try {
        if (paypalInvoice && event.event_type.startsWith("INVOICING.INVOICE.")) {
          await reconcileInvoice(paypalInvoice.workspaceId, paypalInvoice.id, {
            actor: "PayPal webhook",
            logger: request.log,
            initialCalls: calls,
          })
        } else if (paypalInvoice) {
          await prisma.$transaction((tx) => auditPayPalCalls(tx, {
            workspaceId: paypalInvoice.workspaceId,
            actor: "PayPal webhook",
            ref: paypalInvoice.id,
            calls,
          }))
        }
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: { processedAt: new Date(), error: null },
        })
        return reply.code(200).send({ status: "stored", processed: true })
      } catch (error) {
        await prisma.webhookEvent.update({
          where: { providerEventId },
          data: {
            processedAt: null,
            error: error instanceof Error ? error.message : "Webhook processing failed",
          },
        })
        request.log.error({ providerEventId }, "Verified PayPal webhook could not be reconciled")
        return reply.code(503).send({ status: "retry" })
      }
    })
  })
}
