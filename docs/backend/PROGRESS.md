# Backend progress log

Each phase appends a section: date, what changed (files), commands run and results, tests, deviations from `SPEC.md`, open questions.

## Phase 0 — setup
- [x] Node 22 installed (v22.23.3 via nvm; dependencies reinstalled with pnpm; `npm run build` passes on Vite 8)
- [x] Git repo initialised with MIT LICENSE and README (remote: github.com/nabinkoirala452/Cents-AI) — pushed
- [x] Supabase Postgres 17 reachable from `server/.env` (Session pooler, verified connection)
- [x] PayPal Sandbox app created; OAuth token verified with invoicing scope; personal payer email set in `server/.env`

## Backend foundation — 2026-10-17
- Added the Node 22 ESM Fastify server package, strict TypeScript setup, validated environment configuration, shared finance-core re-exports, security plugins, problem+json handling, and the health endpoint.
- Added the complete Prisma data model, demo seed, and DB-to-frontend State adapter. No auth or business routes were added.
- Added DB integration-test scaffolding that migrates a temporary schema derived from `DATABASE_URL`, then drops it; added setup documentation and ignored backend secrets/build output.
- The initial Prisma migration and follow-up raw-SQL migration were applied to the configured Supabase database. The second migration adds the partial unique open-approval index and append-only audit trigger.
- The seed creates all `createSeed()` records plus the Owner, FinanceManager (Neha Shah), and Viewer (Mina Rao) demo users. It is repeatable: mutable records refresh, while append-only audit rows are retained and duplicate seed IDs are skipped. The State adapter labels the original demo audit entries as sample history rather than asserting that simulated operations actually occurred.
- **Validation passed:** `npm run db:migrate` (already in sync on final run); `npm run db:seed` (Demo workspace seeded); `npm test` (2 files, 3 tests passed, including State financial parity, health/error response, partial approval uniqueness, and append-only audit); `npm run typecheck`; `npm run build`; root `npx tsc --noEmit -p .`.
- **Dependency security:** upgraded Vitest to 4.1.12 and pinned esbuild to 0.28.2. The npm advisory scan still reports three high-severity findings in the Prisma 6 / `deepmerge-ts@7.1.5` chain. Accepted for now as a Prisma CLI development dependency; revisit after the hackathon.
- **Deviations:** seed reruns cannot delete existing audit rows because the required DB trigger forbids deletion; all other demo workspace data is refreshed. Tests use a uniquely named temporary PostgreSQL schema on the configured database connection and drop it after completion.
- **Remaining:** no auth, business routes, PayPal integration, or frontend hosted-mode API client were added; they remain outside this foundation task.

## Phase 1 review fixes — 2026-10-17
- Added schema-scoped RLS enablement, role-guarded revokes for `anon`/`authenticated`, and matching default-privilege revokes; the migration targets `current_schema()` and covers `_prisma_migrations`.
- Changed approval idempotency uniqueness to `(workspaceId, idempotencyKey)`, removed `AuditEvent.updatedAt`, and added deterministic ordering to adapter reads.
- Added the `Stale` frontend approval status and completed-tab display, plus shared canonical JSON/SHA-256 payload hashing for future approval execution.
- Updated local CORS documentation/example to port 8443 and documented refreshing date-relative demo data by reseeding.
- **Validation passed:** `npm run db:migrate` applied both new migrations to the configured database; `npm --prefix server run typecheck`; `npm --prefix server test` (3 files, 7 tests passed, including RLS on every schema table and no `anon` SELECT privileges); root `npx tsc --noEmit -p .`.
- **Notable test coverage:** verified Stale adapter inclusion, deterministic ordering, canonical hash behavior, workspace-scoped approval key uniqueness, audit append-only trigger, and RLS coverage including `_prisma_migrations`.
- **Accepted finding:** Prisma 6 CLI dependency npm audit finding; revisit after the hackathon.

