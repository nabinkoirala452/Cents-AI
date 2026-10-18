import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireContext } from "../../plugins/auth"
import { askCopilot } from "./service"

const askBody = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(4000),
  }).strict()).max(20).default([]),
}).strict()

export function registerCopilotRoutes(app: FastifyInstance) {
  // Read-only for every member: the copilot reads records and runs calculations, never mutates.
  app.post("/api/v1/copilot/ask", {
    schema: { body: askBody },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request) => {
    const ctx = requireContext(request)
    const body = askBody.parse(request.body)
    const run = await askCopilot(ctx, body, request.log)
    return { answer: run.answer, engine: run.engine }
  })
}
