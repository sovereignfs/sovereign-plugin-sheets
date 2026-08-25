# Sheets

**Version:** 0.1\
**Date:** July 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sheets plugin — the single source of truth for its manifest, access model, data model, and build plan.\
**Status:** MVP shipped (tasks 1–5, see ROADMAP.md).

---

Sheets is a lightweight, self-hostable spreadsheet for Sovereign. Long-term
ambition is a genuine alternative to Google Sheets; the MVP specced here is
deliberately small: a single-user grid with formulas and one custom function,
`FINANCE()`, for currency conversion — Sheets' analogue to `GOOGLEFINANCE()`.

The UI should *feel* like a familiar spreadsheet (grid, formula bar, sheet
tabs). The formula/function surface should track Google Sheets conventions
where practical (cell refs, ranges, common function names) so muscle memory
and ported formulas mostly work, without committing to full Excel/Sheets
fidelity in the MVP.

## What makes the MVP different from the long-term goal

Google Sheets does a lot: real-time multiplayer editing, comments, charts,
pivot tables, conditional formatting, hundreds of functions, import/export of
every spreadsheet format in existence. None of that ships in v0.1. The MVP
answers one question: *can a single user open a grid, type formulas that
recalculate correctly, and pull in a live currency rate?* Everything else is
explicitly future work, tracked in "Post-MVP" below, not designed away.

## MVP scope

**In:**

- Single workbook per doc; multiple sheets/tabs within a workbook; standard
  row/column grid.
- Cell editing: text, numbers, formulas (`=...`).
- Minimal display formatting: a small enum (plain / number / currency / date)
  — not a full style/formatting engine.
- Formula engine: arithmetic operators, cell references (`A1`), ranges
  (`A1:B10`), cross-sheet references (`Sheet2!A1`).
- Built-in function library (provided natively by the formula engine — no
  custom implementation needed): `SUM, AVERAGE, COUNT, COUNTA, MIN, MAX, IF,
  AND, OR, NOT, CONCATENATE, LEN, UPPER, LOWER, TRIM, ROUND, ABS, TODAY, NOW`.
- One custom function: `FINANCE(base, quote)` — see "The FINANCE() function"
  below.
- Save/load; single owner per workbook.
- CSV export of a single sheet.
- Add / rename / delete / reorder sheet tabs.
- Undo/redo within a session.

**Out — explicitly deferred post-MVP:**

- Real-time multiplayer editing, live cursors/presence, comments.
- Charts, pivot tables, conditional formatting, cell styling beyond the
  minimal format enum, data validation, named ranges.
- Sharing/permissions beyond a single owner per workbook.
- XLSX/CSV *import* (export only in MVP).
- Stock/ticker quotes or any `FINANCE()` attribute beyond a currency rate;
  historical time-series lookups.

## The `FINANCE()` function

The GOOGLEFINANCE-alternative. **MVP scope is currency exchange rate
conversion only** — no stock/security quotes.

**Signature:** `FINANCE(base, quote)` — e.g. `FINANCE("USD", "EUR")` returns
the rate for converting 1 unit of `base` into `quote`. Compose with a cell
reference to convert an amount: `=B2 * FINANCE("USD","EUR")`.

Deliberately **not** named `GOOGLEFINANCE` or `SV.FINANCE` — a plain
`FINANCE()` avoids implying Google Sheets' full attribute set (`"price"`,
`"high"`, `"low"`, `"volume"`, historical ranges, security tickers) that this
MVP doesn't implement, while staying short and discoverable. Document it
prominently as "Sheets' GOOGLEFINANCE-equivalent" so it isn't missed by users
porting formulas.

