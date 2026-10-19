import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, ArrowRight, Bot, Check, ChevronDown, Database, Eraser, Send, ShieldCheck, Sparkles, Wrench } from "lucide-react"
import { ApprovalGroup } from "../components/approval-card"
import { Badge, Button, Card, CardHeader, Input, Title, useAction } from "../components/ui"
import { api, hostedMode } from "../lib/api"
import { answerQuestion, SUGGESTED_QUESTIONS, type CopilotAction, type CopilotAnswer } from "../lib/copilot"
import { buildEvents, cashBalance, receivables } from "../lib/finance"
import { money } from "../lib/format"
import { go, routeParams } from "../lib/router"
import { ROLE_TIERS, useStore } from "../lib/store"
import type { ChatMessage } from "../lib/types"

export default function CopilotPage() {
  const { state, today, update, prepareReminder, toast, can, copilotEngine, refresh } = useStore()
  const [message, setMessage] = useState("")
  const [thinking, setThinking] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [workingBubble, setWorkingBubble] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const asked = useRef(false)

  const stateRef = useRef(state)
  stateRef.current = state

  const isBusy = Boolean(thinking || busyAction || workingBubble)

  const ask = (question: string) => {
    const q = question.trim()
    if (!q || isBusy) return
    const userMsg: ChatMessage = { id: `m-${Date.now()}`, role: "user", text: q }
    update((d) => {
      d.chat.push(userMsg)
    })
    setMessage("")
    setThinking(q)
    if (hostedMode) {
      // Server-side: the LLM agent picks the tools; numbers come from the engine.
      const history = stateRef.current.chat.slice(-8).map((m) => ({
        role: m.role,
        text: m.role === "assistant" && m.answer ? [m.answer.headline, ...m.answer.paragraphs].join("\n") : m.text,
      }))
      api.askCopilot(q, history)
        .then(async ({ answer, proposals }) => {
          const approvalIds = proposals?.map((p) => p.id) ?? []
          await update((d) => {
            d.chat.push({
              id: `m-${Date.now()}-a`,
              role: "assistant",
              text: answer.headline,
              answer: { ...answer, approvalIds },
              approvalIds,
            })
          })
          // The agent may have prepared approvals or recorded a verified PayPal payment.
          if (proposals.length || answer.trace.some((t) => t.tool === "paypal.verify_payment")) await refresh().catch(() => undefined)
        })
        .catch((cause: unknown) =>
          update((d) => {
            d.chat.push({ id: `m-${Date.now()}-e`, role: "assistant", text: `I couldn't answer that: ${cause instanceof Error ? cause.message : "the server did not respond"}.` })
          }))
        .finally(() => setThinking(null))
      return
    }
    window.setTimeout(() => {
      const answer = answerQuestion(stateRef.current, today, q)
      update((d) => {
        d.chat.push({ id: `m-${Date.now()}-a`, role: "assistant", text: answer.headline, answer })
      })
      setThinking(null)
    }, 900)
  }

  const dailyCheckAction = useAction(async () => {
    if (isBusy) return
    setWorkingBubble("Running daily finance check across accounts…")
    await update((d) => {
      d.chat.push({ id: `m-${Date.now()}`, role: "user", text: "Run today's finance check" })
    })
    try {
      const { answer, proposals } = await api.copilotDailyCheck()
      const approvalIds = proposals?.map((p) => p.id) ?? []
      await update((d) => {
        d.chat.push({
          id: `m-${Date.now()}-a`,
          role: "assistant",
          text: answer.headline,
          answer: { ...answer, approvalIds },
          approvalIds,
        })
      })
      await refresh().catch(() => undefined)
    } catch (cause) {
      await update((d) => {
        d.chat.push({
          id: `m-${Date.now()}-e`,
          role: "assistant",
          text: `The daily check failed: ${cause instanceof Error ? cause.message : "the server did not respond"}.`,
        })
      })
    } finally {
      setWorkingBubble(null)
    }
  })

  useEffect(() => {
    const q = routeParams().get("q")
    if (q && !asked.current) {
      asked.current = true
      ask(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [state.chat.length, thinking, workingBubble])

  const runAction = async (action: CopilotAction) => {
    if (action.kind === "navigate") return go(action.to)
    if (isBusy) return
    if (!can.prepare) return toast("Your role can view answers but not prepare actions.")
    const overdue = state.invoices.filter((i) => i.status === "Sent" && i.dueDate < today)
    if (overdue.length === 0) {
      await update((d) => {
        d.chat.push({
          id: `m-${Date.now()}-x`,
          role: "assistant",
          text: "No overdue invoices need a reminder right now.",
        })
      })
      return
    }
    const count = overdue.length
    setBusyAction(action.label)
    setWorkingBubble(`Drafting reminders for ${count} overdue invoice${count === 1 ? "" : "s"}…`)
    try {
      const results = await Promise.all(
        overdue.map(async (i) => {
          const res = await prepareReminder(i.id, { preparedBy: "CentsAI agent" })
          const existing = stateRef.current.approvals.find(
            (a) => a.kind === "send_reminder" && a.refId === i.id && (a.status === "Pending" || a.status === "Submitted"),
          )
          const approvalId = res.id ?? existing?.id
          return { ...res, invoiceId: i.id, approvalId }
        }),
      )
      const ok = results.filter((r) => r.ok)
      const approvalIds = results.map((r) => r.approvalId).filter((id): id is string => Boolean(id))
      await update((d) => {
        d.chat.push({
          id: `m-${Date.now()}-x`,
          role: "assistant",
          text: ok.length ? `I prepared ${ok.length} reminder draft${ok.length > 1 ? "s" : ""} for approval.` : "No new reminders were needed.",
          approvalIds,
          answer: {
            intent: "action",
            headline: ok.length ? `I prepared ${ok.length} reminder draft${ok.length > 1 ? "s" : ""} — nothing has been sent.` : "No new reminders were prepared.",
            paragraphs: [
              ...results.map((r) => `${r.invoiceId}: ${r.message}`),
              "An authorised person can review and approve each one below before PayPal or email delivery.",
            ],
            figures: [],
            records: results.map((r) => r.invoiceId),
            assumptions: [],
            missing: [],
            trace: results.map((r) => ({ tool: "approvals.request", input: `kind=send_reminder ref=${r.invoiceId}`, output: r.ok ? "queued" : "blocked" })),
            actions: approvalIds.length === 0 ? [{ label: "Review in Approvals", kind: "navigate", to: "approvals" }] : [],
            approvalIds,
          },
        })
      })
      if (hostedMode) {
        await refresh().catch(() => undefined)
      }
    } catch (cause) {
      await update((d) => {
        d.chat.push({
          id: `m-${Date.now()}-e`,
          role: "assistant",
          text: `Failed to prepare reminders: ${cause instanceof Error ? cause.message : "an error occurred"}.`,
        })
      })
    } finally {
      setBusyAction(null)
      setWorkingBubble(null)
    }
  }

  const context = useMemo(() => {
    const rec = receivables(state, today)
    const owed = buildEvents(state, today, 30, "expected").filter((e) => e.amount < 0).reduce((s, e) => s - e.amount, 0)
    return { cash: cashBalance(state, today), owed, overdue: rec.overdueTotal }
  }, [state, today])

  const tier = ROLE_TIERS.find((t) => t.role === state.settings.role)!

  return (
    <div className="page copilot-page">
      <div className="page-intro">
        <div>
          <Title>Your agency finance copilot</Title>
          <p>Ask in plain language. Every answer shows the records, tools and assumptions behind it.</p>
        </div>
        <div className="intro-actions">
          <Badge tone="green">
            <ShieldCheck size={12} /> Grounded in workspace records
          </Badge>
          {hostedMode && copilotEngine === "llm" && (
            <Badge tone="blue">
              <Sparkles size={12} /> AI agent · Groq
            </Badge>
          )}
          {hostedMode && can.prepare && (
            <Button
              variant="secondary"
              icon={Bot}
              onClick={() => void dailyCheckAction.run()}
              disabled={isBusy}
              loading={dailyCheckAction.busy}
            >
              {dailyCheckAction.busy ? "Running daily check…" : "Run daily check"}
            </Button>
          )}
          {state.chat.length > 0 && (
            <Button variant="ghost" icon={Eraser} disabled={isBusy} onClick={() => update((d) => { d.chat = [] })}>
              Clear
            </Button>
          )}
        </div>
      </div>
      <div className="copilot-layout">
        <Card className="conversation">
          <div className={`suggestions ${state.chat.length ? "suggestions-compact" : ""}`}>
            {SUGGESTED_QUESTIONS.map((q) => (
              <Button key={q} onClick={() => ask(q)} disabled={isBusy}>
                {q}
              </Button>
            ))}
          </div>
          <div className="messages" aria-live="polite">
            <div className="assistant-message">
              <div className="bot-avatar">
                <Sparkles size={16} />
              </div>
              <div>
                <strong>CentsAI</strong>
                <p>I analyse cash flow, invoices, obligations, project margins, subscriptions and loans using the records in this workspace. I’ll show my working, say when data is missing, and prepare — never execute — actions that move money.</p>
              </div>
            </div>
            {state.chat.map((m) =>
              m.role === "user" ? (
                <div className="user-message" key={m.id}>
                  <p>{m.text}</p>
                </div>
              ) : (
                <AssistantMessage
                  key={m.id}
                  message={m}
                  answer={m.answer}
                  text={m.text}
                  onAction={runAction}
                  busyAction={busyAction}
                  isBusy={isBusy}
                />
              ),
            )}
            {workingBubble && (
              <div className="assistant-message">
                <div className="bot-avatar thinking">
                  <Sparkles size={16} />
                </div>
                <div className="thinking-steps">
                  <p>
                    <span className="dot-pulse" /> {workingBubble}
                  </p>
                </div>
              </div>
            )}
            {thinking && <Thinking />}
            <div ref={endRef} />
          </div>
          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault()
              ask(message)
            }}
          >
            <Input
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Ask about your agency’s finances…"
              aria-label="Message"
              disabled={isBusy}
            />
            <Button variant="primary" type="submit" icon={Send} aria-label="Send message" disabled={!message.trim() || isBusy} />
          </form>
          <small className="composer-note">Answers are calculated from displayed records and stated assumptions. Review before acting.</small>
        </Card>
        <div className="context-column">
          <Card>
            <CardHeader title="Live context" action={<Badge tone="blue">Recalculated</Badge>} />
            <div className="context-list">
              <div>
                <span>Recorded cash</span>
                <strong>{money(context.cash)}</strong>
              </div>
              <div>
                <span>30-day obligations</span>
                <strong>{money(context.owed)}</strong>
              </div>
              <div>
                <span>Overdue invoices</span>
                <strong className="amber-text">{money(context.overdue)}</strong>
              </div>
              <div>
                <span>Safety threshold</span>
                <strong>{money(state.settings.safetyThreshold)}</strong>
              </div>
            </div>
          </Card>
          <Card>
            <CardHeader title="What the agent may do" />
            <div className="tier-list">
              <p className="tier-on">
                <Check size={13} /> Read records & run calculations
              </p>
              <p className={can.prepare ? "tier-on" : "tier-off"}>
                {can.prepare ? <Check size={13} /> : <AlertTriangle size={13} />} Prepare drafts & approval requests
              </p>
              <p className="tier-off">
                <ShieldCheck size={13} /> Execute payments — never; a human approves
              </p>
            </div>
            <small className="section-note">
              Signed in as {state.settings.role} · {tier.tier}
            </small>
          </Card>
          <div className="privacy-note">
            <ShieldCheck size={15} />
            <span>
              {!hostedMode
                ? "Demo mode: questions are routed to deterministic finance tools by keyword rules in your browser. In hosted mode an LLM agent (Groq) chooses the same tools on the server, reads live PayPal data and prepares approvals."
                : copilotEngine === "llm"
                  ? "An LLM agent (Groq) runs on the server. It calls the finance engine, PayPal Agent Toolkit read tools and PayPal payment verification, and can prepare reminders or PayPal sends as Pending approvals. It cannot approve, send or pay: an authorised person approves every action. Amounts in its wording are checked against tool output."
                  : "The server has no LLM configured, so questions are routed to the finance tools by keyword rules. Numbers come from the same engine either way."}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Thinking() {
  const steps = ["Planning which records to read", "Running finance tools", "Checking assumptions"]
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setN((x) => Math.min(x + 1, steps.length - 1)), 300)
    return () => window.clearInterval(t)
  }, [steps.length])
  return (
    <div className="assistant-message">
      <div className="bot-avatar thinking">
        <Sparkles size={16} />
      </div>
      <div className="thinking-steps">
        {steps.slice(0, n + 1).map((s, i) => (
          <p key={s}>
            {i < n ? <Check size={12} /> : <span className="dot-pulse" />} {s}
          </p>
        ))}
      </div>
    </div>
  )
}

