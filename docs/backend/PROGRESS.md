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

## Frontend hosted-mode integration — 2026-10-18
- Added the typed frontend API client and hosted/demo state handling. Hosted sessions use session storage for auth/workspace selection, load authoritative state from the API, and route financial mutations through the backend; demo persistence remains local. Copilot chat history remains local in both modes.
- Wired hosted login/sign-out, loading/error/retry UI, role-aware controls, invoice send/approval/payment verification, audit export, and server-reported PayPal mode. Added a narrowly scoped server transaction transition so a `Review` transaction can be confirmed as `Recorded`.
- **Validation passed:** root `npx tsc --noEmit -p .`; `npm run build`; `npm --prefix server run typecheck`; `npm --prefix server test -- test/records.test.ts --reporter=dot` (1 file, 6 tests passed); `git diff --check`.
- **Demo-mode browser walkthrough:** logged in through the existing demo flow, created USD invoice `INV-1060` for $6,500, requested and approved PayPal send, simulated payer payment, and verified it. The invoice then displayed `Paid`, the ledger/transaction was recorded, and the invoice detail showed payment-verification history. This exercised the frontend's demo simulation, not a real PayPal Sandbox payment.
- **Hosted-mode walkthrough remains unverified:** the API was not running on port 8787, and a real Sandbox payer payment was not performed. Consequently hosted owner login, real sandbox reconciliation, and the Finance Manager over-$6,000 denial were not manually exercised. No hosted data reset or seed was run.
- Known intentional limitation: loan-readiness checkboxes remain read-only in hosted mode because the API has no persistence field for them; Copilot conversations remain browser-local. No other known unwired page mutation.

## Hosted API verification follow-up — 2026-10-18
- Started the API on port 8787 and verified `/api/v1/health` returned HTTP 200 with PayPal mode/environment `sandbox`. For hosted verification, started a second API process on 8788 with CORS allowing the isolated frontend on port 8446; the original 8787 API remains running.
- The hosted frontend loaded its signed-out login page on port 8446. Browser CORS preflight to the test API returned 204 with the expected allowed origin. Owner authentication against the seeded API succeeded (using the local seed credential without printing it); the frontend login form itself was not submitted.
- Created USD invoice `INV-1060` for $100, requested and approved its PayPal send, and verified PayPal returned `SENT` with a real Sandbox payer URL. Opening the URL rendered the $100 PayPal invoice page. A subsequent PayPal GET-based sync returned `SENT`/unpaid; as expected, the invoice remains Sent and has no ledger payment entry until a payer completes payment. Audit history contains the invoice draft, send, provider-call, and status-check events.
- Authenticated as `finance@centsai.demo` and attempted to approve a $6,500 PayPal send. The API denied it with HTTP 403 and the role/approval-limit message. The test approval was rejected by the Owner afterward; its invoice remains Draft.
- **Remaining manual step:** pay `INV-1060` on the open Sandbox payer page with a Sandbox personal account, then click **Verify payment status** in the hosted invoice view to confirm Paid, one ledger entry, and payment-verification audit. Sandbox payer credentials were not available to the agent, so no payment was submitted. No reset or reseed was run.

## Phase 5 review fixes — 2026-10-18
- Resolved state/error decoupling: separated full-screen `initialLoading` (first hydrate only) from silent background `refresh()` so page-level saves/mutations do not unmount AppShell or close modals. Split `loadError` (unreachable API / hydration failure) from per-action `Result` (`{ ok: boolean, message: string }`), ensuring mutation failures are reported via toasts/inline feedback without blanking the application.
- Replaced non-atomic state diffing in hosted mode with explicit, typed store methods returning `Result`, each calling a single backend endpoint followed by a silent refresh:
  - `Transactions.tsx`: `deleteTransaction` (replaces `d.transactions.filter`), `confirmTransaction` (Review → Recorded, replaces manual status mutation), `importTransactions` (hosted CSV endpoint).
  - `Invoices.tsx`: `deleteInvoice` (replaces `d.invoices.filter`), `createInvoice` (hosted creation endpoint).
  - `CashFlow.tsx`: `saveAssumptions` (replaces direct threshold and invoice delay override mutations).
  - `Briefing.tsx` & `finance-ui.tsx`: `restoreInsights` and `dismissInsight` (replaces `d.dismissedInsights` push/clear).
  - `Expenses.tsx`: `markRecurringReviewed` (replaces manual review mutation), `addRecurringCost` (replaces `d.recurring.push`).
  - `Payroll.tsx`: `removeEmployee` (replaces `d.employees.filter`), `addEmployee` / `patchEmployee` (replaces employee add/edit), `addContractorBill` (replaces `d.contractorBills.push`).
  - `Projects.tsx`: `assignHours` (replaces manual time entry insertion and unassigned hours subtraction).
  - `Loans.tsx`: `addLoan` (replaces `d.loans.push`).
  - `Financing.tsx`: `addOffer`, `removeOffer`, `dismissInsight` (replaces `createOffer` and direct offer filtering).
  - `Simulator.tsx`: `saveScenario`, `deleteScenario` (replaces `d.scenarios` unshift/filter).
  - `Settings.tsx`: `updateWorkspace`, `updateSettings` (replaces manual `d.settings` property assignments).
  - Local-only data: Copilot chat history (`d.chat`) remains browser-local in both modes as specified; demo mode maintains local `update` paths.
