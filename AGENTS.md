# CentsAI (originally a Figma Make export)

React + Vite + Tailwind CSS frontend for CentsAI, an agentic finance copilot for small service agencies. The code was exported from Figma Make and is now developed locally — this folder is the source of truth; do not re-export from Figma over it.

## Development Server

Run `pnpm dev` (or `npm run dev`). Vite 8 requires Node 20.19+ or 22.12+.

## Backend

The backend is being built in `server/` (Fastify + Prisma + PostgreSQL, real PayPal Sandbox). The authoritative spec is `docs/backend/SPEC.md`, the build prompts are in `docs/backend/PROMPTS.md`, and progress is logged in `docs/backend/PROGRESS.md`. The copilot agent (Groq LLM via an OpenAI-compatible API, finance tools, PayPal Agent Toolkit read tools, approval proposals) lives in `server/src/modules/copilot/`; see `server/README.md`.

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Store provider, hash router (`#/app/<page>`), app shell and page registry
- `src/lib/` - Frontend domain layer, shaped so a backend can replace it later:
  - `types.ts` workspace data model · `seed.ts` demo data generated relative to today
  - `finance.ts` deterministic finance engine (cash, receivables, 3-scenario forecast, margins, loans, briefing) — every number in the UI comes from here
  - `store.tsx` React context + localStorage persistence, permission tiers, approval workflow and audit log
  - `copilot.ts` read-only finance tools shared by the rule-based router (browser) and the LLM agent (server), plus the answer shape
  - `paypal.ts` simulated PayPal Sandbox adapter (to be replaced by backend calls)
  - `router.ts`, `dates.ts`, `format.ts`, `csv.ts`, `drafts.ts` helpers
- `src/components/` - `ui.tsx` primitives, `layout.tsx` sidebar/header/search/alerts, `charts.tsx`, `finance-ui.tsx`
- `src/pages/` - one file per page (Dashboard, Briefing, Transactions, Invoices, CashFlow, Expenses, Payroll, Loans, Projects, Simulator, Financing, Copilot, Approvals, Settings, Landing, Auth)
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Code quality

- Use double quotes for strings containing apostrophes (`"We're here to help"`), or escape them in single-quoted strings. An unescaped apostrophe in a single-quoted string breaks the build.
- Ensure JSX tags are closed and braces are balanced.
- Export components as default exports.
