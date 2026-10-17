import { Prisma } from "@prisma/client"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
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

function problemBody(code: string, detail: string): string {
  return JSON.stringify({
    type: "about:blank",
    title: "Conflict",
    status: 409,
    code,
    detail,
  })
}

function sendConflict(reply: FastifyReply, code: string, detail: string): void {
  reply.code(409).type("application/problem+json").send(problemBody(code, detail))
}

async function findExisting(workspaceId: string, key: string) {
  return prisma.idempotencyKey.findUnique({
    where: { workspaceId_key: { workspaceId, key } },
  })
}

function isExpired(createdAt: Date): boolean {
  return Date.now() - createdAt.getTime() >= replayWindowMs
}

function replayStored(
  reply: FastifyReply,
  stored: NonNullable<Awaited<ReturnType<typeof findExisting>>>,
): void {
  reply.code(stored.responseStatus)
  if (stored.responseStatus === 204 || stored.responseStatus === 304) {
    reply.send()
  } else {
    reply.type("application/json").send(stored.responseBody)
  }
}

async function reserve(pending: PendingKey) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const existing = await findExisting(pending.workspaceId, pending.key)
    if (existing) {
      if (!isExpired(existing.createdAt)) return existing
      await prisma.idempotencyKey.deleteMany({
        where: { workspaceId: pending.workspaceId, key: pending.key },
      })
    }

    try {
      await prisma.idempotencyKey.create({
        data: {
          ...pending,
          responseStatus: 0,
          responseBody: Prisma.JsonNull,
        },
      })
      return null
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error
    }
  }

  throw new Error("Could not reserve the idempotency key after concurrent expiry")
}

export function installIdempotency(app: FastifyInstance): void {
  app.addHook("onRequest", async (request, reply) => {
    if (!idempotentMethods.has(request.method)) return
    const header = request.headers["idempotency-key"]
    if (header === undefined || !request.ctx) return

    const context = requireContext(request)
    if (typeof header !== "string") {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must be a single value.", "Bad Request")
    }
    const key = header.trim()
    if (key.length === 0 || key.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key must contain 1 to 200 characters.", "Bad Request")
    }

    const pending: PendingKey = {
      workspaceId: context.workspaceId,
      userId: context.userId,
      key,
      route: `${context.userId} ${context.role} ${request.method} ${request.routeOptions.url}`,
    }
    const existing = await reserve(pending)
    if (existing) {
      if (existing.route !== pending.route) {
        sendConflict(reply, "idempotency_conflict", "This Idempotency-Key was already used for a different route or authorization context.")
      } else if (existing.responseStatus === 0) {
        sendConflict(reply, "idempotency_in_progress", "A request with this Idempotency-Key is still in progress.")
      } else {
        replayStored(reply, existing)
      }
      return
    }

    pendingKeys.set(request, pending)
  })

  app.addHook("onSend", async (request, reply, payload) => {
    const pending = pendingKeys.get(request)
    if (!pending) return payload
    pendingKeys.delete(request)
    const where = {
      workspaceId_key: { workspaceId: pending.workspaceId, key: pending.key },
    }

    if (reply.statusCode >= 500) {
      await prisma.idempotencyKey.delete({ where })
      return payload
    }

    const text = typeof payload === "string"
      ? payload
      : Buffer.isBuffer(payload)
        ? payload.toString("utf8")
        : ""
    const responseBody: Prisma.InputJsonValue | typeof Prisma.JsonNull = text.length === 0
      ? Prisma.JsonNull
      : JSON.parse(text) as Prisma.InputJsonValue

    await prisma.idempotencyKey.update({
      where,
      data: {
        responseStatus: reply.statusCode,
        responseBody,
      },
    })
    return payload
  })
}