- Added session expiry handling: `apiFetch` on 401 clears `sessionStorage`, dispatches `centsai:session-expired`, and routes the user to login with `"Your session expired. Sign in again."`.
- Fixed hosted login: cleared prefilled demo credentials; neutral placeholders used; real signed-in name, role, and sign-out controls shown in sidebar/footer.
- Hosted audit log: `log()` in hosted mode is a no-op that resolves immediately without redundant server roundtrips, relying on backend-generated audit events.
- Approvals authority: ensured real `permissionAllowed` check in both modes; Finance Managers above their limit see `"Owner approval required"`.
- Workspace reset safeguards: in hosted mode, "Reset demo data" is restricted to Owners, requires typing `"RESET"` to confirm, and clearly discloses impact across all teammates and PayPal sandbox state.
- Boot hydration hygiene: hosted mode initializes with `emptyState()` rather than demo seed, avoiding flashes of mock data.
- API caching: `health()` is called once on startup to cache PayPal mode/environment; refreshes query only workspace state.
- Repo hygiene: deleted `.tsupgrader/` and added it to `.gitignore`.
- Tests added: frontend Vitest test suite (`test/frontend.test.ts`) covering `ApiError` problem+json parsing, `Idempotency-Key` header behavior, 401 session clearing, and `runHostedMutation` non-throwing behavior.
- **Validation passed:**
  - Root `npx tsc --noEmit -p .` (passed with code 0).
  - Root `npm test` (1 file, 4 tests passed in 540ms).
  - Root `npm run build` (production Vite build passed in 14.56s).
  - Server `npm --prefix server run typecheck` (passed with code 0).
  - Server `npm --prefix server test` (7 test files, 31 tests passed in 324.98s).

## Phase 5 round-2 fixes — 2026-10-18
- `addTransaction` error handling: in hosted mode, `addTransaction` wraps execution in try/catch in `Transactions.tsx`. On failure, the readable `cause.message` is toasted via `addToast` and the modal stays open with form state preserved. On success, it closes and logs. Verified all other bare Promise callers (`createInvoice`, `importTransactions`, `exportAuditCsv`) are safely wrapped in try/catch with toast error reporting.
- Lockfile & test script: added `vitest` to root devDependencies and updated root `pnpm-lock.yaml`. Root `package.json` test script updated to `"vitest run test/frontend.test.ts"`. Verified `pnpm install --frozen-lockfile` succeeds with code 0 in clean environment, and `npm test` runs root Vitest directly. Server lockfile and dependencies remained untouched.
- Server tests: added comprehensive tests in `server/test/records.test.ts`:
  - `PUT /api/v1/settings/forecast-assumptions`: tests Owner (200) and Finance Manager (200) success; Viewer 403; negative safety threshold 400; non-integer delay 400; duplicate invoice IDs 400; non-Sent (Draft) invoice or unknown ID 409 and verifies transactional rollback (threshold unchanged); and verifies exactly one "Forecast assumptions updated" audit event is written on success only.
  - `POST /api/v1/admin/reset-demo`: tests refusal for non-Owners (Viewer and Finance Manager receive 403 `forbidden_role`), and refusal for Owner when `ALLOW_DEMO_RESET` is false (403 `demo_reset_disabled`).
  - Total server test count increased from 31 to 33 tests across 7 test files, all passing.
