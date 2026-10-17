# Backend progress log

Each phase appends a section: date, what changed (files), commands run and results, tests, deviations from `SPEC.md`, open questions.

## Phase 0 — setup
- [x] Node 22 installed (v22.23.3 via nvm; dependencies reinstalled with pnpm; `npm run build` passes on Vite 8)
- [x] Git repo initialised with MIT LICENSE and README (remote: github.com/nabinkoirala452/Cents-AI) — push pending GitHub sign-in
- [x] Supabase project created — still need the Postgres connection string (Session pooler URI) in `server/.env` as `DATABASE_URL`
- [ ] PayPal Sandbox app created (client id/secret kept locally), business + personal sandbox accounts noted
