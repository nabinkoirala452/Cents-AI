# CentsAI — Technical Documentation

FinTechathon 2026 · Topic E: SME Finance Copilot

This document covers the system architecture, the core algorithms and the security design. Setup steps are in the [README](../README.md); the full API reference is in [`server/README.md`](../server/README.md).

---

## 1. Problem and design principle

Service agencies with 2–20 people have lumpy revenue (a large milestone invoice may be paid weeks late) but fixed obligations: payroll, contractors, subscriptions, rent and loan instalments. Bookkeeping tools report the past. An owner needs to know whether cash will cover payroll next month and what to do about it.

CentsAI is built on one rule:

> **The AI explains and prepares. Deterministic code calculates. A person approves. PayPal confirms. Every step is audited.**

That split decides where each piece lives:

| Responsibility | Owner | Why |
|---|---|---|
| Every number (cash, forecast, margins, EMIs, affordability) | Deterministic TypeScript engine | Reproducible, testable, explainable |
| Choosing which calculation answers a question; wording the answer; drafting reminder text | LLM agent | Language and judgement, not arithmetic |
| Whether an action happens | A human with the right role and limit | Accountability; no autonomous money movement |
| Whether a payment happened | PayPal, verified by the server | The ledger never trusts the client, the UI or the model |

---

## 2. System architecture

```
┌──────────────────────────── Browser ────────────────────────────┐
│ React 19 + Vite + Tailwind v4  (src/)                           │
│  pages/ ── components/ ── lib/store.tsx (state, approvals UI)   │
│                    │                                            │
│     lib/finance.ts (engine)  lib/copilot.ts (tool registry)     │◄── same modules,
└────────────────────┼────────────────────────────────────────────┘    imported by the server
                     │ HTTPS · Bearer JWT · X-Workspace-Id
┌────────────────────▼──────────── Fastify API (server/) ─────────┐
│ plugins: helmet · CORS allowlist · rate limit · auth · idempotency│
│ modules: auth · workspace · records · approvals · payments ·    │
│          webhooks · audit · copilot                             │
│                                                                 │
│  Prisma ──► PostgreSQL (Supabase, RLS on, no public grants)     │
│  PayPal gateway ──► PayPal Sandbox: OAuth2 + Invoicing v2       │
│  Copilot agent ──► Groq (OpenAI-compatible) + PayPal Agent      │
│                    Toolkit (read-only allowlist)                │
└─────────────────────────────────────────────────────────────────┘
          ▲
          └── PayPal webhooks (INVOICING.INVOICE.PAID, …) ──► /api/v1/webhooks/paypal
```

### 2.1 Components

| Layer | Technology | Location |
|---|---|---|
| UI | React 19, Vite 8, Tailwind CSS v4, Recharts | `src/pages`, `src/components` |
| Finance engine | Pure TypeScript functions over a `State` snapshot | `src/lib/finance.ts` |
| Copilot tools | 10 read-only tools, each with a JSON schema, an input validator and `run()` | `src/lib/copilot.ts` |
| API | Fastify 5, Zod validation, problem+json errors | `server/src/app.ts`, `server/src/modules/*` |
| Persistence | Prisma 6 on PostgreSQL 14+ (Supabase) | `server/prisma/schema.prisma` |
| Payments | PayPal REST: OAuth2 client credentials, Invoicing v2, webhooks | `server/src/integrations/paypal` |
| AI | `openai` SDK against Groq `openai/gpt-oss-120b`; `@paypal/agent-toolkit` | `server/src/modules/copilot` |

### 2.2 One engine, two runtimes

`finance.ts` and `copilot.ts` are imported by both the browser and the server (`server/src/core.ts` re-exports them). The server loads a workspace from PostgreSQL into the same `State` shape (`server/src/lib/state.ts`) and runs the same functions. The forecast the user sees and the figures the agent reasons over are the same calculation, not two implementations that can drift.

### 2.3 Runtime modes

| Mode | Trigger | Data | PayPal | Copilot |
|---|---|---|---|---|
| Demo | no `VITE_API_URL` | Browser `localStorage`, seeded relative to today | Simulated adapter (`src/lib/paypal.ts`) | Rule-based router over the same tools |
| Hosted | `VITE_API_URL` set | PostgreSQL via the API | Real PayPal Sandbox (`PAYPAL_MODE=sandbox`) or in-memory fake for tests | LLM agent; rule-based fallback |

