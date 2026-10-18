import type { FastifyInstance } from "fastify"
import { z } from "zod"
import { requireContext } from "../../plugins/auth"
import { askCopilot, runDailyCheck } from "./service"

const noBody = z.preprocess(
  (value) => value === undefined || value === null ? {} : value,
  z.object({}).strict(),
)
const askBody = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    text: z.string().max(4000),
  }).strict()).max(20).default([]),
}).strict()

export function registerCopilotRoutes(app: FastifyInstance) {
  // Any member may ask. Owners and Finance Managers also let the agent prepare Pending approvals;
  // it never approves or executes them.
  app.post("/api/v1/copilot/ask", {
    schema: { body: askBody },
    config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
  }, async (request) => {
    const ctx = requireContext(request)
    const body = askBody.parse(request.body)
    const run = await askCopilot(ctx, body, request.log)
    return { answer: run.answer, engine: run.engine, proposals: run.proposals }
  })
  // Owner / Finance Manager: the agent checks PayPal payments and prepares reminders as Pending approvals.
  app.post("/api/v1/copilot/daily-check", {
    schema: { body: noBody },
    config: { allowEmptyBody: true, rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request) => {
    const run = await runDailyCheck(requireContext(request), request.log)
    return { answer: run.answer, engine: run.engine, proposals: run.proposals }
  })
}
