# Copilot prompts — CentsAI backend (non-AI phase)

How to use:
- Use **GitHub Copilot Chat in Agent mode** in VS Code, opened at the repo root. Start a **new chat for each phase**.
- Paste the prompt exactly. Copilot also reads `.github/copilot-instructions.md` automatically.
- After each phase, bring the "Report" back for review before starting the next phase.
- Order matters: **0 → 1 → 2 → 3 → 4 → 5 → 6**. For the FinTechathon deadline (20 Oct), phases 1–5 are the minimum; 6 can be partial.

---

## Phase 0 — Manual setup (you, not Copilot) · ~45 min

1. **Node 22**: `nvm install 22` then `nvm use 22`, check `node -v` shows v22.x (Vite 8 and the server need it).
2. **Git**: at the repo root run `git init`, then commit the current frontend as the first commit. Create a **public** GitHub repo and push. Add an MIT `LICENSE` file (PayPal requires a visible licence).
3. **Postgres**: create a free **Supabase** project → Project Settings → Database → copy the connection string (use the "Session pooler" URI). Keep the DB password safe.
4. **PayPal Sandbox** at developer.paypal.com:
   - Apps & Credentials → Sandbox → **Create App** → copy Client ID and Secret.
   - Testing Tools → Sandbox Accounts: note the default **business** account (the invoicer) and **personal** account (the payer — you'll log in with it to pay invoices).
   - Webhooks are optional for the first demo (the "Verify payment status" button works without them). Later: add a webhook URL (your Render URL + `/api/v1/webhooks/paypal`), subscribe to `INVOICING.INVOICE.PAID`, `INVOICING.INVOICE.CANCELLED`, `INVOICING.INVOICE.REFUNDED`, copy the **Webhook ID**.
5. Never paste secrets into Copilot chat. You'll put them in `server/.env` yourself after Phase 1 creates `.env.example`.

---

## Phase 1 — Server scaffold, database, seed, State adapter

```
Read .github/copilot-instructions.md, AGENTS.md and docs/backend/SPEC.md fully before writing code. Follow the SPEC exactly; if something is ambiguous, ask me instead of guessing.

Task: create the backend foundation in a new `server/` folder (SPEC §2, §3, §4, §5, §12). No auth yet, no business routes yet.

1. `server/package.json` (ESM, Node 22) with scripts: dev (tsx watch src/index.ts), build (tsup), start (node dist/index.js), typecheck (tsc --noEmit), test (vitest run), db:migrate (prisma migrate dev), db:seed (tsx prisma/seed.ts), db:reset (prisma migrate reset --force). Dependencies: fastify@5, fastify-type-provider-zod, zod, @prisma/client, prisma, @fastify/helmet, @fastify/cors, @fastify/rate-limit, jose, bcryptjs, dotenv; dev: typescript, tsx, tsup, vitest, @types/node, @types/bcryptjs.
2. `server/tsconfig.json` (strict, ESM, moduleResolution bundler) that can type-check files imported from ../src/lib.
3. `server/src/config.ts`: load .env and validate all variables from SPEC §12 with Zod; fail fast with a clear message. Refuse PAYPAL_ENV/PAYPAL_BASE_URL mismatches.
4. `server/src/core.ts`: re-export the pure frontend modules (finance, dates, format, types, seed). Do NOT import any React file.
5. `server/src/app.ts` exporting `buildApp()` (Fastify with zod type provider, helmet, CORS allow-list from CORS_ORIGIN, rate-limit, pino with redaction, problem+json error handler without stack traces in production, `GET /api/v1/health`). `server/src/index.ts` starts it on PORT.
6. `server/prisma/schema.prisma` with every table in SPEC §4 (string ids with @@id([workspaceId, id]) for business tables, Decimal(14,2) money, enums for roles/statuses). Create the initial migration. Add a second raw-SQL migration that: (a) creates the partial unique index for one open approval per (workspaceId, kind, refId) where status in ('Pending','Submitted'); (b) creates a trigger that raises an exception on UPDATE or DELETE of the AuditEvent table.
7. `server/prisma/seed.ts`: call `createSeed()` from core.ts and insert one workspace with ALL of its records (clients, projects, invoices incl. PayPal fields, transactions, employees, contractor bills, recurring costs, loans, offers, approvals, audit events, settings). Create three users — owner@centsai.demo (Owner), finance@centsai.demo (FinanceManager, named Neha Shah), viewer@centsai.demo (Viewer, named Mina Rao) — with password from SEED_DEMO_PASSWORD hashed with bcrypt. The seed must be re-runnable (wipe the demo workspace first).
8. `server/src/lib/state.ts`: `loadState(workspaceId, role)` returning exactly the frontend `State` type (SPEC §5). Decimal → number, rebuild invoice.paypal from columns, settings.team from memberships, chat: [].
9. Test `server/test/state.test.ts`: with time frozen, seed the DB, call loadState(), and assert it matches createSeed() for: counts of every collection, cashBalance(), receivables().outstanding, forecastAll(...,90).conservative.lowest. (Use a separate test database via DATABASE_URL_TEST or a Postgres schema; document how in server/README.md.)
10. `server/.env.example` (placeholders only), add `server/.env` and `server/dist` to .gitignore, and `server/README.md` with setup steps.
11. Create `docs/backend/PROGRESS.md` and record what you did.

Do not build any other routes. When finished, run typecheck, migrate, seed and tests, and give me the Report below.

Report: (1) files created, (2) exact commands you ran and their final output lines, (3) test results, (4) any deviation from the SPEC and why, (5) open questions.
```

---

## Phase 1 fixes — from review (do these before Phase 2)

```
Phase 1 review fixes. Read docs/backend/PROGRESS.md first. Do not overwrite server/.env.

1. CRITICAL security — Supabase exposes every table in the public schema through its REST API to anyone with the public (publishable) key. I verified that User (including passwordHash) and Transaction rows are readable that way right now. Add a new Prisma migration (raw SQL) that, for every table in the current schema (use current_schema(), do not hard-code "public", so it also works in the test schema):
   - ALTER TABLE … ENABLE ROW LEVEL SECURITY (no policies — the API connects as the table owner, which bypasses RLS)
   - REVOKE ALL on all tables, sequences and functions in the schema FROM anon, authenticated (guard each role with IF EXISTS — plain local Postgres has no such roles)
   - ALTER DEFAULT PRIVILEGES in the schema REVOKE ALL ON TABLES/SEQUENCES/FUNCTIONS FROM anon, authenticated (same guard), so future tables are also locked
   Include _prisma_migrations. Add a test that, after migrations, every table in the test schema has relrowsecurity = true and (if the role exists) has_table_privilege('anon', <table>, 'SELECT') is false. Apply the migration to the real database with `npm run db:migrate`.
2. `Approval.idempotencyKey` must be unique per workspace, not globally: replace @unique with @@unique([workspaceId, idempotencyKey]) (new migration).
3. Stale approvals: do not hide them. Add "Stale" to ApprovalStatus in src/lib/types.ts, show Stale in the Approvals page "Completed" tab with a neutral badge and the text "Records changed after this was requested — request again", and remove the Stale filter from loadState().
4. Canonical payload hash: create server/src/lib/hash.ts exporting canonicalJson (recursively sorted object keys) and payloadHash(value) = sha256 hex of canonicalJson. Use it in the seed instead of JSON.stringify. Phase 4 must reuse this same function.
5. Deterministic ordering in loadState(): transactions by date desc then id desc; invoices by issueDate desc; approvals by requestedAt desc; contractor bills by dueDate; recurring costs by nextDate. Keep audit as at desc.
6. Remove `updatedAt` from AuditEvent (an append-only table has no updates).
7. The Vite dev server runs on port 8443 (vite.config.ts), not 5173: change CORS_ORIGIN in server/.env.example and server/README.md to http://localhost:8443.
8. README: note that demo data dates are fixed at seed time, so re-run `npm run db:seed` on demo day (Phase 3 adds an Owner-only reset endpoint). Record the Prisma 6 `npm audit` finding in PROGRESS.md as accepted for now (dev CLI dependency), to be revisited after the hackathon.
9. Run typecheck, all tests and the frontend `npx tsc --noEmit -p .` from the repo root, then update docs/backend/PROGRESS.md and give me the Report.
```

---

## Currency switch — INR → USD (do this before Phase 2)

```
Currency switch: move the whole app from Indian rupees to US dollars. Read docs/backend/SPEC.md (top note "Currency" and §4) first — it is already updated. Read docs/backend/PROGRESS.md. Do not overwrite server/.env.

Decision: each workspace has ONE currency, default "USD". Every amount (ledger, invoices, payroll, bills, loans, offers, thresholds, approvals) is in that currency. No FX conversion anywhere. The demo agency becomes a small US-based agency. Keep the code currency-aware (formatting takes a currency code) so another single currency could be configured later, but USD is the only one used in the demo.

Frontend (src/):
1. types.ts: add `currency: Currency` to Settings (replace `reportingCurrency: "INR"`); remove `usdRate`; Approval: remove `amountINR` (keep `amount` + `currency`). Invoice/Client keep a `currency` field but it always equals the workspace currency. Keep `channel: "PayPal" | "Bank transfer"` — default PayPal; "Bank transfer" means the client pays by ACH/wire and payment is recorded manually with a reference.
2. format.ts: `money(value, currency = "USD")` using Intl.NumberFormat("en-US") with 0 decimals for whole amounts and 2 decimals when cents exist; replace `compactINR` with `compactMoney` ($85k, $1.2M); remove lakh formatting.
3. finance.ts: delete `toINR`; replace `invoiceINR` with `invoiceTotal` everywhere; no conversion in receivables, forecast, projectStats, briefing. Rename anything "INR" in names/comments. The calculations must otherwise stay identical.
4. paypal.ts eligibility: channel must be PayPal, client email present, ≥1 line item, currency supported by PayPal (USD at least). No "INR invoices use bank transfer" logic.
5. seed.ts — convert the demo agency to USD while keeping the SAME financial story (conservative 90-day forecast dips just below the safety threshold around the second payroll; the expected scenario stays above it):
   - Every amount that is in INR today → round(INR / 8) (salaries and recurring costs to the nearest $50; other amounts to the nearest $10).
   - Every amount that is in USD today (USD invoices like $650, $360, $1,150, $900, $720, $1,080, contractValue USD parts) → round(USD × 10.5) to the nearest $10 (keeps their value relative to everything else).
   - Opening cash target: $81,250 (was ₹6,50,000). Safety threshold $12,500. Finance Manager approval limit $6,000. Hire example $5,600/month.
   - All clients use USD and channel PayPal, except make Spring & Co. channel "Bank transfer" (pays by ACH) so the manual-payment path still exists.
   - Location "Austin, TX, USA"; clients: Acme Technologies (US), PixelCraft Studio (UK), Northstar Consulting (US), Spring & Co. (US), Horizon Labs (US), Greyspace (Canada). Rename "GST & TDS deposit" → "Payroll tax deposit". Keep people names. References like "NEFT-…"/"UTR" → "ACH-…".
   - Bump STATE_VERSION so browsers re-seed.
6. Every page, the landing page, copilot.ts (parseAmount: "$45k", "$5,600", "45000"; suggested questions in $), drafts.ts, csv.ts sample (amounts ÷ 8), Auth register (currency select USD only), Settings (remove the "USD → INR rate" field; show "Reporting currency: USD" read-only), CashFlow assumptions modal (remove the rate field), Invoices (remove "≈ ₹…" conversions; currency/channel field shows "USD · PayPal" or "USD · Bank transfer"; Create invoice lets the user pick the channel, default PayPal), Approvals (remove "≈ ₹" lines). Remove every "₹", "INR", "lakh", "en-IN", "UTR", "NEFT" from user-visible text.
7. After the change, open the app in demo mode (Settings → Reset demo data) and confirm: Dashboard shows $81,250 cash and the "Potential cash shortfall" alert in the conservative scenario; 2 overdue invoices; copilot hire question answers "Not comfortably in the conservative scenario". If the story breaks, adjust seed amounts slightly (not the engine) until it holds, and note what you changed.

Server (server/):
8. Prisma: add `Workspace.currency Currency @default(USD)`; remove `WorkspaceSettings.usdRate`; remove `Approval.amountINR`; remove `PaymentEvent.fxRate` and `PaymentEvent.amountINR`; Client.currency may stay but must equal the workspace currency. New migration (keep RLS: any new table must enable RLS). Re-seed with `npm run db:seed`.
9. state.ts and seed.ts updated to the new types; `settings.currency` from Workspace.currency.
10. Update tests (state parity with createSeed(), hash, RLS) and add one test asserting no amount in loadState() is converted (e.g. invoice totals equal line-item sums, transactions equal seed values).

Checks: root `npx tsc --noEmit -p .`, `npm run build`, `npm --prefix server run typecheck`, `npm --prefix server test`, `npm run db:migrate`, `npm run db:seed`. Search the repo (excluding node_modules, docs/, hacakathon_fintech_problem_statment.md) for "₹", "INR", "usdRate", "amountINR", "toINR", "invoiceINR", "lakh", "en-IN" — must return nothing. Update docs/backend/PROGRESS.md and give me the Report (include the new headline demo numbers: cash, conservative 90-day low and its date, expected 90-day end).
```

---

## Phase 2 — Auth, roles, workspace scoping, audit, state endpoint

```
Read .github/copilot-instructions.md and docs/backend/SPEC.md §6, §7, §9 again. Continue from Phase 1 (see docs/backend/PROGRESS.md).

Task: authentication, authorization and the audit service.

1. `POST /api/v1/auth/login` (bcrypt compare, generic 401, rate limit 10/min/IP) returning `{ token, user, workspaces }`; JWT HS256 signed with JWT_SECRET via jose, 8h expiry, claims: sub (userId).
2. `plugins/auth.ts`: for every route except health, login and webhooks — verify the bearer JWT, read `X-Workspace-Id`, load the membership (404 if the user is not a member), set `req.ctx = { userId, userName, workspaceId, role, requestId }`.
3. `lib/permissions.ts`: `canView`, `canPrepare`, `canEdit`, `canApprove(role, amount, managerApprovalLimit)`, `isOwner` — same rules as `permissions()` in src/lib/store.tsx. Services must call these (not only routes). Throw a typed 403 error (problem+json code `forbidden_role`).
4. `modules/audit/service.ts`: `audit(ctx, { actor?, action, detail, ref?, outcome })` — insert only. `GET /api/v1/audit-events` (limit + cursor, filter by ref) and `GET /api/v1/audit-events/export.csv` with formula-injection guard.
5. `plugins/idempotency.ts`: honour an `Idempotency-Key` header on POST/PATCH/DELETE — replay within 24h returns the stored status + body; same key with a different route → 409.
6. `GET /api/v1/me`, `GET /api/v1/workspace/state` (calls loadState with the caller's role), `PATCH /api/v1/workspace`, `PATCH /api/v1/settings` (Owner-only fields: managerApprovalLimit and team roles), `PUT /api/v1/settings/dismissed-insights`. All mutations write audit events.
7. Tests: login success/failure; missing/invalid token → 401; non-member workspace → 404; permission matrix for the routes in this phase (Viewer / FinanceManager / Owner); audit row cannot be updated or deleted (trigger works); idempotency replay.
8. Update docs/backend/PROGRESS.md.

Report: files changed, commands + output, tests, deviations, open questions.
```

---

## Phase 2 fixes — from review (do these before Phase 3)

```
Phase 2 review fixes. Read docs/backend/PROGRESS.md first. Do not overwrite server/.env.

1. Honest audit evidence (important for the FinTechathon "operation logs"): the audit CSV export (GET /audit-events/export.csv) and GET /audit-events still return the seeded fake history, e.g. "INV-1056 confirmed as SENT via GET /v2/invoicing/invoices" — no such call ever happened. Fix at the source:
   - The server seed must NOT insert the fake demo audit events any more (keep sample approvals; the audit log starts empty and fills with real events).
   - Add a one-time data migration that removes the already-seeded demo rows (ids AU-2…AU-9 in workspace "centsai-demo"): inside that migration only, temporarily disable the append-only trigger (ALTER TABLE "AuditEvent" DISABLE TRIGGER "AuditEvent_append_only"), delete exactly those ids, then ENABLE it again. Add a SQL comment explaining why.
   - Remove the "Sample · …" relabelling hack from loadState() (no longer needed).
   - Test: after seeding, neither the audit list nor the CSV export contains "via GET" or any PayPal claim.
2. Idempotency race: today two concurrent requests with the same Idempotency-Key both run (the key is only stored after the response). Reserve the key BEFORE the handler runs: insert the row with responseStatus 0 in onRequest; if the insert hits the unique constraint and the stored row is still status 0 → reply 409 code "idempotency_in_progress"; on completion update the row with the real status/body. Do NOT keep responses with status >= 500 — delete the reservation so the client can retry. Test: two concurrent identical requests → exactly one executes; a 500 is not replayed.
3. Login hardening: (a) when the email does not exist, still run bcrypt.compare against a fixed dummy hash so response time doesn't reveal which emails exist; (b) audit successful sign-ins ("Signed in", outcome info) in each of the user's workspaces; log failed sign-ins with the app logger (warn, include a sha256 of the lowercased email, never the password) — not in the audit table since there is no workspace context. Test (b).
4. Validation: PATCH /workspace `timezone` must be a valid IANA zone (check with `new Intl.DateTimeFormat("en-US", { timeZone })` in a try/catch); `website` must be empty or an http(s) URL.
5. Run server typecheck + tests and root `npx tsc --noEmit -p .`, then `npm run db:migrate` and `npm run db:seed`. Update docs/backend/PROGRESS.md and give me the Report.
```

---

## Phase 3 — Records CRUD and computed endpoints

```
Read docs/backend/SPEC.md §4.1 and §7 again. Continue from docs/backend/PROGRESS.md.

Task: all record routes and the read-only computed endpoints from SPEC §7, EXCEPT approvals, PayPal, payments and webhooks (next phase).

1. Transactions: POST/PATCH/DELETE with the rules in SPEC §4.1 #3 and the duplicate check reusing `findDuplicate` from core.ts (duplicate → status Review with reviewReason). Date must be <= today in the workspace timezone. Server generates ids with the TXN- prefix.
2. `POST /transactions/import`: body `{ fileName, rows }`; re-validate every row server-side (date parse via `parseLooseDate`, amount > 0, type, required fields), skip invalid, skip or flag duplicates (query param `skipDuplicates=true|false`), create an ImportJob, return `{ imported, duplicates, invalid, issues: [{row, reason}] }`. Max 5,000 rows.
3. Clients, projects (+ `POST /projects/:id/time-entries` that moves hours from unassignedHours like the frontend does), employees, contractor bills, recurring costs (+ review), loans, financing offers, saved scenarios — create/update/delete exactly as listed in SPEC §7, with Zod schemas mirroring src/lib/types.ts.
4. Invoices: POST (Draft, next INV-#### number per workspace, currency = workspace currency, channel PayPal by default (Bank transfer optional), validate line items and dueDate >= issueDate), PATCH (Draft: any field; Sent: only expectedDelayOverride and notes; editing a Draft marks its open approvals Stale), DELETE (Draft only), `POST /invoices/:id/issue` (only for channel Bank transfer — PayPal invoices must go through PayPal approval).
5. Computed (read-only, via loadState + core.ts): `GET /cashflow/forecast`, `GET /dashboard/summary`, `GET /briefing`. No duplicated math.
6. `POST /admin/reset-demo` (Owner only, only when ALLOW_DEMO_RESET=true) reusing the seed logic for the caller's workspace.
7. Every mutation: permission check in the service, audit event, Zod validation, problem+json errors.
8. Tests for each module: happy path, validation errors, permission denials, workspace isolation, transaction rules (verified immutable, invoice-linked undeletable, future date rejected, duplicate → Review), import counts, invoice edit rules.
9. Update docs/backend/PROGRESS.md.

Report: files changed, commands + output, tests, deviations, open questions.
```

---

## Phase 4 — Approvals, PayPal Sandbox, payments, webhook (the money path)

```
Read docs/backend/SPEC.md §4.1 and §8 very carefully. Continue from docs/backend/PROGRESS.md. This phase is the most important — correctness over speed.

Task:
1. `integrations/paypal`: interface `PayPalGateway` { createDraftInvoice, sendInvoice, getInvoice, remindInvoice, searchInvoiceByNumber, verifyWebhookSignature }. Real implementation (fetch, OAuth2 client-credentials with cached token, retries per SPEC §8.3, audit of method/path/status/debug_id, never log tokens). In-memory fake (`fake.ts`) with test helpers like `markPaid(paypalId, amount)` and failure injection. Choose by PAYPAL_MODE (sandbox|fake).
2. Approvals module (SPEC §8.1, §8.2): `GET /approvals`, `POST /approvals` (server builds recipient/amount/currency/steps/draft from DB records; computes payloadHash; idempotencyKey kind-refId-attempt; one open approval per kind+refId), `POST /approvals/:id/approve` (row lock, status check, canApprove with amount and managerApprovalLimit, payloadHash recheck → Stale, then executor outside the DB transaction, result in a second transaction), `POST /approvals/:id/reject`, `POST /approvals/:id/confirm-transfer`. Executors for all four kinds exactly as SPEC §8.2. `paypal_send_invoice` must search-before-create and persist paypalInvoiceId before calling send. Only PayPal-channel invoices with a client email are eligible.
3. Payments module (SPEC §8.4): `reconcileInvoice(workspaceId, invoiceId)` used by `POST /invoices/:id/paypal/sync` and the webhook; `POST /invoices/:id/payments` for manual bank receipts (reference required). One DB transaction for payment event + transaction + invoice status. Withdraw pending reminders on Paid/Cancelled.
4. Webhook (SPEC §8.5): raw-body route, store WebhookEvent first (replay = no-op), verify signature, reconcile only if verified, always 2xx after storing.
5. A manual script `server/scripts/paypal-smoke.ts` (npm run paypal:smoke) that, using real sandbox credentials from .env: gets a token, creates + sends one USD test invoice with invoice_number "SMOKE-<timestamp>", GETs it and prints status + payer URL. It must refuse to run unless PAYPAL_ENV=sandbox.
6. Tests with the fake gateway: send happy path → invoice Sent + approval Verified; FinanceManager blocked above $6,000; Viewer blocked; stale payloadHash; two concurrent approves → exactly one PayPal create; crash between create and send → retry recovers via search, no duplicate; sync PAID → exactly one PaymentEvent and one Transaction (Verified), repeat sync → no duplicates; PAYMENT_PENDING → nothing recorded; manual payment requires reference; webhook bad signature → stored, not processed; duplicate webhook id → no-op; paid invoice withdraws pending reminder approvals.
7. Update docs/backend/PROGRESS.md, including the exact smoke-script output (with secrets removed).

Report: files changed, commands + output, tests, smoke-script result, deviations, open questions.
```

---

## Phase 5 — Frontend hosted mode (connect the UI to the API)

```
Read docs/backend/SPEC.md §6 and §11, AGENTS.md, and src/lib/store.tsx fully. Continue from docs/backend/PROGRESS.md. Keep demo mode (no VITE_API_URL) working exactly as before — this is a hard requirement.

Task:
1. `src/lib/api.ts`: typed client for every endpoint the UI needs; base URL from import.meta.env.VITE_API_URL; token + workspace id kept in sessionStorage; sends Authorization, X-Workspace-Id and an Idempotency-Key (crypto.randomUUID()) on mutations; parses problem+json into an ApiError with a readable message.
2. `src/lib/store.tsx`: add `mode: "demo" | "hosted"`, `loading`, `error`, `refresh()`. In hosted mode: load state from GET /workspace/state after login, never write financial data to localStorage, and make every store action (addTransaction, requestApproval, prepareReminder, requestPayPalSend, requestContractorPayment, requestCancelSubscription, approve, reject, confirmContractorPayment, checkPayPalStatus, recordManualPayment, markSentManually, reset, log) call the API and then refresh(). `simulatePayerPayment` is not available in hosted mode.
3. Replace every page-level `update((d) => ...)` that changes persistent data with an API call in hosted mode (search the code: grep "update((" in src/pages and src/components — Auth, Approvals, Briefing, CashFlow, Expenses, Financing, Invoices, Loans, Payroll, Projects, Settings, Simulator, Transactions, finance-ui). Add small store methods so pages don't call fetch directly. Copilot chat history stays local in both modes.
4. Auth page: in hosted mode, the login form calls /auth/login and shows API errors; "Explore the demo" logs in nothing and only works in demo mode; sign-up/register show "Accounts are created by the workspace owner in this prototype" in hosted mode. Add a sign-out that clears the session.
5. Hide the role switchers in hosted mode (Approvals tier cards read-only, Settings "Acting as (demo)" hidden); show the real role from the membership.
6. Invoice drawer in hosted mode: remove "Simulate client payment"; show the PayPal payer link with the hint "Pay it in the PayPal sandbox with your sandbox personal account, then click Verify payment status".
7. Honest labels: in hosted mode, Settings → Integrations shows the real PayPal mode, and nothing claims an API call that did not happen.
8. Show a loading state while the workspace loads and a readable error + Retry button if the API is unreachable.
9. Verify: `npx tsc --noEmit -p .` at the root passes; `npm run build` passes; run the app in demo mode and hosted mode and walk through: login as owner → create USD invoice → request PayPal send → approve → pay on the sandbox payer page → Verify payment status → invoice Paid + ledger entry + audit trail. Repeat approve as finance@ for an amount above $6,000 → blocked.
10. Update docs/backend/PROGRESS.md.

Report: files changed, what you tested manually in both modes, anything not wired yet, deviations, open questions.
```

---

## Phase 6 — Hardening, docs, deploy, submission evidence

```
Continue from docs/backend/PROGRESS.md. Read docs/backend/SPEC.md §9 and §10.

Task:
1. Fill any missing tests from SPEC §10 (engine golden test with frozen time, permission matrix for every mutating route, workspace isolation).
2. Serve the built frontend from Fastify in production (@fastify/static for ../dist with SPA fallback), so one Render web service hosts everything on one origin.
3. `render.yaml` (web service: build = install + prisma migrate deploy + frontend build + server build; start = node server/dist/index.js; health check /api/v1/health). Document every env var in the README.
4. Root `README.md`: what CentsAI is, architecture diagram (mermaid), how to run locally (demo mode and hosted mode), demo credentials (from the seed's SEED_DEMO_PASSWORD you set), PayPal sandbox steps, test commands, known limitations, licence.
5. `docs/SECURITY.md` (FinTechathon security self-assessment): permission tiers and limits, approval state machine and payload binding, verify-before-record, idempotency, audit trail, secrets handling, webhook verification, rate limits, known risks and what is still simulated.
6. `docs/OPERATION_LOGS.md`: how to export sandbox operation logs (audit CSV + PayPal invoice ids) as execution evidence.
7. Run the full test suite and a production build; update docs/backend/PROGRESS.md.

Report: files changed, test totals, deployed URL (if done), remaining risks.
```

---

## Review checklist (what I will check after each phase)
- Money math only via `src/lib/finance.ts`; no duplicated formulas on the server.
- Every route: auth → membership → Zod → service permission check → audit.
- No secret in source, logs, audit details, or `VITE_*`.
- PayPal writes only from the approvals executor; nothing paid without `GET … PAID` or a bank reference.
- Idempotency and uniqueness: no double invoices, no double payments, replayed webhooks are no-ops.
- Demo mode unchanged.
- Tests actually assert behaviour (not just "returns 200").