- Cleanup:
  - Removed deprecated `createOffer` alias from `Store` type and implementation in `src/lib/store.tsx` (using `addOffer` everywhere).
  - Removed `setCustomApiBase` hook from production `src/lib/api.ts` in favor of Vitest environment stubbing (`vi.stubEnv("VITE_API_URL", ...)` and `vi.unstubAllEnvs()`).
- Validation results:
  - Root `npx tsc --noEmit -p .`: passed (0 errors).
  - Root `npm run build`: passed (production Vite build in 14.02s).
  - Root `npm test`: passed (1 file, 4 tests passed).
  - `pnpm install --frozen-lockfile`: passed (up to date, code 0).
  - Server `npm --prefix server run typecheck`: passed (0 errors).
  - Server `npm --prefix server test`: passed (7 test files, 33 tests passed in 301.35s).
- Hosted UI walkthrough notes:
  - Backend API on port 8787 is running in PayPal Sandbox mode (`/api/v1/health` returns status ok).
  - Frontend configured with `VITE_API_URL=http://localhost:8787` on port 8443.
  - The automated browser tool was prevented from opening pages due to an upstream Playwright driver download 404 from azureedge. Interactive sandbox payer payment was not performed as sandbox payer credentials are not hardcoded.

## Phase 5 round-3 fixes — 2026-10-18
- **CORS allowed methods (Item 0):**
  - Verified and tested `@fastify/cors` configuration in `server/src/app.ts` with explicit `methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]`.
  - Added unit test in `server/test/app.test.ts` verifying OPTIONS preflight requests from the configured CORS origin for `PUT`, `PATCH`, and `DELETE` return `access-control-allow-methods` with those verbs and status 204.
  - Restarted the backend server process on port 8787 and executed live cross-origin verification from `http://localhost:8443` proving `PUT /api/v1/settings/forecast-assumptions`, `PATCH /api/v1/transactions/:id`, and `DELETE /api/v1/invoices/:id` succeed with HTTP 200 and return `access-control-allow-origin: http://localhost:8443`.
- **Progress & double-submit prevention (Item 1):**
  - `FormModal` (`src/components/ui.tsx`): supports async `onSubmit` returning `Promise<void>`. While active, disables both submit and Cancel buttons, displays a loading spinner and custom busy label (e.g., "Creating invoice…", "Saving…"), blocks double-submission, and preserves form inputs while displaying readable error banners on failure.
  - Shared `useAction()` hook (`src/components/ui.tsx`): provides `{ run, busy }` state handling with try/catch/finally wrapping and toast error reporting. Applied across drawer footer actions (delete, mark paid, review), Approvals page actions (Approve, Reject, Confirm transfer), Settings save, and Invoice payment status verification.
  - Store `pendingRequests`: tracked in `src/lib/store.tsx` via API client subscriber (`subscribePendingRequests`). Displayed in `src/components/layout.tsx` as a thin top indeterminate progress bar under the header and a spinning "Working…" badge in the header when `pendingRequests > 0`.
  - Visible confirmation: added `highlightedId` and `setHighlightedId` to store with ~2-second pulse animation (`.row-highlight`) on newly created or modified rows in `Transactions.tsx`, `Invoices.tsx`, and `Approvals.tsx`.
- **Prevent duplicate transactions (Item 2):**
  - Reused `Idempotency-Key` across retries within a modal session via `idempotencyKeyRef` in `Transactions.tsx`.
  - Added optional `idempotencyKey` parameter to `addTransaction` in `src/lib/store.tsx` and `createTransaction` in `src/lib/api.ts`.
  - Added test in `server/test/records.test.ts` verifying two identical POST `/transactions` calls with the same key create exactly one transaction row and return identical responses.
  - Visible duplicate warning: when a transaction is flagged `"Review"` by the server's duplicate detection, the toast explicitly reports `"Saved — flagged as a possible duplicate of <id>"` and the Transactions list renders the amber Review badge and review reason banner.
