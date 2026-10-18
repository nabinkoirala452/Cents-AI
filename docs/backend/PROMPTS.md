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

## Phase 3 fixes — from review (small; do before Phase 4)

```
Phase 3 review fixes. Read docs/backend/PROGRESS.md first. Do not overwrite server/.env. Do not run db:seed or reset the shared demo workspace.

1. GET /cashflow/forecast: accept a comma-separated scenario list as the SPEC says (`scenario=expected,conservative` currently returns 400). Default = all three. Validate each item.
2. Bodyless POST/DELETE routes (e.g. POST /admin/reset-demo, POST /invoices/:id/issue, DELETE …): accept a missing body, an empty body and `{}` alike. Today a POST with no body is rejected with 400. Add tests for both forms.
3. Invoice draft edit/delete must not touch an approval that is already executing: if the invoice has an approval in status "Submitted", reject the PATCH/DELETE with 409 code "approval_in_progress". Only "Pending" approvals become "Stale". Same rule anywhere else Stale is set. Test both cases.
4. resetDemoWorkspace() re-implements the seed (~170 lines). Refactor so the admin reset and prisma/seed.ts call ONE shared function (e.g. server/src/lib/demo-seed.ts) for the workspace's records, so they cannot drift. Keep: Owner-only, ALLOW_DEMO_RESET guard, audit event "Demo data reset", audit rows never deleted.
5. Run server typecheck + tests and root `npx tsc --noEmit -p .`. Update docs/backend/PROGRESS.md and give me the Report.
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

## Phase 4 fixes — from review (do before Phase 5)

```
Phase 4 review fixes — the money path. Read docs/backend/PROGRESS.md and SPEC §8 first. Do not overwrite server/.env. Do not run db:seed or reset the shared demo workspace. Correctness over speed.

1. CRITICAL — PayPal invoice-number collisions. Today invoice_number = our invoice id (e.g. INV-1061) and search-before-create links whatever PayPal invoice has that number. The sandbox merchant account is shared by the whole team and survives every db:seed / demo reset, and after a reset INV numbers start again, so a new INV-1061 would be linked to an OLD PayPal invoice (wrong client or amount, maybe already PAID) and a sync could then mark it Paid. Fix:
   - Add `Invoice.paypalInvoiceNumber String?` (migration; keep RLS). When the paypal_send_invoice executor first runs for an invoice and the column is empty, generate `<invoice id>-<workspace id first 6 chars>-<6 random base36 chars>`, PERSIST IT before any PayPal call, and reuse it on every later attempt or approval for that invoice. Search and create use only this number.
   - Before linking a search result, check that its total, currency and recipient email match our invoice; if they don't, fail the approval with "PayPal invoice number already used by a different invoice" (never link it).
   - Test: two workspaces (or a reset) each with INV-1061 → two separate PayPal invoices in the fake; a pre-existing fake invoice with the same number but a different amount is never linked.

