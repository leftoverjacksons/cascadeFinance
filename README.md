# Cascade Finance

Household finance tracking: import bank CSV exports, deduplicate, categorise, and see the overall picture. Built for two people, on phone and browser.

- **Design and roadmap:** [`docs/DESIGN.md`](docs/DESIGN.md)
- **App:** https://leftoverjacksons.github.io/cascadeFinance/ (after the first deploy)

## Stack

React 18 + Ionic 8 PWA (Vite), Supabase (Postgres + Auth + Storage), Vitest, pgTAP. Hosted on GitHub Pages.

## Development

```bash
npm install
npm run db:start          # local Supabase in Docker; applies supabase/migrations
cp .env.example .env.local  # fill in the publishable key printed by db:start
npm run dev
```

| Command | What it does |
|---|---|
| `npm test` | Unit tests (Vitest) |
| `npm run db:test` | Database access-control tests (pgTAP, needs `db:start`) |
| `npm run db:reset` | Recreate the local database from migrations |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` after a schema change |
| `npm run typecheck` / `npm run build` | Type check / production build |

Schema changes go in a new file under `supabase/migrations/`. Never edit a migration that has already been deployed.

## Deployment

Every push to `main` runs CI, then applies migrations to the production Supabase project (`supabase db push`), then publishes the app to GitHub Pages.

Required repository secrets: `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`.

## Data safety

- Real bank exports are git-ignored (`*.csv`). Use synthetic fixtures in `tests/fixtures/`.
- The publishable key in `src/config.ts` is public by design; data is protected by Row Level Security, which is covered by tests in `supabase/tests/`.
