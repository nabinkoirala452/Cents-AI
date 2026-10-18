# CentsAI backend foundation

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

Owner and Finance Manager can use the record routes listed in
`docs/backend/SPEC.md` §7 for transactions/imports, clients, projects/time
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

## Copilot (Claude)

`POST /api/v1/copilot/ask` with `{ "question": "...", "history": [{ "role": "user" | "assistant", "text": "..." }] }`
returns `{ answer, engine }`, where `answer` has the same shape the frontend copilot renders. Any workspace member,
including a Viewer, may ask; it is limited to 20 requests per minute.

- Claude (`ANTHROPIC_MODEL`, default `claude-opus-5-5`) picks which finance tools to call from `src/lib/copilot.ts`
  and writes the headline and paragraphs. The tools are read-only and run the shared finance engine on `loadState()`,
  so figures, tables, records, assumptions and actions all come from the engine, not the model.
- Every currency amount and percentage in Claude's wording is checked against the tool output. Amounts that don't match
  are listed in `answer.grounding.unverified` and shown to the user as "verify before relying on it".
- Record text (client names, notes, descriptions) is passed as data. The model has no write tools, so prompt injection
  cannot send, pay, approve or edit anything. Actions such as "Prepare reminders" are buttons the user clicks, and they
  then go through the normal approval workflow.
- Each answer writes a `Copilot answered` audit event with the engine, tools used, token counts and any unverified figures.
- With `COPILOT_MODE=rules` or no `ANTHROPIC_API_KEY`, the deterministic keyword router answers instead. It also answers,
  with a note, if Claude declines, is rate limited or can't be reached. `/api/v1/health` reports `copilotEngine`.

Environment: `ANTHROPIC_API_KEY` (server only, never a `VITE_*` variable), `ANTHROPIC_MODEL`,
`COPILOT_EFFORT` (`low`–`max`, default `medium`), `COPILOT_MODE` (`claude` | `rules`).
