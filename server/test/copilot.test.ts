import { randomUUID } from "node:crypto"
import Anthropic from "@anthropic-ai/sdk"
import type { BetaMessage, MessageCreateParamsNonStreaming } from "@anthropic-ai/sdk/resources/beta/messages/messages"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { answerQuestion, cashBalance, createSeed, money, SUGGESTED_QUESTIONS, todayISO } from "../src/core"
import { prisma } from "../src/db"
import { buildApp } from "../src/app"
import { createAccessToken } from "../src/plugins/auth"
import { checkGrounding, COMPOSE_TOOL, runClaudeCopilot, type CopilotModel } from "../src/modules/copilot/agent"
import { setCopilotModel } from "../src/modules/copilot/service"

type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: unknown }

const message = (blocks: Block[], stop_reason: BetaMessage["stop_reason"] = "tool_use") => ({
  id: `msg_${randomUUID()}`,
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: blocks.map((b) => (b.type === "tool_use" ? { ...b, id: `toolu_${randomUUID()}` } : b)),
  stop_reason,
  stop_sequence: null,
  usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0 },
}) as unknown as BetaMessage

/** Replays scripted responses; a function step sees the request so it can echo tool output. */
function scripted(steps: Array<BetaMessage | ((params: MessageCreateParamsNonStreaming) => BetaMessage)>) {
  const calls: MessageCreateParamsNonStreaming[] = []
  const model: CopilotModel = {
    create: async (params) => {
      calls.push(structuredClone(params))
      const step = steps[calls.length - 1]
      if (!step) throw new Error("Model called more times than scripted")
      return typeof step === "function" ? step(params) : step
    },
  }
  return { model, calls }
}

const lastToolResults = (params: MessageCreateParamsNonStreaming) => {
  const last = params.messages.at(-1)
  return Array.isArray(last?.content) ? last.content.filter((b) => b.type === "tool_result") : []
}

const state = createSeed()
const today = todayISO()
const app = await buildApp()
const base = { state, today, turns: [], modelId: "claude-opus-5-5", effort: "medium" as const }

describe("rule-based router (shared tools refactor)", () => {
  it("answers every suggested question with a finance tool, never the help fallback", () => {
    for (const question of SUGGESTED_QUESTIONS) {
      const answer = answerQuestion(state, today, question)
      expect(answer.intent, question).not.toBe("help")
      expect(answer.engine).toBe("rules")
      expect(answer.trace[0].tool).toBe("ledger.cash_balance")
    }
  })
})

describe("Claude copilot agent", () => {
  it("runs the tools Claude picks and keeps every figure from the engine", async () => {
    const cash = money(cashBalance(state, today))
    const { model, calls } = scripted([
      message([{ type: "tool_use", name: "cash_outlook", input: { horizon_days: 30 } }, { type: "tool_use", name: "receivables", input: { reminders: false } }]),
      (params) => {
        const results = lastToolResults(params)
        expect(results).toHaveLength(2)
        expect(results.every((r) => !r.is_error)).toBe(true)
        return message([{ type: "tool_use", name: COMPOSE_TOOL, input: { headline: `You have ${cash} recorded today.`, paragraphs: ["Chase the overdue invoices first."], missing: [], primary_tool: "receivables" } }])
      },
    ])
    const run = await runClaudeCopilot({ ...base, question: "How is our cash and who owes us?", model })

    expect(run.engine).toBe("claude")
    expect(run.toolsUsed).toEqual(["cash_outlook", "receivables"])
    expect(run.answer.headline).toBe(`You have ${cash} recorded today.`)
    expect(run.answer.figures.find((f) => f.label === "Recorded cash")?.value).toBe(cash)
    expect(run.answer.table?.columns[0]).toBe("Invoice")
    expect(run.answer.grounding).toEqual({ checked: true, unverified: [] })
    expect(run.answer.trace.map((t) => t.tool)).toContain("claude → cash_outlook")
    expect(run.answer.actions.some((a) => a.kind === "draft-reminders")).toBe(true)

    const request = calls[0]
    expect(request.model).toBe("claude-opus-5-5")
    expect(request.tool_choice).toBeUndefined()
    expect(request.tools?.every((t) => "strict" in t && t.strict === true)).toBe(true)
    expect(request.tools?.map((t) => ("name" in t ? t.name : ""))).toContain(COMPOSE_TOOL)
  })

  it("flags amounts in Claude's wording that no tool returned", async () => {
    const { model } = scripted([
      message([{ type: "tool_use", name: "loan_status", input: {} }]),
      message([{ type: "tool_use", name: COMPOSE_TOOL, input: { headline: "You will save $987,654 by refinancing.", paragraphs: [], missing: [], primary_tool: "loan_status" } }]),
    ])
    const run = await runClaudeCopilot({ ...base, question: "Should we refinance?", model })
    expect(run.answer.grounding?.unverified).toEqual(["$987,654"])
    expect(run.answer.missing.join(" ")).toContain("$987,654")
  })

  it("returns invalid tool input to Claude as an error instead of running the tool", async () => {
    const { model, calls } = scripted([
      message([{ type: "tool_use", name: "late_payment_impact", input: { client: "Nobody Ltd", days_late: 30 } }]),
      (params) => {
        const [result] = lastToolResults(params)
        expect(result.is_error).toBe(true)
        expect(String(result.content)).toContain("Known clients")
        return message([{ type: "tool_use", name: "upcoming_obligations", input: { days: -5 } }])
      },
      (params) => {
        expect(lastToolResults(params)[0].is_error).toBe(true)
        return message([{ type: "tool_use", name: COMPOSE_TOOL, input: { headline: "I couldn't find that client.", paragraphs: [], missing: ["Client not recorded"], primary_tool: "none" } }])
      },
    ])
    const run = await runClaudeCopilot({ ...base, question: "What if Nobody Ltd pays late?", model })
    expect(calls).toHaveLength(3)
    expect(run.toolsUsed).toEqual([])
    expect(run.answer.missing).toContain("Client not recorded")
  })

  it("falls back to the rule-based router when Claude refuses", async () => {
    const { model } = scripted([message([], "refusal")])
    const run = await runClaudeCopilot({ ...base, question: "Which clients have overdue invoices?", model })
    expect(run.engine).toBe("rules")
    expect(run.fallbackReason).toBe("Claude declined this request")
    expect(run.answer.intent).toBe("overdue")
  })

  it("stops after a bounded number of tool turns", async () => {
    const loop = message([{ type: "tool_use", name: "cash_outlook", input: { horizon_days: 7 } }])
    const { model, calls } = scripted(Array.from({ length: 10 }, () => loop))
    const run = await runClaudeCopilot({ ...base, question: "Loop forever", model })
    expect(calls.length).toBeLessThanOrEqual(6)
    expect(run.engine).toBe("rules")
  })

  it("grounding accepts tool values regardless of sign and formatting", () => {
    expect(checkGrounding(["Balance −$1,250 and margin 18%"], ['{"figures":["Low: -$1,250","Margin: 18%"]}'])).toEqual([])
    expect(checkGrounding(["Up 20%"], ["Margin: 18%"])).toEqual(["20%"])
  })
})