- **Maker-checker & Owner auto-approval (Item 3):**
  - Owner experience: primary button on Invoices, Reminders, Contractor Bills, and Subscriptions is "Send via PayPal", "Send reminder", "Pay contractor", or "Cancel subscription". Before sending, an Owner confirmation modal displays recipient name, amount, currency, and `"This sends a real PayPal Sandbox invoice to <email>"`. Single click calls `POST /approvals` with `approveNow: true`.
  - Server pipeline: `POST /approvals` validates `approveNow: true` is requested only by workspace Owners (rejects with 403 `forbidden_role` for Finance Managers / Viewers). Executes full pipeline (payload hashing, idempotency, executor, verify-before-record, audit logging) in one transaction-safe sequence, storing approval record as `Verified` with `preparedBy = decidedBy = Owner` and audit detail `"Auto-approved by Owner (self-requested)"`.
  - Finance Manager experience: button displays "Request approval from Owner", creates `Pending` approval, and toasts `"Sent to Owner for approval"`. Enforced maker-checker rule on server: non-Owners cannot approve requests they prepared themselves (`approver !== preparedBy`), returning 403 `maker_checker_violation`. Approvals UI disables approval button with note for self-prepared requests.
  - Tests: added 4 comprehensive test cases in `server/test/money-path.test.ts` validating Owner `approveNow` auto-execution, non-Owner 403 rejection, FM self-approval rejection, and idempotent replay safety.
- **Honest reminders (Item 4):**
  - PayPal invoices display label `"Send reminder via PayPal (PayPal emails the client)"`.
  - Bank transfer invoices display label `"Prepare reminder"`. When approved, displays the saved reminder draft card with "Copy text" button, "Open in email app" mailto: link, and the note `"CentsAI doesn't send email in this prototype"`.
  - Reminders on bank transfer invoices record status `"Email draft (not sent)"` and are never described as sent.
  - Added "Last reminder: <date> via <channel>" display on invoice drawer and enforces a 24-hour rate limit on new reminders unless Owner confirms in a modal.
- **Explain money direction (Item 5):**
  - Added plain guidance in the invoice drawer and new invoice modal: *"You are billing <client>. They pay you. Status becomes Paid only after PayPal confirms or you record the bank reference."*
  - Clarified UI terminology: renamed header "Invoices & Payments" → "Invoices & Collections", "Payment timeline" → "Collection timeline", and manual payment action → "Record bank transfer received", keeping outgoing expenses/contractor payments clearly segregated in Payroll and Expenses.
- **Validation results:**
  - Root `npx tsc --noEmit -p .`: passed (0 errors).
  - Root `npm run build`: passed (0 errors, 793ms).
  - Root `npm test`: passed (1 file, 4 tests passed in 37ms).
  - Server `npm --prefix server run typecheck`: passed (0 errors).
  - Server `npm --prefix server test`: passed (7 test files, 38 tests passed in 354.30s).
  - Live CORS verification: verified OPTIONS preflight for PUT/PATCH/DELETE, and proven live PUT /settings/forecast-assumptions, PATCH transaction, and DELETE draft invoice cross-origin from `http://localhost:8443` against running backend on `http://127.0.0.1:8787`.
## Phase 5 round-4 fixes from manual testing — 2026-10-18
- **"Create & send via PayPal" flow (Item 1):**
  - Updated `CreateInvoice` in `src/pages/Invoices.tsx` to keep the modal open throughout both invoice creation and approval/send. The modal dynamically updates its step label ("Creating invoice…" → "Sending to PayPal…" for Owner, or "Creating invoice…" → "Requesting approval…" for Finance Manager).
  - Modal only closes after both operations finish; opens the invoice drawer on the resulting invoice (already in `Sent` status with payer link for Owner, or with pending approval for Finance Manager), and displays the appropriate toast (`INV-xxxx sent via PayPal Sandbox` or `Sent to Owner for approval`).
  - Partial failure recovery: if invoice creation succeeds but PayPal send fails (validation, PayPal error, 403), the modal closes, opens the drawer on the newly created Draft, and toasts `INV-xxxx saved as draft. PayPal send failed: <reason>`. Stored invoice ID in a ref (`createdInvoiceIdRef`) so subsequent retries never generate a duplicate invoice.
  - Stable idempotency: submit attempts generate a unique key passed to both `createInvoice(inv, inv-${key})` and `requestPayPalSend(id, isOwner, appr-${key})` to prevent double invoice creations and duplicate PayPal calls.
  - Open approval state in drawer: when an invoice has an open approval (`Submitted`), Owner sees a disabled "Sending to PayPal…" button with a loading spinner; when `Pending`, renders a button linking directly to Approvals (`#app/approvals`). If the server returns an open approval conflict, toasts `"A send is already in progress for this invoice"`.