### 2.4 Data model

Every business table is keyed by `(workspaceId, id)`, so every query is scoped to the caller's workspace.

- **Identity:** `User`, `Workspace`, `Membership` (role: `Owner` | `FinanceManager` | `Viewer`), `WorkspaceSettings` (currency, opening balance, safety threshold, manager approval limit, horizon)
- **Business records:** `Client`, `Project` (time entries, planned billings, retainer), `Invoice` (line items, PayPal id, number, status, payer URL), `Transaction`, `Employee`, `ContractorBill`, `RecurringCost`, `Loan`, `LoanOffer`, `SavedScenario`, `ImportJob`
- **Money evidence:** `PaymentEvent` (one row per verified PayPal or bank payment, unique external id, raw payload kept)
- **Control:** `Approval` (kind, snapshot hash, draft, prepared-by, agent flag, status), `AuditEvent` (append-only), `WebhookEvent` (raw, signature result), `IdempotencyKey`

Each workspace has a single currency (the demo uses USD), so the engine does no FX conversion.

---

## 3. Core algorithms

All functions are pure: `(state, today, …) → result`. `today` is passed in explicitly, so results are deterministic and tests can pin dates.

### 3.1 Cash balance

```
cash(asOf) = openingBalance + Σ income − Σ expense   over transactions with openingDate ≤ date ≤ asOf
```

Sent invoices are **not** cash. They enter the forecast as future receipts.

### 3.2 Invoice state and receivables priority

The state is derived from the status and due date: `Draft`, `Paid`, `Cancelled`, else `Overdue` (past due), `Due soon` (≤ 7 days) or `Open`.

Open invoices are ranked for collection with a priority score:

```
priority = (amount / 1000) × (1 + daysOverdue / 7) × slowPayer × stage
  slowPayer = 1.3 if the client's average delay ≥ 10 days, else 1
  stage     = 1 (overdue) · 0.6 (due soon) · 0.3 (open)
```

Bigger, older invoices from habitually late clients come first. This order drives the Briefing, the receivables tool and the agent's daily check.

### 3.3 Three-scenario cash forecast

`buildEvents()` turns every record into dated cash events within the horizon (default 90 days). Each event has a certainty: `Confirmed` (obligations), `Expected` (receipts not yet due) or `Uncertain` (receipts already overdue).

| Source | Expected | Optimistic | Conservative |
|---|---|---|---|
| Sent invoice | due + client's average delay (or a per-invoice override) | due date; overdue → today + 3 | due + delay + **30 days** if overdue or a slow payer, otherwise + 7 |
| Draft invoice / planned milestone | due (+15 days for milestones) + delay | due | + 15 days extra |
| Retainer not yet invoiced | billing day + delay | same | + 10 days |
| Payroll | each employee's pay day, grouped per date (`Confirmed`) | same | same |
| Contractor bills, subscriptions, annual costs | due / next date, repeated by cycle | same | same |
| Loan EMIs | remaining rows of the amortisation schedule | same | same |

`forecast()` then rolls the balance forward day by day:

```
balance[0] = cash(today)
balance[d] = balance[d−1] + Σ events on day d
lowest, lowestDate = min over the series
breachDays         = count of days with balance < safetyThreshold
firstBreach        = first such day
```

`lowPointDrivers()` explains a low point with the four largest outflows before it, plus receipts still marked uncertain. Every forecast answer shows its assumptions and drivers, not just a number.

### 3.4 What-if simulations

All simulations work the same way: run the forecast with **modifications** (`extra` events, per-invoice `delays`, `dropRetainers`, `skipInvoices`), then compare before and after against the safety threshold.

| Question | Modification | Verdict rule |
|---|---|---|
| Can we hire at $X/month? | −X on payroll day for the next 3 months, starting on the 1st of next month | Affordable if the conservative low ≥ threshold; "not comfortably" if only the expected scenario passes |
| Can we buy X for $Y? | −Y today | Same rule |
| Can we cover payroll if Client pays N days late? | +N days on each of that client's open invoices | Covered if the balance after the next payroll is ≥ 0. Also reports whether it falls below the threshold and the 60-day low |

The Scenario Simulator page exposes the same modifications interactively.

### 3.5 Project margins

```
labour cost  = Σ hours × (monthlySalary / 160)        per time entry
cost         = labour + contractor bills + direct project expenses
billed       = Σ sent/paid invoices + unlinked project income
contribution = billed − cost
margin       = contribution / billed × 100            (before shared overhead)
flags        = margin < 25%, budget used > 100%, unassigned hours
```

