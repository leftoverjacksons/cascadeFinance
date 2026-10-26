# Cascade Finance — Design Document

> Living document. Status: **v0.2 draft — under discussion, no code yet.**
> Update this file whenever a decision is made or reversed; record it in the Decision Log (§11).

---

## 1. Purpose

A self-hosted personal finance application for a two-person household, replacing Monarch Money.

Motivating problems with the incumbent:

| Problem | Design response |
|---|---|
| Cost | Supabase free/low tier + static web hosting. Target: ~$0–25/month. |
| Limited configurability | User-defined category tree and user-defined categorisation rules; bank categories are retained only as an input signal. |
| Unreliable account connections (aggregator links break) | **File import is the primary ingestion path.** No dependency on Plaid/MX/Finicity in v1. A live feed may be added later as an optional second source feeding the same pipeline. |

## 2. Goals and non-goals

**Goals (v1)**
1. Import CSV exports from multiple institutions/accounts.
2. Parse, normalise, and **deduplicate** against previously imported data, such that re-importing an overlapping or identical file is idempotent.
3. Categorise transactions into a household-defined taxonomy, via rules plus manual override.
4. Present an overall picture: cash flow, spending by category, account balances, net worth including liabilities (mortgage, auto loan).
5. Shared access for both household members with proper access control.
6. Browser UI first; mobile-usable from the start; native/mobile app later.

**Non-goals (v1)**
- Automatic bank connections / aggregators.
- Investment/brokerage holdings tracking (revisit later).
- Bill pay or any write access to financial institutions.
- Multi-household / SaaS tenancy beyond what falls out of the data model for free.

## 3. Accounts in scope