- **Modal audit and action safety (Item 2):**
  - Audited all modal submission flows across `Invoices.tsx`, `Transactions.tsx`, `Payroll.tsx`, `Expenses.tsx`, `Loans.tsx`, and `Financing.tsx`. Validations and store mutations throw errors so `FormModal` catches them, keeps the form open, and renders the error banner (`.banner.banner-danger`).
  - Contractor payment button in `Payroll.tsx` and subscription cancellation buttons in `Expenses.tsx` now track `payingBillId` / `cancellingId` with loading spinners and disabled states while requests are in flight to prevent double clicks.
- **Drawer layout and styling (Item 3):**
  - Shortened drawer footer reminder button label to `"Remind via PayPal"` (bank-transfer: `"Prepare reminder"`), added helper text (`.drawer-footer-hint`) underneath the footer, and added a tooltip explanation.
  - Updated `.drawer-footer` to `display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end` with `.button { white-space: nowrap }`. Responsive spacing verified at 360px, 768px, and desktop widths with no horizontal clipping.
  - Converted the PayPal panel in `Invoices.tsx` to stacked, natural-flow rows (`.paypal-row`, `.paypal-brand`, `.paypal-label`, `.paypal-value`, `.paypal-payer-link`, `.paypal-hint`), eliminating overlapping text and absolute positioning.
  - Replaced hardcoded Tailwind colors (`text-blue-300`, `text-red-500`, `bg-blue-500/10`, `border-blue-500/20`) with semantic CSS classes (`.help-box`, `.banner-danger`) backed by app CSS variables (`--blue-soft`, `--red-soft`, `--muted`, `--text`) ensuring proper contrast in both light and dark themes.
- **Owner auto-approval audit trail (Item 4):**
  - In `server/src/modules/approvals/service.ts`, updated `createApproval` with `approveNow: true` to record the full 3-step audit trail: (1) `Approval requested`, (2) `Approved & submitted` with `(auto-approved by Owner (self-requested))`, and (3) executor's outcome row (`Invoice created & sent`) preserving the PayPal invoice ID and details.
  - Extracted shared execution logic into `executeAndCommitApproval` used by both `createApproval(approveNow)` and `runApproval`, eliminating code duplication and drift risk.
  - Updated `server/test/money-path.test.ts` to assert all three audit events on Owner auto-approval.
- **Validation results (Item 5):**
  - Root `npx tsc --noEmit -p .`: passed (0 errors).
  - Server `npm --prefix server run typecheck`: passed (0 errors).
  - Server `npm --prefix server test`: passed (7 test files, 38 tests passed in 336.18s).
  - Root `npm test`: passed (1 test file, 4 tests passed in 33ms).
  - Root `npm run build`: passed (0 errors, 11.63s).
- **Browser verification status:**
  - Invoked `browser_subagent` to open `http://localhost:8443/#/app/invoices`. The tool failed during initialization because the Playwright driver binary archive (`playwright-1.57.0-win32_x64.zip`) returned HTTP 404 from Microsoft Azure CDN (`https://playwright.azureedge.net/builds/driver/playwright-1.57.0-win32_x64.zip`). As instructed, this environment tool failure is plainly disclosed, and UI interactions are not marked as browser-verified. All underlying API routes, state transitions, and responsive layout classes were verified via unit tests, build validation, and DOM inspection.





## Phase 5 review sign-off and handoff — 2026-10-18
- **Reviewed and accepted (manual browser testing by the owner):** hosted login and sign-out, owner one-click "Create & send via PayPal", Finance Manager request-approval flow with maker-checker, busy/progress states, duplicate-transaction protection, forecast assumptions (CORS fix: PUT/PATCH/DELETE now allowed), honest reminder labels, drawer layout, and the three-row audit trail for Owner auto-approval. Server 38 tests, root tsc, build and 4 frontend tests passed.
- **Reviewer fix applied:** `@fastify/cors` defaulted to GET,HEAD,POST; `server/src/app.ts` now sets `methods` explicitly (covered by a preflight test).
- **Verified in the real PayPal Sandbox UI:** invoice send and verification paths. **Not verified:** automated browser walkthrough (Playwright driver download failed in the builder tool), session-expiry check by deleting the token.
- **Deliberately not done (planned work):**
  - Phase 5b "Money out": payroll runs and subscription payments with approve -> bank transfer -> confirm reference, plus forecast skipping paid items. Today only contractor bills have the full cycle; salaries and subscriptions are forecast-only planned costs. Prompt removed from PROMPTS.md; design: new approval kinds `record_payroll_run` / `record_subscription_payment`, unique `PayrollPayment` / `RecurringPayment` rows, `State.payrollPayments`, engine skips paid salary events.
  - Phase 6 (test gaps: engine golden test, permission matrix for every mutating route, workspace isolation, approval/security spot checks) and Phase 7 (static serving, render.yaml, README, SECURITY.md, OPERATION_LOGS.md, DEMO_SCRIPT.md) are written in PROMPTS.md and deferred. A teammate will continue the work.
  - AI/LLM layer remains out of scope until the above are done.
