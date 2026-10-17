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
- **Dependency security:** upgraded Vitest to 4.1.12 and pinned esbuild to 0.28.2. The npm advisory scan still reports three high-severity findings in the Prisma 6 / `deepmerge-ts@7.1.5` chain. The available fix requires moving to Prisma 7, which conflicts with the stack decision in `SPEC.md`; Prisma 6 is retained pending an approved stack change or upstream patch.
- **Deviations:** seed reruns cannot delete existing audit rows because the required DB trigger forbids deletion; all other demo workspace data is refreshed. `loadState()` filters Stale approvals because the frontend `ApprovalStatus` type does not represent Stale. Tests use a uniquely named temporary PostgreSQL schema on the configured database connection and drop it after completion.
- **Remaining:** no auth, business routes, PayPal integration, or frontend hosted-mode API client were added; they remain outside this foundation task. Consider the Prisma advisory before deployment.
