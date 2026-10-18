import { randomUUID } from "node:crypto"
import OpenAI from "openai"
import type { ChatCompletion, ChatCompletionCreateParamsNonStreaming, ChatCompletionToolMessageParam } from "openai/resources/chat/completions"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"
import { answerQuestion, cashBalance, createSeed, money, SUGGESTED_QUESTIONS, todayISO } from "../src/core"
import { prisma } from "../src/db"
import { buildApp } from "../src/app"
import { HttpError } from "../src/lib/errors"
import { createAccessToken } from "../src/plugins/auth"
import {
  CHECK_PAYMENT,
  checkGrounding,
  COMPOSE_TOOL,
  PROPOSE_PAYPAL_SEND,
  PROPOSE_REMINDER,
  runLlmCopilot,
  type AgentCapabilities,
  type CopilotModel,
} from "../src/modules/copilot/agent"
import { setCopilotModel, setCopilotPayPalTools } from "../src/modules/copilot/service"

type Call = { name: string; args: unknown }

const completion = (calls: Call[], finish_reason: ChatCompletion.Choice["finish_reason"] = calls.length ? "tool_calls" : "stop", content: string | null = null) => ({
  id: `chatcmpl_${randomUUID()}`,
  object: "chat.completion",
  created: 0,
  model: "openai/gpt-oss-120b",
  choices: [{
    index: 0,
    finish_reason,
    logprobs: null,
    message: {
      role: "assistant",
      content,
      refusal: null,
      ...(calls.length ? { tool_calls: calls.map((c) => ({ id: `call_${randomUUID()}`, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args) } })) } : {}),
    },
  }],
  usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
}) as unknown as ChatCompletion

const compose = (headline: string, primary_tool = "none", paragraphs: string[] = [], missing: string[] = []) =>
  completion([{ name: COMPOSE_TOOL, args: { headline, paragraphs, missing, primary_tool } }])

