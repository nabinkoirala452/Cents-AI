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
import { copilotTool, invoiceTotal, money, receivables, type CopilotAnswer, type State } from "../../core"
import { COMPOSE_TOOL as COMPOSE_ANSWER, PROPOSE_REMINDER, rulesRun, runLlmCopilot, type AgentCapabilities, type ChatTurn, type CopilotModel, type CopilotRun, type ProposedApproval } from "./agent"

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
  const client = new OpenAI({ apiKey: config.llmApiKey, baseURL: config.llmBaseUrl, timeout: 90_000, maxRetries: 3 })
  return { create: (params) => client.chat.completions.create(params) }
}

/** Only read actions of the PayPal Agent Toolkit; its write tools would bypass the approval workflow. */
const PAYPAL_READ_ACTIONS = {
  invoices: { list: true, get: true },
  transactions: { list: true },
  insights: { get: true },
}
// search_invoicing (~3k tokens of schema) and disputes are left out to fit Groq's free-tier 8K tokens/minute.
const PAYPAL_READ_TOOLS = new Set(["list_invoices", "get_invoice", "list_transactions", "get_merchant_insights"])
const MAX_TOOL_DESCRIPTION = 300
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
    tools: kit.getTools()
      .filter((t) => PAYPAL_READ_TOOLS.has(t.function.name))
      .map((t) => ({ ...t, function: { ...t.function, description: (t.function.description ?? "").replace(/\s+/g, " ").slice(0, MAX_TOOL_DESCRIPTION) } })),
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

type AgentOptions = Pick<Parameters<typeof runLlmCopilot>[0], "onlyTools" | "brief" | "prefetched" | "capabilities">

