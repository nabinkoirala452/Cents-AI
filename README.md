# CentsAI

**An agentic AI finance copilot for small service agencies.**
Understand your cash. Protect your margins. Run your agency with confidence.

CentsAI brings a 2–20 person agency's invoices, payroll, contractors, subscriptions, loans and project costs into one place. It forecasts cash flow in three scenarios, explains risks in plain language, and prepares real **PayPal Sandbox** invoice and reminder actions that a person must approve before anything is sent.

Built for **FinTechathon 2026 — Topic E: SME Finance Copilot**.

> **The rule:** the AI explains and prepares. Deterministic code calculates. A person approves. PayPal confirms. Every step is audited.

## What it does

| Area | What works |
|---|---|
| **Finance workspace** | 14 pages: Dashboard, Daily Briefing, Transactions (CSV import), Invoices, Cash Flow, Expenses, Payroll & contractors, Loans, Projects & margins, What-if Simulator, Financing offers, Copilot, Approvals, Settings |
| **Deterministic finance engine** | Cash position, receivables ageing, 90-day forecast in three scenarios (expected / clients pay late / worst case), project margins, loan schedules, hire and purchase affordability. Every number in the UI and every number the AI uses comes from `src/lib/finance.ts` |
| **Real PayPal Sandbox** | Invoicing v2: create, send, remind and status-check invoices. Payments are recorded only after a server-side GET (or a verified webhook) confirms them |
| **AI agent** | LLM agent (Groq `openai/gpt-oss-120b`, any OpenAI-compatible provider) with ten read-only finance tools plus read-only **PayPal Agent Toolkit** tools. It answers questions such as *"Can we cover payroll if Acme pays 30 days late?"* and runs a **daily check** that verifies PayPal status for overdue invoices and drafts reminder messages for approval |
| **Approvals & audit** | Maker-checker approvals with role limits, an append-only audit log and CSV export of every recommendation, approval, PayPal API call and verified result |

## Architecture

```
React + Vite frontend (src/)
   │  shared finance engine + tool registry (src/lib/finance.ts, src/lib/copilot.ts)
   ▼
Fastify API (server/)  ── JWT auth, workspace scoping, Zod validation, rate limits
   ├─ Prisma ─► PostgreSQL (Supabase)   records, approvals, append-only audit events
   ├─ PayPal gateway ─► PayPal Sandbox  Invoicing v2 + webhooks (OAuth token cached server-side)
   └─ Copilot agent ─► Groq LLM         finance tools + PayPal Agent Toolkit (read-only) + approval proposals
```

The finance engine is one TypeScript module that both the browser and the server run. The forecast a user sees and the figures the agent reasons over are the same calculation.

The frontend runs in two modes:
- **Demo mode** (no backend): data lives in the browser, PayPal is simulated, and a rule-based router answers Copilot questions over the same tools.
- **Hosted mode** (`VITE_API_URL` set): everything goes through the API, real PayPal Sandbox and the LLM agent.

## Security design

- **Permission tiers.** *Owner* can do everything. *Finance Manager* can prepare actions and approve up to the workspace limit (default $6,000). *Viewer* is read-only and can ask the Copilot. Roles are enforced on the server for every route, not just hidden in the UI.
- **Maker-checker.** Nobody approves their own request. Items the agent prepares are marked "CentsAI agent (for &lt;user&gt;)", so the user it acted for can't approve them either.
- **The AI can't move money.** The agent's only write actions create a *Pending* approval. The PayPal Agent Toolkit is restricted to read actions by an allowlist; send, remind, cancel, refund and pay tools are never exposed.
- **No hallucinated numbers.** Figures and tables come straight from tool output. Every `$` amount and `%` in the model's wording is checked against tool results. Unmatched figures are flagged as "verify before relying on it" in the UI and in the audit event.
- **Tamper-checked execution.** Approval data (recipient, amount, steps) is built from database records, not request bodies. A record hash is re-verified under row locks before execution. Requests take idempotency keys, so a retried call can't send twice.
- **Verify before record.** A PayPal payment is recorded only after PayPal confirms it. Webhooks are stored raw, signature-verified and de-duplicated.
- **Audit trail.** Every mutation writes an audit event in the same transaction. A database trigger makes events append-only. CSV export neutralises formula injection.
- **Secrets stay server-side.** PayPal and LLM keys live only in `server/.env` (never `VITE_*`). Tokens and credentials are never logged. Login is rate-limited and failed sign-ins log only an email hash.

## Run it

Requires **Node 22**.