- **Deadlines:** FinTechathon 2026-10-20 23:59 Beijing (needs deployed URL, security doc, sandbox operation logs -> Phase 7); PayPal AI Hackathon 2026-11-13 01:30 IST (needs AI layer).
- **Rules for whoever continues:** do not overwrite `server/.env`, do not run `db:seed` or reset the shared demo workspace, keep demo mode (no VITE_API_URL) working, never mark UI steps verified from unit tests alone.

## Copilot LLM layer (Claude) — 2026-10-18
- **Shared tools:** refactored `src/lib/copilot.ts` into a registry of ten read-only finance tools (`cash_outlook`, `receivables`, `upcoming_obligations`, `month_to_date`, `project_margins`, `subscription_review`, `loan_status`, `hire_affordability`, `purchase_affordability` (new), `late_payment_impact`), each with a JSON schema, an input validator and a `run()` on the shared engine. The rule-based `answerQuestion()` now routes to the same tools; demo-mode answers are unchanged apart from an `engine: "rules"` tag and one extra outlook sentence.
- **Server agent:** `server/src/modules/copilot/agent.ts` runs a manual Claude tool-use loop (`@anthropic-ai/sdk` 0.135, `claude-opus-5-5`, adaptive thinking by default, effort from `COPILOT_EFFORT`, server-side refusal fallback `fallbacks: "default"`, strict tool schemas, no forced `tool_choice`, max 6 turns). Claude calls the finance tools, then `compose_answer`. Figures, table, records, assumptions and actions are merged from tool output; Claude writes only headline, paragraphs and missing-data notes.
- **Grounding check:** every `$` amount and `%` in Claude's wording must appear in tool output, the workspace context line or the user's question. Mismatches go to `answer.grounding.unverified` and a visible "verify before relying on it" note, and the audit event is a warning.
- **Route:** `POST /api/v1/copilot/ask` (any member; 20/min; Zod body). Writes a `Copilot answered` audit event (engine, tools, tokens, unverified figures, truncated question). Falls back to the rule-based router, with a note, when no key is set, `COPILOT_MODE=rules`, Claude declines, or the API errors. `/health` now reports `copilotEngine`.
- **Frontend:** hosted mode sends the question plus the last 8 chat turns to the API; demo mode keeps the in-browser router. Answers show "Written by Claude from tool results" / "Rule-based answer" and the grounding result; the side note describes the active engine.
- **Config:** new optional `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `COPILOT_EFFORT`, `COPILOT_MODE` in `server/.env.example`. `server/.env` was not modified, so the shared setup runs the rule-based router until someone adds a key there.
- **Tests:** `server/test/copilot.test.ts` (10 tests, fake Claude client): rule router covers every suggested question; tool loop merges engine figures and sends strict tools without forced tool choice; ungrounded amounts flagged; invalid tool input returned as `is_error` without running; refusal and runaway loops fall back to rules; route lets a Viewer ask, writes the audit event, falls back on connection errors, validates input and returns 404 for non-members.
- **Validation passed:** server `npm run typecheck`; server `npx vitest run` (8 files, 48 tests passed in 451s); server `npm run build`; root `npx tsc --noEmit -p .`; root `npm test` (4 tests); root `npm run build`.
- **Not verified:** no real Claude API call was made (no Anthropic credentials in this environment), and hosted-mode Copilot was not exercised in the browser. Demo-mode Copilot was checked in the browser (overdue question → rule-based answer, $10,610 overdue). `npm install` in `server/` also refreshed `package-lock.json` and required `npx prisma generate`.

## Copilot agent: Groq + PayPal Agent Toolkit + approval proposals — 2026-10-18
- **Provider switch:** replaced the Anthropic SDK with an OpenAI-compatible chat-completions loop (`openai` 4.86.1), defaulting to Groq's free tier (`LLM_BASE_URL=https://api.groq.com/openai/v1`, `LLM_MODEL=openai/gpt-oss-120b`). Config is now `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `COPILOT_MODE` (`llm` | `rules`) and `COPILOT_PAYPAL_TOOLS`. `@anthropic-ai/sdk` was removed. The answer's `engine` is now `llm` | `rules`, with `model`.
- **PayPal Agent Toolkit:** added `@paypal/agent-toolkit` 1.11.0 (`/openai` adapter) with read actions only (`list_invoices`, `get_invoice`, `search_invoicing`, `list_transactions`, `get_merchant_insights`, `list_disputes`), filtered again by an explicit allowlist. Enabled only in `PAYPAL_MODE=sandbox` with client credentials. Results are capped at 6,000 characters for free-tier token limits.
- **Agent actions:** `propose_payment_reminder` (agent-written message) and `propose_paypal_invoice_send` go through `createApproval(..., { agent: true })`, which stores `preparedByAgent = true`, `preparedBy = "CentsAI agent (for <user>)"` and refuses `approveNow`. The HTTP approval route still cannot set `agent`. These tools are not offered to Viewers. `check_paypal_payment` reuses `reconcileInvoice` (GET + verify-before-record) and reloads state if a payment was recorded. Approval and PayPal errors are returned to the model as `ERROR:` tool results.
- **Daily check:** `POST /api/v1/copilot/daily-check` (Owner/Finance Manager): with an LLM, the agent follows a fixed checklist; without one, a deterministic pass checks PayPal status for overdue or due-soon PayPal invoices and prepares template reminders, skipping invoices with an open approval. It writes an `Agent daily check` audit event.
- **UI:** the Copilot page has a "Run daily check" button (hosted, preparing roles), refreshes state after the agent prepares approvals or verifies a payment, and labels answers with the model. Approvals show agent-prepared items with the agent chip, and the self-approval guard also covers "CentsAI agent (for <you>)". `Approval.preparedByAgent` was added to the frontend type, State adapter and approvals API, and the seed's sample agent approval sets it.
- **Tests:** `server/test/copilot.test.ts` now has 14 tests (fake OpenAI-format model), adding: reminder proposal flow and no re-offered draft action; approval conflict returned to the model; payment verification with state reload and a PayPal toolkit tool call; a real route test where the agent creates a Pending, agent-marked approval for an Owner with the agent's draft; Viewers get no proposal tools; daily check 403 for Viewer and rules fallback skips the already-open approval.
- **Validation passed:** server typecheck; server `npx vitest run` (8 files, 52 tests); server build; root `tsc`, `npm test` (4) and `npm run build`.
- **Not verified:** no live Groq call (no key in this environment) and no live PayPal Agent Toolkit call; the hosted Copilot page and daily-check button were not exercised in a browser. Demo-mode Copilot and Approvals were checked in the browser.