async function runAgent(ctx: RequestContext, state: State, today: string, question: string, turns: ChatTurn[], log: FastifyBaseLogger, fallback: () => Promise<CopilotRun>, options: AgentOptions = {}) {
  const model = configuredModel()
  if (!model) return fallback()
  try {
    return await runLlmCopilot({
      state, today, question, turns, model, modelId: config.llmModel, fallback,
      capabilities: options.capabilities ?? capabilitiesFor(ctx, log),
      reasoningEffort: config.llmReasoningEffort,
      ...(options.onlyTools ? { onlyTools: options.onlyTools } : {}),
      ...(options.brief ? { brief: options.brief } : {}),
      ...(options.prefetched ? { prefetched: options.prefetched } : {}),
    })
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

export const DAILY_CHECK_PROMPT = `Run today's finance check. The facts below were gathered for you, including PayPal payment checks.
For each invoice listed under "Needs a reminder", decide whether a reminder is warranted and, if so, call ${PROPOSE_REMINDER} once for it with a short, polite, personalised message (mention the invoice id, amount and due date). Do not propose anything for other invoices.
Then call ${COMPOSE_ANSWER}: the headline says what you prepared and the overall cash position; the paragraphs cover the cash outlook, what PayPal confirmed, and the single most important next step.`

type DailyFacts = {
  state: State
  paymentChecks: CopilotAnswer["trace"]
  candidates: ReturnType<typeof receivables>["overdue"]
  alreadyOpen: string[]
}

/** Code does the fact-finding and PayPal checks; the model only decides on reminders and writes them. */
async function gatherDailyFacts(ctx: RequestContext, state: State, today: string, capabilities: AgentCapabilities): Promise<DailyFacts> {
  const paymentChecks: CopilotAnswer["trace"] = []
  let recorded = false
  const rec = receivables(state, today)
  for (const r of [...rec.overdue, ...rec.dueSoon]) {
    if (r.inv.channel !== "PayPal" || !r.inv.paypal || !capabilities.checkPaymentStatus) continue
    try {
      const result = await capabilities.checkPaymentStatus(r.inv.id)
      recorded ||= (result.insertedPayments ?? 0) > 0
      paymentChecks.push({ tool: "paypal.verify_payment", input: r.inv.id, output: `PayPal ${result.status ?? "unknown"}${result.paid ? " · paid and recorded" : ""}` })
    } catch (error) {
      paymentChecks.push({ tool: "paypal.verify_payment", input: r.inv.id, output: error instanceof HttpError ? error.message : "PayPal check failed" })
    }
  }
  const current = recorded && capabilities.reloadState ? await capabilities.reloadState() : state
  const open = new Set(current.approvals.filter((a) => a.kind === "send_reminder" && (a.status === "Pending" || a.status === "Submitted")).map((a) => a.refId))
  const overdue = receivables(current, today).overdue
  return { state: current, paymentChecks, candidates: overdue.filter((r) => !open.has(r.inv.id)), alreadyOpen: overdue.filter((r) => open.has(r.inv.id)).map((r) => r.inv.id) }
}

const briefFor = (facts: DailyFacts, prefetched: { answer: CopilotAnswer }[]) => [
  ...prefetched.map(({ answer }) => `- ${answer.headline} ${answer.figures.map((f) => `${f.label}: ${f.value}`).join("; ")}`),
  `- PayPal checks: ${facts.paymentChecks.map((c) => `${c.input} → ${c.output}`).join("; ") || "no PayPal invoices to check"}`,
  `- Needs a reminder: ${facts.candidates.map((r) => `${r.inv.id} (${r.client.name}, ${money(invoiceTotal(r.inv), r.inv.currency)}, due ${r.inv.dueDate}, ${r.reason}, ${r.inv.paypal ? "PayPal" : "bank transfer"}${r.inv.reminders.length ? `, last reminder ${r.inv.reminders.at(-1)!.date}` : ""})`).join("; ") || "none"}`,
  `- Already waiting for approval: ${facts.alreadyOpen.join(", ") || "none"}`,
].join("\n")

/** Deterministic daily check used when no LLM is configured (or it fails): template reminder text. */
async function rulesDailyCheck(today: string, facts: DailyFacts, capabilities: AgentCapabilities): Promise<CopilotRun> {
  const proposals: ProposedApproval[] = []
  const trace: CopilotAnswer["trace"] = [...facts.paymentChecks]
  const notes: string[] = facts.alreadyOpen.length ? [`Already waiting for approval: ${facts.alreadyOpen.join(", ")}.`] : []
  for (const r of facts.candidates) {
    if (!capabilities.proposeApproval) break
    try {
      const proposal = await capabilities.proposeApproval("send_reminder", r.inv.id)
      proposals.push(proposal)
      trace.push({ tool: "approvals.propose_reminder", input: r.inv.id, output: `${proposal.id} · ${proposal.status}` })
    } catch (error) {
      notes.push(`${r.inv.id}: ${error instanceof HttpError ? error.message : "could not prepare a reminder"}`)
    }
  }
  const rec = receivables(facts.state, today)
  const answer: CopilotAnswer = {
    intent: "agent-actions",
    headline: proposals.length
      ? `Daily check: ${proposals.length} reminder${proposals.length > 1 ? "s" : ""} prepared for approval, ${money(rec.overdueTotal)} overdue.`
      : `Daily check: no new reminders needed, ${money(rec.overdueTotal)} overdue.`,
    paragraphs: [...notes, "Nothing was sent. Each prepared reminder waits in Approvals for an authorised person."],
    figures: [{ label: "Overdue", value: money(rec.overdueTotal), tone: rec.overdueTotal ? "amber" : "green" }, { label: "Due within 7 days", value: money(rec.dueSoonTotal) }],
    table: { columns: ["Invoice", "Client", "Amount", "Status"], rows: [...rec.overdue, ...rec.dueSoon].map((r) => [r.inv.id, r.client.name, money(invoiceTotal(r.inv), r.inv.currency), r.state]) },
    records: proposals.map((p) => `${p.id} · ${p.title} · ${p.status}`),
    assumptions: ["Template reminder text"],
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
  const today = await currentDate(ctx)
  const capabilities = capabilitiesFor(ctx, log)
  const facts = await gatherDailyFacts(ctx, await readComputedState(ctx), today, capabilities)
  const prefetched = [
    { name: "cash_outlook", input: { horizon_days: 30 } },
    { name: "receivables", input: { reminders: true } },
    { name: "upcoming_obligations", input: { days: 14 } },
  ].map((call) => ({ ...call, answer: copilotTool(call.name)!.run(facts.state, today, call.input as never) }))
  // Only the reminder tool is offered: one small request per reminder fits the free tier's tokens/minute.
  const run = await runAgent(ctx, facts.state, today, DAILY_CHECK_PROMPT, [], log, () => rulesDailyCheck(today, facts, capabilities), {
    capabilities: { ...(capabilities.proposeApproval ? { proposeApproval: capabilities.proposeApproval } : {}) },
    onlyTools: [PROPOSE_REMINDER],
    brief: briefFor(facts, prefetched),
    prefetched,
  })
  if (run.engine === "llm") run.answer.trace.unshift(...facts.paymentChecks)
  // The daily check already prepared every reminder it should; don't offer to draft them again.
  run.answer.actions = run.answer.actions.filter((a) => a.kind !== "draft-reminders")
  if (facts.alreadyOpen.length && !run.answer.actions.some((a) => a.kind === "navigate" && a.to === "approvals")) run.answer.actions.unshift({ label: "Review approvals", kind: "navigate", to: "approvals" })
  await auditRun(ctx, "Agent daily check", run, "daily check")
  return run
}