**Provider:** [Frankfurter](https://api.frankfurter.dev) — free, **no API key
required**, ECB daily reference rates. Same provider family the Sovereign
Ledger plugin already relies on for its `ledger_fx_rates` cache
(`plugins/sovereign-ledger.local`), so it's a proven choice in this ecosystem.
Because no key is needed, **there is no admin-managed-secret or Console
settings page in MVP** — no `sdk.secrets` usage, no capability-gated config
form. That entire workstream (the pattern used by Console's SMTP settings and
the admin-managed external provider config feature) is simply not needed
here.

**Client/server split** (no server-side formula-engine instance needed for
MVP, since there's no multiplayer/authoritative-merge requirement):

1. The formula engine runs **client-side** in the browser — instant,
   offline-capable recalculation for every synchronous function as the user
   types.
2. `FINANCE(base, quote)` is registered as a custom function that
   synchronously returns the last-known cached rate (or a "loading…"
   sentinel) and, as a side effect, triggers a server action.
3. The server action checks the rate cache first; if stale/missing, it calls
   Frankfurter's `/latest?base=USD&symbols=EUR` endpoint server-side (no
   secret needed — still server-side to keep caching centralized and avoid
   client-side CORS/fan-out), upserts the cache, and returns the rate.
4. The client feeds the resolved value back into the formula engine,
   triggering a normal recalculation cascade for dependent cells.
5. On workbook load, do **one batched** round-trip resolving all distinct
   currency pairs present in the sheet (deduped) rather than one request per
   cell.

**Caching:** Frankfurter has no documented hard rate limit for reasonable use,
but caching is still worthwhile for responsiveness and to avoid redundant
calls:

- Rate cache table keyed on `(base, quote)`, **instance-wide** (not
  per-tenant/user) — exchange rates are public data, same rationale as
  Ledger's untenanted `ledger_fx_rates` cache.
- Flat TTL (a few hours — Frankfurter/ECB rates update once daily on bank
  business days) checked before any upstream call.
- No usage-quota tracking needed — Frankfurter is keyless with no quota to
  track against, unlike a metered provider.
- Build the provider client behind a small interface (`getRate(base, quote):
  Promise<{rate, asOf}>`) so a different provider could be swapped in later
  without touching the formula-engine integration layer.

**Failure mode:** if Frankfurter is unreachable, serve the last-cached rate
with a "stale" indicator if one exists, or a clear in-cell error if no cache
exists yet — never let a network failure break the whole sheet's
recalculation. Frankfurter is a free, community-run service with no SLA;
document this as a best-effort dependency.

**Granularity:** Frankfurter/ECB rates update once per business day —
`FINANCE()` does not reflect intraday currency moves. This is documented
user-facing behavior, not a bug.

## Data model

**Storage granularity: JSON blob per sheet for cell data, normalized tables
for everything else.** The formula engine holds the live grid in memory; MVP
is single-user/single-workbook-per-doc with no concurrent-writer conflict
resolution, so coarse, debounced whole-sheet saves are simpler and sufficient
than per-cell row diffing. Revisit per-cell rows only if real-time
collaboration or very large sheets are added post-MVP — that *would* need
CRDT-friendly per-cell storage.

```ts
// app/_db/schema.ts (sketch — not final; isolated SQLite DB, so no
// slug-prefix required on table names, but tenant_id + an owning-user
// column are still required per docs/plugin-database.md)

export const workbooks = sqliteTable('workbooks', {
  id: text('id').primaryKey(),                 // ULID
  tenantId: text('tenant_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  name: text('name').notNull(),
  activeSheetId: text('active_sheet_id'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
  deletedAt: integer('deleted_at'),             // soft delete
});

export const sheets = sqliteTable('sheets', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  workbookId: text('workbook_id').notNull(),
  name: text('name').notNull(),                 // tab label, unique per workbook (app-enforced)
  position: integer('position').notNull(),
  rowCount: integer('row_count').notNull().default(200),
  colCount: integer('col_count').notNull().default(26),
  cellsJson: text('cells_json').notNull().default('{}'), // sparse A1-keyed map: {v?, f?, fmt?}
  updatedAt: integer('updated_at').notNull(),
});

// Instance-wide — deliberately NOT tenant/user-scoped (public market data),
// same pattern as ledger_fx_rates.
export const financeRateCache = sqliteTable('finance_rate_cache', {
  base: text('base').notNull(),                  // e.g. 'USD'
  quote: text('quote').notNull(),                 // e.g. 'EUR'
  rate: text('rate').notNull(),                    // canonical decimal string, never a float
  asOf: integer('as_of').notNull(),                 // rate's reference date, unix seconds
  fetchedAt: integer('fetched_at').notNull(),
  source: text('source').notNull().default('frankfurter'),
  // primary key (base, quote)
});
```

No provider-config or usage-quota table in MVP — Frankfurter needs no API key
and has no quota to track.

## Architecture

```
plugins/sovereign-sheets.local/
  manifest.json
  package.json
  icon.svg
  SPEC.md / README.md / CLAUDE.md / ROADMAP.md
  app/
    page.tsx                    # workbook list / "new workbook"
    layout.tsx
    [workbookId]/page.tsx       # loads workbook+sheets, renders the grid
    actions.ts                  # createWorkbook, loadWorkbook, saveSheet,
                                 # addSheet, renameSheet, deleteSheet,
                                 # getFinanceRate (server bridge for FINANCE())
    _components/
      WorkbookView.tsx           # owns the HyperFormula instance for the workbook
      SheetGrid.tsx              # active sheet's grid, reads/writes via the shared engine
      SheetTabs.tsx
      FormulaBar.tsx             # built on CodeTextarea (@sovereignfs/ui)
      BackLink.tsx
    _lib/
      formula-engine.ts          # engine init, cellsJson<->grid conversion, error display
      finance-function.ts        # FINANCE() HyperFormula plugin + rate cache
      frankfurter.ts             # thin fetch client for api.frankfurter.dev
      a1.ts                      # A1<->row/col helpers
      cells.ts                   # CellData/CellsMap types, cellsJson parse/serialize
      csv.ts
      config.ts                  # DEFAULT_ROW_COUNT/DEFAULT_COL_COUNT
      formUtils.ts
    _db/schema.ts
  db/schema.ts                   # re-export of app/_db/schema.ts
  migrations/sqlite/
```

No admin settings page, no `sdk.secrets` usage, no capability-gated
Console-style form — Frankfurter requires no API key, which removes that
entire workstream from MVP.

**UI:** `@sovereignfs/ui` has no spreadsheet-grid component today — the grid
is built as plugin-local CSS/components, using only `--sv-*` semantic tokens
(never hardcode colors or reference primitive tokens directly). Reusable
pieces from the design system: `SplitPane` (sheet-tabs sidebar or
formula-bar split), `CodeTextarea` (formula bar), `FormField`, `StatusBadge`
(save/sync state), `Toast`/`ConfirmDialog` (save feedback, destructive
actions), `EmptyState` (no-workbooks state).

## Manifest & permissions

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.sheets",
  "name": "Sheets",
  "version": "0.1.3",
  "description": "A lightweight spreadsheet with formulas and a built-in currency conversion function.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/sheets",
  "shell": "default",
  "icon": "icon.svg",
  "permissions": ["auth:session", "db:readWrite"],
  "repository": "https://github.com/sovereignfs/sovereign-plugin-sheets",
  "compatibility": { "minPlatformVersion": "0.42.0" }
}
```

- `auth:session` + `db:readWrite` are the only permissions declared. No
  `data:export` — CSV export is a client-side `Blob` download, not the
  `portability.provideExport()` flow. No `activity:write` — no
  `sdk.activity.log()` calls exist. No `data:import` (no CSV import in MVP),
  no `notifications:send`, no invented permission for a settings gate — none
  needed since `FINANCE()` requires no secret.
- No `database` field in the manifest — the per-plugin `isolation`/`dialect`
  overrides were both retired platform-wide; every sovereign/community plugin
  is now unconditionally isolated, with dialect set instance-wide via
  `DB_DIALECT`. Sheets still runs on its own isolated SQLite store in
  practice — clean uninstall via `sv plugin remove`, no slug-prefix
  boilerplate on table names — that's just no longer something the manifest
  itself declares.
- No `development` flag — the MVP is shipped (tasks 1–5 done), not a
  work-in-progress plugin.

`package.json`: `@sovereignfs/sovereign-sheets`, `type: module`, license
`AGPL-3.0-or-later` (matches Wallet/Tally), deps `@sovereignfs/sdk`,
`@sovereignfs/ui`, `drizzle-orm`, `hyperformula`, `next`/`react`/`react-dom`
at `catalog:`; devDeps `drizzle-kit`, `@sovereignfs/tsconfig`,
`typescript`/`@types/react*` at `catalog:`.

## Open questions

1. **Formula engine choice and its license — resolved, HyperFormula
   adopted.** Its free/community edition is **GPLv3**; a commercial license
   exists for closed-source use. This repo already has AGPL-3.0-or-later
   plugins (`sovereign-wallet`, `sovereign-tally`) coexisting with the
   platform, and each `type: sovereign` plugin lives in its own repository,
   touching the platform only through the `@sovereignfs/sdk` contract at
   runtime — not statically linked into the platform core or other plugins.
   That separate-work boundary is the same reasoning that lets a GPL'd
   desktop app run on a proprietary OS. This is not a legal opinion — get
   real confirmation that GPLv3-in-Sheets doesn't create an obligation on the
   core platform or other plugins if this ships beyond a local/dev instance.
2. **Frankfurter reliability at scale.** No SLA; revisit if it becomes a
   problem in practice — the provider-client interface in "The `FINANCE()`
   function" section keeps a swap possible.
3. **CSV export scope — resolved, shipped in MVP** (single sheet only via a
   toolbar button; full workbook export and any import stay post-MVP).

## Post-MVP (tracked, not designed in detail yet)

- Stock/security quotes and additional `FINANCE()` attributes
  (`"high"`/`"low"`/`"volume"`/historical ranges), once a suitable quoted-key
  provider and admin-config workflow are worth the complexity.
- Real-time multiplayer editing, presence, comments.
- Charts, pivot tables, conditional formatting, named ranges, data
  validation, richer cell styling.
- XLSX import/export, CSV import.
- Sharing/permissions model beyond single owner.
