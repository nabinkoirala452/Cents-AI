# CentsAI Backend — Build Spec (non-AI phase)

This is the authoritative spec for the backend. It condenses the "CentsAI Backend Blueprint" for the current phase.
**Currency (decided 2026-10-17):** each workspace has ONE currency, default **USD**. All amounts (ledger, invoices, payroll, approvals, thresholds) are in that currency — there is no FX conversion. The demo agency is a small US-based agency billing in USD, so every invoice can be collected through PayPal.
**Out of scope for now:** LLM / GenAI (copilot model, AI reminder drafting, AI briefing narrative). The existing rule-based copilot (`src/lib/copilot.ts`) and template reminders (`src/lib/drafts.ts`) keep running in the browser.

---

## 1. Goals of this phase

1. A **trusted server** for everything that touches money or permissions: records, roles, approvals, PayPal, audit log.
2. **Real PayPal Sandbox** (Invoicing v2): create + send invoice, payment-status verification, reminders, webhooks.
3. The **same numbers** as today: the server reuses the existing deterministic engine (`src/lib/finance.ts`) — never re-implement money math.
4. The frontend keeps working in two modes:
   - **Demo mode** (no `VITE_API_URL`): exactly as today, localStorage only.
   - **Hosted mode** (`VITE_API_URL` set): login required, all data comes from and is written through the API.

## 2. Stack (decided — do not change without asking)

| Concern | Choice |
|---|---|
| Runtime | Node 22 LTS, TypeScript (strict), ESM |
| HTTP | Fastify 5 + `fastify-type-provider-zod` + Zod |
| DB | PostgreSQL (Supabase free tier or local Docker) via Prisma 6 |
| Auth | Email + password (`bcryptjs`), JWT access token (`jose`, HS256, 8h). No Supabase Auth. |
| Security plugins | `@fastify/helmet`, `@fastify/cors` (allow-list), `@fastify/rate-limit` |
| Logging | Fastify's pino logger with redaction of `authorization`, `cookie`, tokens, secrets |
| Tests | Vitest + `fastify.inject()` |
| Dev runner / build | `tsx watch` for dev, `tsup` (esbuild) bundle for prod |
| Deploy | One Render web service: Fastify serves the API and the built frontend (`dist/`) from the same origin |

## 3. Folder layout

The frontend stays where it is. The backend lives in `server/` with its own `package.json`.

```
CentsAI/
  src/                      # frontend (unchanged structure)
    lib/finance.ts dates.ts format.ts types.ts seed.ts   # PURE — shared with server
    lib/api.ts              # NEW: typed API client (hosted mode)
  server/
    package.json  tsconfig.json  tsup.config.ts  .env.example  vitest.config.ts
    prisma/schema.prisma  prisma/migrations/  prisma/seed.ts
    src/
      index.ts              # start server
      app.ts                # buildApp(): plugins, routes, error handler (exported for tests)
      config.ts             # zod-validated env
      core.ts               # re-exports from ../../src/lib/{finance,dates,format,types,seed}
      plugins/  auth.ts  errors.ts  idempotency.ts
      modules/<name>/routes.ts  service.ts  schemas.ts
        auth  workspace  settings  transactions  clients  projects  invoices
        payroll  expenses  loans  financing  scenarios  approvals  payments
        cashflow  audit  admin  webhooks
      integrations/paypal/  client.ts  invoicing.ts  webhooks.ts  fake.ts
      lib/  state.ts (DB → frontend State adapter)  ids.ts  hash.ts  csv.ts  money.ts
    test/
```

**Shared engine rule:** the server imports the frontend's pure modules through `server/src/core.ts`
(`export * from "../../src/lib/finance"` etc.). `tsx` and `tsup` both handle this. The server must never import
React files (`store.tsx`, pages, components). If a pure helper is needed and lives in a React file, move it to a pure file first.

## 4. Data model (Prisma)

**Convention:** every business table has `workspaceId String` and a string `id` using the **same ids/prefixes the frontend uses**
(`INV-1042`, `TXN-…`, `CB-221`, `e-ananya`, `AP-3104` …), with `@@id([workspaceId, id])`. This keeps the DB → `State`
adapter trivial and lets the seed be ported directly. New ids are generated on the server with the same prefixes.