| Account | Institution | Owner | Expected data source |
|---|---|---|---|
| Checking (A) | USAA | Member 1 | CSV (`bk_download.csv`) |
| Checking (B) | USAA | Member 2 | CSV (same format assumed) |
| Shared checking | USAA | Joint | CSV (same format assumed) |
| Savings | USAA | TBD | CSV (same format assumed) |
| Credit cards (several) | TBD (Member 2's issuers pending) | TBD | CSV — formats to be collected |
| Mortgage | TBD | Joint | Probably no transaction export; statement balance + loan terms |
| Auto loan | Ford Motor Credit (observed in checking payments) | TBD | Same as mortgage |

## 4. Observations from the sample export (USAA checking, `bk_download.csv`)

Sample: 1,641 rows, 2025‑04‑28 → 2026‑10‑26 (~18 months).

```
Date,Description,Original Description,Category,Amount,Status
2026-10-23,"Publix","PUBLIX SUPER MAR 3695 C  ATLANTA      GA",Groceries,-137.70,Posted
```

Findings that directly constrain the design:

1. **No account identifier and no running balance in the file.** The importer cannot infer which account a file belongs to; the user must select (or a remembered mapping must supply) the target account. Balances must come from elsewhere (manually entered statement balance, or a separate export).
2. **Signed amounts**, negative = outflow, ISO dates. Good. Credit card exports from other issuers frequently invert the sign or split debit/credit columns → per-format mapping is required.
3. **Two description fields**: `Original Description` (raw processor string) and `Description` (USAA's cleaned merchant name). Raw is the more stable key; the cleaned one is better for display.
4. **Pending rows mutate on posting.** Pending: `PUBLIX #503  102526`, `Category Pending`. Posted equivalent later appears with a different raw string (`PUBLIX #503  ATLANTA GA`), possibly a different date and occasionally a different amount (tips, holds). Pending rows therefore cannot be matched to their posted form by exact key.
5. **Legitimate exact duplicates exist.** 6 (date, raw description, amount) groups occur twice (e.g. two identical coffee purchases same day). A naive "unique on date+description+amount" constraint would silently drop real transactions.
6. **Bank categorisation is incomplete and coarse.** 54 distinct bank categories; 34 *posted* rows still carry `Category Pending`; overlapping categories (`Utilities` vs `Bills & Utilities`, `Restaurants` vs `Food & Dining`, `Pets` vs `Pet Food & Supplies`).
7. **Inter-account transfers are present** (`USAA Funds Transfer DB`, `USAA Transfer`, Venmo). These will appear twice once the counterpart account is imported, and must not count as income/spending.
8. **Loan payments are visible from the payer side** (`Ford Motor Credit`, `Department of Education`). These are transfers to a liability account, not expenses (except the interest portion, if we choose to model it).

## 5. Architecture

```
 ┌───────────── Browser (web app, responsive / PWA) ─────────────┐
 │  CSV file → parse (in browser) → preview + mapping → submit   │
 └───────────────────────────────┬───────────────────────────────┘
                                 │ supabase-js (user JWT)
 ┌───────────────────────────────▼───────────────────────────────┐
 │ Supabase                                                      │
 │  Auth ── email magic link / OAuth, 2 users                    │
 │  Storage ── raw uploaded files (private bucket, audit trail)  │
 │  Postgres ── tables + Row Level Security per household        │
 │           ── RPC `import_batch(...)` : dedup + insert, atomic │
 │           ── rules engine (SQL function) for categorisation   │
 │  Edge Functions ── only if something can't live in SQL       │
 └───────────────────────────────────────────────────────────────┘
```

Stack — reuses the proven stack of the household's previous project (LakTrak):

| Layer | Choice |
|---|---|
| Language | TypeScript 5.x |
| UI | React 18 + Ionic 8 (`@ionic/react`, Ionicons). Ionic's `IonSplitPane` gives a sidebar layout on desktop and tabs on phone from one codebase. |
| Navigation | React Router 5 via Ionic router |
| Charts | Chart.js 4 |
| Data/auth | supabase-js 2 (incl. realtime, so both devices see imports/edits live) |
| Build | Vite 6 + vite-plugin-pwa |
| Tests | Vitest (parser, dedup, rules, settlement maths); Playwright (multi-user flows: member 1, member 2) |
| Hosting | GitHub Pages, deployed by CI on green tests |
| Backend | Supabase (Postgres, Auth, RLS, Storage); schema as SQL migrations via the Supabase CLI, in this repo |

Consequences: browser and phone are the same app from day one (PWA), so the separate "mobile later" phase collapses to polish work. GitHub Pages serves only static files; the Supabase anon key in the bundle is public by design, and all data protection rests on RLS — RLS policies therefore need their own automated tests.
- **Parsing location:** in the browser (PapaParse). Rationale: immediate preview and mapping UI, no server compute; the authoritative dedup still happens server-side inside one transaction.

## 6. Data model (initial sketch)

All money as **integer cents** (`bigint`). All tables carry `household_id` for RLS.

```
households(id, name)
household_members(household_id, user_id, role)            -- role: owner | member

institutions(id, name)
accounts(id, household_id, institution_id, name, type,     -- type: checking | savings | credit_card
         owner_user_id NULL /*NULL = joint*/,              --       | mortgage | auto_loan | other_loan
                                                           -- visibility: all members see all accounts
         is_liability, currency, import_format_id NULL,
         opened_on, closed_on)

import_formats(id, name, column_map jsonb, date_format,    -- e.g. "USAA bank CSV"
               sign_convention, has_header)
imports(id, household_id, account_id, uploaded_by,
        storage_path, file_sha256 UNIQUE per account,
        original_filename, exported_at,                   -- user-supplied at upload
        balance_at_export_cents NULL,                     -- user-supplied; also written to balance_snapshots
        rows_total, rows_inserted, rows_duplicate, rows_pending,
        date_min, date_max, created_at)

transactions(id, household_id, account_id, import_id,
             posted_on date, amount_cents bigint,
             raw_description text,                        -- "Original Description"
             display_description text,                    -- "Description" (editable)
             bank_category text,                          -- kept verbatim, never authoritative
             status,                                      -- posted | pending
             fingerprint text, occurrence smallint,       -- see §7
             category_id NULL, category_source,           -- rule | manual | none
             merchant_id NULL, notes, transfer_group_id NULL,
             is_excluded bool,
             is_shared bool, share_ratio NULL,            -- §9a; NULL = household default
             created_at, updated_at)

categories(id, household_id, parent_id NULL, name, kind,   -- kind: expense | income | transfer
           is_archived, sort_order)
category_rules(id, household_id, priority, match_field,    -- raw_description | display | bank_category
               match_type, pattern, amount_min, amount_max,--   | account
               account_id NULL, set_category_id,
               set_display_description NULL, created_from_txn_id NULL)
merchants(id, household_id, name)                          -- optional normalisation layer

balance_snapshots(id, account_id, as_of date, balance_cents, source, import_id NULL)  -- export | statement | manual
settlements(id, household_id, from_user_id, to_user_id, amount_cents, settled_on,
            transaction_id NULL, note)                     -- §9a
loan_terms(account_id, principal_cents, apr, term_months,
           first_payment_on, payment_cents, escrow_cents NULL)
```

## 7. Import & deduplication

Ingestion pipeline per file:

1. **Select account** (remembered per filename/format where possible) and enter **balance at time of export** (optional but encouraged).
2. **Parse** with that account's `import_format` → normalised rows `{date, amount_cents, raw_desc, display_desc, bank_category, status}`.
3. **File-level check:** SHA‑256 of file bytes; identical file for the same account → reject as already imported.
4. **Preview** to the user: counts of new / duplicate / pending / suspicious rows before commit.
5. **Commit** via one RPC; everything below runs in a single transaction.
6. **Archive** the original file in a private Storage bucket, byte-for-byte unmodified, at
   `imports/{household}/{account}/{yyyy-mm-dd}_{sha256-prefix}.csv`. Provenance (account, export date, balance at export, uploader, hash, row counts) lives in the `imports` row and is also written as a sidecar `….meta.json` next to the file, so the archive is self-describing even without the database.
   Rationale for not injecting a header into the CSV itself: modifying the file changes its hash, destroys the "this is exactly what the bank gave us" property, and can break re-parsing.

**Balance reconciliation.** With a balance at export for two imports of the same account, `balance₂ − balance₁` must equal the sum of posted transactions between the two export dates. A mismatch flags missing or duplicated rows. Snapshots also allow reconstructing a running balance for every transaction, since the bank file has none.

**Posted rows — fingerprint + occurrence index.**
`fingerprint = hash(account_id, posted_on, amount_cents, normalise(raw_description))`, where `normalise` upper-cases and collapses whitespace.
Within a file, identical fingerprints are numbered `occurrence = 1, 2, …`. The unique key is `(account_id, fingerprint, occurrence)`.
Consequence: re-importing an overlapping export inserts nothing new; two genuine identical coffees remain two rows; a third identical coffee appearing in a later export becomes occurrence 3 and is inserted.
Known weakness: if a bank retroactively edits a posted row's raw description, it would be imported as a new row. Mitigation: the preview flags new rows whose (date ±3 days, amount) matches an existing row as *suspected duplicates* for manual confirmation.

**Pending rows — shown, but treated as an ephemeral snapshot.**
Pending rows are displayed (visually distinct) and included in a "pending" line of cash-flow views, but are not durably deduplicated. On each import for an account, all existing `pending` rows for that account are deleted and replaced with the pending rows in the new file. Posted rows are the durable record.
Categorisation of pending rows (v1): **rules apply automatically; manual categorisation is not offered.** Rationale: a manual edit on a row that is about to be deleted and replaced would be silently lost, and fuzzy pending→posted matching (amount ±20%, date ±5 days, merchant token overlap) is error-prone. Rules match on merchant text, which is usually present in both forms (`PUBLIX #503 …`), so most pending rows still get a category. Revisit if this proves insufficient.

**Transfers.**
After insert, a matcher proposes pairs across the household's accounts: opposite signs, equal absolute amount, dates within N days, and at least one side matching a transfer-like rule. Paired rows share `transfer_group_id` and are excluded from income/spending totals. Payments to loan accounts are transfers to a liability.

**Re-import guarantees (invariants to test):**
- Importing the same file twice ⇒ zero new rows.
- Importing file B overlapping file A ⇒ only rows outside A, plus extra occurrences, are added.
- Import order of overlapping files does not change the final set of posted rows.
- Manual edits (category, notes, display description) are never overwritten by a re-import.

## 8. Categorisation

- **Household-owned taxonomy**, two levels (group → category), e.g. *Food → Groceries / Restaurants / Coffee*. Seeded from a starter template, fully editable. Bank categories are mapped, not adopted.
- **Precedence:** `manual` > `rule` > `none`. A rule never overwrites a manual assignment.
- **Rules** are ordered; first match wins. Match on raw description (contains / starts with / regex), optionally constrained by account and amount range. Rules can also rewrite the display name ("SQ *REVOLUTION DOUGHNUT…" → "Revolution Doughnut").
- **Learning loop:** when a user recategorises a transaction, offer "apply to all similar and create rule". Re-running rules over history is an explicit action with a preview of affected rows.
- **Splits** (one Amazon order across categories): deferred; schema should not preclude a `transaction_splits` table later.

## 9. Liabilities: mortgage and auto loan

Likely no usable transaction export. Proposed model:
- Each loan is an `account` with `is_liability = true`.
- Balance comes from periodic `balance_snapshots` (entered from statements) and/or an amortisation schedule computed from `loan_terms`.
- The checking-side payment is a transfer into the loan account; optionally split into principal / interest / escrow using the schedule, so interest can be reported as an expense.

## 9a. Shared expenses and member balance

Goal: tag certain expenses as mutual, see who has paid more, and how large the imbalance is.

Model:
- **Payer** of a transaction is derived from its account: personal account → that member; joint account → the joint pool.
- **`is_shared`** marks an expense from a personal account as mutual. Rules can set it (e.g. all `Groceries` are shared); it can be toggled per transaction.
- **Split ratio**: household default (e.g. 50/50, or proportional to income), overridable per transaction.
- For each shared expense of amount *A* paid by member *p*: *p* is credited *A × (1 − share_p)* owed by the other member.
- **Joint account**: expenses paid from it are already shared and do not create a debt. What matters is each member's **contributions** into it (transfers from personal → joint), which are compared against the split ratio.
- **Settlements**: a transfer between members (or an explicit settlement entry) reduces the balance.
- Output: running balance "Member 1 owes Member 2 $X", per-month breakdown, list of contributing transactions.

Open: default split ratio (Q10).

## 10. Roadmap (phased)

| Phase | Scope |
|---|---|
| 0 — Design | This document; collect sample exports from every account; settle open questions. |
| 1 — Foundation | Supabase project, migrations, auth, household + RLS, accounts CRUD. |
| 2 — Import | USAA format, parser, preview, dedup RPC, import history, invariants as automated tests. |
| 3 — Categorise | Category tree, rules engine, manual edit, bulk recategorise, transfer matching. |
| 4 — Overview | Transactions list (search/filter), monthly cash flow, spending by category, balances, net worth. |
| 5 — More formats | Credit card formats, savings, loans + balance snapshots. |
| 5a — Shared expenses | `is_shared`, split ratio, joint contributions, settlement balance. |
| 6 — Budgets & trends | After ~2–3 months of categorised data: per-category monthly targets vs actuals; recurring-charge detection. |
| 7 — Mobile polish | PWA install, offline read cache, phone-first import flow. (No separate native app planned.) |

## 11. Open questions

1. **Credit cards:** Member 2's issuers, plus one sample export per issuer.
2. **Savings ownership:** joint or personal?
3. **Auth method:** magic link, Google sign-in, or password (whatever LakTrak uses is the default)?
4. **History depth:** how far back to import initially (USAA sample is ~18 months)?
5. **Shared-expense split:** 50/50, or proportional to income? Same ratio for everything?
6. **Joint account contributions:** are both members expected to transfer into the joint account on a schedule, and should that be part of the "who paid more" calculation? (Proposed: yes.)
7. **Budgeting:** deferred until ~2–3 months of categorised data exist; then start with simple monthly targets per category.

## 12. Decision log

| Date | Decision | Rationale | Status |
|---|---|---|---|
| 2026-10-26 | File import (CSV) is the primary ingestion path | Aggregator connections were the main failure mode of Monarch | Proposed |
| 2026-10-26 | Supabase for auth, Postgres, storage | Prior positive experience; RLS fits household sharing | Proposed |
| 2026-10-26 | Money stored as integer cents | Avoid floating-point error | Proposed |
| 2026-10-26 | Dedup by (account, fingerprint, occurrence); pending rows replaced per import | Sample shows legitimate identical rows and mutating pending rows | Proposed |
| 2026-10-26 | Bank categories retained but non-authoritative | Coarse, overlapping, and incomplete in sample | Proposed |
| 2026-10-26 | Real financial exports are never committed to the repo | Privacy; use synthetic fixtures for tests | Proposed |
| 2026-10-26 | Reuse LakTrak stack: React 18 + Ionic 8 + Vite PWA, Chart.js, supabase-js, Vitest + Playwright, GitHub Pages | Proven by the household; phone + browser from one codebase | Accepted |
| 2026-10-26 | All members see all accounts | Household preference | Accepted |
| 2026-10-26 | Pending transactions shown; categorised by rules only, no manual edit | Pending rows are replaced on each import; manual edits would be lost | Accepted |
| 2026-10-26 | Start fresh; no Monarch data migration | Household preference | Accepted |
| 2026-10-26 | Original files archived unmodified in Storage; provenance (account, export date, balance at export) in DB + sidecar JSON | Preserves hash/audit integrity; enables balance reconciliation | Accepted |
| 2026-10-26 | Shared-expense tracking with member balance and settlements is in scope | Household requirement | Accepted |
| 2026-10-26 | Budgeting deferred until categorised data exist | Household new to budgeting; targets need baseline | Accepted |