/** Replays scripted responses; a function step sees the request so it can inspect tool output. */
function scripted(steps: Array<ChatCompletion | ((params: ChatCompletionCreateParamsNonStreaming) => ChatCompletion)>) {
  const calls: ChatCompletionCreateParamsNonStreaming[] = []
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

const toolReplies = (params: ChatCompletionCreateParamsNonStreaming) => {
  const replies: ChatCompletionToolMessageParam[] = []
  for (let i = params.messages.length - 1; i >= 0 && params.messages[i].role === "tool"; i--) replies.unshift(params.messages[i] as ChatCompletionToolMessageParam)
  return replies
}
const toolNames = (params: ChatCompletionCreateParamsNonStreaming) => (params.tools ?? []).map((t) => t.function.name)

const state = createSeed()
const today = todayISO()
const overdue = state.invoices.find((i) => i.id === "INV-1042")!
const app = await buildApp()
const base = { state, today, turns: [], modelId: "openai/gpt-oss-120b" }

describe("rule-based router (shared tools)", () => {
  it("answers every suggested question with a finance tool, never the help fallback", () => {
    for (const question of SUGGESTED_QUESTIONS) {
      const answer = answerQuestion(state, today, question)
      expect(answer.intent, question).not.toBe("help")
      expect(answer.engine).toBe("rules")
    }
  })
})

describe("LLM copilot agent", () => {
  it("runs the tools the model picks and keeps every figure from the engine", async () => {
    const cash = money(cashBalance(state, today))
    const { model, calls } = scripted([
      completion([{ name: "cash_outlook", args: { horizon_days: 30 } }, { name: "receivables", args: { reminders: false } }]),
      (params) => {
        const replies = toolReplies(params)
        expect(replies).toHaveLength(2)
        expect(replies.every((r) => !String(r.content).startsWith("ERROR"))).toBe(true)
        return compose(`You have ${cash} recorded today.`, "receivables", ["Chase the overdue invoices first."])
      },
    ])
    const run = await runLlmCopilot({ ...base, question: "How is our cash and who owes us?", model })

    expect(run.engine).toBe("llm")
    expect(run.toolsUsed).toEqual(["cash_outlook", "receivables"])
    expect(run.answer.model).toBe("openai/gpt-oss-120b")
    expect(run.answer.figures.find((f) => f.label === "Recorded cash")?.value).toBe(cash)
    expect(run.answer.table?.columns[0]).toBe("Invoice")
    expect(run.answer.grounding).toEqual({ checked: true, unverified: [] })
    expect(run.answer.trace.map((t) => t.tool)).toContain("llm → cash_outlook")
    expect(calls[0].tool_choice).toBe("auto")
    expect(calls[0].messages[0].role).toBe("system")
    // No capabilities given: no write tools are offered.
    expect(toolNames(calls[0])).not.toContain(PROPOSE_REMINDER)
    expect(toolNames(calls[0])).not.toContain(CHECK_PAYMENT)
  })

  it("flags amounts in the wording that no tool returned", async () => {
    const { model } = scripted([
      completion([{ name: "loan_status", args: {} }]),
      compose("You will save $987,654 by refinancing.", "loan_status"),
    ])
    const run = await runLlmCopilot({ ...base, question: "Should we refinance?", model })
    expect(run.answer.grounding?.unverified).toEqual(["$987,654"])
    expect(run.answer.missing.join(" ")).toContain("$987,654")
  })

  it("returns invalid tool input to the model as an error instead of running the tool", async () => {
    const { model, calls } = scripted([
      completion([{ name: "late_payment_impact", args: { client: "Nobody Ltd", days_late: 30 } }]),
      (params) => {
        expect(String(toolReplies(params)[0].content)).toMatch(/^ERROR: .*Known clients/)
        return completion([{ name: "upcoming_obligations", args: { days: -5 } }])
      },
      (params) => {
        expect(String(toolReplies(params)[0].content)).toMatch(/^ERROR/)
        return compose("I couldn't find that client.", "none", [], ["Client not recorded"])
      },
    ])
    const run = await runLlmCopilot({ ...base, question: "What if Nobody Ltd pays late?", model })
    expect(calls).toHaveLength(3)
    expect(run.toolsUsed).toEqual([])
    expect(run.answer.missing).toContain("Client not recorded")
  })

  it("prepares a reminder as a Pending approval and never claims it was sent", async () => {
    const proposed: unknown[] = []
    const capabilities: AgentCapabilities = {
      proposeApproval: async (kind, invoiceId, draft) => {
        proposed.push({ kind, invoiceId, draft })
        return { id: "AP-agent-1", title: `Send payment reminder · ${invoiceId}`, status: "Pending", amount: 6830, currency: "USD" }
      },
    }
    const { model, calls } = scripted([
      completion([{ name: PROPOSE_REMINDER, args: { invoice_id: overdue.id, message: "Hi Acme, a friendly reminder that INV-1042 for $6,830 is past due." } }]),
      (params) => {
        expect(JSON.parse(String(toolReplies(params)[0].content))).toMatchObject({ approvalId: "AP-agent-1", status: "Pending" })
        return compose("I prepared a reminder for INV-1042 ($6,830) — it is waiting for your approval.")
      },
    ])
    const run = await runLlmCopilot({ ...base, question: "Chase Acme", model, capabilities })
    expect(toolNames(calls[0])).toEqual(expect.arrayContaining([PROPOSE_REMINDER, PROPOSE_PAYPAL_SEND]))
    expect(proposed).toEqual([{ kind: "send_reminder", invoiceId: "INV-1042", draft: "Hi Acme, a friendly reminder that INV-1042 for $6,830 is past due." }])
    expect(run.proposals.map((p) => p.id)).toEqual(["AP-agent-1"])
    expect(run.answer.actions[0]).toEqual({ label: "Review 1 prepared approval", kind: "navigate", to: "approvals" })
    expect(run.answer.actions.some((a) => a.kind === "draft-reminders")).toBe(false)
    expect(run.answer.grounding?.unverified).toEqual([])
  })

  it("passes approval errors (such as an already-open approval) back to the model", async () => {
    const capabilities: AgentCapabilities = {
      proposeApproval: async () => { throw new HttpError(409, "approval_already_open", "An approval is already open for this record.", "Conflict") },
    }
    const { model } = scripted([
      completion([{ name: PROPOSE_PAYPAL_SEND, args: { invoice_id: "INV-1060" } }]),
      (params) => {
        expect(String(toolReplies(params)[0].content)).toBe("ERROR: An approval is already open for this record.")
        return compose("A send is already waiting for approval.")
      },
    ])
    const run = await runLlmCopilot({ ...base, question: "Send INV-1060", model, capabilities })
    expect(run.proposals).toEqual([])
  })

  it("verifies a PayPal payment, reloads state when one is recorded, and calls PayPal toolkit read tools", async () => {
    let reloaded = 0
    const toolkitCalls: string[] = []
    const capabilities: AgentCapabilities = {
      checkPaymentStatus: async () => ({ status: "PAID", paid: true, insertedPayments: 1 }),
      reloadState: async () => { reloaded++; return state },
      paypal: {
        tools: [{ type: "function", function: { name: "list_transactions", description: "List PayPal transactions", parameters: { type: "object", properties: {} } } }],
        call: async (call) => { toolkitCalls.push(call.function.name); return '{"transaction_details":[{"transaction_amount":{"value":"6830.00"}}]}' },
      },
    }
    const { model, calls } = scripted([
      completion([{ name: CHECK_PAYMENT, args: { invoice_id: "INV-1042" } }]),
      completion([{ name: "list_transactions", args: {} }]),
      compose("PayPal confirms INV-1042 is paid; the $6,830 receipt is in the ledger."),
    ])
    const run = await runLlmCopilot({ ...base, question: "Did Acme pay?", model, capabilities })
    expect(toolNames(calls[0])).toContain("list_transactions")
    expect(reloaded).toBe(1)
    expect(toolkitCalls).toEqual(["list_transactions"])
    expect(run.answer.trace.map((t) => t.tool)).toEqual(expect.arrayContaining(["paypal.verify_payment", "paypal.list_transactions"]))
    expect(run.answer.grounding?.unverified).toEqual([])
  })

  it("falls back to the rule-based router on a content filter or a runaway loop", async () => {
    const filtered = await runLlmCopilot({ ...base, question: "Which clients have overdue invoices?", model: scripted([completion([], "content_filter")]).model })
    expect(filtered.engine).toBe("rules")
    expect(filtered.answer.intent).toBe("overdue")

    const loop = completion([{ name: "cash_outlook", args: { horizon_days: 7 } }])
    const { model, calls } = scripted(Array.from({ length: 12 }, () => loop))
    const run = await runLlmCopilot({ ...base, question: "Loop forever", model })
    expect(calls.length).toBeLessThanOrEqual(8)
    expect(run.engine).toBe("rules")
  })

  it("grounding accepts tool values regardless of sign and formatting", () => {
    expect(checkGrounding(["Balance −$1,250 and margin 18%"], ['{"figures":["Low: -$1,250","Margin: 18%"]}'])).toEqual([])
    expect(checkGrounding(["Paid $6,830"], ['{"value":"6830.00"}'])).toEqual([])
    expect(checkGrounding(["Up 20%"], ["Margin: 18%"])).toEqual(["20%"])
  })
})

describe("copilot routes", () => {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 12)
  const workspaceId = `copilot-${suffix}`
  const viewerId = `user-copilot-viewer-${suffix}`
  const ownerId = `user-copilot-owner-${suffix}`
  const clientId = `CL-${suffix}`
  let viewerToken = ""
  let ownerToken = ""
  const headers = (token: string) => ({ authorization: `Bearer ${token}`, "x-workspace-id": workspaceId })

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: viewerId, email: `copilot-viewer-${suffix}@example.test`, name: "Copilot Viewer", passwordHash: "unused" },
        { id: ownerId, email: `copilot-owner-${suffix}@example.test`, name: "Copilot Owner", passwordHash: "unused" },
      ],
    })
    await prisma.workspace.create({
      data: {
        id: workspaceId, name: "Copilot Test", currency: "USD", agencyType: "Agency", teamSize: "1", location: "Austin", website: "", timezone: "UTC", seededOn: today,
        settings: { create: { safetyThreshold: 1000, defaultHorizon: 30, planningScenario: "expected", managerApprovalLimit: 6000, openingBalance: 10000, openingDate: "2026-01-01", ownerName: "Owner", ownerEmail: `owner-${suffix}@example.test`, notifications: {}, readiness: [], dismissedInsights: [] } },
      },
    })
    await prisma.membership.createMany({ data: [{ workspaceId, userId: viewerId, role: "Viewer" }, { workspaceId, userId: ownerId, role: "Owner" }] })
    await prisma.client.create({ data: { workspaceId, id: clientId, name: "Overdue Co", email: `client-${suffix}@example.test`, country: "USA", currency: "USD", avgDelayDays: 10 } })
    await prisma.invoice.create({
      data: {
        workspaceId, id: `INV-${suffix}`, clientId, kind: "Project", issueDate: "2026-01-01", dueDate: "2026-01-15", currency: "USD",
        lineItems: [{ description: "Design sprint", quantity: 1, unitPrice: 2500 }], status: "Sent", channel: "BankTransfer", reminders: [],
      },
    })
    viewerToken = await createAccessToken(viewerId)
    ownerToken = await createAccessToken(ownerId)
  })

  afterEach(() => {
    setCopilotModel(undefined)
    setCopilotPayPalTools(undefined)
  })
  afterAll(async () => {
    await app.close()
  })

  it("lets a read-only member ask, offers no write tools, and audits the answer", async () => {
    const { model, calls } = scripted([
      completion([{ name: "cash_outlook", args: { horizon_days: 30 } }]),
      compose("Here is your 30-day outlook."),
    ])
    setCopilotModel(model)
    setCopilotPayPalTools(null)
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(viewerToken), payload: { question: "How much cash do we have?" } })
    expect(response.statusCode).toBe(200)
    expect(response.json().engine).toBe("llm")
    expect(toolNames(calls[0])).not.toContain(PROPOSE_REMINDER)
    expect(toolNames(calls[0])).toContain(CHECK_PAYMENT)
    const events = await prisma.auditEvent.findMany({ where: { workspaceId, action: "Copilot answered" } })
    expect(events).toHaveLength(1)
    expect(events[0].detail).toContain("tools: cash_outlook")
  })

  it("lets the agent prepare a real Pending approval for an Owner, marked as agent-prepared", async () => {
    setCopilotPayPalTools(null)
    setCopilotModel(scripted([
      completion([{ name: PROPOSE_REMINDER, args: { invoice_id: `INV-${suffix}`, message: "Hi Overdue Co, a reminder about our invoice." } }]),
      compose("I prepared a reminder for your approval."),
    ]).model)
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(ownerToken), payload: { question: "Chase the overdue invoice" } })
    expect(response.statusCode).toBe(200)
    const [proposal] = response.json().proposals
    const row = await prisma.approval.findUniqueOrThrow({ where: { workspaceId_id: { workspaceId, id: proposal.id } } })
    expect(row.status).toBe("Pending")
    expect(row.preparedByAgent).toBe(true)
    expect(row.preparedBy).toBe("CentsAI agent (for Copilot Owner)")
    expect(row.draft).toBe("Hi Overdue Co, a reminder about our invoice.")
    expect(row.decidedAt).toBeNull()
    const listed = await app.inject({ method: "GET", url: "/api/v1/approvals?status=Pending", headers: headers(ownerToken) })
    expect(listed.json().find((a: { id: string }) => a.id === proposal.id)?.preparedByAgent).toBe(true)
  })

  it("daily check needs a preparing role and, without an LLM, skips invoices that already have an open approval", async () => {
    const viewer = await app.inject({ method: "POST", url: "/api/v1/copilot/daily-check", headers: headers(viewerToken) })
    expect(viewer.statusCode).toBe(403)

    setCopilotModel(null)
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/daily-check", headers: headers(ownerToken) })
    expect(response.statusCode).toBe(200)
    const body = response.json()
    expect(body.engine).toBe("rules")
    expect(body.proposals).toEqual([])
    expect(body.answer.paragraphs.join(" ")).toContain("already open")
    const events = await prisma.auditEvent.findMany({ where: { workspaceId, action: "Agent daily check" } })
    expect(events).toHaveLength(1)
  })

  it("answers with the rule-based router when the LLM provider is unreachable", async () => {
    setCopilotPayPalTools(null)
    setCopilotModel({ create: async () => { throw new OpenAI.APIConnectionError({ message: "offline" }) } })
    const response = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(viewerToken), payload: { question: "Which clients have overdue invoices?" } })
    expect(response.statusCode).toBe(200)
    expect(response.json().engine).toBe("rules")
    expect(response.json().answer.missing.join(" ")).toContain("could not be reached")
  })

  it("validates the request and requires membership", async () => {
    const empty = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: headers(viewerToken), payload: { question: "  " } })
    expect(empty.statusCode).toBe(400)
    const outsider = await app.inject({ method: "POST", url: "/api/v1/copilot/ask", headers: { ...headers(viewerToken), "x-workspace-id": "not-mine" }, payload: { question: "Cash?" } })
    expect(outsider.statusCode).toBe(404)
  })
})