## USD workspace currency — 2026-10-17
- Migrated the frontend finance model to one workspace currency, defaulting the demo to USD. Removed mixed-currency conversions from the shared finance engine, approval limits, payment recording, copilot assumptions, and UI; formatting now accepts a currency code and uses US-style currency formatting.
- Converted the sample agency and seeded amounts to USD, set Austin, TX, USA as its location, updated client countries and ACH references, made Spring & Co. invoices bank-transfer invoices, and bumped `STATE_VERSION` so local browser data re-seeds. The seed derives opening balance so recorded cash is exactly $81,250.
- Updated invoice creation to default to PayPal while allowing bank transfer, made reporting currency read-only, removed the exchange-rate assumption, and adjusted currency labels, examples, CSV sample values, and amount parsing.
- Added `Workspace.currency`, removed obsolete conversion columns from Prisma, and added migrations for the single-currency workspace model and future supported currency enum values. The Workspace timezone default now follows the US demo (`America/Chicago`). Re-seeded the configured demo workspace without changing `server/.env`.
- Added parity checks for invoice totals, transaction amounts, workspace/client/invoice currencies, plus the existing collection counts and deterministic finance outputs.
- **Demo validation (seeded 2026-10-17):** available cash $81,250; two overdue invoices; conservative 90-day low $11,234 on 2026-11-21 (the second payroll date), below the $12,500 threshold; expected 90-day ending cash $65,642 on 2027-01-15. The dashboard displays “Potential cash shortfall,” and the $5,600/month copilot question answers “Not comfortably in the conservative scenario.” Reset local demo data in Settings and verified these screens in the browser.
- **Validation passed:** root `npx tsc --noEmit -p .`; root `npm run build` (`✓ built in 15.46s`, with the existing large-chunk advisory); server `npm run typecheck`; server `npm test` (3 files, 7 tests passed); server `npm run db:migrate` (currency migrations applied, final run already in sync); server `npm run db:seed` (Demo workspace seeded).
- **Search/deviation:** user-facing source files contain none of the retired currency labels or conversion identifiers. A repository-wide search that excludes `node_modules/`, `docs/`, and `hacakathon_fintech_problem_statment.md` still finds legacy identifiers in the already-applied initial migration and the new migration that must drop those legacy columns. Historical applied migrations and explicit `DROP COLUMN` names were retained rather than rewritten or obscured; no application-source hits remain. No functional deviation from the currency behavior in `SPEC.md`; no open questions.

## Phase 2 — authentication, authorization, audit, idempotency — 2026-10-17
- Added bcrypt-backed login with generic credential failures and a 10/minute/IP limit. Successful login returns the user, workspace memberships, and an HS256 JWT with `sub` and an 8-hour expiry.
- Added request authentication for protected API routes. Every request must provide a valid bearer token and `X-Workspace-Id`; membership is verified per request, non-members receive 404, and the request context includes user, workspace, role, and request ID.
- Added role permission helpers matching the frontend tiers and typed `forbidden_role` errors. Workspace services enforce role requirements themselves: Owner/FinanceManager profile and preference edits; Owner-only manager limit and team roles; all members can replace dismissed insights and view State/audit events.
- Added the `/me`, workspace State/profile/settings, and dismissed-insights endpoints. Profile/settings changes and dismissed-insights updates write append-only audit events in the same database transaction.
- Added scoped audit-event pagination/filtering and CSV export with formula-injection escaping. Added idempotency replay for POST/PATCH/PUT/DELETE requests for 24 hours; reusing a key on another route or from a different authenticated user/role returns 409.
- Updated `server/README.md` with authentication headers, role update shape, audit endpoints, error behavior, and idempotency behavior.
- **Validation passed:** from `server/`, `npm run typecheck`; `npm test -- --reporter=dot` (4 test files, 9 tests passed; includes login success/failure, token and membership checks, role matrix, audit append-only update/delete rejection, CSV escaping, and idempotency replay/conflict). From the repository root, `npx tsc --noEmit -p .` passed.
- No Prisma schema changes were needed, so migrations were not run. No deviations from the requested Phase 2 behavior; no open questions.

## Phase 3 — record routes and computed reads — 2026-10-17
- Added workspace-scoped CRUD routes and services for transactions, clients, projects/time entries, invoices, employees, contractor bills, recurring costs/review, loans, financing offers, and saved scenarios. Mutations validate with Zod, enforce permissions in the service, and append audit events transactionally.
- Added transaction import with per-row server validation, a 5,000-row limit, duplicate skip/flag behavior, ImportJob persistence, and imported/duplicates/invalid counts. Transaction IDs use `TXN-`; workspace-local today bounds transaction dates; duplicate transactions are created in Review with a reason.
- Added invoice creation with workspace currency and concurrency-safe `INV-####` allocation; enforced Draft/Sent editing rules, stale open approvals after Draft edits, Draft-only deletion, and Bank-transfer-only issuing outside the PayPal approval flow.
- Preserved approval boundaries: Verified transactions cannot have financial fields edited or be deleted, invoice-linked transactions cannot be deleted, contractor bills cannot be marked Paid, recurring costs cannot be cancelled through these routes, and PayPal invoices cannot be issued directly.
- Added forecast, dashboard summary, and briefing read endpoints backed by `loadState` and shared `core.ts` finance functions. Added Owner-only demo reset gated by `ALLOW_DEMO_RESET=true`, reusing the demo seed while retaining workspace identity and append-only audit history.
- Updated `server/README.md`; registered the records routes in `server/src/app.ts`; added `server/test/records.test.ts`; configured Vitest to run files serially with a 120-second test timeout after parallel runs timed out against the configured database pooler.
- **Validation passed:** `npm --prefix server run typecheck`; `npm --prefix server run build`; `npm --prefix server test` (5 files, 15 tests passed); root `npx tsc --noEmit -p .`; `git diff --check`.
- No Prisma schema changes or migrations were needed. The requested approvals, PayPal, payments, and webhooks routes remain out of scope for this phase. No open questions.

