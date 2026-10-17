import { Prisma } from "@prisma/client"
import type { FastifyInstance, FastifyRequest } from "fastify"
import { prisma } from "../db"
import { HttpError } from "../lib/errors"
import { requireContext } from "./auth"

type PendingKey = {
  workspaceId: string
  userId: string
  key: string
  route: string
}

const pendingKeys = new WeakMap<FastifyRequest, PendingKey>()
const idempotentMethods = new Set(["POST", "PATCH", "PUT", "DELETE"])
const replayWindowMs = 24 * 60 * 60 * 1000

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

function conflictBody() {
  return JSON.stringify({
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code: "idempotency_conflict",
    detail: "This Idempotency-Key was already used for a different route or authorization context.",
  })
}

export function installIdempotency(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!idempotentMethods.has(request.method)) return
    const header = request.headers["idempotency-key"]
    if (header === undefined) return

    if (!request.ctx) return
    const context = requireContext(request)
    if (typeof header !== "string") {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must be a single value.", "Bad Request")
    }
    const key = header.trim()
    if (key.length === 0 || key.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must contain 1 to 200 characters.", "Bad Request")
    }

    const route = `${context.userId} ${context.role} ${request.method} ${request.routeOptions.url}`
    const uniqueKey = { workspaceId: context.workspaceId, key }
    const stored = await prisma.idempotencyKey.findUnique({ where: { workspaceId_key: uniqueKey } })
    if (stored) {
      if (Date.now() - stored.createdAt.getTime() >= replayWindowMs) {
        await prisma.idempotencyKey.delete({ where: { workspaceId_key: uniqueKey } })
      } else if (stored.route !== route) {
        reply
          .code(409)
          .type("application/problem+json")
          .send(conflictBody())
        return
      } else {
        reply.code(stored.responseStatus)
        if (stored.responseStatus === 204 || stored.responseStatus === 304) {
          reply.send()
        } else {
          reply.type("application/json").send(stored.responseBody)
        }
        return
      }
    }

    pendingKeys.set(request, {
      workspaceId: context.workspaceId,
      userId: context.userId,
      key,
      route,
    })
  })

  app.addHook("onSend", async (request, reply, payload) => {
    const pending = pendingKeys.get(request)
    if (!pending) return payload
    pendingKeys.delete(request)

    const text = typeof payload === "string"
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : ""
    const responseBody: Prisma.InputJsonValue | typeof Prisma.JsonNull = text.length === 0
      ? Prisma.JsonNull
      : JSON.parse(text) as Prisma.InputJsonValue

    try {
      await prisma.idempotencyKey.create({
        data: {
          ...pending,
          responseStatus: reply.statusCode,
          responseBody,
        },
      })
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
      const existing = await prisma.idempotencyKey.findUnique({
        where: { workspaceId_key: { workspaceId: pending.workspaceId, key: pending.key } },
      })
      if (!existing) throw error
      if (existing.route !== pending.route) {
        reply.code(409).type("application/problem+json")
        return conflictBody()
      }
      reply.code(existing.responseStatus)
      return existing.responseStatus === 204 || existing.responseStatus === 304
        ? ""
        : JSON.stringify(existing.responseBody)
    }

    return payload
  })
}