Money columns: `Decimal @db.Decimal(14, 2)`, converted to `number` only inside `lib/state.ts` / `lib/money.ts`.
Calendar dates (`issueDate`, `dueDate`, transaction `date`) are ISO `YYYY-MM-DD` strings (`String`), matching the frontend.
Moments (`createdAt`, audit `at`) are `DateTime` (UTC).

| Table | Fields (in addition to `workspaceId`, `id`, `createdAt`, `updatedAt`) | Notes |
|---|---|---|
| `User` | `id` (cuid, global PK), `email` unique, `name`, `passwordHash` | not workspace-scoped |
| `Workspace` | `id` (cuid, global PK), `name`, `agencyType`, `teamSize`, `location`, `website`, `currency` (default `USD`), `timezone` (default `America/Chicago`), `seededOn` | |
| `Membership` | `userId`, `workspaceId`, `role` enum `Owner \| FinanceManager \| Viewer` | `@@unique([workspaceId, userId])` |
| `WorkspaceSettings` | PK `workspaceId`; `safetyThreshold`, `defaultHorizon`, `planningScenario`, `managerApprovalLimit`, `openingBalance`, `openingDate`, `ownerName`, `ownerEmail`, `notifications Json`, `readiness Json`, `dismissedInsights Json` | 1:1 |
| `Client` | `name`, `email`, `country`, `avgDelayDays` (currency = workspace currency) | |
| `Project` | `name`, `clientId`, `billing`, `contractValue`, `budgetCost`, `status`, `timeEntries Json`, `unassignedHours`, `retainer Json?`, `plannedBillings Json?` | Json validated with Zod on write |
| `Invoice` | `clientId`, `projectId?`, `kind`, `issueDate`, `dueDate`, `currency`, `lineItems Json`, `status` (`Draft/Sent/Paid/Cancelled`), `channel`, `paidDate?`, `paypalInvoiceId?` (unique), `paypalStatus?`, `paypalPayerUrl?`, `paypalSentAt?`, `paypalLastCheckedAt?`, `reminders Json`, `expectedDelayOverride?`, `notes?` | `dueDate >= issueDate` |
| `PaymentEvent` | `invoiceId`, `source` (`PayPal/Manual`), `externalId` (PayPal capture/transaction id or bank/ACH reference), `status`, `gross`, `fee?`, `net?`, `currency`, `occurredAt`, `verifiedAt?`, `raw Json?` | `@@unique([workspaceId, source, externalId])` — prevents double recording |
| `Transaction` | `date`, `description`, `party`, `category`, `projectId?`, `type` (`Income/Expense`), `amount` (workspace currency), `status` (`Recorded/Verified/Review`), `source`, `invoiceId?`, `paymentEventId?` (unique), `reference?`, `notes?`, `reviewReason?`, `importJobId?` | |
| `Employee` | `name`, `role`, `monthlySalary`, `payDay` (1–28), `status`, `startDate` | |
| `ContractorBill` | `vendor`, `projectId?`, `reference`, `amount`, `dueDate`, `status`, `paidDate?` | |
| `RecurringCost` | `vendor`, `category`, `kind`, `amount`, `previousAmount?`, `cycle`, `nextDate`, `startedOn`, `status`, `reviewed` | |
| `Loan` | `name`, `lender`, `principal`, `rate`, `tenureMonths`, `startDate`, `emiDay`, `prepaymentFeePct?` | |
| `LoanOffer` | `name`, `principal`, `rate`, `months`, `fees` | |
| `SavedScenario` | `name`, `type`, `inputs Json`, `createdById` | |
| `Approval` | all fields of frontend `Approval` type + `payload Json`, `payloadHash`, `preparedByUserId?`, `preparedByAgent Boolean`, `attempt Int` | partial unique index: one open (`Pending`/`Submitted`) approval per `(workspaceId, kind, refId)` (raw SQL migration); `idempotencyKey` unique |
| `AuditEvent` | `at`, `actorUserId?`, `actor` (label), `action`, `detail`, `ref?`, `outcome`, `requestId?` | **append-only**: a SQL trigger raises on UPDATE/DELETE |
| `WebhookEvent` | `providerEventId` unique, `eventType`, `resourceId`, `rawBody`, `headers Json`, `signatureVerified`, `receivedAt`, `processedAt?`, `error?` | global (not workspace-scoped); resolve workspace from the invoice |
| `ImportJob` | `fileName`, `rowCount`, `imported`, `duplicates`, `invalid`, `createdById` | |
| `IdempotencyKey` | `key`, `userId`, `route`, `responseStatus`, `responseBody Json`, `createdAt` | replay within 24h returns stored response |

