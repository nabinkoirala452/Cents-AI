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

## Project layout

- `src/lib/` — data model, demo seed, finance engine (`finance.ts`), store, simulated PayPal adapter, rule-based copilot
- `src/pages/` — one file per page
- `src/components/` — shared UI, layout, charts
- `docs/backend/` — backend spec, build prompts, progress log

## Licence

[MIT](LICENSE)
