# Cascade Finance — Design Document

> Living document. Status: **v1.0 — Phases 1–4, desktop workspace, 5a (transfer linking, money flow, shared expenses and paybacks); next: 5 (card formats) / 6 (budgets).**
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
| Savings | USAA | Joint | CSV (same format assumed) |
| Credit card | American Express | Member 2 | CSV — sample pending (tabled) |
| Credit card | Discover | Member 2 | CSV — sample pending (tabled) |
| Credit card | IKEA card (issuer TBD) | Member 2 | CSV — sample pending (tabled) |
| Credit cards (Member 1) | TBD | Member 1 | TBD |
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
- **Split ratio**: household setting, default **50/50**, configurable in settings; overridable per transaction.
- For each shared expense of amount *A* paid by member *p*: *p* is credited *A × (1 − share_p)* owed by the other member.
- **Joint account as pass-through**: in practice the joint checking is used mainly as an intermediary for moving money between accounts, not for spending. Consequences:
  - Transfer matching must handle **chains** (personal A → joint → personal B, possibly a few days apart), not only direct pairs. A chain is collapsed into one logical transfer A → B.
  - The rare expense paid directly from joint is shared by definition and creates no debt.
  - Contributions into joint are **not** scored as "paying more" by themselves; only the money's final destination matters.
- **Settlements**: a logical transfer from one member's personal account to the other's (direct or via joint) is proposed as a settlement; it **defaults to accepted** (household confirmed such transfers are usually paybacks); the user can reclassify it (e.g. a gift). Explicit manual settlement entries are also allowed.
- Output: running balance "Member 1 owes Member 2 $X", per-month breakdown, list of contributing transactions.


## 10. Roadmap (phased)

| Phase | Scope |
|---|---|
| 0 — Design | This document; collect sample exports from every account; settle open questions. |
| 1 — Foundation ✅ | Supabase project, migrations, auth, household + RLS, accounts CRUD, CI/deploy. |
| 2 — Import ✅ | USAA format, parser, preview, dedup RPC, import history, invariants as automated tests. |
| 3 — Categorise ✅ | Category tree, rules engine, manual edit, bulk recategorise. (Transfer *pair linking* moved to 5a, where settlements need it.) |
| 4 — Overview ✅ | Transactions list (search/filter), monthly cash flow, spending by category, balances, net worth. |
| 5 — More formats | Credit card formats, savings, loans + balance snapshots. |
| 5a — Shared expenses ✅ | Part 1: transfer linking + money-flow Sankey. Part 2: shared expenses, paybacks (direct and via joint), recorded payments, member balance. |
| 6 — Budgets & trends | After ~2–3 months of categorised data: per-category monthly targets vs actuals; recurring-charge detection. |
| 7 — Mobile polish | PWA install, offline read cache, phone-first import flow. (No separate native app planned.) |

## 10a. Implementation status

**Phase 1 (done):**
- Migration `supabase/migrations/20261026000001_foundation.sql`: `households`, `household_members` (with `split_weight`), `accounts`, private `imports` Storage bucket, RLS on all of them, RPCs `create_household` and `add_household_member`.
- Deviation from §6: `institutions` is a free-text column on `accounts` for now, and the split ratio is stored as per-member `split_weight` (share = weight / sum of weights) rather than a single household ratio. This generalises cleanly and makes 50/50 the default (equal weights).
- One household per user (unique index). Sufficient for this household; lift if ever needed.
- Import archive bucket is append-only from the client (select + insert policies only).
- Tests: 26 pgTAP access-control tests (`supabase/tests/database/`), verified to fail when an RLS policy is weakened; 24 Vitest unit tests (money parsing, account grouping, split maths).
- App: login, password reset, household setup, add partner, accounts CRUD (grouped Cash / Credit / Loans), split setting, placeholder tabs for later phases. Hash-based routing (GitHub Pages has no SPA fallback); PKCE auth flow so reset links do not collide with hash routes.
- CI: typecheck, unit tests, build, migrations + pgTAP on local Supabase, generated-types drift check. Deploy on `main`: CI → `supabase db push` → GitHub Pages.
- Not yet automated: browser end-to-end tests (Playwright). Phase 1 flows were verified manually with a Playwright script against local Supabase (two users, household creation, partner add, split change persisted, shared account visible to partner); to be committed as a CI suite in Phase 2.