2. CRITICAL — never mark Paid without the money in the ledger. reconcilePayPalStatus sets fullyPaid when status === "PAID" even if no payment was parsed (parsePayment silently drops payments it can't read), so you get a Paid invoice with no Transaction and the cash balance is wrong. Rule: mark the invoice Paid only when the sum of its stored PayPal PaymentEvents (existing + inserted in this call) is >= the invoice total. If PayPal says PAID but that sum is short → leave the invoice Sent, set paypalStatus, write an audit event (outcome "warning", "PayPal reports PAID but payment details could not be verified") and return a result that says so. Test with a fake PAID invoice that has no payments.

3. Match PayPal's real response shapes (the fake currently mirrors our own types, not PayPal):
   - Create: send the header `Prefer: return=representation` so the 201 contains the full invoice; if it still only has `href`, take the id from the last path segment of the `rel: "self"` link; keep search as the last fallback.
   - Payer URL: PayPal v2 puts it at `detail.metadata.recipient_view_url` (not in `links`). Read it there in parseInvoice, persist it as paypalPayerUrl. This answers the Phase 4 open question.
   - Payments: real GET shape is `payments: { paid_amount, transactions: [{ payment_id, type, payment_date, method, amount: { currency_code, value } }] }`. Only record transactions with `type === "PAYPAL"` (an `EXTERNAL` entry is one the merchant typed in by hand in PayPal — not verified money; ignore it and treat status MARKED_AS_PAID as "not verified", like PAYMENT_PENDING). `payment_date` can be date-only ("2026-10-17"): if so, use it directly as the Transaction date instead of new Date() + timezone conversion (that shifts it a day back in America/Chicago).
   - Make FakePayPalGateway.getInvoice return this raw PayPal JSON and run it through the SAME parser as the real gateway, so tests cover the parser. Add unit tests in paypal-gateway.test.ts with real-shaped fixtures: create with representation, create with only href, GET with recipient_view_url, PAYPAL + EXTERNAL transactions, date-only payment_date.
   - Token: on a 401 from any API call, clear the cached token and retry that call once.

4. Errors: a PayPalError reaching a route currently becomes a 500 INTERNAL_ERROR. Map it in the error handler to 502 problem+json code "paypal_error" with detail "PayPal request failed (HTTP <status>) · debug_id <id>" — no response body, no token. A PayPal 404 on GET → 409 code "paypal_invoice_not_found". Sync failures write an audit event (outcome "error") with the debug_id.

5. Operation-log evidence (FinTechathon requirement): SPEC §8.3 says audit every PayPal call, but calls only go to console.info. Make the gateway logger collect calls per request, and have the executor / reconcile write one AuditEvent per PayPal call (action "PayPal API call", detail "POST /v2/invoicing/invoices → 201 · debug_id …", ref = our invoice id) in the same DB transaction as the result. Use the Fastify/pino logger instead of console.info. In reconcileInvoice, write the "Payment verified" / "Status checked" audit INSIDE the reconcile transaction and use the calling user as actor ("Verify payment status by <name>"); for webhooks the actor is "PayPal webhook".

6. Stuck Submitted approvals: if the process dies after an approval is set to Submitted, it stays Submitted for ever — the partial unique index then blocks a new approval and Draft edits get approval_in_progress. Add `POST /approvals/:id/retry` (same permission rule as approve): allowed only for kinds paypal_send_invoice / send_reminder / cancel_subscription that are Submitted with decidedAt older than 2 minutes; it re-runs the executor (safe because of the persisted paypalInvoiceNumber + search-before-create) and writes the result exactly like approve. Test: approval forced to Submitted with an old decidedAt → retry → exactly one PayPal invoice, approval Verified.

7. Webhook retries:
   - If signature verification ERRORS (network/5xx from PayPal, missing PAYPAL_WEBHOOK_ID) or reconcile throws, return 503 so PayPal retries delivery. Keep 200 only for: stored + verified + processed, a definitive signature FAILURE, or a true duplicate.
   - A repeat delivery of a stored event is a no-op ONLY if that event was processed successfully or definitively failed verification; otherwise verify and process it again.
   - Don't store bodies that aren't JSON or that have no `id` / `event_type`: reply 400 and store nothing. Lower the webhook bodyLimit to 64 KB.
   - Build the verify-webhook-signature request body by inserting the raw body string as-is (`'{"auth_algo":…,"webhook_id":…,"webhook_event":' + rawBody + '}'`) instead of JSON.parse → JSON.stringify, which can change the bytes and break signature checks.
   - Tests: verification error → 503, then the retry is processed; reconcile error → 503; non-JSON body → 400 and no row.

8. Dates: the reminder date, contractor bill paidDate and its transaction date use the UTC date (`toISOString().slice(0,10)`); use the workspace-local today (one shared helper in server/src/lib, reused by Phase 3 transactions and payments/service.ts localDate — no copies). Manual payment `date` must be <= workspace today and >= invoice issueDate (400 otherwise).

9. Seeded fake PayPal ids: the server demo seed stores invented PayPal ids (INV2-H4ZN-…) and payer URLs on seeded invoices. In sandbox mode, "Verify payment status" on them calls PayPal for invoices that don't exist, and the data claims sends that never happened (SPEC §9). In server/src/lib/demo-seed.ts only (leave the frontend demo seed alone): keep channel PayPal and status, but store paypalInvoiceId, paypalInvoiceNumber, paypalStatus, paypalPayerUrl, paypalSentAt and paypalLastCheckedAt as null, and use the invoice id as the reference on the seeded income transactions. Update the state-parity test accordingly. Don't reseed now — this takes effect at the next seed/reset (demo day).

10. Reminder draft: Phase 5 sends the reminder text the user edited. Let POST /approvals accept optional `draft` (string, max 2000) only for kind send_reminder (400 for other kinds); use it instead of the default text, include it in payloadHash, and pass it to PayPal as the `note` of the remind call.

11. Small: withdrawPendingReminders takes a reason — "Withdrawn automatically — invoice was paid" / "… invoice was cancelled". Delete server/.tsupgrader/ (tool output, must not be committed) and remove its mention from PROGRESS.md.

12. Run server typecheck + tests, root `npx tsc --noEmit -p .`, `npm --prefix server run db:migrate`, then `npm run paypal:smoke` again (it should now print a real payer URL and get the id from the create response without a search). Update docs/backend/PROGRESS.md and give me the Report, including the smoke output.
```

---

## Phase 4 fixes, round 2 (small — before Phase 5)

```
Phase 4 round-2 fixes. Read docs/backend/PROGRESS.md first. Do not overwrite server/.env. Do not run db:seed or reset the shared demo workspace.

1. Search recovery ordering (approvals/service.ts executeApproval): a search result is checked with matchesPayPalInvoice BEFORE it is fetched in full, so if PayPal's search item lacks amount or primary_recipients the crash-recovery path wrongly fails with "already used by a different invoice". Whenever search (or create-failure recovery) returns an invoice with an id, GET it by id first and run matchesPayPalInvoice on the GET result only. Make FakePayPalGateway.searchInvoiceByNumber return a partial item (id, status, detail.invoice_number only) so tests cover this; the existing "send failure → recovery" and "aged Submitted retry" tests must still pass.
2. paidDate drift (payments/service.ts reconcilePayPalStatus): every repeat sync of an already-Paid invoice rewrites paidDate to today, which corrupts the client-delay numbers in the finance engine. Set status Paid + paidDate only when the invoice is not already Paid, and use the latest stored PayPal payment's transaction date as paidDate (not the check date). Audit "Payment verified" only when payments were inserted or the invoice just became Paid; otherwise "Status checked". Test: sync twice on a paid invoice → paidDate unchanged, one "Payment verified" audit.
3. Run server typecheck + tests and root `npx tsc --noEmit -p .`. Update docs/backend/PROGRESS.md and give me the Report.
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

## Phase 5 fixes — from review (do before Phase 6)

```
Phase 5 review fixes — hosted mode. Read docs/backend/PROGRESS.md, SPEC §11 and src/lib/store.tsx, src/App.tsx first. Demo mode (no VITE_API_URL) must stay exactly as before. Do not overwrite server/.env. Do not run db:seed or reset the shared demo workspace. Do not commit .tsupgrader/.

1. CRITICAL — every hosted refresh unmounts the whole app. `Router` in src/App.tsx returns the "Loading your workspace…" screen whenever `store.loading` is true, and `refresh()` sets loading=true on every call (after every mutation and every log). Result: each save flashes a spinner, remounts AppShell, and closes open drawers/modals/forms. Fix: split `loading` into `initialLoading` (true only until the FIRST successful hydrate after login/page load) and a silent background refresh that never touches it. Full-screen loading shows only for initialLoading.

2. CRITICAL — mutation errors take over the whole app. hostedMutation and `update` call `setError(text)`, and Router replaces the app with "Your workspace could not be loaded" whenever `store.error` is set. A 403 on approve, a 400 validation error, or a 409 would blank the UI (and `update` leaves it stuck there because it never refreshes). Fix: keep two separate things — `loadError` (hydrate/refresh failed → full-screen error + Retry, only while there is no usable state or the API is unreachable) and per-action errors, which are returned to the caller (`{ ok:false, message }` / thrown) and shown as a toast or inline message. Mutation errors must never set the full-screen error.

3. HIGH — `update()` in hosted mode swallows failures. It diffs before/after state and fires many API calls (`persistHostedChanges`), catches everything, and RESOLVES — so pages show success toasts ("Scenario saved", "Loan added") even when the API rejected the change, and a mid-way failure leaves a partial write (non-atomic). Fix: replace the diff engine with explicit store methods for the mutations the UI actually performs, each calling exactly one endpoint, returning Result, and followed by a silent refresh(): updateSettings, updateWorkspace, saveAssumptions (safetyThreshold + invoice expectedDelayOverride), dismissInsight / restoreInsights, addClient/patchClient, addProject/assignHours, addEmployee/patchEmployee/removeEmployee, addContractorBill, addRecurringCost/patchRecurringCost/markRecurringReviewed, addLoan/patchLoan, addOffer/removeOffer, saveScenario/deleteScenario, confirmTransaction (Review → Recorded), importTransactions, patchInvoice/deleteInvoice. Update the pages to await them and show result.message on failure. `store.update` stays for demo mode and for local-only data (chat). If you keep any generic path in hosted mode, it must THROW on failure and on any state change it cannot persist, never silently resolve. Grep for every remaining `update((` in src/pages and src/components and list in PROGRESS.md which method replaced each.

4. HIGH — 401 handling. If the JWT is expired/invalid, apiFetch throws and the user gets a permanent error screen whose Retry can never succeed. In apiFetch: on 401 for an authenticated call, clear the session, set authenticated=false, and send the user to the login page with the message "Your session expired. Sign in again." Do this through a small listener/event so api.ts stays free of React.

5. MEDIUM — hosted login form is prefilled with demo values (alex@meridian.example / demopassword) because of `defaultValue`. In hosted mode the fields must be empty with neutral placeholders (no demo credentials in the bundle). Also show the sign-out control and the signed-in user's name + role (from the membership) in the sidebar/footer in hosted mode.

6. MEDIUM — hosted `log()` is a fake: it calls `api.auditEvents("limit=1")` and then a full refresh just to look busy. The server writes audit events itself. In hosted mode make `log()` a no-op that resolves immediately, and remove the extra `await log(...)` refreshes. Audit lists load from the state refresh (or /audit-events) only. Nothing in the UI may imply the client wrote an audit row.

7. MEDIUM — Approvals: `allowed = mode === "hosted" ? true : permissionAllowed` forces the Approve button on for Finance Managers above their limit and Viewers. Use the real `permissionAllowed` (settings.role + managerApprovalLimit come from the server state) in both modes and keep the server 403 as the authority; the over-limit note should say "Owner approval required". If the product wants to demonstrate the server denial, do it with a visible "Try anyway (server will refuse)" secondary action, not by silently enabling Approve.

8. MEDIUM — Reset: in hosted mode, "Reset demo data" wipes the SHARED workspace for the whole team. Show it only to Owners, require typing RESET to confirm, and make the confirm text say it affects every teammate and the PayPal-linked invoices stay in the PayPal sandbox. Ensure the backend still refuses it unless the server's demo-reset flag is on (add a test if one does not exist).

9. LOW — `useState(() => hostedMode ? createSeed() : load())` hydrates hosted mode with the fictional seed workspace, which can flash on screen and gets restored on sign-out. Use an empty State (add `emptyState()` to seed.ts or types) for hosted mode before the first hydrate and after sign-out, and render nothing from it while unauthenticated.

10. LOW — Repo hygiene: `.tsupgrader/` at the repo root is untracked tool output. Delete it and add `.tsupgrader/` to .gitignore (the same lesson as Phase 4). `git status` must not list it.

11. LOW — `loadState`/hosted refresh runs `api.workspaceState()` and `api.health()` together on every refresh; fetch health once at startup (paypalMode/paypalEnvironment don't change) and only workspaceState on refresh.

12. Finish the hosted verification by UI, not by hand-made API calls. Start API on 8787 and the frontend with VITE_API_URL=http://localhost:8787 (add the frontend origin to the API's CORS setting in the local .env.example comment if needed). Through the browser: login as owner → create USD invoice → Request PayPal send → Approve → confirm the payer link appears and "Simulate client payment" does not → login as finance@ and approve a >$6,000 item (button disabled or server 403 shown as a toast, app stays usable) → add a transaction, add a client, change the safety threshold and confirm each persists after a hard reload → expire/clear the token and confirm you land on login with the expiry message → stop the API and confirm the Retry screen appears, restart it and Retry works. Then pay INV-1060 on the sandbox payer page with the sandbox personal account (ask me for the credentials, never write them down) and click Verify payment status → Paid + exactly one ledger entry + one payment-verified audit event, and clicking Verify again adds no second ledger entry.

13. Add a few frontend tests if vitest is not set up, set it up minimally (devDependency only, no change to the app build): ApiError parsing of problem+json, Idempotency-Key present on POST and absent on GET, 401 clears the session, and the store's hostedMutation returns ok:false without setting the full-screen loadError.

14. Run root `npx tsc --noEmit -p .`, `npm run build`, server typecheck + full server tests, and confirm demo mode still works (invoice → approve → simulate → verify). Update docs/backend/PROGRESS.md and give me the Report: files changed, what replaced each `update((` call, the UI walkthrough results for both modes, anything still unverified.
```

---

## Phase 5 fixes, round 2 (small — before Phase 6)

```
Phase 5 round-2 fixes. Read docs/backend/PROGRESS.md first. Demo mode must stay unchanged. Do not touch server/.env, run db:seed, reset the shared workspace, or commit.

1. addTransaction in hosted mode throws on API failure (future date, 403 for a Viewer, network error) and Transactions.tsx:381 has no try/catch, so the modal just stays open with no message. Make hosted addTransaction use runHostedMutation-style handling: return the Transaction on success, and on failure either return a Result or have the caller catch and toast the readable ApiError message and keep the form open. Also check every other store method that still returns a bare Promise (createInvoice, importTransactions) has its callers wrapped in try/catch with a toast.

2. Lockfile: root package.json gained vitest but pnpm-lock.yaml was not updated, and the `test` script runs `node server/node_modules/vitest/vitest.mjs` (reaches into server's node_modules). Run `pnpm add -D vitest` at the root so pnpm-lock.yaml is updated, change the script to `vitest run test/frontend.test.ts`, and confirm `pnpm install --frozen-lockfile` succeeds in a clean checkout and `npm test` still passes. Also make sure the server has its own lockfile entries unchanged.

3. Server tests still missing (the suite stayed at 31 tests): add tests for PUT /api/v1/settings/forecast-assumptions — Owner and Finance Manager succeed, Viewer gets 403, negative threshold or non-integer delay returns 400, a non-Sent invoice or unknown id returns 409 and NOTHING is saved (threshold unchanged), duplicate ids 400, and one "Forecast assumptions updated" audit event is written on success only. Add a test that POST /admin/reset-demo is refused for non-Owners and when the demo-reset flag is off. Report the new total.

4. Cleanup: remove the deprecated `createOffer` alias from the Store type/implementation (use addOffer everywhere). Remove the `setCustomApiBase` test hook from production api.ts if vitest can stub import.meta.env / use vi.stubEnv instead; otherwise leave it but mark it test-only with a comment.

5. Hosted UI walkthrough was NOT reported last round. Do it through the browser, not API calls: API on 8787, frontend with VITE_API_URL=http://localhost:8787. (a) owner login → create USD invoice → Request PayPal send → Approve → payer link shown, no "Simulate client payment". (b) login as finance@ and try to approve a >$6,000 item → blocked with "Owner approval required" or a toast from the server 403, app stays usable and keeps your open drawer. (c) add a transaction with a future date → readable error toast, modal stays open; valid transaction → persists after hard reload. (d) change safety threshold in Cash Flow assumptions → persists after reload. (e) delete the token in sessionStorage and click any action → login page with "Your session expired. Sign in again." (f) stop the API → Retry screen; restart → Retry works. (g) Viewer login: all create/edit buttons disabled. Then demo mode regression: invoice → approve → simulate payer → verify → Paid. Ask me for the sandbox payer credentials for the real payment check; never write them down.

6. Run root tsc, `npm run build`, `npm test`, server typecheck and full server tests. Update docs/backend/PROGRESS.md and give me the Report: files changed, new test totals, walkthrough results per step a–g, anything still unverified.
```

---

## Phase 5 fixes, round 3 — found in manual browser testing (before Phase 6)

```
Phase 5 round-3 fixes from manual testing. Read docs/backend/PROGRESS.md first. Demo mode must keep working. Do not touch server/.env, run db:seed, reset the shared workspace, or commit.

0. ALREADY PATCHED by the reviewer — verify and test only: server/src/app.ts registered @fastify/cors without `methods`, so it defaulted to GET,HEAD,POST and the browser blocked every PUT/PATCH/DELETE cross-origin ("Could not reach the CentsAI API: Failed to fetch" on Cash Flow assumptions, settings saves, edits, deletes). I added methods: GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS. Add a test: an OPTIONS preflight from the configured CORS origin for PUT, PATCH and DELETE returns those methods in access-control-allow-methods. Then, in a browser against the running API (restart it first), prove PUT /settings/forecast-assumptions, PATCH a transaction and DELETE a draft invoice succeed from http://localhost:8443.

1. No feedback while working. Every hosted action must show progress and prevent double submits:
   - FormModal (src/components/ui.tsx): let onSubmit return a Promise; while it runs, disable the submit and Cancel buttons, show a spinner and "Saving…" (or a submitLabel-specific busy text such as "Creating invoice…"), ignore a second submit, and keep the modal open with the readable error if it fails.
   - Drawer footer actions, Approvals (Approve / Reject / Confirm transfer), Settings Save, Verify payment status: same busy+disabled pattern via one shared `useAction()` hook returning { run, busy }.
   - Add `pendingRequests` to the store (count of in-flight hosted calls) and show a thin progress bar under the header plus a "Working…" state while > 0, so nothing ever looks frozen.
   - After success always give visible confirmation: toast + the new/changed row highlighted for ~2s (transactions, invoices, approvals).

2. Duplicate transactions on save. Cause: no busy state, so a double click (or Enter + click) sends two POSTs, and apiFetch makes a NEW Idempotency-Key per fetch so the server cannot dedupe them. Fix: (a) busy state above; (b) generate the Idempotency-Key once per user action (per modal open / submit attempt) and pass it into apiFetch via an optional `idempotencyKey` argument, reuse it on retry of the same action; (c) add a test that two identical POSTs with the same key create one row. Also make the duplicate warning visible: when the server flags a transaction "Review", the toast must say "Saved — flagged as a possible duplicate of <id>" and the Transactions list must show the Review badge.

3. Owner shouldn't have to request approval from themselves. New rule (maker-checker):
   - Owner: the primary button on an invoice is "Send via PayPal" (and "Send reminder", "Pay contractor", "Cancel subscription"). One click creates AND approves the request in a single server call. Server: POST /approvals accepts `approveNow: true`, allowed only when ctx.role is Owner (403 otherwise). It runs the SAME pipeline (payloadHash, idempotency, executor, verify-before-record, audit) in one transaction-safe sequence; the approval record is stored with preparedBy = decidedBy = the Owner and audit detail "Auto-approved by Owner (self-requested)". It still appears in Approvals history, never in the Pending tab.
   - Finance Manager: button says "Request approval from Owner"; it creates a Pending approval, shows "Sent to Owner for approval" and the Pending badge/count in the sidebar updates for the Owner. A Finance Manager may approve other people's requests up to the limit, but NEVER their own (server rule: approver !== preparedBy unless Owner; 403 with a clear message). Viewer: buttons disabled.
   - Confirmation dialog before an Owner one-click send shows recipient, amount, currency and "This sends a real PayPal Sandbox invoice to <email>".
   - Tests: Owner approveNow executes and ends Verified with exactly one audit trail; Finance Manager approveNow → 403; FM cannot approve own request; replaying the same Idempotency-Key does not send twice.

4. Reminders must be honest. Today a reminder for a PayPal invoice calls PayPal's remind endpoint (PayPal emails the payer), but for a non-PayPal invoice the server only records "Email draft (not sent)". In the UI: PayPal invoice → label "Send reminder via PayPal (PayPal emails the client)"; bank-transfer invoice → label "Prepare reminder", and after approval show the saved draft with a "Copy text" button and a "Open in email app" mailto: link, plus the note "CentsAI doesn't send email in this prototype". Never show "sent" for an email that was only drafted. Show "Last reminder: date, channel" on the invoice and block a second reminder within 24h unless Owner confirms.

5. Explain money direction in the UI (users are confused): an Invoice is money a CLIENT owes the AGENCY (receivable). In the invoice drawer and the new-invoice modal add one line of plain help: "You are billing <client>. They pay you. Status becomes Paid only after PayPal confirms or you record the bank reference." Rename any "Payments" wording that could mean outgoing money; outgoing money (contractors, payroll, subscriptions) lives in Payroll/Expenses and uses the approval flow.

6. Re-run: server typecheck + full tests, root tsc, build, npm test. Do the hosted browser walkthrough yourself with a working browser (if your browser tool is broken, say so; do NOT mark steps verified from unit tests). Report per step what you actually saw. Update docs/backend/PROGRESS.md.
```

---

## Phase 5 fixes, round 4 — create & send flow + drawer layout (before Phase 6)

```
Phase 5 round-4 fixes from manual testing. Read docs/backend/PROGRESS.md first. Demo mode must keep working. Do not touch server/.env, run db:seed, reset the shared workspace, or commit.

1. BUG — "Create & send via PayPal" flow (src/pages/Invoices.tsx CreateInvoice.onSubmit). Today, in hosted mode it does: createInvoice → close() → onCreated(id) → requestPayPalSend(id, isOwner) in the background. So the modal closes at once and the drawer opens on a Draft invoice with a live "Send via PayPal" button while the real PayPal call is still running with no progress shown. If the owner clicks that button the server answers "already in approval", and a few seconds later the invoice flips to Sent by itself. Fix:
   - Keep the modal OPEN for the whole sequence. Drive the busy label through steps: "Creating invoice…" → "Sending to PayPal…" (add a `busyLabel` state the modal can update, or let onSubmit report steps). Only after BOTH steps finish: close the modal, open the invoice drawer (it must already show status Sent + payer link), toast "INV-xxxx sent via PayPal Sandbox".
   - If create succeeds but the send fails (PayPal error, validation, 403): close the modal, open the drawer on the Draft, and toast "INV-xxxx saved as draft. PayPal send failed: <readable reason>". Do not leave the user guessing and do not create a second invoice on retry.
   - Same pattern for Finance Manager: step label "Creating invoice…" → "Requesting approval…", end with toast "Sent to Owner for approval" and the drawer showing "Awaiting approval AP-xxxx".
   - In the drawer, if the invoice has an open approval (Pending/Submitted) show that state clearly: Owner sees "Sending to PayPal…" with a spinner while Submitted (button disabled), or "Awaiting approval AP-xxxx" with a link to Approvals when Pending. Never show an active Send button that will only fail with "already open". If the server returns the already-open conflict anyway, show "A send is already in progress for this invoice" instead of an error.
   - Make sure createInvoice + send use ONE Idempotency-Key per submit attempt (reuse on retry) so a double click can't create two invoices or two PayPal sends.
   - Add a UI-level test or a manual proof: owner creates an invoice with PayPal + send now → exactly one invoice, one approval (Verified), one PayPal invoice id, drawer shows Sent immediately after the modal closes.

2. Same issue elsewhere — check every place that closes a modal first and fires the real action afterwards (reminder modal, record-payment modal, contractor payment, cancel subscription) and apply the same rule: modal stays open with progress until the action finishes, then show the result.

3. UI — invoice drawer layout (see Invoices.tsx drawer footer and the PayPal card):
   - The footer button "Send reminder via PayPal (PayPal emails the client)" is too long: it overflows the drawer on the left and hides the label. Shorten the label to "Remind via PayPal" (bank-transfer invoices: "Prepare reminder") and move the explanation to small helper text under the footer or a tooltip. Make the footer `display:flex; flex-wrap:wrap; gap:8px; justify-content:flex-end` with `white-space:nowrap` buttons, and verify at 360px, 768px and desktop width that nothing is clipped.
   - In the PayPal card, "Last verified …" overlaps the hint "Pay it in the PayPal sandbox with your sandbox personal account, then click Verify payment status." and the "Payer link". Lay the card out as stacked rows (title/status, invoice id, last verified, payer link, hint) with normal flow and spacing, no absolute positioning. Check light and dark theme.
   - Replace hardcoded Tailwind colours added last round (text-blue-300, text-red-500, bg-blue-500/10, banner-danger utility classes in FormModal and the "You are billing …" help box) with the app's CSS variables/classes so contrast is fine in light theme too.

4. Audit trail for Owner one-click actions (server/src/modules/approvals/service.ts createApproval with approveNow): right now non-contractor approveNow writes only ONE audit row and its detail is replaced with the fixed text "Auto-approved by Owner (self-requested)", dropping the PayPal invoice id/result detail, and no "Approval requested"/"Approved & submitted" rows exist. Write the same rows as the normal flow (Approval requested → Approved & submitted with note "auto-approved by Owner (self-requested)" → the executor's own result row with its original detail). Also extract the execute-and-commit block that is now duplicated between createApproval(approveNow) and runApproval into one shared function so both paths cannot drift. Existing tests must still pass; add an assertion on the audit rows.

5. Run server typecheck + tests, root tsc, build, npm test. This time do the browser flow yourself if your browser tool works; if it does not, say so plainly and do not mark UI steps verified. Update docs/backend/PROGRESS.md and report.
```

---

## Phase 6 — Test gaps (hardening only)

```
Continue from docs/backend/PROGRESS.md. Read docs/backend/SPEC.md §9 and §10. No new features and no UI changes in this phase. Do not touch server/.env, run db:seed, or reset the shared workspace. Do not commit. Use isolated test schemas/workspaces only.

Task: close the gaps against SPEC §10. First list in PROGRESS.md which §10 items already have a test (file + test name) and which do not, then add only the missing ones:
1. Engine golden test: freeze time (vi.setSystemTime), build createSeed(), snapshot key outputs of forecastAll, receivables, buildBriefing, projectStats and loanStatus. Add a second case that proves the server loadState() numbers equal the frontend engine on the same seed.
2. Permission matrix: Viewer / Finance Manager / Owner x EVERY mutating route (POST, PUT, PATCH, DELETE under /api/v1, including approvals approve/reject/retry/confirm-transfer, approveNow, settings, forecast-assumptions, admin/reset-demo, imports, deletes). Drive it from the registered route list so a new route without a matrix entry fails the test. Expected: Viewer 403 everywhere; Finance Manager 403 on owner-only routes and above the limit; Owner 2xx.
3. Workspace isolation: a user of workspace A gets 404 (not 403) for workspace B ids on every id-taking route (invoices, transactions, approvals, clients, projects, employees, loans, scenarios, recurring costs, contractor bills) and cannot read B through list or state endpoints. Also a valid token with a workspace id header the user is not a member of gets 404.
4. Approvals: concurrent double approve executes once; stale payload hash; Finance Manager blocked above the limit; maker-checker (cannot approve own); approveNow replay with the same Idempotency-Key does not execute twice.
5. Security checklist spot tests from SPEC §9: audit CSV export neutralises cells starting with = + - @ tab CR; audit rows cannot be updated or deleted (DB trigger); error responses have no stack trace; login rate limit returns 429 after 10 attempts/min; webhook with a bad signature is rejected and a duplicate webhook is a no-op; no secret appears in /health or error bodies.
6. Run the full server suite, root tsc, build and npm test. Report which previously missing tests were added, the new total, and any real bug the new tests exposed (fix it only if small and tell me; otherwise list it).

Report: coverage table (SPEC §10 item -> test name), new totals, bugs found, files changed. Update docs/backend/PROGRESS.md.
```

---

## Phase 7 — Deploy and submission docs (AFTER the AI layer, before the deadline)

```
Continue from docs/backend/PROGRESS.md. Read docs/backend/SPEC.md §9 and §10.

Task:
1. Serve the built frontend from Fastify in production (@fastify/static for ../dist with SPA fallback), so one Render web service hosts everything on one origin.
2. `render.yaml` (web service: build = install + prisma migrate deploy + frontend build + server build; start = node server/dist/index.js; health check /api/v1/health). Document every env var in the README.
3. Root `README.md`: what CentsAI is, architecture diagram (mermaid), how to run locally (demo mode and hosted mode), demo credentials (from the seed's SEED_DEMO_PASSWORD you set), PayPal sandbox steps, test commands, known limitations, licence.
4. `docs/SECURITY.md` (FinTechathon security self-assessment): permission tiers and limits, approval state machine and payload binding, verify-before-record, idempotency, audit trail, secrets handling, webhook verification, rate limits, known risks and what is still simulated.
5. `docs/OPERATION_LOGS.md`: how to export sandbox operation logs (audit CSV + PayPal invoice ids) as execution evidence.
6. `docs/DEMO_SCRIPT.md`: the exact click path for a 3-minute demo video (owner login -> create invoice -> send via PayPal -> pay on the sandbox payer page -> verify -> Paid + ledger + audit; finance manager over-limit denial).
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
