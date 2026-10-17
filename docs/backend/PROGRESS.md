# Backend progress log

Each phase appends a section: date, what changed (files), commands run and results, tests, deviations from `SPEC.md`, open questions.

## Phase 0 — setup
- [x] Node 22 installed (v22.23.3 via nvm; dependencies reinstalled with pnpm; `npm run build` passes on Vite 8)
- [x] Git repo initialised with MIT LICENSE and README (remote: github.com/nabinkoirala452/Cents-AI) — pushed
- [x] Supabase project created; local `server/.env` (git-ignored) prepared with the Session pooler URI — DB password still to be filled in by the owner
- [ ] PayPal Sandbox app created — Client ID / Secret / personal payer email still to be filled into `server/.env`