**Phase 2 (done):**
- Migration `20261027000001_import.sql`: `imports`, `transactions`, `balance_snapshots`; RPCs `preview_import` (read-only classification) and `import_batch` (atomic insert). Child tables reference `(household_id, account_id)` so a row can never point at another household's account.
- Clients cannot insert or delete transactions, nor change amounts/dates; they may edit only `display_description` and `notes` (column grants). Pending rows are read-only in the UI.
- Fingerprint = sha256(date | cents | upper-cased, whitespace-collapsed raw description); occurrence numbered within the file. Implemented in SQL, so the database is the single authority.
- Stale-pending rule: an import replaces the account's pending rows only if no import with a *later* `exported_on` exists.
- Suspected duplicates: a new row with the same amount within ±3 days of an existing posted row that the file does not itself account for. Shown for review, imported unless the user ticks *skip*.
- Archive: original file uploaded unmodified to `imports/{household}/{account}/{exported_on}_{sha256[:16]}.csv`, plus `.meta.json` sidecar. Identical file for the same account is detected before import (hash lookup) and refused by the database (unique constraint).
- Parsing in the browser (PapaParse) via a format registry (`src/import/formats/`); format auto-detected from the header row. Only `usaa_bank` exists so far.
- Verified on the real 1,641-row USAA export (locally, file not committed): 0 parse errors, 1,633 posted + 8 pending, amount total identical to an independent computation; preview ≈0.2 s, import ≈0.3 s.
- Tests: 31 pgTAP import tests (idempotency, identical same-day rows, pending replacement and stale-pending, order independence, suspects, skip, validation, isolation); 14 new unit tests; Playwright end-to-end suite (phone + desktop viewports) now runs in CI.
- Deferred: balance reconciliation between snapshots (pending vs. posted balance semantics need care) → Phase 4. Undo of an import → later.

**Phase 3 (done):**
- Migration `20261027000002_categories.sql`: `categories` (two levels, kind inherited from group, archive instead of delete), `category_rules`, `transactions.category_id` + `category_source` (`none | rule | manual`), RPCs `preview_category_rule` and `set_transaction_category`.
- **Change from §8:** rather than an explicit "re-run rules over history" action, non-manual categories are *always* the output of the current rule set. Any insert/update/delete of a rule re-categorises the household automatically (statement-level triggers), and imported rows are categorised on insert. The preview happens while authoring a rule (live match count + examples), which serves the same purpose as the planned re-run preview.
- Rule fields: description (raw or display name) or bank category; match `contains | starts with | equals | regex` (case-insensitive, invalid regex rejected at write); optional account scope and absolute-amount range; priority (lower first; ties by creation time).
- Seeded per household: 15 groups / 64 categories, ~53 bank-category mapping rules (priority 1000) and 2 internal-transfer description rules (priority 500). User rules default to priority 100, so they take precedence. Rehearsed on the real USAA export: 1,596 / 1,641 rows categorised automatically; the 45 left are rows USAA itself had not categorised.
- Manual category on pending rows is rejected by the database (check constraint). "Reset to automatic" hands a row back to the rules immediately.
- "Create a rule" from a transaction suggests a pattern from the bank description (fixed-width merchant field, processor prefixes such as `SQ *` and `TST*` removed, store numbers dropped), shows how many transactions it would match, and is pre-ticked.
- Deferred: rules that rename (display name), transaction splits, transfer pair/chain linking (→ 5a).
- Tests: 31 new pgTAP tests (88 total, verified to fail when the matcher is broken), 18 new unit tests (56 total), new Playwright scenario (automatic categories, manual + rule, Uncategorized filter, bulk edit, rule editor) on phone and desktop.