## Phase 2 review fixes — 2026-10-17
- Stopped seeding synthetic audit history; sample approvals remain. Removed the `loadState()` relabelling hack so audit records now reflect their stored event evidence.
- Added and applied `20261017180000_remove_fake_demo_audit`, which temporarily disables the append-only trigger only to delete `AU-2` through `AU-9` for `centsai-demo`, then re-enables the trigger.
- Changed idempotency to reserve a key with status `0` before route execution. Concurrent duplicate requests receive `idempotency_in_progress`; completed responses replay for 24 hours; responses with status >=500 remove the reservation so retry is possible.
- Hardened login with a fixed dummy bcrypt hash for unknown emails, successful `Signed in` audit events in each member workspace, and failed-sign-in warnings containing only a SHA-256 hash of the normalized email.
- Validated workspace timezone names as IANA zones and website values as empty or HTTP(S) URLs.
- **Validation passed:** `cd server && npm run typecheck`; `cd server && npm test -- --reporter=dot` (4 files, 9 tests passed, including empty seeded audit history, no fake PayPal evidence in API/CSV, successful sign-in audit entries, failed-login hash logging, concurrent idempotency reservation, 500 retry, and validation rejection); root `npx tsc --noEmit -p .`; `cd server && npm run db:migrate` (new migration applied; final run already in sync); `cd server && npm run db:seed` (Demo workspace seeded).
- Confirmed the configured demo workspace has no remaining PayPal/GET claims. It has one genuine earlier settings-update event, which was retained as real append-only evidence; the seed does not add audit rows.
- `server/.env` was not overwritten. No deviations or open questions.

## Phase 3 review fixes — 2026-10-17
- Updated `GET /cashflow/forecast` to validate comma-separated scenario names, return the requested selection, reject invalid/duplicate names, and retain the all-scenario default.
- Changed bodyless-route validation to accept an omitted body, a zero-byte JSON body, and `{}`. Added route tests for all three forms; the JSON pre-parser adjustment is restricted to explicitly marked bodyless routes.
- Draft invoice PATCH/DELETE now reject with `approval_in_progress` when a related approval is Submitted; only Pending approvals are changed to Stale. Added tests for the Submitted conflict and Pending staleness paths.
- Extracted workspace record replacement into `server/src/lib/demo-seed.ts`; both `prisma/seed.ts` and `resetDemoWorkspace()` now call that shared persistence routine. Reset remains Owner-only and gated by `ALLOW_DEMO_RESET`; it writes the “Demo data reset” audit event and does not delete audit rows.
- **Validation passed:** `npm --prefix server run typecheck`; `npm --prefix server test` (5 files, 15 tests passed); root `npx tsc --noEmit -p .`; `git diff --check`.
- Did not run `db:seed` or reset the shared demo workspace. `server/.env` was not modified. No schema changes, migrations, deviations, or open questions.

## Phase 4 — PayPal, approvals, payments, and webhooks — 2026-10-17
- Added the `PayPalGateway` contract, real PayPal Invoicing v2 client, cached OAuth client-credentials token, retry handling for retryable requests, sanitized method/path/status/`debug_id` logs, and an injectable fake with payment marking and failure injection. `PAYPAL_MODE=fake` selects the fake; sandbox mode selects the real gateway.
- Added approval list/proposal/approve/reject/transfer-confirmation routes and services for all four approval kinds. Proposal inputs are resolved from workspace records; execution checks status, permissions, amount limits, and payload hashes under database row locks, then executes external work outside the initial transaction. PayPal invoice send searches by number before creation and persists its PayPal ID before sending. Reminder approvals are withdrawn when their invoice is paid or cancelled.
- Added manual bank receipt recording and PayPal GET-based reconciliation with payment-event/transaction deduplication and transactional invoice updates. Added raw-body webhook storage before signature verification; duplicate event IDs are no-ops, and stored webhook requests receive 2xx even when verification fails.
- Added the sandbox-only `server/scripts/paypal-smoke.ts` and `paypal:smoke` script. The first sandbox attempt created a draft but exposed that PayPal's create response can contain only a resource link, not an invoice ID. The real gateway now recovers the ID by searching for the invoice number; a mocked regression test covers this response shape.
- **Validation passed:** `npm --prefix server run typecheck`; `npm --prefix server run build`; `npm --prefix server test` (7 files, 22 tests passed in 246.52s); root `npx tsc --noEmit -p .`.
- **Sandbox smoke run:** the corrected script completed OAuth, create, search recovery, send, and GET successfully (HTTP 200/201/200/200/200; invoice status `SENT`). Exact script output, with the external payer link unavailable from the Sandbox API response:
  ```
  invoice_number: SMOKE-1792260376124
  status: SENT
  payer_url: (not provided)
  ```
  The PayPal GET response exposed no payer-view link, so no URL was fabricated. The first attempt left one unsent Sandbox draft before the response-shape recovery was added. The later review-fix smoke run below resolved the payer-view URL question.
