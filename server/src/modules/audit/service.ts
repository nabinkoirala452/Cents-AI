import { randomUUID } from "node:crypto"
import type { AuditOutcome, Prisma, PrismaClient } from "@prisma/client"
import type { RequestContext } from "../../plugins/auth"
import { prisma } from "../../db"
import { HttpError } from "../../lib/errors"
import { requireView } from "../../lib/permissions"

type AuditInput = {
  actor?: string
  action: string
  detail: string
  ref?: string
  outcome: AuditOutcome
}

type AuditDatabase = PrismaClient | Prisma.TransactionClient

export async function audit(
  ctx: RequestContext,
  event: AuditInput,
  database: AuditDatabase = prisma,
) {
  return database.auditEvent.create({
    data: {
      workspaceId: ctx.workspaceId,
      id: `AU-${randomUUID()}`,
      actorUserId: ctx.userId,
      actor: event.actor ?? ctx.userName,
      action: event.action,
      detail: event.detail,
      ref: event.ref,
      outcome: event.outcome,
      requestId: ctx.requestId,
    },
  })
}

export async function listAuditEvents(
  ctx: RequestContext,
  query: { limit: number; cursor?: string; ref?: string },
) {
  requireView(ctx.role)
  const where = {
    workspaceId: ctx.workspaceId,
    ...(query.ref === undefined ? {} : { ref: query.ref }),
  }

  if (query.cursor) {
    const cursorEvent = await prisma.auditEvent.findFirst({
      where: { ...where, id: query.cursor },
      select: { id: true },
    })
    if (!cursorEvent) {
      throw new HttpError(400, "invalid_cursor", "The audit cursor is not valid for this query.", "Bad Request")
    }
  }

  const events = await prisma.auditEvent.findMany({
    where,
    orderBy: [{ at: "desc" }, { id: "desc" }],
    take: query.limit + 1,
    ...(query.cursor
      ? {
          cursor: {
            workspaceId_id: {
              workspaceId: ctx.workspaceId,
              id: query.cursor,
            },
          },
          skip: 1,
        }
      : {}),
  })
  const hasMore = events.length > query.limit
  const page = hasMore ? events.slice(0, query.limit) : events
  return {
    items: page.map((event) => ({
      id: event.id,
      at: event.at.toISOString(),
      actor: event.actor,
      action: event.action,
      detail: event.detail,
      ...(event.ref === null ? {} : { ref: event.ref }),
      outcome: event.outcome,
    })),
    nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null,
  }
}

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${safe.replaceAll('"', '""')}"`
}

export async function exportAuditEventsCsv(ctx: RequestContext): Promise<string> {
  requireView(ctx.role)
  const events = await prisma.auditEvent.findMany({
    where: { workspaceId: ctx.workspaceId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
  })
  const rows = [
    ["id", "at", "actor", "action", "detail", "ref", "outcome"],
    ...events.map((event) => [
      event.id,
      event.at.toISOString(),
      event.actor,
      event.action,
      event.detail,
      event.ref ?? "",
      event.outcome,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n")
}