### 3.6 Loans

The EMI uses the standard annuity formula, with `r = annualRate / 1200`:

```
EMI = P · r · (1 + r)^n / ((1 + r)^n − 1)        (P / n when r = 0)
```

`amortize()` builds the schedule (interest = balance × r, principal = EMI − interest), with optional one-off and monthly prepayments for the Loans page's prepayment calculator. `loanStatus()` counts the EMIs already due by today to get the outstanding balance, remaining interest and next due date. Financing offers are compared on EMI, total interest and the effect on the forecast.

### 3.7 Expense insights and data hygiene

- **Subscription review:** the monthly-equivalent cost now vs the previous charges; flags increases above **15%** and subscriptions added in the last 31 days.
- **Duplicate detection** (manual entry and CSV import): same amount, dates within **±2 days**, and the same party or description. Duplicates are imported with status `Review` instead of being silently merged.

### 3.8 Daily briefing

`buildBriefing()` combines the above into ranked priorities (high → low): overdue invoices, a projected threshold breach, cash just after the next payroll, rising software costs, projects under 25% margin, and pending approvals. Each priority includes its **evidence** (records), **calculation** (in words) and **what would change it**.

---

## 4. AI copilot agent

### 4.1 Tool loop

`server/src/modules/copilot/agent.ts` runs an OpenAI-compatible tool-calling loop (at most 8 turns). On the last turn the model is offered only `compose_answer`, so a long loop still ends with an answer.

| Tool group | Tools | Effect |
|---|---|---|
| Finance (read-only) | `cash_outlook`, `receivables`, `upcoming_obligations`, `month_to_date`, `project_margins`, `subscription_review`, `loan_status`, `hire_affordability`, `purchase_affordability`, `late_payment_impact`, `lookup_invoice` | Run the engine on the workspace State |
| PayPal Agent Toolkit (read-only allowlist) | `list_invoices`, `get_invoice`, `list_transactions`, `get_merchant_insights` | Live sandbox reads; CentsAI invoice ids are mapped to PayPal ids |
| Verification | `check_paypal_payment` | The same GET + reconcile as the "Verify payment status" button (§5.3) |
| Proposals | `propose_payment_reminder`, `propose_paypal_invoice_send` | Create a **Pending** approval only. Not offered to Viewers |
| Output | `compose_answer` | Headline, paragraphs, missing-data notes |

Tool inputs are validated (type, range, unknown client) before running. Invalid input goes back to the model as an error result and isn't executed.

### 4.2 Answer assembly and grounding check

The model writes only the **headline, paragraphs and notes**. Figures, tables, records, assumptions and actions are copied from tool output by code.

The model's wording is then checked by `checkGrounding()`:

```
known      = every "$…" amount and "…%" in tool outputs, the workspace context and the user's question
             + every numeric "value" field in PayPal JSON
unverified = amounts/percentages in the model's wording that are not in known   (normalised: −, $, commas, trailing zeros)
```

Unverified figures are not hidden. They are listed in `answer.grounding.unverified`, shown in the UI as "verify before relying on it", and the audit event is logged as a warning. In live testing this caught the model rounding 73.2% to 73%.

### 4.3 Daily check

`POST /api/v1/copilot/daily-check` (Owner or Finance Manager):

1. **Code** selects sent PayPal invoices that are overdue or due soon, GETs each from PayPal and reconciles it (payments are recorded if PayPal confirms them), then computes the cash outlook, receivables and 14-day obligations.
2. **The model** gets that brief plus only the reminder tool. It decides which overdue invoices without an open approval need a reminder, writes each message and summarises.
3. The result is Pending approvals marked "CentsAI agent (for &lt;user&gt;)" and an `Agent daily check` audit event.

Doing the fact-gathering in code made the check deterministic, and it fits Groq's free tier (8K tokens/min): about 3.5K tokens and 24 s in live testing, down from more than 180 s for a model-driven loop.

### 4.4 Fallback

With no `LLM_API_KEY`, `COPILOT_MODE=rules`, a rate limit, or a refusal or error from the provider, a deterministic router answers through the same tools and says so in a note. The product keeps working without the LLM.

---

## 5. PayPal integration (Sandbox)

### 5.1 Gateway