**Phase 4 (done):**
- Migration `20261028000001_reports.sql`: `monthly_category_totals(from, to)` and `balance_history(dates[])`, both `SECURITY INVOKER` (read through RLS). Pending rows excluded.
- Overview is trend-first (household preference): period 6 / 12 / 24 months; tiles for average monthly spending, income and saved (full months only; the current month is shown as "so far" and excluded from averages) and net worth.
- Money conventions: Transfer-kind categories excluded from income and spending; expense categories are netted (refunds reduce spending); uncategorised money out counts as spending, money in as income.
- Charts (Chart.js 4): monthly income vs spending (grouped bars); spending by group (stacked, top 6 groups + Other, with a table underneath that expands to categories); net worth (line). Palette is the validated categorical order, separately stepped for light and dark and checked with the palette validator against both surfaces. Group colours are chosen over the full 24-month history so switching the period never recolours a group. Months where a group's refunds exceed its spending are drawn at zero; tooltip and table show the net figure.
- Balances: "Record balance" on any account (statement balances; liabilities entered as amount owed). Balance at any date = nearest snapshot (latest on/before, else earliest after) rolled with posted transactions. Net worth includes only accounts that have at least one recorded balance, and says how many.
- Interpretation note: "saved" = income − spending, transfers excluded. Until every account is imported, money moved to other accounts counts as saved even though it left the imported account.
- Also fixed: primary colour was unreadable in dark mode (lighter step for dark).
- Tests: 12 new pgTAP tests (100 total); 9 new unit tests; new Playwright overview scenario (statement balance, net worth, table expansion, period switch).
- Deferred: the planned balance *reconciliation* check between consecutive exports; per-category drill-down into the transaction list.