describe("POST /api/v1/copilot/ask", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
  const workspaceId = `copilot-${suffix}`
  const viewerId = `user-copilot-viewer-${suffix}`
  let token = ""
  const headers = () => ({ authorization: `Bearer ${token}`, "x-workspace-id": workspaceId })

  beforeAll(async () => {
    await prisma.user.create({ data: { id: viewerId, email: `copilot-viewer-${suffix}@example.test`, name: "Copilot Viewer", passwordHash: "unused" } })
    await prisma.workspace.create({
      data: {
        id: workspaceId, name: "Copilot Test", currency: "USD", agencyType: "Agency", teamSize: "1", location: "Austin", website: "", timezone: "UTC", seededOn: today,
        settings: { create: { safetyThreshold: 1000, defaultHorizon: 30, planningScenario: "expected", managerApprovalLimit: 6000, openingBalance: 10000, openingDate: "2026-01-01", ownerName: "Owner", ownerEmail: `owner-${suffix}@example.test`, notifications: {}, readiness: [], dismissedInsights: [] } },
      },
    })
    await prisma.membership.create({ data: { workspaceId, userId: viewerId, role: "Viewer" } })
    token = await createAccessToken(viewerId)
  })

  afterEach(() => setCopilotModel(undefined))
  afterAll(async () => {
    await app.close()
  })

  it("lets a read-only member ask, and audits the answer", async () => {
    setCopilotModel(scripted([
      message([{ type: "tool_use", name: "cash_outlook", input: { horizon_days: 30 } }]),
      message([{ type: "tool_use", name: COMPOSE_TOOL, input: { headline: "Cash is $10,000.", paragraphs: [], missing: [], primary_tool: "none" } }]),
    ]).model)
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(), payload: { question: "How much cash do we have?" } })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.engine).toBe("claude")
    expect(body.answer.grounding.unverified).toEqual([])
    const events = await prisma.auditEvent.findMany({ where: { workspaceId, action: "Copilot answered" } })
    expect(events).toHaveLength(1)
    expect(events[0].detail).toContain("tools: cash_outlook")
    expect(events[0].outcome).toBe("info")
  })

  it("answers with the rule-based router when Claude is unreachable", async () => {
    setCopilotModel({ create: async () => { throw new Anthropic.APIConnectionError({ message: "offline" }) } })
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(), payload: { question: "Which clients have overdue invoices?" } })
    expect(response.statusCode).toBe(200)
    expect(response.json().engine).toBe("rules")
    expect(response.json().answer.missing.join(" ")).toContain("Claude could not be reached")
  })

  it("validates the request and requires membership", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(), payload: { question: "  " } })
    expect(empty.statusCode).toBe(400)
    const outsider = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: { ...headers(), "x-workspace-id": "not-mine" }, payload: { question: "Cash?" } })
    expect(outsider.statusCode).toBe(404)
  })
})