`RealPayPalGateway` uses OAuth2 client credentials, with the token cached in memory and never logged. Calls: create draft invoice, send, remind, get, and verify the webhook signature. Every call (method, path, status, PayPal debug id, but never credentials) is written to the audit log. `PAYPAL_ENV` and `PAYPAL_BASE_URL` must agree. In the sandbox, `PAYPAL_SANDBOX_PAYER_EMAIL` replaces the recipient so no real client is ever emailed.

### 5.2 Send-invoice flow (through approval)

1. A Finance Manager or Owner requests `paypal_send_invoice` for a Draft PayPal invoice. The server builds the snapshot (recipient, amount, line items) from the database, never from the request body.
2. A different authorised person approves (§6.2). The snapshot hash is re-checked under row locks; the approval moves to `Submitted` and is committed **before** any external call.
3. The server generates a unique PayPal invoice number (`INV-####-<workspace>-<random>`) and saves it **before** calling PayPal. It then creates the draft, sends it and GETs it back. If a retry finds that number already in PayPal, the existing PayPal invoice is matched and reused instead of creating a duplicate.
4. If PayPal reports SENT, the invoice becomes `Sent` with its PayPal id and payer link, and the approval becomes `Verified`. Otherwise it becomes `Failed` with a sanitised message.

Reminders (`send_reminder`) follow the same path with the drafted message text.

### 5.3 Payment reconciliation (verify before record)

`reconcileInvoice()` runs from the "Verify payment status" button, the agent's `check_paypal_payment`, the daily check, or a verified webhook:

1. GET the invoice from PayPal.
2. In one transaction, under a per-invoice advisory lock (`pg_advisory_xact_lock`):
   - for each settled PayPal payment not already stored (unique external id), check the currency matches, then insert a `PaymentEvent` and a `Verified` income `Transaction`;
   - sum the stored payments. Only when they cover the invoice total is it marked `Paid`, with the paid date taken from the payment;
   - if PayPal says PAID but the payment details can't be verified, the invoice **stays Sent** and a warning is logged;
   - when paid or cancelled, pending reminders are withdrawn automatically.
3. Audit the PayPal calls and the outcome (`Payment verified` / `Status checked`).

Running it twice is safe: duplicate payments are skipped by external id.

### 5.4 Webhooks

`POST /api/v1/webhooks/paypal` stores the raw event first, verifies the signature with PayPal (transmission id, signature, time, webhook id), ignores duplicate event ids, and reconciles only verified invoice events, using the same GET-based reconciliation as above. It never trusts the webhook body for amounts.

---

## 6. Security design

### 6.1 Permission tiers

Enforced on the server for every route (`server/src/lib/permissions.ts`). The UI only mirrors them.

| Capability | Owner | Finance Manager | Viewer |
|---|:-:|:-:|:-:|
| View data, ask the Copilot | ✓ | ✓ | ✓ |
| Edit records, import CSV | ✓ | ✓ | — |
| Prepare approvals, run the daily check | ✓ | ✓ | — |
| Approve | any amount | ≤ `managerApprovalLimit` (default $6,000), not their own | — |
| Change roles, the limit, workspace settings, reset demo | ✓ | — | — |

### 6.2 Approval state machine

```
            ┌──────── reject ───────► Rejected
Pending ────┤
            ├── approve (hash ok) ──► Submitted ──► Verified   (PayPal confirmed)
            │                             │    └──► Failed     (sanitised error)
            │                             └── retry after 2 min (same idempotent invoice number)
            └── approve (hash changed) ─► Stale
```

Checks at approval time, all inside one locked transaction:

- **Role and limit:** `canApprove(role, amount, limit)`.
- **Maker-checker:** a Finance Manager can't approve anything they prepared, including items the agent prepared on their behalf (`preparedByUserId`).
- **Integrity:** the approval stores a SHA-256 hash of a canonical (sorted-key) JSON snapshot of the records it acts on. At approval the snapshot is rebuilt from the database. If anything changed (amount, recipient, line items, draft text), the approval becomes `Stale` instead of executing.
- **One open approval per record:** a partial unique index on `(workspaceId, kind, refId)` where the status is `Pending` or `Submitted`.
- **No AI approvals:** agent proposals can't use `approveNow`, and the HTTP route can't set the agent flag.

### 6.3 AI safety

