import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireContext } from "../../plugins/auth"
import { exportAuditEventsCsv, listAuditEvents } from "./service"

const auditQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(200).optional(),
  ref: z.string().max(200).optional(),
}).strict()

export function registerAuditRoutes(app: FastifyInstance): void {
  app.get("/api/v1/audit-events", { schema: { querystring: auditQuery } }, async (request) => {
    const context = requireContext(request)
    const { limit, cursor, ref } = auditQuery.parse(request.query)
    return listAuditEvents(context, { limit, cursor, ref })
  })

  app.get("/api/v1/audit-events/export.csv", async (request, reply) => {
    const context = requireContext(request)
    const csv = await exportAuditEventsCsv(context)
    return reply
      .header("content-disposition", 'attachment; filename="audit-events.csv"')
      .type("text/csv; charset=utf-8")
      .send(csv)
  })
}
