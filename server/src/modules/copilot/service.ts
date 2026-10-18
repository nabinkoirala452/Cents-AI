import Anthropic from "@anthropic-ai/sdk"
import type { FastifyBaseLogger } from "fastify"
import { config } from "../../config"
import type { RequestContext } from "../../plugins/auth"
import { audit } from "../audit/service"
import { currentDate, readComputedState } from "../records/service"
import { anthropicModel, rulesRun, runClaudeCopilot, type ChatTurn, type CopilotModel, type CopilotRun } from "./agent"

let overrideModel: CopilotModel | null | undefined

/** Tests inject a fake; `null` forces the rule-based router; `undefined` restores config. */
export function setCopilotModel(model: CopilotModel | null | undefined) {
  overrideModel = model
}

function configuredModel(): CopilotModel | null {
  if (overrideModel !== undefined) return overrideModel
  return config.copilotEngine === "claude" && config.anthropicApiKey ? anthropicModel(config.anthropicApiKey) : null
}

const reasonFor = (error: unknown) =>
  error instanceof Anthropic.RateLimitError ? "Claude is rate limited"
    : error instanceof Anthropic.AuthenticationError ? "Claude API key was rejected"
    : error instanceof Anthropic.APIConnectionError ? "Claude could not be reached"
    : error instanceof Anthropic.APIError ? `Claude API error ${error.status ?? ""}`.trim()
    : "Claude answer failed"

export async function askCopilot(
  ctx: RequestContext,
  body: { question: string; history: ChatTurn[] },
  log: FastifyBaseLogger,
): Promise<CopilotRun> {
  const state = await readComputedState(ctx)
  const today = await currentDate(ctx)
  const model = configuredModel()

  let run: CopilotRun
  if (!model) {
    run = rulesRun(state, today, body.question)
  } else {
    try {
      run = await runClaudeCopilot({
        state, today, question: body.question, turns: body.history, model,
        modelId: config.anthropicModel, effort: config.copilotEffort,
      })
    } catch (error) {
      // The deterministic router still answers, and says so, if the LLM is unavailable.
      log.warn({ err: error }, "Copilot LLM call failed; answering with the rule-based router")
      run = { ...rulesRun(state, today, body.question), fallbackReason: reasonFor(error) }
    }
  }
  if (run.fallbackReason) run.answer.missing.push(`${run.fallbackReason}; this answer used the rule-based router instead.`)

  const unverified = run.answer.grounding?.unverified ?? []
  await audit(ctx, {
    action: "Copilot answered",
    detail: [
      run.engine === "claude" ? `Claude (${config.anthropicModel})` : "Rule-based router",
      `tools: ${run.toolsUsed.join(", ") || "none"}`,
      run.usage ? `${run.usage.inputTokens} in / ${run.usage.outputTokens} out tokens` : "",
      unverified.length ? `unverified figures: ${unverified.join(", ")}` : "",
      run.fallbackReason ?? "",
      `question: "${body.question.slice(0, 160)}"`,
    ].filter(Boolean).join(" · "),
    outcome: unverified.length || run.fallbackReason ? "warning" : "info",
  })
  return run
}