**Desktop / responsive layout (done):**
- Primary target is a desktop browser (household uses an ultrawide monitor); phones must stay fully usable and fast.
- Breakpoints: < 768 px phone (single column, bottom tabs); 768–1199 px tablet (two-column stacked panels, bottom tabs); ≥ 1200 px desktop (left sidebar via `IonSplitPane`, tab bar hidden).
- **Overview workspace (desktop):** each chart/table is a panel on a 12-column snap grid (react-grid-layout 1.5). Default: summary tiles across the top, then two half-width panels per row. Panels can be dragged by their title, resized from the corner (min ¼ width), hidden, re-added ("Add panel") and reset. Row height is computed so 12 grid rows fill the window, so the default layout fills the screen at any resolution. Charts redraw to fit their panel.
- Layout is stored **per person** in `user_preferences.dashboard_layout` (migration `20261029000001`; RLS: own row only, partners cannot read each other's). Stored layouts are validated against the known panel list on load (unknown panels dropped, sizes clamped, malformed → default).
- An extra *Transactions* panel (desktop only) lists recent transactions with an "Uncategorized" filter; categorising there refreshes the charts.
- **Phone cost:** the grid library is code-split into a chunk loaded only at ≥ 1200 px (≈26 KB gzipped) and excluded from the service-worker precache (cached at runtime on desktops only). Main bundle grew 434 → 437 KB gzipped. A Playwright test asserts the phone never requests the grid code.
- Transactions (desktop): sortable table (date, amount) with the transaction detail docked as a side panel instead of a pop-up. Import: two columns (form/preview | new rows/history). Accounts: groups in a responsive grid.
- **Performance fix found during this work:** categorising imports had become slow (4.3 s DB time for the 1,641-row export) because the rule matcher could not be inlined by Postgres. Migration `20261029000002` rewrites it as inlinable expressions: 0.7 s, identical results.

**Phase 5a part 1 (done): transfer linking and money flow:**
- Migrations `20261030000001` (enum value `category_source = 'transfer'`, separate because a new enum value cannot be used in the transaction that adds it) and `20261030000002`.
- `transfer_links` pairs an outgoing transaction with an incoming one in another household account: equal and opposite amount, within 4 days, at least one side transfer-like (transfer-kind category, or description containing TRANSFER/XFER), neither side marked "not a transfer" by a manual spending category. Greedy, closest dates first. Status `auto` (unique candidate both ways), `suggested` (ambiguous, shown for review) or `confirmed`.
- Linked sides take a transfer category (card payment / loan payment / between accounts by the receiving account's type) with `category_source = 'transfer'`, which rules never override; both drop out of income and spending regardless of wording.
- Matching runs after every import (statement trigger, after categorisation), on demand ("Find matches"), and once over existing data at migration time. Unlinking records a rejection so the pair is never re-proposed; choosing a spending category by hand unlinks and rejects. Manual linking (`link_transfer`) with candidate list (`transfer_candidates`: opposite sign, other account, ±10 days, exact amounts first).
- Transfers page: To check (suggested), No match found (transfer-categorised but unlinked, grouped by category), Linked. Transactions show "→ Joint" / "← Checking".
- **Money flow (Sankey)** panel (chartjs-chart-sankey pinned to 0.14.0: later versions had an unusual burst of releases): income categories → accounts → other accounts (linked transfers, netted per account pair; cycles broken at the smallest flow) → spending groups (same colours as the spending chart) / unmatched transfers out. Flows under 0.3 % of the largest node are not drawn but stay in the table view. On phones and desktop.
- Dashboard layouts record which panels existed when saved; panels added later appear automatically for existing layouts, hidden ones stay hidden.
- Known limits: loan and card payments stay "No match found" while those accounts are tracked by statement balance only (no transactions to pair with). Two-hop transfers through the joint account are linked as two separate transfers until part 2.
- Tests: 25 new pgTAP tests (131 total; verified to fail when the date window is widened), 11 new unit tests, new Playwright transfers scenario.

**Phase 5a part 2 (done): shared expenses and paybacks:**
- Migration `20261101000001_shared.sql`. Implements §9a with these concrete choices:
  - *What is shared:* `categories.is_shared` ("shared by default"; seeded for Groceries, Housing, Utilities, Pets) with a per-transaction override `transactions.shared_override` (null = category default). Only spending from a personal account (`accounts.owner_user_id` set) enters the ledger; joint-account spending is shared by definition and creates no debt. Linked transfers are never expenses.
  - *Split:* per-member `split_weight` (unchanged; 50/50 default).
  - *Paybacks:* `member_transfers()` derives money moving between two members' personal accounts: direct links, and two-hop routes personal → joint → other personal (same amount, second hop within 7 days of the first arriving; most-constrained/closest first, each hop used once). Each counts as a payback unless switched off (`settlement_overrides`, keyed by the sender's transaction so it survives re-matching). Payments outside the accounts go in `manual_settlements`. Money put into the joint account and not passed on is not a payback (pass-through model from §9a).
  - *Ledger:* `shared_ledger()` returns entries "debtor owes creditor N cents" (expense shares, paybacks, recorded payments) from `households.shared_since` (null = all history). The client nets them per pair.
- **Matcher change: order-independent.** Automatic and suggested links are recomputed from scratch on every run (confirmed links and rejections kept), most constrained first (a transaction with one possible partner is paired before ones with alternatives), then closest dates. Manual link / unlink / "not a transfer" re-run it immediately. Previously the result depended on import order (a 4-day direct pairing could pre-empt two 1-day hops via the joint account imported later). "Zelle" now counts as transfer wording.
- UI: Shared page (balance with "Settle up", start date, by-month table, money between you with a Payback toggle, recorded payments, shared expenses with "Not shared"); "Shared between you" dashboard panel; "shared by default" on categories; "Shared with partner" on a transaction (personal-account spending only).
- **Accessibility bug fixed:** closing a dialog that contained a dropdown (e.g. account owner, import account) left `aria-hidden` on the router outlet, hiding the whole app from screen readers. A global handler clears it once no overlay is open; regression-tested. (This was the cause of an earlier "flaky" test previously attributed to Playwright.)
- Tests: 19 new pgTAP tests (153 total) incl. import-order independence; 5 new unit tests; Playwright shared scenario.

## 11. Open questions

1. **Credit card samples** (tabled): one export each from Amex, Discover, IKEA card; Member 1's cards, if any.
2. **Maximum USAA export range:** to be determined empirically by trying the longest custom date range the site allows. Overlapping chunks are safe to import (dedup is order-independent).
- **Loan payments: transfer or spending? (TABLED 2026-10-31, revisit.)** A loan payment is principal (a transfer: reduces the liability, net worth unchanged) plus interest (a real cost); a mortgage payment may also include escrow (taxes, insurance: real costs). Currently loan payments are a *transfer* (bank category "Auto Payment" → Transfers › Loan Payments), so spending is understated and "avg saved" overstated by the payment (~$579/month for the auto loan). Options:
  - **A. Transfer (current).** Optionally "point" unmatched loan payments at the loan account so the Sankey shows Checking → Car loan and they leave "No match found".
  - **B. Spending (recommended).** Move Loan Payments into a spending group (e.g. new "Debt Payments": auto loan, student loan, mortgage); payments into loan accounts count as spending even if loan transactions are imported later. Matches cash-flow budgeting (YNAB-style).
  - **C. Split** principal (transfer) / interest (spending) using loan terms (rate, schedule); most precise, needs data the household chose not to maintain.
  In all cases net worth stays correct via statement balances on the loan accounts (household should record the auto loan and mortgage balances).

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
| 2026-10-26 | Savings account is joint | Household answer | Accepted |
| 2026-10-26 | Auth: email + password (Supabase Auth) | Household preference | Accepted |
| 2026-10-26 | Import as much history as institutions allow | Household preference; dedup makes chunked/overlapping imports safe | Accepted |
| 2026-10-26 | Shared-expense split default 50/50, configurable | Household preference | Accepted |
| 2026-10-26 | Joint checking modelled as pass-through; transfer chains collapsed; contributions not scored | Joint account barely used for spending | Accepted |
| 2026-10-26 | Credit card importers deferred until samples available | Samples unavailable for now | Accepted |
| 2026-10-26 | Member-to-member transfers default to settlement | Household: usually paybacks | Accepted |
| 2026-10-26 | Schema deployed automatically from `main` via GitHub Actions (`supabase db push`) | Household preference; keeps DB and code in lockstep | Accepted |
| 2026-10-26 | Public GitHub repo; GitHub Pages hosting | Household preference; no data in repo | Accepted |
| 2026-10-26 | Split stored as per-member weights | Generalises the configurable 50/50 default | Accepted |
| 2026-10-27 | Pending rows read-only in UI | Replaced on every import; edits would be lost | Accepted |
| 2026-10-27 | Suspected duplicates imported by default, user may skip | ±3-day same-amount heuristic has false positives (e.g. recurring small amounts) | Accepted |
| 2026-10-27 | Fingerprinting and dedup live in SQL, not the client | Single authority; cannot be bypassed by a modified client | Accepted |
| 2026-10-27 | Non-manual categories always reflect current rules; rule changes re-categorise automatically | Simpler mental model than a separate re-run step; authoring preview covers the safety need | Accepted |
| 2026-10-27 | Seed bank-category mapping rules at low priority | Immediate ~97% coverage; fully editable; user rules win | Accepted |
| 2026-10-27 | Transfer pair linking moved from Phase 3 to 5a | Spending totals only need the Transfer kind; linking matters for settlements | Accepted |
| 2026-10-28 | Overview is trend-first, 12 months default | Household preference | Accepted |
| 2026-10-28 | Loans tracked by statement balances only (no amortisation) | Household preference | Accepted |
| 2026-10-29 | Desktop-first responsive layout; tiled, draggable, resizable Overview panels | Household uses an ultrawide desktop; phones still supported | Accepted |
| 2026-10-29 | Dashboard layouts stored per person, not per household | Household preference | Accepted |
| 2026-10-29 | Default 2 panels per row | Household preference | Accepted |
| 2026-10-30 | Linked transfers override rule categories (source `transfer`); manual spending category means "not a transfer" | Wording-independent exclusion from totals; person's choice wins | Accepted |
| 2026-10-30 | Money-flow Sankey on the Overview | Household request | Accepted |
| 2026-10-31 | Seeded rule: description contains "OD FEE" → Financial › Fees & Charges (priority 400) | USAA labels overdraft fees on loan ACH items as "Auto Payment"; they are fees, not loan payments | Accepted |
| 2026-11-01 | Shared-by-default per category + per-transaction override | Few decisions up front; exceptions where they occur | Accepted |
| 2026-11-01 | Transfer matching recomputed on every run (order-independent) | Same result regardless of import order | Accepted |