### 4.1 Financial invariants (enforce in services + DB)
1. A PayPal payment creates at most one `PaymentEvent` (unique `source+externalId`) and at most one `Transaction` (unique `paymentEventId`).
2. An invoice becomes `Paid` only from (a) a PayPal `GET` that returns `PAID`, or (b) a manual payment with a bank reference. Manual (bank/ACH reference) = transaction status `Recorded`; PayPal-verified = `Verified`.
3. `Verified` transactions are immutable except `category`, `projectId`, `notes`. They cannot be deleted. Invoice-linked transactions cannot be deleted.
4. Forecast / simulated values are **never** written to `Transaction`.
5. One open approval per `(kind, refId)`. An approval executes only if `payloadHash` still equals the hash recomputed from current records; otherwise it becomes `Stale`.
6. Every query is filtered by the caller's `workspaceId` (taken from the membership, never from the request body).
7. When an invoice becomes `Paid` or `Cancelled`, its `Pending` reminder approvals are withdrawn (status `Rejected`, decidedBy `System`, note "Withdrawn automatically — invoice was paid").

## 5. The State adapter (most important file)

`server/src/lib/state.ts` exports `loadState(workspaceId): Promise<State>` that reads all rows and returns **exactly the
frontend `State` type** from `src/lib/types.ts` (numbers not Decimals, ISO strings, invoice `paypal` object rebuilt from columns,
`settings.team` built from memberships + users, `settings.role` = the **caller's** role, `chat: []`).

- All computed endpoints call the shared engine on this State: `forecastAll`, `receivables`, `buildBriefing`, `projectStats`, `loanStatus`, etc.
- `GET /api/v1/workspace/state` returns it — this is how the frontend hydrates in hosted mode.
- Golden rule: for the seeded workspace, `loadState()` must produce the same numbers the frontend shows in demo mode on the same day.

## 6. Auth, roles, permissions

- `POST /api/v1/auth/login {email, password}` → `{ token, user, workspaces: [{id, name, role}] }`. Wrong credentials → 401 with a generic message. Rate limit 10/min/IP.
- Every other route (except `/health`, `/auth/login`, `/webhooks/paypal`) requires `Authorization: Bearer <jwt>` and `X-Workspace-Id`.
  The auth plugin verifies the JWT, loads the membership for that workspace (404 if none — don't leak existence) and sets `req.ctx = { userId, userName, workspaceId, role }`.
- Permission helpers (server-side, mirror `permissions()` in `store.tsx`):
  - `view`: any member
  - `prepare` / `edit`: `Owner` or `FinanceManager`
  - `approve(amount)`: `Owner` always; `FinanceManager` only if `amount <= managerApprovalLimit`; `Viewer` never
  - Owner-only: changing `managerApprovalLimit`, team roles, `/admin/*`
- Seed three demo users for the seeded workspace (one per role). Passwords come from `SEED_DEMO_PASSWORD` in `.env` (never hard-coded in source; document them in README as demo credentials).
- In hosted mode the frontend **hides the "acting as" role switchers** (Approvals tier cards become read-only, Settings "Acting as (demo)" hidden). Role comes from the JWT membership.

## 7. API (all under `/api/v1`)

Conventions: JSON; Zod-validated bodies/queries; errors as `application/problem+json` `{ type, title, status, code, detail, fields? }`;
amounts in request/response bodies are numbers in the workspace currency — the DB stores Decimal; mutations accept an
`Idempotency-Key` header; every mutation writes an `AuditEvent`.

Permission legend: **V** any member · **P** Owner/FinanceManager · **O** Owner · **Lim** approve rule above.

| Method & path | Purpose | Perm |
|---|---|---|
| `GET /health` | liveness (no auth) | – |
| `POST /auth/login` | login | – |
| `GET /me` | user + memberships | auth |
| `GET /workspace/state` | full frontend `State` for the caller | V |
| `PATCH /workspace` , `PATCH /settings` | profile / preferences (limit + roles: O) | P |
| `PUT /settings/dismissed-insights` | replace dismissed list | V |
| `POST /transactions` · `PATCH /transactions/:id` · `DELETE /transactions/:id` | ledger CRUD; duplicate check → `Review`; rules in §4.1 #3; `date <= today` | P |
| `POST /transactions/import` | body `{ fileName, rows: [{date, description, amount, type, party, category}] }` (parsed in browser); server re-validates every row, skips invalid, flags/skips duplicates, creates `ImportJob` | P |
| `POST /clients` · `PATCH /clients/:id` | clients | P |
| `POST /projects` · `PATCH /projects/:id` · `POST /projects/:id/time-entries` | projects, hours (assign unassigned hours) | P |
| `POST /invoices` | create **Draft** (server assigns next `INV-####`, currency from client) | P |
| `PATCH /invoices/:id` | Draft: any field; Sent: only `expectedDelayOverride`, `notes`. Editing a draft marks its open approvals `Stale` | P |
| `DELETE /invoices/:id` | Draft only | P |
| `POST /invoices/:id/issue` | mark an invoice sent outside PayPal (channel `Bank transfer`, e.g. ACH/wire) | P |
| `POST /invoices/:id/payments` | manual bank receipt `{date, reference}` (bank/ACH reference required) → PaymentEvent(Manual) + Transaction(Recorded) + invoice Paid, in one DB transaction | P |
| `POST /invoices/:id/paypal/sync` | "Verify payment status": PayPal GET + reconcile (§8.4) | V |
| `POST /employees` · `PATCH /employees/:id` · `DELETE /employees/:id` | payroll planning | P |
| `POST /contractor-bills` · `PATCH /contractor-bills/:id` | payables | P |
| `POST /recurring-costs` · `PATCH /recurring-costs/:id` · `POST /recurring-costs/:id/review` | subscriptions | P |
| `POST /loans` · `PATCH /loans/:id` | debt | P |
| `POST /financing/offers` · `DELETE /financing/offers/:id` | offers | P |
| `POST /scenarios` · `DELETE /scenarios/:id` | saved simulator inputs | P |
| `GET /cashflow/forecast?horizon=7\|30\|90\|120&scenario=expected,conservative,optimistic` | engine output (`forecastAll`) | V |
| `GET /dashboard/summary?horizon=` | cash, month-to-date, receivables, forecast headline | V |
| `GET /briefing?horizon=` | deterministic `buildBriefing()` (no LLM) | V |
| `GET /approvals?status=` | queue | V |
| `POST /approvals` | propose `{ kind, refId, draft? }`; **server** builds recipient/amount/currency/steps from DB records, computes `payloadHash`, `idempotencyKey = <kind>-<refId>-<attempt>` | P |
| `POST /approvals/:id/approve` | approve & execute (§8) | Lim |
| `POST /approvals/:id/reject` | `{ reason }` | P |
| `POST /approvals/:id/confirm-transfer` | contractor payment: `{ reference }` → bill Paid + Transaction(Verified) | Lim |
| `GET /audit-events?ref=&limit=&cursor=` · `GET /audit-events/export.csv` | audit trail (CSV export with formula-injection guard) | V |
| `POST /admin/reset-demo` | wipe + reseed the caller's workspace; only when `ALLOW_DEMO_RESET=true` | O |
| `POST /webhooks/paypal` | public; raw body; verify signature; store; reconcile | signature |

Approval kinds (same as frontend): `paypal_send_invoice`, `send_reminder`, `record_contractor_payment`, `cancel_subscription`.

## 8. Approvals + PayPal (the money path)

### 8.1 Approval state machine
`Pending → (approve) → Submitted → Verified` · `Pending → Rejected` · `Submitted → Failed` · `Pending → Stale` (records changed).
On approve, inside a DB transaction: `SELECT … FOR UPDATE` the approval row → must be `Pending` → check role/limit against
`amount` → recompute `payloadHash` from current records; mismatch → `Stale` (409) → set `Submitted`, `decidedBy`, `decidedAt`.
Then run the executor **outside** the DB transaction; write the result in a second transaction. Two concurrent approves → exactly one executes.

`payloadHash = sha256(canonicalJSON({ kind, refId, recipientEmail, amount, currency, lineItems, dueDate, draft }))`.

### 8.2 Executors (no AI, built only from DB records — never from request text)
| Kind | Execution |
|---|---|
| `paypal_send_invoice` | `searchInvoices(invoice_number = <INV id>)` → if none, `createDraftInvoice` → **persist `paypalInvoiceId` immediately** → `sendInvoice` → `getInvoice`; status `SENT`/`UNPAID` → invoice `Sent` + approval `Verified`; else `Failed` (store PayPal `debug_id`) |
| `send_reminder` | PayPal invoice → `remindInvoice`; bank-transfer invoice → log reminder only ("email delivery not connected"); append to `invoice.reminders`; `Verified` |
| `record_contractor_payment` | stays `Submitted` until `confirm-transfer` with a bank reference (no payout API) |
| `cancel_subscription` | `RecurringCost.status = Cancelled`; `Verified` |

### 8.3 PayPal client (`integrations/paypal`)
- Env: `PAYPAL_ENV=sandbox`, `PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com`, `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`, optional `PAYPAL_SANDBOX_PAYER_EMAIL` (if set, used as recipient email for demo invoices so the sandbox personal account receives them).
- Refuse to start if `PAYPAL_ENV=sandbox` but base URL is not the sandbox URL (and vice versa).
- OAuth2 client credentials `POST /v1/oauth2/token`, cache the token until ~60s before `expires_in`.
- Endpoints: `POST /v2/invoicing/invoices`, `POST /v2/invoicing/invoices/{id}/send`, `GET /v2/invoicing/invoices/{id}`, `POST /v2/invoicing/invoices/{id}/remind`, `POST /v2/invoicing/search-invoices`, `POST /v1/notifications/verify-webhook-signature`.
- Create payload: `detail { invoice_number: <INV id>, currency_code: <workspace currency>, invoice_date, payment_term { due_date }, note }`, `primary_recipients [{ billing_info { email_address, name { full_name: client.name } } }]`, `items [{ name, quantity: "1", unit_amount { currency_code, value: "650.00" } }]`.
- Retries: 3× with jittered backoff on 429/5xx/network for GET and remind; for create, retry only after the search-recovery check. Never retry 4xx.
- Audit every call: method, path, HTTP status, `paypal-debug-id`. **Never** log tokens or secrets.
- Define an interface `PayPalGateway`; real implementation in `invoicing.ts`, in-memory fake in `fake.ts` used by tests and when `PAYPAL_MODE=fake`.
- Every invoice defaults to channel `PayPal`. An invoice may be marked `Bank transfer` instead (client pays by ACH/wire; recorded manually with a reference). Eligibility for PayPal: channel PayPal, client email present, at least one line item, currency supported by PayPal.

### 8.4 Reconciliation (`payments` module) — used by sync, webhook, and poll
1. `GET` the invoice from PayPal (never trust a webhook body).
2. `PAID` / `PARTIALLY_PAID`: for each payment in the response not yet stored → `PaymentEvent(PayPal, externalId = payment transaction id)` + `Transaction(Income, Verified, source PayPal, amount = gross)`; invoice `Paid` when fully paid. All in one DB transaction. Then withdraw pending reminders (§4.1 #7).
3. `PAYMENT_PENDING`: record nothing; forecast keeps it uncertain.
4. `CANCELLED`: invoice `Cancelled`, withdraw reminders.
5. Update `paypalStatus`, `paypalLastCheckedAt`; audit `Payment verified` / `Status checked`.

### 8.5 Webhook
`POST /api/v1/webhooks/paypal` with raw body (`addContentTypeParser` keeping the raw string). Store `WebhookEvent` first
(unique `providerEventId` → replay is a no-op, return 200). Verify via `verify-webhook-signature` using headers
`paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`, `paypal-transmission-sig`, `paypal-transmission-time` and
`PAYPAL_WEBHOOK_ID`. Unverified → stored, not processed, still 200 (log warning). Verified `INVOICING.INVOICE.*` → reconcile (§8.4).
Return 2xx only after the event is stored. Local dev needs a tunnel; the "Verify payment status" button covers the demo without it.

## 9. Security checklist (judged: 30% of FinTechathon)
- Secrets only in `server/.env` (git-ignored); `server/.env.example` committed with placeholders. No secret in any `VITE_*` variable.
- JWT verified on every protected route; workspace from membership; role checks in services (not only routes).
- Zod on every body/query/param; Prisma only (no string-built SQL).
- Helmet; CORS allow-list from `CORS_ORIGIN`; rate limits: 120/min/user, 10/min login, 60/min webhook.
- Problem+json errors without stack traces in production.
- Audit log append-only (DB trigger). Export CSV guards formula injection (prefix `'` for cells starting `= + - @ \t \r`).
- Webhook signature verification; idempotent payment recording.
- Remove/relabel simulated claims in hosted mode (seeded audit events that say "confirmed via GET…", Settings "Test connection", "Enforced" badges) — they must only claim what really happened.

## 10. Tests (minimum)
- **Engine golden test**: freeze time (`vi.setSystemTime('2026-10-17T09:00:00+05:30')`), build `createSeed()`, snapshot key outputs of `forecastAll`, `receivables`, `buildBriefing`, `projectStats`, `loanStatus`.
- **State adapter**: seed DB → `loadState()` equals `createSeed()` on the compared fields.
- **Permissions matrix**: Viewer/FinanceManager/Owner × every mutating route → expected 2xx/403.
- **Workspace isolation**: user of workspace A gets 404 for workspace B ids.
- **Approvals**: limit check (FinanceManager blocked above the $6,000 limit), stale hash, concurrent double approve → one execution.
- **PayPal (fake gateway)**: send happy path; crash between create and send → search recovery, no duplicate; sync PAID → one payment event + one transaction; repeat sync → no duplicate; PAYMENT_PENDING → nothing recorded; bad webhook signature → not processed; duplicate webhook → no-op.
- **Transactions**: duplicate → Review; verified immutable; future date rejected; import counts.

## 11. Frontend integration (hosted mode)
- `src/lib/api.ts`: `apiFetch` with base `import.meta.env.VITE_API_URL`, bearer token from `sessionStorage`, `X-Workspace-Id`, problem+json → thrown `ApiError` with message.
- `StoreProvider`: if `VITE_API_URL` is set → require login (Auth page calls `/auth/login`), load `GET /workspace/state`, expose `refresh()`, `loading`, `error`. Every store action and every page-level `update((d) => …)` that changes persistent data calls the matching API endpoint, then `refresh()`. Purely local UI state (copilot chat, theme) stays local. Demo mode keeps today's behaviour unchanged.
- Remove `simulatePayerPayment` in hosted mode; show the PayPal payer link instead ("open the sandbox payer page and pay with your sandbox personal account").

## 12. Environment variables (`server/.env.example`)
```
NODE_ENV=development
PORT=8787
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/centsai
JWT_SECRET=change-me-to-32+-random-chars
CORS_ORIGIN=http://localhost:5173
SEED_DEMO_PASSWORD=change-me
ALLOW_DEMO_RESET=true
PAYPAL_MODE=sandbox            # sandbox | fake
PAYPAL_ENV=sandbox
PAYPAL_BASE_URL=https://api-m.sandbox.paypal.com
PAYPAL_CLIENT_ID=
PAYPAL_CLIENT_SECRET=
PAYPAL_WEBHOOK_ID=
PAYPAL_SANDBOX_PAYER_EMAIL=
```
Frontend: `.env.local` → `VITE_API_URL=http://localhost:8787` (no secrets ever).
