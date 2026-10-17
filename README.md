# CentsAI

**An agentic AI finance copilot for small service agencies.**
Understand your cash. Protect your margins. Run your agency with confidence.

CentsAI brings an agency's invoices, payroll, contractors, subscriptions, loans and project costs into one place, forecasts cash flow in three scenarios, explains risks in plain language, and prepares PayPal invoice and reminder actions that a human approves before anything is sent.

Built for **FinTechathon 2026 (Topic E: SME Finance Copilot)** and the **PayPal AI Hackathon 2026**.

## Status

| Part | State |
|---|---|
| Frontend (React + Vite) | Working prototype: 14 pages on a shared, deterministic finance engine; data stored in the browser (demo mode) |
| Backend (Fastify + Prisma + PostgreSQL) | In progress — see [`docs/backend/SPEC.md`](docs/backend/SPEC.md) and [`docs/backend/PROGRESS.md`](docs/backend/PROGRESS.md) |
| PayPal Sandbox (Invoicing v2) | Simulated in the browser today; real integration is part of the backend |
| AI copilot | Rule-based agent over the finance engine today; LLM integration planned after the backend |

## Run the frontend

Requires Node 22.

```bash
npm install
npm run dev
```

Open the printed local URL and choose **Explore the demo**. Demo data is generated relative to today; reset it any time from Settings → Data Management.

## Team setup (new teammate)

1. Install **Node 22** and **Git**, then clone: `git clone https://github.com/nabinkoirala452/Cents-AI.git` and `cd Cents-AI`.
2. Frontend: `npm install` then `npm run dev` → http://localhost:8443.
3. Backend secrets: get the `server/.env` file **privately** from a teammate (WhatsApp/Signal/password manager — never commit it, never post it in public chats or issues). Put it at `server/.env`. The variable names are listed in [`server/.env.example`](server/.env.example).
4. Backend: `cd server`, `npm install`, `npx prisma generate`, then `npm run dev` → http://localhost:8787/api/v1/health.
5. Do **not** run `npm run db:migrate`, `npm run db:seed` or `npm run db:reset` unless you agreed with your teammate — the Supabase database is shared, so these change data for both of you.

**Working together**
- `git pull` before you start, commit small, push often.
- Don't both work on the same phase or the same files at the same time; split by phase (see [`docs/backend/PROMPTS.md`](docs/backend/PROMPTS.md)).
- Record what you did in [`docs/backend/PROGRESS.md`](docs/backend/PROGRESS.md).

## Project layout

- `src/lib/` — data model, demo seed, finance engine (`finance.ts`), store, simulated PayPal adapter, rule-based copilot
- `src/pages/` — one file per page
- `src/components/` — shared UI, layout, charts
- `docs/backend/` — backend spec, build prompts, progress log

## Licence

[MIT](LICENSE)
