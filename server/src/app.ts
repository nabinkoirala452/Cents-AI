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
import { HttpError } from "./lib/errors"
import { registerAuditRoutes } from "./modules/audit/routes"
import { registerAuthRoutes } from "./modules/auth/routes"
import { registerWorkspaceRoutes } from "./modules/workspace/routes"
import { installAuth } from "./plugins/auth"
import { installIdempotency } from "./plugins/idempotency"

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

  await app.register(helmet)
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  })
  await app.register(rateLimit, {
    max: 120,
    timeWindow: "1 minute",
  })

  app.setErrorHandler((error: FastifyError, request, reply) => {
    const applicationError = error instanceof HttpError ? error : undefined
    const status = applicationError?.statusCode
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
        title: applicationError?.title ?? (status >= 500 ? "Internal Server Error" : error.name),
        status,
        code: applicationError?.code ?? (status >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR"),
        detail: status >= 500 && config.nodeEnv === "production"
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

  app.get("/api/v1/health", async () => ({ status: "ok" }))

  installAuth(app)
  installIdempotency(app)
  registerAuthRoutes(app)
  registerWorkspaceRoutes(app)
  registerAuditRoutes(app)

  return app
}
