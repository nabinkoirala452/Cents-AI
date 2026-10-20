# CentsAI API server

## Requirements

- Node.js 22
- PostgreSQL 14 or later

## Setup

1. From `server/`, install the backend dependencies:

   ```sh
   npm install
   ```

2. Copy `.env.example` to `.env` and set `DATABASE_URL`, a random `JWT_SECRET`
   of at least 32 characters, and `SEED_DEMO_PASSWORD`. Keep `.env` private and
   do not use frontend `VITE_*` variables for server secrets. Set `CORS_ORIGIN`
   to `http://localhost:8443` for the local Vite server.
3. Apply the schema and load the demo workspace:

   ```sh
   npm run db:migrate
   npm run db:seed
   ```

4. Start the API:

   ```sh
   npm run dev
   ```

   The health endpoint is `http://localhost:8787/api/v1/health`.

## Demo accounts

The seed creates `owner@centsai.demo` (Owner), `finance@centsai.demo`
(FinanceManager, Neha Shah), and `viewer@centsai.demo` (Viewer, Mina Rao).
All accounts use the password set by `SEED_DEMO_PASSWORD`; no demo password is
stored in source control.

Each workspace has one currency. The demo workspace uses USD, and all finance
calculations and records use that currency without FX conversion.

## Database tests

`npm test` uses the configured `DATABASE_URL` as a connection only. Before
running tests, it creates a uniquely named PostgreSQL schema, deploys migrations
into that schema, runs the tests there, and drops the schema during teardown.
The test does not seed or migrate the configured default schema. The database
role therefore needs permission to create and drop schemas. If setup is
interrupted before teardown, remove the leftover schema whose name starts with
`centsai_test_`. Test files run sequentially to avoid competing for connections
on the configured PostgreSQL pooler.

The seed is repeatable and refreshes mutable demo-workspace data. It does not
insert sample audit rows; the audit log starts empty and is populated only by
operations that actually occur. Audit events are append-only by database
trigger, so real events are retained on subsequent seeds. The one-time
`20261017180000_remove_fake_demo_audit` migration removed the former fake demo
operation claims.

Demo data dates are set when the workspace is seeded. Re-run `npm run db:seed`
on the demo day to refresh its relative dates. An Owner can call
`POST /api/v1/admin/reset-demo` only when `ALLOW_DEMO_RESET=true`; reset keeps
the caller's workspace, membership, and append-only audit history.

The Vite development server uses `http://localhost:8443`; set `CORS_ORIGIN` to
that origin when running the frontend locally.

## Authentication and workspace access

`POST /api/v1/auth/login` accepts `{ "email": "...", "password": "..." }`
and returns an HS256 bearer token (8-hour expiry), the user profile, and the
workspaces the user belongs to. Protected API requests send both
`Authorization: Bearer <token>` and `X-Workspace-Id`. Workspace membership is
resolved from the verified token; a caller cannot select a workspace without
being a member. The login route is limited to 10 attempts per minute per IP.
Successful sign-ins are audited in each workspace the user belongs to. Failed
sign-in warnings log only a SHA-256 digest of the normalized email.

`GET /api/v1/me` returns the signed-in profile and memberships.
`GET /api/v1/workspace/state` returns the frontend State for the selected
workspace and caller role. Workspace and preference changes use
`PATCH /api/v1/workspace` and `PATCH /api/v1/settings`; for example, role
changes are submitted as an Owner with
`{ "team": [{ "email": "viewer@centsai.demo", "role": "Finance Manager" }] }`.
The `managerApprovalLimit` and `team` fields are Owner-only. The
`PUT /api/v1/settings/dismissed-insights` body is
`{ "dismissedInsights": ["insight-id"] }` and is available to any member.

## Records and computed reads

Owner and Finance Manager can use the record routes in
`server/src/modules/records/` for transactions/imports, clients, projects/time
entries, invoices, employees, contractor bills, recurring costs, loans,
financing offers, and saved scenarios. Transaction imports accept at most
5,000 parsed rows at `POST /api/v1/transactions/import`; invalid rows are
skipped, `skipDuplicates=true` skips duplicates by default, and
`skipDuplicates=false` imports duplicate rows with status `Review`. Reported
issue row numbers start at 1 for the submitted data rows.

Transaction dates are limited to today in the workspace timezone. Verified
transactions are editable only for category, project, and notes; verified or
invoice-linked transactions cannot be deleted. New invoices are Draft,
workspace-currency records with server-assigned `INV-####` numbers. Only
Draft bank-transfer invoices can be issued by the record API; PayPal invoices
must use the later approval workflow. Contractor bills cannot be marked Paid
and subscriptions cannot be cancelled directly; those state transitions must
use the authorised approval flow.

`GET /api/v1/cashflow/forecast`, `/api/v1/dashboard/summary`, and
`/api/v1/briefing` are read-only and compute their figures through the shared
finance engine using the authenticated workspace State.

Every successful workspace mutation inserts an append-only audit event in the
same database transaction. Members can read the scoped event feed at
`GET /api/v1/audit-events?limit=50&cursor=...&ref=...` or export it as CSV at
`GET /api/v1/audit-events/export.csv`. CSV formula-leading cells are prefixed
with an apostrophe. POST, PATCH, PUT, and DELETE requests may include an
`Idempotency-Key`; reusing the same key on the same route replays the first
stored status and JSON body for 24 hours, while reusing a key for another
route or authenticated user/role context returns 409.

API errors use `application/problem+json`. A role denial has status 403 and
code `forbidden_role`; missing or invalid bearer tokens return a generic 401.