function AssistantMessage({
  message,
  answer,
  text,
  onAction,
  busyAction,
  isBusy,
}: {
  message?: ChatMessage
  answer?: CopilotAnswer
  text: string
  onAction: (a: CopilotAction) => void
  busyAction?: string | null
  isBusy?: boolean
}) {
  const [showTrace, setShowTrace] = useState(false)
  const approvalIds = message?.approvalIds ?? answer?.approvalIds ?? []

  if (!answer) {
    return (
      <div className="assistant-message">
        <div className="bot-avatar">
          <Sparkles size={16} />
        </div>
        <div>
          <strong>CentsAI</strong>
          <p>{text}</p>
          {approvalIds.length > 0 && <ApprovalGroup approvalIds={approvalIds} disabled={isBusy} />}
        </div>
      </div>
    )
  }
  return (
    <div className="assistant-message">
      <div className="bot-avatar">
        <Sparkles size={16} />
      </div>
      <div className="answer">
        <strong>CentsAI</strong>
        <p className="answer-headline">{answer.headline}</p>
        {answer.paragraphs.map((p, i) => (
          <p key={i}>{p}</p>
        ))}
        {answer.figures.length > 0 && (
          <div className="answer-figures">
            {answer.figures.map((f) => (
              <div key={f.label}>
                <span>{f.label}</span>
                <strong className={f.tone ? `${f.tone}-text` : ""}>{f.value}</strong>
              </div>
            ))}
          </div>
        )}
        {answer.table && (
          <div className="answer-table">
            <table>
              <thead>
                <tr>
                  {answer.table.columns.map((c) => (
                    <th key={c}>{c}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {answer.table.rows.map((r, i) => (
                  <tr key={i}>
                    {r.map((c, j) => (
                      <td key={j}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {answer.missing.length > 0 && (
          <div className="answer-missing">
            <AlertTriangle size={13} />
            <span>
              <b>Missing data:</b> {answer.missing.join(" · ")}
            </span>
          </div>
        )}
        {approvalIds.length > 0 && (
          <ApprovalGroup approvalIds={approvalIds} disabled={isBusy} />
        )}
        {answer.engine && (
          <small className="section-note">
            {answer.engine === "llm" ? `Written by ${answer.model ?? "the LLM agent"} from tool results` : "Rule-based answer"}
            {answer.grounding?.checked && (answer.grounding.unverified.length ? " · some figures not found in tool output" : " · every amount matches tool output")}
          </small>
        )}
        <button className="explain-toggle" onClick={() => setShowTrace(!showTrace)} aria-expanded={showTrace}>
          How I got this · {answer.trace.length} tool call{answer.trace.length === 1 ? "" : "s"} <ChevronDown size={13} />
        </button>
        {showTrace && (
          <div className="agent-trace">
            {answer.trace.map((t, i) => (
              <div key={i}>
                <Wrench size={12} />
                <code>{t.tool}</code>
                <span>{t.input}</span>
                <b>{t.output}</b>
              </div>
            ))}
            {answer.records.length > 0 && (
              <p>
                <Database size={12} /> Records used: {answer.records.join(" · ")}
              </p>
            )}
            {answer.assumptions.length > 0 && (
              <ul>
                {answer.assumptions.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {answer.actions.length > 0 && (
          <div className="message-actions">
            {answer.actions.map((a, i) => {
              const isThisBusy = busyAction === a.label
              const label = isThisBusy
                ? a.kind === "draft-reminders"
                  ? "Preparing reminders…"
                  : `${a.label}…`
                : a.label
              return (
                <Button
                  key={a.label}
                  variant={i === 0 ? "primary" : "secondary"}
                  onClick={() => onAction(a)}
                  disabled={isBusy}
                  loading={isThisBusy}
                >
                  {label} {a.kind === "navigate" && <ArrowRight size={13} />}
                </Button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