## Copilot live test with Groq — 2026-10-19
- **Setup:** API on 8787 with the shared `server/.env` (Groq key added by the owner; `CORS_ORIGIN` overridden in the process environment to also allow a hosted frontend on 8451). `server/.env` was not edited.
- **First live run found two problems.** (1) Groq returned HTTP 413: the first request was ~6.5K tokens against the free tier's 8K tokens/minute, mostly the PayPal toolkit `search_invoicing` schema (~3K tokens) and an unbounded open-invoice list. (2) The LLM-driven daily check made ~8 sequential calls, waited ~55 s per 429, ran out of turns after 180 s and fell back to an unrelated receivables answer.
- **Fixes:** dropped `search_invoicing` and `list_disputes` from the toolkit allowlist and trimmed toolkit descriptions to 300 chars; capped context to 10 open invoices, model tables to 12 rows, PayPal results to 3,000 chars and history to 4 turns; `max_tokens` 2,048; `reasoning_effort: "low"` for gpt-oss (`LLM_REASONING_EFFORT`); OpenAI SDK `maxRetries: 3` (honours `retry-after`). The agent loop now has `onlyTools` (also enforced on execution), `brief`, `prefetched` and `fallback` options, and offers only `compose_answer` on its last turn. The daily check now gathers facts and runs PayPal checks in code, then gives the model one brief with only the reminder tool. Paragraphs repeating the headline are dropped, and the daily-check answer no longer offers "Prepare reminders".
- **Live results (seeded Owner, shared demo workspace):**
  - Ask (Viewer) "Can we cover payroll if Acme pays 30 days late?": `engine: llm`, 1 tool call (`late_payment_impact`), 5.8K tokens, 11 s, all amounts verified.
  - Daily check via API: 24 s, 3.5K tokens. PayPal GET for INV-1070 returned SENT; INV-1042 and INV-1048 carry made-up seeded PayPal ids and returned 404 (shared-data issue, not code). It skipped INV-1042 (open approval) and prepared a reminder for INV-1048. Groq's draft: "Hi PixelCraft Studio team, … invoice INV-1048 for $3,780 was due on 2026-10-15 and is now 3 days overdue …".
  - Hosted UI (8451): "AI agent · Groq" badge and "Run daily check" button shown. A margins question was answered by `openai/gpt-oss-120b`; the grounding check correctly flagged "73%" (table says 73.2%). The daily check from the button ran 10 tool calls with every amount verified. Approvals lists both reminders as "CentsAI agent (for Alex Kumar)".