- No schema migrations at this point in Phase 4; the review-fix section below records the subsequent migration and SPEC update.

## Phase 4 review fixes — 2026-10-17
- Added `Invoice.paypalInvoiceNumber` and migration `20261017200000_paypal_invoice_identity`. PayPal invoice numbers are generated once with workspace/random suffixes, persisted before provider calls, reused on retries, and collision-checked against total, currency, and recipient email before linking search results.
- Aligned the gateway and fake with PayPal response shapes: create requests ask for representation, self-link IDs are parsed, the payer URL comes from `detail.metadata.recipient_view_url`, only `PAYPAL` payment transactions are accepted, date-only payment dates remain unchanged, and a 401 clears the cached token and retries once. The fake responses pass through the shared parser.
- Reconciliation now marks an invoice Paid only when persisted PayPal receipts cover its total. A short or absent receipt set leaves it Sent and records a warning. PayPal errors map to safe problem+json responses, and sync failures record the provider debug ID.
- PayPal calls are captured per request, logged with Fastify/Pino, and written as audit events in the result transaction. Reconciliation audit events use the requesting member or “PayPal webhook” as actor.
- Added retry for aged Submitted approvals, reminder-draft support, retryable webhook verification/reconciliation failures, a 64 KB webhook limit and malformed-body rejection, workspace-local date validation, and UTC date handling for reminder/contractor-payment records. Future demo seeds no longer claim invented PayPal IDs or payer URLs.
- Updated SPEC §8 and `server/README.md` for the collision-resistant invoice number and retry behavior. The SPEC update was approved to resolve the previous raw-invoice-ID search requirement.
- **Validation passed:** `npm --prefix server run typecheck`; `npm --prefix server test -- test/money-path.test.ts` (11 tests); `npm --prefix server test` (7 files, 31 tests passed in 282.06s); `npm --prefix server run build`; root `npx tsc --noEmit -p .`; `npm --prefix server run db:migrate` (PayPal invoice identity migration applied; schema in sync).
- **Sandbox smoke passed:** `npm --prefix server run paypal:smoke` created, sent, and fetched one USD Sandbox invoice. PayPal returned the ID in the create response (no search call); the GET returned a real payer URL. Sanitized script output:
  ```
  invoice_number: SMOKE-1792263444679
  status: SENT
  payer_url: https://www.sandbox.paypal.com/invoice/p/#A2DVTKQSL99U6MQS
  ```
- No `db:seed` or demo reset was run, and `server/.env` was not modified. The standalone validation orchestrator timed out during its full-test step; the direct full backend test command completed successfully. No open questions remain.

## Phase 4 round-2 fixes — 2026-10-18
- PayPal approval search recovery now fetches every search result with an ID before validating invoice total, currency, and recipient. Create-failure recovery follows the same GET-first rule. The fake gateway returns only the search-summary fields, so send-failure recovery exercises this path.
- PayPal reconciliation now sets `Paid` and `paidDate` only when the invoice first becomes Paid, deriving its paid date from the latest stored PayPal payment's ledger transaction. Repeat syncs preserve the original date and write `Status checked`; `Payment verified` is emitted only for newly recorded payments or a newly Paid invoice.
- Added regression assertions for partial search-result recovery, repeat-sync `paidDate` preservation, and audit-action counts.
- **Validation passed:** `npm --prefix server run typecheck`; `npm --prefix server test -- test/money-path.test.ts` (1 file, 11 tests passed); `npm --prefix server test` (7 files, 31 tests passed); root `npx tsc --noEmit -p .`.
- No `db:seed` or demo reset was run, and `server/.env` was not modified. No schema migration or open questions.
