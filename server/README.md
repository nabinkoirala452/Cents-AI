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
`centsai_test_`.

The seed is repeatable and refreshes mutable demo-workspace data. It does not
insert sample audit rows; the audit log starts empty and is populated only by
operations that actually occur. Audit events are append-only by database
trigger, so real events are retained on subsequent seeds. The one-time
`20261017180000_remove_fake_demo_audit` migration removed the former fake demo
operation claims.

Demo data dates are set when the workspace is seeded. Re-run `npm run db:seed`
on the demo day to refresh its relative dates. Phase 3 will add an Owner-only
demo reset endpoint.

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
