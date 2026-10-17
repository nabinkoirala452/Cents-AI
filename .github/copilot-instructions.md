# Copilot instructions — CentsAI

CentsAI is a finance copilot for small service agencies, built for two hackathons (FinTechathon Topic E, PayPal AI Hackathon).
Read `AGENTS.md` for the frontend layout and `docs/backend/SPEC.md` for the backend. The SPEC is authoritative — if a prompt conflicts with it, stop and ask.

## Ground rules
- **Never re-implement money math.** All figures come from the pure engine in `src/lib/finance.ts` (plus `dates.ts`, `format.ts`, `types.ts`, `seed.ts`). The server imports them through `server/src/core.ts`. Never import React files (`store.tsx`, pages, components) into the server.
- **No AI/LLM work in this phase.** Do not add model SDKs, API keys for models, or prompt code. Leave `src/lib/copilot.ts` and `src/lib/drafts.ts` as they are.
- **Money moves only through approvals.** PayPal write calls (create/send/remind/cancel) are made only by the approvals executor after an authorised approval. Nothing is marked paid until a PayPal `GET` returns `PAID` or a manual payment with a bank reference is recorded.
- **Every query is scoped by `workspaceId` from the authenticated membership** — never trust a workspace id from the request body.
- **Every mutation writes an audit event.** The audit table is append-only.
- **Secrets** live only in `server/.env` (git-ignored). Never put secrets in `VITE_*` variables, in source, in logs, or in audit details. Never log PayPal tokens.
- **Validate every input with Zod.** Errors are `application/problem+json`.
- **Demo mode must keep working**: when `VITE_API_URL` is not set the frontend behaves exactly as before (localStorage only).
- Be honest in UI text: never claim an API call or verification that did not actually happen.

## Code style
- TypeScript strict, ESM, 2-space indent, double quotes, no semicolons (match the existing frontend).
- Small modules: `routes.ts` (HTTP only) → `service.ts` (rules, permissions, audit) → Prisma.
- Prefer explicit names over abbreviations; add a short comment only where the *why* is not obvious.
- Do not add new frontend dependencies without a reason; do not restyle the UI.

## Definition of done for any task
1. `cd server && npm run typecheck && npm test` passes (once the server exists).
2. `npx tsc --noEmit -p .` passes at the repo root (frontend).
3. No new `any`, no `@ts-ignore`, no disabled tests.
4. Update `docs/backend/PROGRESS.md` with what changed, what was tested, and anything left undone.