### Option A — demo mode (frontend only, 1 minute)

```bash
npm install
npm run dev
```

Open http://localhost:8443 and choose **Explore the demo**. Demo data is generated relative to today. Reset it from Settings → Data Management.

### Option B — full stack (real PayPal Sandbox + AI agent)

You need a PostgreSQL 14+ database, a [PayPal Developer](https://developer.paypal.com) sandbox app (client id/secret plus a sandbox personal account to act as the payer) and a free [Groq API key](https://console.groq.com/keys).

1. Configure the backend:
   ```bash
   cd server
   npm install
   cp .env.example .env
   ```
   Fill in `DATABASE_URL`, `JWT_SECRET` (32+ random characters), `SEED_DEMO_PASSWORD`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_SANDBOX_PAYER_EMAIL` and `LLM_API_KEY`.
2. Create the schema, load the demo workspace and start the API:
   ```bash
   npx prisma generate
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```
   Health check: http://localhost:8787/api/v1/health (reports the PayPal mode and Copilot engine).
3. Point the frontend at the API. In the repo root, create `.env.local` containing `VITE_API_URL=http://localhost:8787`, then run `npm run dev` and sign in.

**Demo accounts** (password = your `SEED_DEMO_PASSWORD`):

| Email | Role |
|---|---|
| `owner@centsai.demo` | Owner (Alex Kumar) |
| `finance@centsai.demo` | Finance Manager (Neha Shah) |
| `viewer@centsai.demo` | Viewer (Mina Rao) |

Useful sandbox scripts (run from `server/`):
- `npm run paypal:smoke` creates and sends a $1 sandbox invoice to prove the credentials work.
- `npx tsx scripts/paypal-links.ts` is a read-only audit: it checks every stored PayPal invoice id against the sandbox.

### Suggested demo path

1. **Dashboard / Briefing:** cash today, runway, and what needs attention this week.
2. **Cash Flow:** switch scenarios and see when cash dips below the payroll threshold.
3. **Copilot:** ask *"Can we cover payroll if Acme pays 30 days late?"*, then press **Run daily check**.
4. **Approvals:** sign in as the Finance Manager or Owner and approve the agent's reminder (the agent's own user can't). Watch it execute against PayPal Sandbox.
5. **Invoices:** open the PayPal payer link, pay as the sandbox buyer, then **Verify payment status**. The payment is recorded only after PayPal confirms it.
6. **Approvals → Export audit CSV:** the sandbox operation log.

## Tests

| Suite | Command | Coverage |
|---|---|---|
| Backend | `cd server && npm test` | 8 files, 57 tests: auth and workspace isolation, permissions and approval limits, money paths, PayPal gateway, records, state, copilot agent (fake model). Runs in a throwaway PostgreSQL schema that is dropped afterwards |
| Frontend | `npm test` | Finance engine and copilot router |
| Types / build | `npx tsc --noEmit -p .` · `npm run build` · `cd server && npm run typecheck && npm run build` | |
| End-to-end (manual) | [`docs/testing/CentsAI-E2E-Test-Report-2026-10-19.xlsx`](docs/testing/CentsAI-E2E-Test-Report-2026-10-19.xlsx) | 159 browser test cases as Owner, Finance Manager and Viewer against the live stack, with defects and retests |

## Project layout

- `src/lib/` — data model, demo seed, finance engine (`finance.ts`), store, copilot tool registry (`copilot.ts`), API client, simulated PayPal adapter for demo mode
- `src/pages/` — one file per page · `src/components/` — shared UI, layout, charts
- `server/src/modules/` — API modules (auth, workspace, records, approvals, payments, webhooks, audit, copilot agent)
- `server/src/integrations/paypal` — real PayPal Sandbox gateway · `server/prisma/` — schema, migrations, seed
- `docs/backend/` — backend spec, build prompts and progress log · `docs/testing/` — E2E test report
- [`server/README.md`](server/README.md) — full API, PayPal and agent reference

## Team setup (new teammate)

1. Clone: `git clone https://github.com/nabinkoirala452/Cents-AI.git`.
2. Get `server/.env` **privately** from a teammate. Never commit it or post it in a public chat or issue. The variable names are in [`server/.env.example`](server/.env.example).
3. Do **not** run `npm run db:migrate`, `db:seed` or `db:reset` against the shared Supabase database without agreeing with your teammate first.
4. `git pull` before you start, commit small and push often. Record what you did in [`docs/backend/PROGRESS.md`](docs/backend/PROGRESS.md).

## Licence

[MIT](LICENSE)
