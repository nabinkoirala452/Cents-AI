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

## Database tests

`npm test` uses the configured `DATABASE_URL` as a connection only. Before
running tests, it creates a uniquely named PostgreSQL schema, deploys migrations
into that schema, runs the tests there, and drops the schema during teardown.
The test does not seed or migrate the configured default schema. The database
role therefore needs permission to create and drop schemas. If setup is
interrupted before teardown, remove the leftover schema whose name starts with
`centsai_test_`.

The seed is repeatable. It refreshes all mutable demo-workspace data. Audit
events are append-only by database trigger, so existing audit rows are retained
and matching seed event IDs are skipped on subsequent runs. The State adapter
labels the original demo audit rows as sample history because their described
actions were not performed by this backend.

Demo data dates are set when the workspace is seeded. Re-run `npm run db:seed`
on the demo day to refresh its relative dates. Phase 3 will add an Owner-only
demo reset endpoint.

The Vite development server uses `http://localhost:8443`; set `CORS_ORIGIN` to
that origin when running the frontend locally.