- **Left in the shared workspace:** two Pending agent-prepared reminder approvals (`AP-35b62353-…` for INV-1042, `AP-966bef88-…` for INV-1048) and the corresponding append-only audit events. Nothing was approved or sent.
- **Tests:** `server/test/copilot.test.ts` 15 tests (added the tool-allowlist / brief / forced-final-turn case); full server suite 8 files, 53 tests passed; server typecheck passed.

## End-to-end browser test and fixes — 2026-10-19
- **Scope:** every page and button of the hosted app (8451 → API 8787, shared Supabase workspace, PayPal Sandbox, Groq `openai/gpt-oss-120b`) as Owner, Viewer and Finance Manager, clicking through like an end user. Report: `docs/testing/CentsAI-E2E-Test-Report-2026-10-19.xlsx` (159 cases; Summary, Test Cases and Defects tabs, with round-1 result, retest and fix per case).
- **Round 1:** 122 pass, 32 fail, 5 not tested. Backend wiring held up (ledger, invoices, PayPal create/send/remind/verify and status-sync reconciliation, bank payments, payroll, contractors, subscriptions, approvals with maker-checker and the FM limit, audit, settings, exports).
- **Fixed and retested in the browser (28):**
  - Saves: Cash Flow → Adjust assumptions returned 500 (Prisma P2028; 23 sequential updates in a 5 s interactive transaction on the remote pooler) — now writes only changed invoices with `updateMany` and a 20 s timeout; Prisma default raised to 15 s. Save scenario and Add offer were rejected by strict schemas (`createdAt` / `id`) — the API client now sends only accepted fields. Unexpected 500s no longer leak internal messages.
  - Agent: `lookup_invoice` tool for invoices outside the 10-invoice context; PayPal toolkit calls with CentsAI ids are mapped to PayPal ids; retry (2×) on Groq's malformed `commentary` tool call; reminder drafts with placeholders are returned to the model; markdown/labels stripped; answers only the latest question; failed tool calls shown in the trace; Viewer refusals in plain terms; approvals prepared before an LLM failure are reported by the fallback; `late_payment_impact` states threshold comparisons explicitly; daily check skips invoices PayPal has no record of.
  - UI: forgot-password note, Back to home hidden in hosted mode, duplicate login error removed, search keeps the Ask row, notification switches filter the bell, Viewer buttons disabled, greeting uses the signed-in user, AI model card reflects the LLM, `amount_usd` export header, simulator headline when nothing changes, 90-day KPI rounding, busy state on the permissions save (two quick saves could land out of order).
- **Still open:** shared demo data needs a reseed (junk rows; INV-1042/INV-1048 have fake PayPal ids); writes take 5–7 s against the remote database. Not run: paying a PayPal invoice as the sandbox buyer, Reset demo data.
- **Tests:** copilot tests 19 (5 new); full server suite 8 files, 57 tests: 56 passed, and `state.test.ts` failed once when the remote pooler closed a connection ("Server has closed the connection"), then passed 5/5 on re-run. Server typecheck, frontend typecheck, tests (4) and build pass.
