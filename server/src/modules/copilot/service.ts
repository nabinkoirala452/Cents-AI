import OpenAI from "openai"
import { PayPalAgentToolkit } from "@paypal/agent-toolkit/openai"
import type { FastifyBaseLogger } from "fastify"
import { config } from "../../config"
import { HttpError } from "../../lib/errors"
import { canPrepare, requirePrepare } from "../../lib/permissions"
import type { RequestContext } from "../../plugins/auth"
import { createApproval } from "../approvals/service"
import { audit } from "../audit/service"
import { reconcileInvoice } from "../payments/service"
import { currentDate, readComputedState } from "../records/service"
import { receivables, invoiceTotal, money, type CopilotAnswer, type State } from "../../core"
import { rulesRun, runLlmCopilot, type AgentCapabilities, type ChatTurn, type CopilotModel, type CopilotRun, type ProposedApproval } from "./agent"

let overrideModel: CopilotModel | null | undefined
let overridePayPalTools: AgentCapabilities["paypal"] | null | undefined

/** Tests inject fakes; `null` disables; `undefined` restores what config says. */
export function setCopilotModel(model: CopilotModel | null | undefined) {
  overrideModel = model
}
export function setCopilotPayPalTools(tools: AgentCapabilities["paypal"] | null | undefined) {
  overridePayPalTools = tools
}

function configuredModel(): CopilotModel | null {
  if (overrideModel !== undefined) return overrideModel
  if (config.copilotEngine !== "llm" || !config.llmApiKey) return null
  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl, timeout: 60_000, maxRetries: 2 })
  return { create: (params) => client.chat.completions.create(params) }
}

/** Only read actions of the PayPal Agent Toolkit; its write tools would bypass the approval workflow. */
const PAYPAL_READ_ACTIONS = {
  invoices: { list: true, get: true, search: true },
  transactions: { list: true },
  insights: { get: true },
  disputes: { list: true },
}
const PAYPAL_READ_TOOLS = new Set(["list_invoices", "get_invoice", "search_invoicing", "list_transactions", "get_merchant_insights", "list_disputes"])
let toolkit: PayPalAgentToolkit | undefined

function paypalTools(): AgentCapabilities["paypal"] {
  if (overridePayPalTools !== undefined) return overridePayPalTools ?? undefined
  if (!config.copilotPayPalTools || config.paypalMode !== "sandbox" || !config.paypalClientId || !config.paypalClientSecret) return undefined
  toolkit ??= new PayPalAgentToolkit({
    clientId: config.paypalClientId,
    clientSecret: config.paypalClientSecret,
    configuration: { actions: PAYPAL_READ_ACTIONS, context: { sandbox: config.paypalEnv === "sandbox" } },
  })
  const kit = toolkit
  return {
    tools: kit.getTools().filter((t) => PAYPAL_READ_TOOLS.has(t.function.name)),
    call: async (call) => {
      if (!PAYPAL_READ_TOOLS.has(call.function.name)) throw new HttpError(403, "forbidden_tool", "That PayPal tool is not enabled.", "Forbidden")
      const result = await kit.handleToolCall(call)
      return typeof result.content === "string" ? result.content : JSON.stringify(result.content)
    },
  }
}

function capabilitiesFor(ctx: RequestContext, log: FastifyBaseLogger): AgentCapabilities {
  return {
    // Viewers get no proposal tools at all; createApproval re-checks the role regardless.
    ...(canPrepare(ctx.role)
      ? {
          proposeApproval: async (kind, invoiceId, draft) => {
            const approval = await createApproval(ctx, { kind, refId: invoiceId, ...(draft ? { draft } : {}), agent: true }, log)
            return { id: approval.id, title: approval.title, status: approval.status, amount: approval.amount, currency: approval.currency } satisfies ProposedApproval
          },
        }
      : {}),
    checkPaymentStatus: (invoiceId) =>
      reconcileInvoice(ctx.workspaceId, invoiceId, {
        actor: `CentsAI agent (for ${ctx.userName})`,
        actorUserId: ctx.userId,
        requestId: ctx.requestId,
        logger: log,
      }),
    reloadState: () => readComputedState(ctx),
    paypal: paypalTools(),
  }
}

const reasonFor = (error: unknown) =>
  error instanceof OpenAI.RateLimitError ? "The LLM provider's free-tier rate limit was reached"
    : error instanceof OpenAI.AuthenticationError ? "The LLM API key was rejected"
    : error instanceof OpenAI.APIConnectionError ? "The LLM provider could not be reached"
    : error instanceof OpenAI.APIError ? `LLM API error ${error.status ?? ""}`.trim()
    : "The LLM answer failed"

async function runAgent(ctx: RequestContext, state: State, today: string, question: string, turns: ChatTurn[], log: FastifyBaseLogger, fallback: () => Promise<CopilotRun>) {
  const model = configuredModel()
  if (!model) return fallback()
  try {
    return await runLlmCopilot({ state, today, question, turns, model, modelId: config.llmModel, capabilities: capabilitiesFor(ctx, log) })
  } catch (error) {
    // The deterministic router still answers, and says so, if the LLM is unavailable.
    log.warn({ err: error }, "Copilot LLM call failed; answering with the rule-based router")
    return { ...(await fallback()), fallbackReason: reasonFor(error) }
  }
}