## Approvals, PayPal, and payments

Approvals are proposed from workspace records at `POST /api/v1/approvals`;
request data cannot set the recipient, amount, currency, steps, or reminder
draft. Approval execution verifies the record hash under row locks and performs
external PayPal calls after committing the `Submitted` state. An approval that
is already executing cannot be approved again. Managers are limited by the
workspace `managerApprovalLimit`; Owners can approve any amount.

`PAYPAL_MODE=sandbox` selects the real PayPal gateway and `PAYPAL_MODE=fake`
selects the in-memory fake. Set PayPal credentials in `server/.env` only.
`PAYPAL_ENV` and `PAYPAL_BASE_URL` must agree; `PAYPAL_SANDBOX_PAYER_EMAIL`
overrides invoice recipients only in the sandbox. PayPal access tokens are
cached in memory and never logged. External method/path/status/debug IDs are
logged without request credentials or tokens.

The public `POST /api/v1/webhooks/paypal` endpoint stores raw webhook events
before verifying their signature; a duplicate provider event ID is a no-op.
It reconciles only verified invoice events and responds with 2xx after storage.
`POST /api/v1/invoices/:id/paypal/sync` provides the authenticated GET-based
verification fallback. `POST /api/v1/invoices/:id/payments` records bank
receipts using `{ "date": "YYYY-MM-DD", "reference": "bank-reference" }`.

Run `npm run paypal:smoke` from `server/` only with sandbox credentials set.
The script refuses to run unless `PAYPAL_ENV=sandbox`, creates and sends a
one-dollar USD test invoice, then prints PayPal's status and payer URL when
PayPal provides one. If the API omits the payer-view link, the script reports
`(not provided)` rather than fabricating a URL.

## Copilot agent (Groq + PayPal Agent Toolkit)

The copilot is an LLM agent. By default it uses **Groq's free tier** through its OpenAI-compatible API; any
OpenAI-compatible provider works by changing `LLM_BASE_URL` and `LLM_MODEL`. Get a free key at
https://console.groq.com/keys and put it in `server/.env` as `LLM_API_KEY` (server only, never a `VITE_*` variable).

Endpoints:
- `POST /api/v1/copilot/ask` `{ "question": "...", "history": [{ "role": "user" | "assistant", "text": "..." }] }` →
  `{ answer, engine, proposals }`. Any member may ask (20/min).
- `POST /api/v1/copilot/daily-check` (Owner / Finance Manager, 5/min): code checks PayPal status for sent PayPal invoices that are
  overdue or due soon and computes the cash outlook, receivables and 14-day obligations. The model then gets that brief and only the
  reminder tool: it decides which overdue invoices (without an open approval) to remind, writes each message, and summarises.

Tools the agent can call:
- **Finance tools** (`src/lib/copilot.ts`): read-only; they run the deterministic engine on `loadState()`.
- **PayPal Agent Toolkit** (`@paypal/agent-toolkit/openai`), **read actions only**: `list_invoices`, `get_invoice`,
  `list_transactions`, `get_merchant_insights` against the PayPal Sandbox (descriptions trimmed; `search_invoicing` is left out
  because its schema alone is ~3K tokens). The toolkit's write tools (send, remind, cancel, refund, pay) are not enabled, because
  they would bypass approvals. Set
  `COPILOT_PAYPAL_TOOLS=false` to turn this off; it's also off when `PAYPAL_MODE=fake`.
- **Agent actions**: `propose_payment_reminder` (with message text the agent writes) and `propose_paypal_invoice_send` call
  the normal approval service with `preparedByAgent = true`. They only create a **Pending** approval, never use
  `approveNow`, and are not offered to Viewers. Maker-checker still applies: a Finance Manager can't approve what the agent
  prepared on their behalf. `check_paypal_payment` runs the same GET + reconcile as "Verify payment status", so a payment is
  recorded only when PayPal confirms it.

Safeguards:
- Figures, tables, records and assumptions in the answer come from tool output. Every `$` amount and `%` in the model's
  wording is checked against tool output, the workspace context and the user's words; mismatches are listed in
  `answer.grounding.unverified` and shown as "verify before relying on it".
- Record text and PayPal data are passed as data. A prompt-injected instruction can at most create a Pending approval for an
  existing invoice, built from DB records, which a person must still approve.
- Each run writes a `Copilot answered` or `Agent daily check` audit event (model, tools, prepared approval ids, token counts,
  unverified figures).
- With `COPILOT_MODE=rules` or no `LLM_API_KEY`, the deterministic router answers and the daily check uses template reminder
  text. It also answers, with a note, if the provider rate-limits, rejects the key or can't be reached.
  `/api/v1/health` reports `copilotEngine`.

Environment: `LLM_API_KEY`, `LLM_BASE_URL` (default `https://api.groq.com/openai/v1`), `LLM_MODEL`
(default `openai/gpt-oss-120b`), `COPILOT_MODE` (`llm` | `rules`), `COPILOT_PAYPAL_TOOLS` (default `true`).
`LLM_REASONING_EFFORT` (`low` | `medium` | `high` | `none`; default `low` for gpt-oss models, otherwise not sent).

**Free-tier limits:** Groq's free tier allows 8K tokens/minute and 200K tokens/day for `openai/gpt-oss-120b`, and every agent
turn re-sends the conversation. Requests are kept small (trimmed toolkit tools, 10 invoices in context, 12 table rows, 4 history
turns, low reasoning effort); the SDK waits and retries on 429, and the last turn only offers `compose_answer`. A question
typically costs 3–6K tokens.
