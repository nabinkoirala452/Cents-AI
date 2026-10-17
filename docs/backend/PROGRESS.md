# Backend progress log

Each phase appends a section: date, what changed (files), commands run and results, tests, deviations from `SPEC.md`, open questions.

## Phase 0 — setup
- [x] Node 22 installed (v22.23.3 via nvm; dependencies reinstalled with pnpm; `npm run build` passes on Vite 8)
- [x] Git repo initialised with MIT LICENSE and README (remote: github.com/nabinkoirala452/Cents-AI) — pushed
- [x] Supabase Postgres 17 reachable from `server/.env` (Session pooler, verified connection)
- [x] PayPal Sandbox app created; OAuth token verified with invoicing scope; personal payer email set in `server/.env`