async function auditRun(ctx: RequestContext, action: string, run: CopilotRun, question: string) {
  if (run.fallbackReason) run.answer.missing.push(`${run.fallbackReason}; this answer used the rule-based router instead.`)
  const unverified = run.answer.grounding?.unverified ?? []
  await audit(ctx, {
    action,
    detail: [
      run.engine === "llm" ? `LLM (${config.llmModel})` : "Rule-based router",
      `tools: ${run.toolsUsed.join(", ") || "none"}`,
      run.proposals.length ? `prepared: ${run.proposals.map((p) => p.id).join(", ")}` : "",
      run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out tokens` : "",
      unverified.length ? `unverified figures: ${unverified.join(", ")}` : "",
      run.fallbackReason ?? "",
      `question: "${question.slice(0, 160)}"`,
    ].filter(Boolean).join(" · "),
    outcome: unverified.length || run.fallbackReason ? "warning" : "info",
  })
}

export async function askCopilot(
  ctx: RequestContext,
  body: { question: string; history: ChatTurn[] },
  log: FastifyBaseLogger,
): Promise<CopilotRun> {
  const state = await readComputedState(ctx)
  const today = await currentDate(ctx)
  const run = await runAgent(ctx, state, today, body.question, body.history, log, async () => rulesRun(state, today, body.question))
  await auditRun(ctx, "Copilot answered", run, body.question)
  return run
}

export const DAILY_CHECK_PROMPT = `Run today's finance check for the owner:
1. Review the 30-day cash outlook, receivables and the next 14 days of obligations.
2. For every sent PayPal invoice that is overdue or due within 7 days, check its payment status with PayPal.
3. For every invoice that is still overdue after that, prepare one payment reminder with a short personalised message. Skip invoices that already have an open approval.
4. Answer with what changed today, what you prepared for approval, and the single most important next step.`

/** Deterministic daily check used when no LLM is configured: same steps, template reminder text. */
async function rulesDailyCheck(ctx: RequestContext, state: State, today: string, capabilities: AgentCapabilities): Promise<CopilotRun> {
  const proposals: ProposedApproval[] = []
  const trace: CopilotAnswer["trace"] = []
  const notes: string[] = []
  let current = state
  for (const r of receivables(current, today).overdue.concat(receivables(current, today).dueSoon)) {
    if (r.inv.channel !== "PayPal" || !r.inv.paypal || !capabilities.checkPaymentStatus) continue
    try {
      const result = await capabilities.checkPaymentStatus(r.inv.id)
      trace.push({ tool: "paypal.verify_payment", input: r.inv.id, output: `PayPal ${result.status ?? "unknown"}${result.paid ? " · paid" : ""}` })
    } catch (error) {
      trace.push({ tool: "paypal.verify_payment", input: r.inv.id, output: error instanceof HttpError ? error.message : "failed" })
    }
  }
  if (capabilities.reloadState) current = await capabilities.reloadState()
  for (const r of receivables(current, today).overdue) {
    if (!capabilities.proposeApproval) break
    try {
      const proposal = await capabilities.proposeApproval("send_reminder", r.inv.id)
      proposals.push(proposal)
      trace.push({ tool: "approvals.propose_reminder", input: r.inv.id, output: `${proposal.id} · ${proposal.status}` })
    } catch (error) {
      notes.push(`${r.inv.id}: ${error instanceof HttpError ? error.message : "could not prepare a reminder"}`)
    }
  }
  const rec = receivables(current, today)
  const answer: CopilotAnswer = {
    intent: "agent-actions",
    headline: proposals.length
      ? `Daily check: ${proposals.length} reminder${proposals.length > 1 ? "s" : ""} prepared for approval, ${money(rec.overdueTotal)} overdue.`
      : `Daily check: no new reminders needed, ${money(rec.overdueTotal)} overdue.`,
    paragraphs: [
      ...notes,
      "Nothing was sent. Each prepared reminder waits in Approvals for an authorised person.",
    ],
    figures: [{ label: "Overdue", value: money(rec.overdueTotal), tone: rec.overdueTotal ? "amber" : "green" }, { label: "Due within 7 days", value: money(rec.dueSoonTotal) }],
    table: { columns: ["Invoice", "Client", "Amount", "Status"], rows: [...rec.overdue, ...rec.dueSoon].map((r) => [r.inv.id, r.client.name, money(invoiceTotal(r.inv), r.inv.currency), r.state]) },
    records: proposals.map((p) => `${p.id} · ${p.title} · ${p.status}`),
    assumptions: ["Template reminder text (no LLM configured)"],
    missing: [],
    trace,
    actions: proposals.length ? [{ label: `Review ${proposals.length} prepared approval${proposals.length > 1 ? "s" : ""}`, kind: "navigate", to: "approvals" }] : [{ label: "Open invoices", kind: "navigate", to: "invoices" }],
    engine: "rules",
  }
  return { answer, engine: "rules", toolsUsed: trace.map((t) => t.tool), proposals }
}

export async function runDailyCheck(ctx: RequestContext, log: FastifyBaseLogger): Promise<CopilotRun> {
  // Preparing approvals needs Owner or Finance Manager; Viewers can still ask questions.
  requirePrepare(ctx.role)
  const state = await readComputedState(ctx)
  const today = await currentDate(ctx)
  const capabilities = capabilitiesFor(ctx, log)
  const run = await runAgent(ctx, state, today, DAILY_CHECK_PROMPT, [], log, () => rulesDailyCheck(ctx, state, today, capabilities))
  await auditRun(ctx, "Agent daily check", run, "daily check")
  return run
}
