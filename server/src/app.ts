import Fastify from "fastify"
import type { FastifyError } from "fastify"
import cors from "@fastify/cors"
import helmet from "@fastify/helmet"
import rateLimit from "@fastify/rate-limit"
import {
  serializerCompiler,
  validatorCompiler,
  ZodTypeProvider,
} from "fastify-type-provider-zod"
import { z } from "zod"
import { config } from "./config"
import { PayPalError } from "./integrations/paypal"
import { HttpError } from "./lib/errors"
import { registerAuditRoutes } from "./modules/audit/routes"
import { registerApprovalRoutes } from "./modules/approvals/routes"
import { registerAuthRoutes } from "./modules/auth/routes"
import { registerCopilotRoutes } from "./modules/copilot/routes"
import { registerPaymentRoutes } from "./modules/payments/routes"
import { registerRecordRoutes } from "./modules/records/routes"
import { registerWorkspaceRoutes } from "./modules/workspace/routes"
import { registerPayPalWebhookRoute } from "./modules/webhooks/routes"
import { installAuth } from "./plugins/auth"
import { installIdempotency } from "./plugins/idempotency"

function isPayPalError(error: unknown): error is PayPalError {
  return error instanceof PayPalError
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "req.headers.set-cookie",
          "req.body.password",
          "req.body.token",
          "req.body.access_token",
          "req.body.refresh_token",
          "req.body.client_secret",
          "req.body.clientSecret",
          "req.body.secret",
          "req.body.passwordHash",
          "req.body.apiKey",
          "req.body.api_key",
          "res.token",
          "res.access_token",
          "res.refresh_token",
          "res.client_secret",
          "res.secret",
          "res.password",
          "*.access_token",
          "*.refresh_token",
          "*.token",
          "*.secret",
          "*.client_secret",
          "*.password",
          "*.passwordHash",
          "*.apiKey",
          "*.api_key",
        ],
        censor: "[REDACTED]",
      },
    },
  }).withTypeProvider<ZodTypeProvider>()

  app.setValidatorCompiler(validatorCompiler)
  app.setSerializerCompiler(serializerCompiler)

  app.addHook("preParsing", (request, _reply, payload, done) => {
    const routeConfig = request.routeOptions.config as { allowEmptyBody?: boolean }
    const contentLength = request.headers["content-length"]
    if (
      routeConfig.allowEmptyBody
      && (contentLength === undefined || contentLength === "0")
      && request.headers["transfer-encoding"] === undefined
      && request.headers["content-type"]?.split(";")[0] === "application/json"
    ) {
      delete request.headers["content-type"]
    }
    done(null, payload)
  })

  await app.register(helmet)
  await app.register(cors, {
    origin: config.corsOrigins,
    // @fastify/cors defaults to GET,HEAD,POST, which blocks every PUT/PATCH/DELETE the SPA makes cross-origin.
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true,
  })
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const applicationError = error instanceof HttpError ? error : undefined
    const paypalError = isPayPalError(error) ? error as PayPalError : undefined
    const status = paypalError ? 502 : applicationError?.statusCode
      ?? (error.statusCode && error.statusCode >= 400 ? error.statusCode : 500)
    const validationIssues = error.validation
      ? z.array(z.object({
          instancePath: z.string().optional(),
          message: z.string().optional(),
        })).safeParse(error.validation)
      : undefined
    const fields = validationIssues?.success
      ? validationIssues.data.map((issue) => ({
          field: issue.instancePath ?? "",
          message: issue.message ?? "Invalid value",
        }))
      : undefined

    if (status >= 500) request.log.error({ err: error }, "Request failed")
    else request.log.info({ err: error }, "Request rejected")

    reply
      .code(status)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: paypalError ? "Bad Gateway" : applicationError?.title ?? (status >= 500 ? "Internal Server Error" : error.name),
        status,
        code: paypalError ? "paypal_error" : applicationError?.code ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
        detail: paypalError
          ? `PayPal request failed (HTTP ${paypalError.status ?? "unknown"})${paypalError.debugId ? ` · debug_id ${paypalError.debugId}` : ""}`
          : status >= 500 && config.nodeEnv === "production"
          ? "An unexpected error occurred."
          : error.message,
        ...(fields ? { fields } : {}),
      })
  })

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .type("application/problem+json")
      .send({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        code: "NOT_FOUND",
        detail: `No route matches ${request.method} ${request.url}.`,
      })
  })

  app.get("/api/v1/health", async () => ({
    status: "ok",
    paypalMode: config.paypalMode,
    paypalEnvironment: config.paypalEnv,
    copilotEngine: config.copilotEngine,
  }))

  installAuth(app)
  installIdempotency(app)
  registerAuthRoutes(app)
  registerWorkspaceRoutes(app)
  registerRecordRoutes(app)
  registerApprovalRoutes(app)
  registerPaymentRoutes(app)
  registerAuditRoutes(app)
  registerCopilotRoutes(app)
  registerPayPalWebhookRoute(app)

  return app
}
