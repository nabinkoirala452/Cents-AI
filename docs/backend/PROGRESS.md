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