- The agent has **no write tools for money**. Its only writes create Pending approvals. The PayPal Agent Toolkit's send, remind, cancel, refund and pay tools are filtered out by an explicit allowlist, and the allowlist is enforced again at execution.
- **Prompt injection:** record text and PayPal data are passed as data. The worst a malicious invoice note could do is make the agent propose a reminder for an existing invoice, with content built from database records, which a person must still approve.
- **Hallucinated numbers** are caught by the grounding check (§4.2).
- Every agent run is audited: model, tools called, token counts, prepared approval ids and unverified figures.

### 6.4 Application security

| Control | Implementation |
|---|---|
| Authentication | bcrypt password hashes; HS256 JWT, 8-hour expiry; login limited to 10/min per IP; failed sign-ins log only a SHA-256 of the email |
| Tenant isolation | Workspace membership resolved from the verified token on every request; every query scoped by `workspaceId`; non-members get 404 |
| Input validation | Zod schemas on every route; strict bodies reject unknown fields; CSV import capped at 5,000 rows |
| Idempotency | `Idempotency-Key` on writes replays the first response for 24 h; reuse with a different route or user returns 409 |
| Transport and headers | Helmet security headers, CORS allowlist, global rate limit (120/min), copilot 20/min, daily check 5/min |
| Audit | Every mutation writes an `AuditEvent` in the same transaction; a database trigger rejects UPDATE/DELETE on audit rows; CSV export prefixes formula-leading cells (`=`, `+`, `-`, `@`, tab, CR) with an apostrophe |
| Database | Row-level security enabled and all privileges revoked from Supabase's public API roles on every table, sequence and function (lockdown migration), so the database is reachable only through the API |
| Secrets | PayPal and LLM keys only in `server/.env` (git-ignored, never `VITE_*`); tokens never logged; unexpected 500s return a generic message |
| Sandbox guard | The PayPal scripts refuse to run unless `PAYPAL_ENV=sandbox` |

---

## 7. Testing

| Layer | What | Result |
|---|---|---|
| Backend integration (`server/test`, Vitest) | 8 files, 57 tests against a real PostgreSQL in a throwaway schema: auth and tenant isolation, permission tiers and the FM limit, maker-checker, stale approvals, idempotency, money paths (PayPal send, reminder, reconcile, duplicate payments, partial payments), webhook storage and signature handling, the PayPal gateway against a fake, records, state and the copilot agent with a fake model | All passing |
| Frontend (`test/frontend.test.ts`) | Finance engine and copilot router | Passing |
| Static | `tsc --noEmit` for frontend and server; production builds | Passing |
| End-to-end (manual, live stack) | 159 browser test cases as Owner, Finance Manager and Viewer against Supabase, PayPal Sandbox and Groq. See [`docs/testing/CentsAI-E2E-Test-Report-2026-10-19.xlsx`](testing/CentsAI-E2E-Test-Report-2026-10-19.xlsx) | Defects found in round 1 were fixed and retested |
| Sandbox data audit | `server/scripts/paypal-links.ts` GETs every stored PayPal invoice id | All 28 exist in the sandbox (2026-10-19) |

---

## 8. Deployment

- **Frontend:** a static build (`npm run build` → `dist/`) for any static host. Set `VITE_API_URL` at build time for hosted mode.
- **API:** `cd server && npm run build && npm start` (Node 22). Set environment variables from `server/.env.example`, with `CORS_ORIGIN` set to the frontend origin.
- **Database:** PostgreSQL 14+ (Supabase in our setup). `npm run db:migrate` applies the schema and security migrations; `npm run db:seed` loads the demo workspace with dates relative to the seed day.
- **PayPal:** a sandbox REST app (client id/secret), a sandbox personal account as the payer, and optionally a webhook pointing to `/api/v1/webhooks/paypal` (`PAYPAL_WEBHOOK_ID`).
- **AI:** a Groq API key (free tier), or any OpenAI-compatible endpoint through `LLM_BASE_URL` and `LLM_MODEL`.

---

## 9. Known limitations

- **Sandbox only.** No production PayPal credentials, and the payer is always the sandbox account.
- **Single currency per workspace,** no FX.
- **Bank transfers** are recorded manually with a reference. There is no bank feed.
- **LLM free tier:** Groq allows 8K tokens/min, so back-to-back questions may wait for a retry. The rule-based fallback covers outages.
- **Latency:** writes take a few seconds against the remote Supabase pooler.
- **Forecast inputs** are client payment habits (average delay) and scheduled records. There is no statistical model of payment probability.
