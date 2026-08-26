# Sheets

**Version:** 0.1\
**Date:** July 2026\
**Author:** kasunben\
**Purpose:** Canonical specification for the Sheets plugin — the single source of truth for its manifest, access model, data model, and build plan.\
**Status:** MVP shipped (tasks 1–5); workbook sharing, CSV import, cell
number formatting, named ranges, cell styling/data validation, full-workbook
JSON export/import, manual sheet growth, the Docs-style workbook editor
header redesign, a follow-up layout consolidation (tighter padding,
bottom-docked sheet tabs, header/toolbar action regrouping), an
export/import menu consolidation, a status-badge placement tweak,
resizable columns, a formula-bar/column-width bug-fix pass, cell font/
background color, a cell-color visibility fix, and multi-cell selection
(range formatting, copy/cut/paste, bulk clear) shipped post-MVP
(tasks 6, 8–11, 13–23) — see ROADMAP.md.

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
  — not a full style/formatting engine. **Note:** this enum was speced and
  typed (`CellData.fmt`) from task 1 on, but had no UI and no display logic
  wired to it — a real scope gap, not a deliberate stub — until it actually
  shipped post-MVP, task 9. See "Cell number formatting" below.
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
- Charts, pivot tables, conditional formatting, text color. Bold/italic cell
  styling and per-cell data validation shipped post-MVP, task 11 — see "Cell
  styling and data validation" below. Named ranges shipped post-MVP, task 10
  — see "Named ranges" below.
- Sharing/permissions beyond a single owner per workbook (shipped post-MVP,
  task 6 — see "Workbook sharing" below).
- XLSX import/export (stays deferred). CSV import shipped post-MVP, task 8
  — see "CSV import" below. A full-fidelity native JSON workbook
  export/import (formulas, styling, validation, named ranges) shipped
  post-MVP, task 13 — see "Full-workbook JSON export/import" below; it is
  not an XLSX/Excel-interoperable format.
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
- **Resolved, task 7:** the provider client sits behind a small interface,
  `FxRateProvider` (`_lib/fx-rate-provider.ts`) — `getRates(base, quotes):
  Promise<{date, rates} | null>`. Frankfurter (`_lib/frankfurter.ts`'s
  `frankfurterProvider`) is the sole implementation today, wired in at
  `actions.ts`'s single `FX_PROVIDER` binding; swapping providers means
  writing a new implementation and changing that one line, without touching
  `getFinanceRatesAction`'s caching/TTL/dedup logic or the formula-engine
  integration in `finance-function.ts`/`WorkbookView.tsx`. Currency
  conversion only — not a general quote/ticker abstraction; extending to
  stock/security quotes is its own task (see "Post-MVP").

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

## Workbook sharing (post-MVP, task 6)

Shipped alongside the home redesign — see
[`docs/adhoc/home-and-sharing.md`](docs/adhoc/home-and-sharing.md) for the
full wireframe spec this was built from. Modeled closely on the Docs
plugin's folder-level sharing (`docs_folder_members`), the closest existing
platform precedent for "a single-owner container whose role also grants
access to everything inside it."

**Model:** workbook-level only — a shared member gets access to every sheet
tab in that workbook. There's no per-sheet sharing; Sheets has no
nested-folder structure the way Docs does, so there's no separate level to
put sharing at.

```ts
// Isolated SQLite DB — no slug-prefix required. workbooks.owner_user_id
// stays the immutable creator record; this table is the actual access-
// control surface, seeded with an `owner` row for the creator on every
// workbook insert.
export const workbookMembers = sqliteTable(
  'workbook_members',
  {
    workbookId: text('workbook_id').notNull().references(() => workbooks.id),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    invitedBy: text('invited_by'),
    joinedAt: integer('joined_at').notNull(),
    // Per (workbook, user) — not on `workbooks` itself. A workbook is
    // shared, so "recently opened" tracks each member's own access, not
    // whichever member opened it most recently instance-wide.
    lastOpenedAt: integer('last_opened_at'),
  },
  (t) => [primaryKey({ columns: [t.workbookId, t.userId] })],
);
```

`lastOpenedAt` is bumped on every `getWorkbook()` load, for the loading
user's own membership row — powers the Home sidebar's Recent list.

**Roles:** `owner` / `editor` / `viewer`, same three-role shape as Docs'
`FolderMemberRole`. `resolveWorkbookRole()` replaces every previous
`eq(workbooks.ownerUserId, session.user.id)` check in `app/actions.ts` —
read actions accept any role, write actions require owner/editor, workbook
deletion and sharing management require owner. A viewer gets a fully
read-only workbook: grid cells and the formula bar render `readOnly`, and
every sheet-tab/workbook mutation control (add/rename/delete/reorder sheets,
Undo/Redo, Delete workbook) simply doesn't render — enforced again
server-side in every action, per the platform's "authorize inside the
action" rule, not just by hiding the controls. CSV export stays available
to every role — it's a read operation.

**Sharing UI:** an owner-only "Share" dialog (`WorkbookShareButton`/
`WorkbookShareDialog`) — member list with role badges + Remove, an invite
form with an `sdk.directory` typeahead and a role select. A close port of
Docs' `FolderShareButton`/`FolderShareDialog`, kept independently evolvable
rather than shared. The last remaining owner can't be demoted or removed.

**Notifications:** in-app only via `sdk.notifications.send` (the
`notifications:send` manifest permission) on a new share — no email. This
is a smaller surface than Docs' equivalent (which also sends an email via
`sdk.mailer.send`); matches Kanban's own sharing notification pattern
instead. Revisit if email invites prove worth the added `mailer:send`
permission.

**Not solved (same as every other plugin with sharing):** no live-kick on
member removal — an editor/viewer who loses access mid-session keeps
working until their next page load, same as Docs/Kanban.

## CSV import (post-MVP, task 8)

Single-sheet only, symmetric with export's own scope (SPEC's original "CSV
export scope" open question resolved it there too). Entry point: an "Import
CSV" toolbar button next to "Export CSV" in `SheetGrid.tsx`, `canEdit`-gated
(same as every other mutation). No manifest permission change — like export,
this is a client-side file read, not the platform's account-level
`portability.provideImport()` flow (`data:import` gates that, not this).

**Behavior — a full replace, not a merge:** importing clears every existing
cell in the active sheet and writes the CSV's own content in its place, via
one `ConfirmDialog` naming the file and the sheet, `destructive`-styled. If
the CSV is larger than the sheet's current `rowCount`/`colCount`, the sheet
grows to fit (via a new `resizeSheetAction`, capped at `MAX_ROW_COUNT`
2000 / `MAX_COL_COUNT` 100 — the same sheet-size ceiling manual "Add
rows"/"Add columns" growth (task 14) is capped at too — a sanity bound against a malformed/huge
file, not a product limit); rows/columns beyond that cap are silently
clipped, with a toast noting it.

**Parsing:** `_lib/csv.ts`'s new `parseCsv()`, the inverse of the existing
`cellsToCsv()` — RFC 4180-ish (quoted fields, embedded commas, `""` for a
literal quote, both `\r\n`/`\n` line endings). Every CSV cell becomes a raw
value fed through the same `engine.setCellContents()` path normal typing
uses — a bare `=...` field is interpreted as a formula, same as if the user
had typed it directly. This matches real spreadsheet software's own
paste/import behavior; not specially blocked, since the importer is already
an editor/owner of their own workbook, not an untrusted multi-tenant input.

**Known minor limitation:** a CSV field containing an embedded newline
(inside quotes, e.g. `"line1\nline2"`) parses correctly as one field, but
doesn't round-trip through the grid's single-line `<input>` cell editor —
the newline is lost on display/re-save. Not chased further for MVP scope;
revisit if it proves to matter in practice (would need a multi-line cell
editor, a larger change).

## Cell number formatting (post-MVP, task 9)

Finishes the `CellData.fmt` enum (plain/number/currency/date) that was typed
since task 1 but had no UI or display logic wired to it — see the note on
MVP scope's "Minimal display formatting" bullet above. **This is a partial
slice of "richer cell formatting / conditional formatting"** — deliberately
scoped down to just the number-format enum for this task; bold/italic/text
color and conditional formatting are explicitly *not* included here (see
"Deliberately deferred" below), so the underlying per-cell-metadata
mechanism this task introduces gets proven with one concern before more are
layered onto it.

**UI:** a `Select` in `SheetGrid.tsx`'s toolbar (left side, next to the
existing right-aligned Export/Import CSV group), showing/editing the active
cell's format. Disabled when no cell is active or `!canEdit` (same pattern
as the formula bar). Applies only to the *display* value (`getDisplay`) —
the active cell's raw input (formula/typed value, shown while editing) is
never reformatted, matching how Excel/Sheets only format the settled value.

**Data flow — the real design problem this task solves:** the HyperFormula
engine only knows cell values/formulas, never this plugin's own `fmt`
metadata, so format overrides are tracked in a separate in-memory map
(`WorkbookView.tsx`'s `formatMaps`, one `Record<cellKey, CellFormat>` per
sheet — same "alongside the engine, not in it" pattern as
`finance-function.ts`'s rate cache) and merged back into the serialized
cells at every save point:

- **Load:** `_lib/cells.ts`'s new `extractCellFormats()` pulls the format
  overrides back out of each sheet's loaded `cellsJson` when the engine is
  first built.
- **Save:** `_lib/cells.ts`'s new `mergeCellFormats()` layers the format map
  onto the engine-derived cell values immediately before
  `serializeCellsJson()` — used by both `SheetGrid`'s own debounced autosave
  and `WorkbookView`'s `saveAllSheets()` (the undo/redo save path).
- **Format changes save immediately**, not debounced — a `Select` change is
  a discrete, infrequent action, unlike keystroke-by-keystroke typing.
- `serializeCellsJson()` now also keeps a cell with a non-default `fmt` even
  if it has no value yet (formatting a column ahead of typing into it) —
  previously it dropped any cell with an empty value unconditionally.

**Rendering:** `_lib/format.ts`'s `formatCellValue()` — a no-op for
'plain'/undefined or a non-numeric resolved value (formatting applies to a
number the formula engine actually resolved, not arbitrary text).
`'date'` converts via `engine.numberToDate()` (HyperFormula's own date
serial → calendar date), rendered as `YYYY-MM-DD`; no locale/format-pattern
picker in this pass. `'currency'` is a fixed `$` prefix — no currency
selector.

**Deliberately deferred, not silently dropped:**

- Bold/italic and other cell styling — resolved, shipped post-MVP, task 11,
  see "Cell styling and data validation" below. Text color stays deferred
  (task 11 only added bold/italic).
- Conditional formatting (rule-based highlighting). Real range-based
  conditional formatting needs a multi-cell selection model this app
  doesn't have (same gap noted for multi-cell copy/paste back in task 5) —
  a single-cell "highlight this cell if its own value meets a condition"
  version is buildable without one, using the same per-cell-metadata
  mechanism this task introduces, but wasn't included in this pass either.
- Named ranges — resolved, shipped post-MVP, task 10, see "Named ranges"
  below. Data validation — resolved, shipped post-MVP, task 11, see "Cell
  styling and data validation" below.

## Named ranges (post-MVP, task 10)

Workbook-scoped names (not per-sheet) that resolve to a formula or cell/range
reference — e.g. `TaxRate` → `=0.08`, or `Revenue` → `=Sheet1!$B$2:$B$12` —
usable from any formula in the workbook (`=B2 * TaxRate`). Built directly on
HyperFormula's own native named-expression support
(`addNamedExpression`/`changeNamedExpression`/`removeNamedExpression`/
`getNamedExpression`) — no custom name-resolution logic needed, since the
engine already implements this exactly as a real spreadsheet would.

**UI:** a "Named ranges" button in `WorkbookView.tsx`'s header (next to
Share), opening a `Dialog` — `_components/NamedRangesDialog.tsx`'s
`NamedRangesButton`. Same list + add-form shape as `WorkbookShareDialog`.
Viewing the list is available to any role; adding/removing is `canEdit`-gated
(this is a workbook-editing concern, not an owner-only one like sharing).

**Persistence:** a new `workbooks.named_ranges_json` column
(`{ [name]: expression }`), alongside the existing `active_sheet_id` —
workbook-scoped data, not sheet-scoped, matching HyperFormula's own default
named-expression scope (global unless a sheet id is explicitly passed). New
`saveNamedRangesAction` writes the whole map in one call (no per-item CRUD
action) — the client already holds the authoritative set, mirrored into the
engine for live formula resolution, same pattern task 9 established for cell
format overrides.

**Load order matters:** named ranges are registered with the engine *after*
every sheet has been added (`WorkbookView.tsx`'s engine-setup effect) — an
expression referencing a sheet (`=Sheet1!$B$2`) throws if that sheet doesn't
exist in the engine yet.

**Validation is HyperFormula's own** — `addNamedExpression`/
`changeNamedExpression` throw on an invalid name (spaces, looks like a cell
reference, etc.) or a malformed expression; `NamedRangesButton` surfaces
that error message inline in the add form. Not `ActionResult`/
`useActionState` — like cell formatting, this mutates the client-side engine
directly, not a server action.

Data validation (restricting what a cell accepts) — resolved, shipped
post-MVP, task 11, see "Cell styling and data validation" below.

## Cell styling and data validation (post-MVP, task 11)

Generalizes the per-cell-metadata mechanism task 9 introduced for number
formatting — same "alongside the engine, not in it" pattern — to carry two
more kinds of per-cell metadata the HyperFormula engine has no concept of:
text styling (bold/italic) and a soft data-validation rule.

**Types (`_lib/cells.ts`):** `CellData` gains `style?: CellStyle` (`{ bold?:
boolean; italic?: boolean }`) and `validation?: DataValidationRule`
(`{ type: 'range'; min?: number; max?: number } | { type: 'list'; values:
string[] }`). `CellMetadata` — the shape carried in `WorkbookView.tsx`'s
per-sheet in-memory map — now covers all three concerns (`fmt`/`style`/
`validation`) rather than just `fmt`. Task 9's `mergeCellFormats`/
`extractCellFormats` are renamed and generalized to `mergeCellMetadata`/
`extractCellMetadata`, handling all three the same way: layered onto the
engine-derived grid immediately before `serializeCellsJson()` on every save,
and pulled back out when a sheet's `cellsJson` is loaded into the engine.
`serializeCellsJson()` keeps a cell with a non-default format, a non-empty
style, or a validation rule even if it has no value yet — extended from
task 9's format-only version of the same rule.

**Cell styling — bold/italic only, no text color** (color stays deferred,
same "Deliberately deferred" note task 9 already carried forward). UI: two
toggle buttons (`Button` with `variant` swapped secondary/ghost and
`aria-pressed` reflecting the active cell's current style, not a new DS
component) in `SheetGrid.tsx`'s toolbar, next to the existing format
`Select`. Disabled when no cell is active or `!canEdit`, same pattern as the
format select. Toggling flips just that one style key
(`WorkbookView.tsx`'s `handleToggleStyle`) and saves immediately, like a
format change — not debounced. Rendering: `SheetGrid.module.css`'s
`.cellInputBold`/`.cellInputItalic` (`font-weight: 700`/`font-style:
italic`) applied to the cell `<input>` based on `cellMetadata[key]?.style`.

**Data validation — per-cell only, not range-based**, same multi-cell-
selection-model gap noted for conditional formatting above (task 5, task 9).
Two rule shapes: a number range (`min`/`max`, either bound optional) and a
list of allowed values (comma-separated in the UI, case-insensitive/trimmed
match). UI: a "Validation" toolbar button (same enable/disable rule as the
style toggles) opens `_components/CellValidationDialog.tsx` — a `Dialog`
with a rule-type `Select` (No validation / Number range / List of values)
and the matching inputs, scoped to the active cell. Saving calls
`WorkbookView.tsx`'s `handleValidationChange`, which persists through the
same `persistCellMetadata` path as style/format changes.

**Deliberately soft, never blocking:** `_lib/validation.ts`'s
`isCellValueValid(rawValue, rule)` checks the cell's *resolved* value (a
formula result is checked the same as a typed literal, matching how `fmt`
formats the resolved value in task 9) and is used only to render a visual
`.invalid` indicator (`SheetGrid.module.css`, an inset box-shadow using
`--sv-color-error-border`, plus `aria-invalid`) — it never rejects or blocks
a commit. This is a deliberate architectural choice, not a scope cut: the
grid commits on every keystroke via the cell `<input>`'s `onChange`, so hard
validation would either reject characters mid-type or require a separate
"blur to validate" model this grid doesn't have. An empty cell is always
valid regardless of its rule — no data entered yet isn't the same as bad
data.

**Deliberately deferred, not silently dropped:**

- Text color and any styling beyond bold/italic.
- Range-based/multi-cell validation rules (e.g. "every cell in `A1:A20`"),
  same multi-cell-selection-model gap as conditional formatting.
- Custom-formula validation rules (an arbitrary boolean expression), beyond
  the two built-in shapes (range, list).
- Hard/blocking validation — stays out entirely per the "Deliberately soft"
  note above, not just deferred for a future pass.

## Full-workbook JSON export/import (post-MVP, task 13)

CSV export/import (tasks 5/8) is a values-only snapshot of one sheet — it
can't carry formulas, cell styling, validation rules, or named ranges,
because CSV has no way to represent any of that. This task adds a second,
additive export/import format, alongside CSV rather than replacing it:
a full-fidelity JSON snapshot of the *whole workbook* — every sheet's
values/formulas/format/style/validation, plus named ranges — that round-trips
losslessly. Explicitly a backup/restore format for this plugin, not an
interchange format: the file doesn't open in Excel/Google Sheets. Real
external interoperability (XLSX) was considered and deliberately deferred —
see "Post-MVP" below for the tradeoffs that decided it.

**Why lossless is basically free here:** persistence already round-trips
formulas correctly — `WorkbookView.tsx`'s save path
(`engine.getSheetSerialized()` → `gridToCellsMap()`) stores a formula cell's
*serialized* content (`"=B2+B3"`, not its computed result) into `cellsJson`'s
`v` field, and load feeds that string straight back into
`engine.setSheetContent()`, where HyperFormula re-parses any leading `=` as a
live formula again. (This is a different, non-lossy path from CSV export's
own `getDisplay()`/`getCellValue()`, which *does* resolve formulas to their
computed value — see CSV import's own section above for why CSV round-tripping
is lossy.) Since normal autosave already preserves formulas/style/format/
validation exactly, the export format just serializes that same
already-correct per-sheet `cellsJson` (built the identical way
`saveAllSheets()` does, from live engine + `cellMetadataMaps` state, not the
possibly-stale `sheetList.cellsJson` React state) plus `namedRangesJson`, into
one file — no new format-translation logic to get wrong.

**File shape (`_lib/workbook-export.ts`):**

```ts
interface WorkbookExportPayload {
  formatVersion: 1; // rejected on read if it doesn't match — no best-effort guessing
  exportedAt: number; // unix seconds, informational only
  workbook: {
    name: string;
    namedRangesJson: string; // same `{ [name]: expression }` shape as workbooks.named_ranges_json
    sheets: { name: string; position: number; rowCount: number; colCount: number; cellsJson: string }[];
  };
}
```

**Export** (`WorkbookView.tsx`'s "Export workbook" header button, next to
Named ranges — available to any role, a read operation like CSV export):
builds the payload from live client state (every sheet in `sheetList`,
re-serialized from the engine + `cellMetadataMaps`, not the initial
server-loaded `cellsJson`) and triggers a browser download via
`downloadWorkbookExport()` (a `Blob` + synthetic `<a download>`, same pattern
as `csv.ts`'s `downloadCsv()`) — no server round-trip needed.

**Import creates a new workbook — never an in-place overwrite.** This is a
deliberate UX difference from CSV import's destructive full-sheet replace:
CSV import targets one already-open sheet you're consciously choosing to
overwrite, but a workbook file carries multiple sheets' worth of data, and
overwriting whatever workbook happens to be open would be a much bigger
footgun. So the trigger (`ImportWorkbookButton.tsx`) lives on the Home page
next to "New workbook" (both the empty-state action and, since task 28,
the "My workbooks" grid's ghost `NewCardTile` menu offer it as an
option), not inside any specific workbook's editor — picking a file is the
only step, with no destructive-action confirm needed, since nothing
existing is at risk.

**Validation is one function, used twice.**
`_lib/workbook-export.ts`'s `parseWorkbookExportPayload()` validates shape,
rejects an unsupported `formatVersion`, enforces every cap (sheet count via
new `MAX_IMPORT_SHEET_COUNT` 20, and the shared sheet-size ceiling
`MAX_ROW_COUNT`/`MAX_COL_COUNT` per sheet — reject outright on
an oversized file rather than CSV import's clip-and-warn, since the payload
states its own dimensions upfront instead of only being discoverable by
parsing every row), and round-trips each sheet's `cellsJson`/the workbook's
`namedRangesJson` back through the existing `parseCellsJson`/
`serializeCellsJson` pair so a hand-edited or malicious file can't smuggle
unrecognized keys into storage. `ImportWorkbookButton` calls this
client-side first, purely for immediate feedback (a toast) before ever
hitting the network — but `importWorkbookAction` calls the *same* function
again server-side, which is the real trust boundary: a server action is a
public endpoint dispatched by action id, not gated by whichever UI happens
to call it.

**Why the payload travels as a hidden form field, not a real file
upload:** `importWorkbookAction` is a plain `'use server'` action (matching
every other mutation in this plugin), and Next.js caps a server action's
whole request body at 1MB by default. Rather than take on a platform-wide
`next.config.ts` `serverActions.bodySizeLimit` override for one feature,
`MAX_IMPORT_FILE_SIZE_BYTES` (800 KB, `_lib/config.ts`) stays comfortably
under that ceiling — generous for the realistic case (a sparse `cellsJson`
blob for a normal-sized workbook is tens to low-hundreds of KB) while still
rejecting a pathological file with a clear error instead of a framework-level
500.

**Deliberately deferred, not silently dropped:**

- XLSX (or any real external-interchange format). Considered directly
  against this native format: XLSX needs a new dependency (`exceljs`, MIT —
  the alternative, SheetJS's `xlsx` package, has messier licensing history),
  meaningfully more engineering (bidirectional format translation, not just
  serializing what's already stored), and fidelity that's good but leaky at
  the edges in both directions — `FINANCE()` has no meaning to real Excel
  (`#NAME?` on open), and this plugin's bold/italic-only styling is a small
  subset of Excel's, so an Excel-authored file's richer formatting would be
  silently dropped on import. Worth building if genuine Excel
  interoperability becomes the actual goal, not just backup/restore within
  Sheets — a separate, larger task, not a natural extension of this one.
- Importing *into* an existing workbook (merge, or per-sheet append) — only
  "create a new workbook" is supported; see the UX note above for why.
- A schema-migration path for a future `formatVersion` bump — today an
  unrecognized version is a flat rejection, not a best-effort upgrade. Revisit
  once there's an actual second version to migrate from.

## Sheet size: default and manual growth (post-MVP, task 14)

New-sheet default grew from 60×18 to **100 rows × 20 columns**
(`DEFAULT_ROW_COUNT`/`DEFAULT_COL_COUNT`, `_lib/config.ts`) — applied to both
a brand-new workbook's first sheet (`createWorkbookAction`) and every
subsequently added tab (`addSheetAction`).

**Manual growth**, previously only a side effect of importing a file bigger
than the current sheet: `SheetGrid.tsx`'s toolbar gets two `canEdit`-gated
buttons, "Add {`ROW_GROWTH_STEP`} rows" and "Add {`COL_GROWTH_STEP`}
columns" (50 and 10 respectively, `_lib/config.ts`), next to Export/Import
CSV. Each click grows the sheet by one fixed step — `engine.addRows()`/
`addColumns()` on the live HyperFormula instance, then `resizeSheetAction`
to persist the new `rowCount`/`colCount` (no `cellsJson` change needed,
since new rows/columns start empty — unlike CSV import, which writes cell
content in the same step). Both buttons disable once the sheet is already at
`MAX_ROW_COUNT`/`MAX_COL_COUNT` — clicking past the cap is prevented rather
than silently clamped to a no-op.

**The import-growth ceiling is now the same constant, renamed to match:**
`MAX_IMPORT_ROW_COUNT`/`MAX_IMPORT_COL_COUNT` (task 8) became
`MAX_ROW_COUNT`/`MAX_COL_COUNT` — CSV import, full-workbook JSON import
(task 13), and manual growth all share one sheet-size ceiling (2000×100)
rather than three independently-named-but-identical caps. No behavior
change for import; purely a naming correction now that the constant has a
second, non-import caller.

**Deliberately not attempted:** shrinking a sheet (removing trailing empty
rows/columns) — growth only, matching every other spreadsheet's own
"add more rows" convention; a user who over-grows a sheet isn't blocked from
anything, just has more unused rows to scroll past.

## Workbook editor header redesign (post-MVP, task 15)

The workbook editor's top chrome — back navigation, title, and every
workbook-level action (Undo/Redo, Named ranges, Export workbook, Share,
Delete workbook) — is rebuilt to match the Docs plugin's own document-page
header (`DocumentPage.tsx`/`.module.css`) 1:1, rather than continuing to grow
the original two-row "← Back to workbooks" + wrapping-button-soup layout
that task 12 (icon/URL polish) and task 13 (Export workbook) had already
started to strain and the 0.9.1 hotfix (see CLAUDE.md's version history) had
to patch reactively. Same visual language as Docs' header, not a
Sheets-specific reinvention:

- **Compact identity row** (`WorkbookView.module.css`'s `.metaBar`,
  replacing the old two-line `.header`/`.titleRow`): an icon-only back
  button (`Icon name="chevron-left"`, 32×32, `aria-label="Back to
  workbooks"`, no visible text) sits on the same line as the workbook name,
  not above it. `_components/BackLink.tsx` (a text-link "← Back to X"
  component, one plugin-local caller) is deleted outright as dead code now
  that this is the only place it was used.
- **The title truncates, it doesn't wrap or push the action group
  off-screen**: `.titleBlock { flex: 1 1 auto; min-width: 160px; overflow:
  hidden; }` plus `.title { overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; }`. Sheets' title is plain read-only text (no
  inline-rename affordance the way Docs' editable `<input>` title needs), so
  none of Docs' JS-measured `titleMirror`/`titleInputWrap` width-clamping
  machinery is needed here — plain CSS ellipsis truncation is sufficient.
- **The action group (`.metaRight`) is `flex: none` + `max-width: 100%` +
  `flex-wrap: wrap`, together** — porting the single most load-bearing detail
  from Docs' own `.metaRight`: `flex-wrap: wrap` alone does nothing on a
  `flex: none` group, since that group never shrinks below its buttons'
  combined natural width on its own — without an explicit `max-width` cap it
  renders at full width regardless of how little room `.metaBar` has left
  after the title, invisibly overflowing past the viewport edge with no
  wrap and no scrollbar. `max-width: 100%` is what actually makes the wrap
  trigger. (Same gotcha independently rediscovered and worth flagging if this
  pattern is ever generalized into the platform's own `docs/architecture-
  rules.md` — not yet done, since that's a cross-cutting platform-repo change
  outside this plugin's own scope.)
- **Delete workbook moves into an overflow `⋮` menu** (`@sovereignfs/ui`'s
  `Menu`, `MenuEntry[]`, `destructive: true`), owner-only — mirrors Docs'
  own overflow-menu pattern for rare/dangerous actions. Named ranges and
  Export workbook stay as always-visible `variant="secondary"` buttons
  (matching Docs' Import/Export treatment); Share stays the one
  default/primary-styled button, last in the group — same relative
  prominence Docs gives its own Share button.
- **A new toolbar row** (`.toolbarBar`, directly below `.metaBar`, `canEdit`-
  gated) hosts Undo/Redo as compact 28×28 icon-only buttons (`rotate-ccw`/
  `rotate-cw`), each `disabled` when `engine.isThereSomethingToUndo()`/
  `isThereSomethingToRedo()` is false. Mirrors Docs' own formatting-ribbon
  row (`DocumentPage.module.css`'s `.toolbarBar` + `RichTextEditor.module.css`'s
  `.toolbar`) being a second chrome row separate from the identity/sharing
  header — Docs' own ribbon's first button cluster is literally "[Undo,
  Redo] · …", the same workbook-level/editing-action split applied here.
  This is a different row from `SheetGrid.tsx`'s own per-active-sheet
  toolbar (Format/Bold/Italic/Validation/Add rows/Add columns/Export
  CSV/Import CSV) below it, which is unchanged by this task — Undo/Redo are
  workbook-wide (cross-sheet undo history), not sheet-scoped, so they belong
  with the other workbook-level actions, not inside the per-sheet grid
  chrome.

**Deliberately not attempted:** collapsing `SheetGrid.tsx`'s own toolbar
into this same redesign — it already has its own `flex-wrap: wrap` (from
the 0.9.1 hotfix) and wasn't reported as broken; folding two differently-
scoped toolbars (workbook-level vs. sheet-level) into one row was
considered and rejected as a needless conflation, not an oversight.

## Layout consolidation and bottom-docked sheet tabs (post-MVP, task 16)

A direct follow-up to task 15's header redesign — same screen, four more
concrete layout asks once that redesign was live: tighter page padding, the
sheet-tab strip docked at the bottom of the viewport (Google Sheets' own
convention, rather than sitting above the grid), and a second look at *which*
actions belong in the header versus the toolbar directly above the grid, now
that both existed as separate rows.

- **Tighter page padding.** `WorkbookView.module.css`'s `.view` padding
  dropped from `space-4/space-6/space-6` (top/sides/bottom) to
  `space-2/space-3/space-1` — the grid wants as much of the viewport's width
  as it can get, `SheetGrid.module.css`'s `.scroller` already draws its own
  border so the outer container doesn't need a wide gutter, and the bottom
  edge in particular reads better tight now that the tab strip (see below)
  sits flush against it rather than floating in a gap.
- **Export CSV, Import CSV, and the autosave "Synced" status badge move from
  `SheetGrid.tsx`'s own toolbar up into `WorkbookView.tsx`'s header
  (`.metaRight`)**, alongside Export workbook/Share/the overflow menu — every
  file-in/file-out and sync-state affordance now lives in one place. Since
  the underlying export/import logic (the hidden file `<input>`, the
  confirm-import dialog, the CSV serialization itself) all depend on
  per-sheet state that legitimately belongs inside `SheetGrid.tsx` (active
  sheet's row/col counts, cell values, `sheetName`), it wasn't lifted up —
  instead `SheetGrid` now exposes a small imperative handle,
  `SheetGridHandle` (`{ exportCsv(): void; triggerImport(): void }`), via
  React 19's ref-as-prop (`ref?: Ref<SheetGridHandle>` in its own props type,
  no `forwardRef` needed — same pattern `packages/ui`'s `Input` already
  uses). `WorkbookView.tsx` holds the ref and a `gridStatus` state mirror
  (`onStatusChange` callback prop, called everywhere `SheetGrid` used to call
  its own local `setStatus`) so the header can render the badge without
  duplicating autosave state.
- **Undo/Redo and Named ranges move the other direction — out of the header
  and into `SheetGrid.tsx`'s own toolbar**, directly above the cell grid,
  alongside the format `Select`/Bold/Italic/Validation group. Task 15's
  standalone `.toolbarBar` row (`WorkbookView.module.css`, Undo/Redo only,
  between the header and the sheet tabs) is removed outright — those two
  controls and Named ranges are now the first two groups in `SheetGrid.tsx`'s
  toolbar, each separated by a 1px `.divider` (ported from Docs'
  `RichTextEditor.module.css`'s own toolbar-group divider): `[Undo, Redo] |
  [Named ranges] | [Format, Bold, Italic, Validation] | (spacer) | [Add
  rows, Add columns]`. `canUndo`/`canRedo`/`onUndo`/`onRedo` and
  `namedRanges`/`onAddNamedRange`/`onRemoveNamedRange` are threaded down from
  `WorkbookView.tsx` as plain props — the underlying handlers
  (`handleUndo`/`handleRedo`/`handleAddNamedRange`/`handleRemoveNamedRange`)
  still live in `WorkbookView.tsx` since they operate on the shared
  cross-sheet HyperFormula engine, not per-sheet state; only the rendered
  buttons moved. Undo/Redo and Named ranges are `canEdit`-gated the same way
  Add rows/Add columns already were (hidden outright for viewers, not just
  disabled) — Named ranges is the one exception, staying visible-but-
  internally-gated for viewers, unchanged from task 15, since viewing the
  list is a read-only operation.
- **Sheet tabs move from above the grid to below it, dock to the bottom of
  the viewport, and — the real fix underneath all of this — the header,
  toolbar, formula bar, and column-letter row now stay fixed in place while
  only the grid's own rows scroll**, matching a real spreadsheet app rather
  than a normal scrolling document. `SheetTabs` is now the last child
  rendered in `WorkbookView.tsx`'s JSX (after `SheetGrid`, not before it),
  and `SheetTabs.module.css`'s `.tabs` swaps `border-bottom`/`padding-bottom`
  for `border-top`/`padding-top` (the divider now sits above the strip,
  matching its new position).

  This needed two attempts. The first attempt made only `SheetTabs` itself
  `position: sticky; bottom: 0`, reasoning (correctly, as far as it went)
  that this page's `.view { height: 100% }` chain wasn't resolving to a real
  viewport-bounded height — confirmed live via `SheetGrid.module.css`'s
  `.scroller` (meant to be the *only* internally-scrolling box) reporting
  `scrollHeight === clientHeight` (no internal scrollbar at all) while
  `document.scrollingElement` was `<html>` and the whole document scrolled
  instead. That first attempt shipped believing the underlying gap was a
  platform-shell layout limitation outside this plugin's own control (the
  same conclusion as the 0.9.1 hotfix's width-blowout bug, one layer up in
  the box model) — **that belief was wrong**, caught immediately after by a
  direct follow-up ask to also keep the header/toolbar/column-letter row
  fixed while scrolling, which a bottom-anchored sticky tab strip alone could
  never deliver (nothing was pinning the *top* chrome, and `.scroller`'s own
  `position: sticky; top: 0` column headers were scoped to `.scroller` as
  their sticky containing block, which was worthless while `.scroller` itself
  never actually scrolled). Revisiting the platform shell's own
  `shell.module.css` surfaced the actual, already-documented mechanism:
  `[data-plugin-fullbleed]` is exactly this — "a plugin that owns its own
  internal layout (columns, scroll, flanking panes) marks its root with
  `[data-plugin-fullbleed]`," at which point the shell hard-locks itself to
  `100dvh` on desktop and gives the plugin's own content cell `overflow:
  hidden`, letting `height: 100%` cascade correctly into the plugin instead
  of the whole document growing to fit a 100-row sheet. Sheets' own `(home)`
  route group (`app/(home)/layout.tsx`) already opts into this for the
  Workbooks/Inbox list — the workbook editor route
  (`app/s/[workbookId]/page.tsx`) simply never had the same attribute added,
  a genuine gap in this plugin's own code, not a platform limitation. Adding
  `data-plugin-fullbleed` there was the one-line real fix: confirmed live
  afterward that `.scroller` now reports real internal scroll
  (`scrollHeight` 1648 vs. `clientHeight` 609 at 1280×800, `document
  .scrollingElement`'s own `scrollHeight`/`clientHeight` now equal, i.e. the
  page itself no longer scrolls at all) — and with a real bounded height in
  place, `.colHeader`/`.cornerHeader`'s existing `position: sticky; top: 0`
  (unchanged, already present since the MVP) started working exactly as
  originally intended, the header/toolbar/formula bar stopped needing any
  positioning changes at all (they were never the problem once `.scroller`
  itself was properly bounded), and the earlier `position: sticky; bottom: 0`
  on `SheetTabs` became dead weight — removed, since it's now just a normal
  last flex child of a genuinely viewport-bounded `.view`, landing at the
  bottom for free. Also incidentally corrects the task 16 padding-tightening
  bullet above: some of what read as "too much padding" in the original
  report was the platform shell's own default `.content` padding stacking
  with `.view`'s own — `data-plugin-fullbleed` also zeroes that shell-level
  padding (same as every other fullbleed plugin), so only this plugin's own
  (now-tightened) `.view` padding applies.

**Lesson captured for future layout work in this plugin:** `[data-plugin-
fullbleed]` (`runtime/app/(platform)/shell.module.css`) is the right first
thing to check whenever a route wants real internal scrolling bounded to the
viewport, before concluding a height-chain gap is a platform limitation —
grep the platform repo for the attribute's own usage/doc comment first.

## Export/Import menu consolidation (post-MVP, task 17)

By task 16, the header had accumulated four separate export/import
affordances — an `Export CSV` icon button, an `Import CSV` icon button, and a
labeled `Export workbook` button, plus the Home page's own separate `Import
workbook` — each a one-off trigger for a single format. Consolidated into
two menu-triggered buttons, `Export ▾` and `Import ▾`
(`WorkbookView.tsx`'s `.metaRight`), each opening a small `@sovereignfs/ui`
`Menu` (the same `Popover`-desktop/`Drawer`-mobile adaptive menu already used
for the header's overflow `⋮`):

- **Export ▾** — "Export as CSV" (current sheet only, `Icon:
  file-text`) and "Export as JSON" (whole workbook, lossless, `Icon: file`).
  Available to any role, unchanged from before — both are read operations.
- **Import ▾** — "Import CSV" (replaces the current sheet, same confirm
  dialog as before) and "Import as JSON (new workbook)" (parses/validates a
  `.sheets.json` file and creates a **new**, unrelated workbook, navigating
  away from the one currently open). The whole `Import ▾` button is
  `canEdit`-gated — hidden outright for viewers, not just its items — even
  though "Import as JSON" doesn't strictly depend on this workbook's own
  role, since a read-only visitor has no reason to see an Import affordance
  here at all (same reasoning already applied to Undo/Redo).

**Naming matters here more than most menu copy in this plugin.** "Import as
JSON" always creates a brand-new workbook and navigates away from whichever
one you're currently looking at — a real behavior discontinuity from "Import
CSV," which edits the workbook you're already in. The label spells out the
consequence directly (`"Import as JSON (new workbook)"`) rather than leaving
it to be discovered after the fact, a deliberate product decision (not
merely a UI nit) made explicitly during planning before implementation
started, not worked out ad hoc while coding.

**`ImportWorkbookButton.tsx` gained a second calling convention** to support
this without duplicating its own file-input/validation/`useActionState`
plumbing (already shared between client-side pre-validation and
`importWorkbookAction`'s own server-side re-validation, per the "Full-workbook
JSON export/import" section above). `renderTrigger` is now optional, and the
component additionally accepts a React 19 ref-as-prop (`ref?:
Ref<ImportWorkbookHandle>`, no `forwardRef` — the same pattern
`SheetGridHandle` established in task 16) exposing `{ triggerImport: () =>
void }`. The Home page's existing two call sites (`HomeWorkbooksList.tsx`)
are unchanged, still passing `renderTrigger` to render their own visible
button; `WorkbookView.tsx` mounts a second, trigger-less instance
(`<ImportWorkbookButton ref={importWorkbookRef} />`, renders only the hidden
file input/form, no visible UI of its own) and calls
`importWorkbookRef.current.triggerImport()` from the Import menu's "Import
as JSON" item's `onSelect`. One component, two independent call sites, no
duplicated logic.

## Status badge placement (post-MVP, task 18)

A small, direct follow-up: the autosave "Synced"/"Draft"/"Error" status
badge moved from `WorkbookView.tsx`'s `.metaRight` (the Export/Import/Share
command-button row) into `.titleBlock`, right next to the workbook name —
the same slot the "View only" badge (shown to viewers) already occupied.
The two are mutually exclusive by role (`!canEdit` shows "View only",
`canEdit` shows the live autosave status) and were already rendered as
siblings of the `<h1>` before this change for the viewer case, so no new
CSS was needed. Reasoning: both describe the state of the *document itself*
(read-only vs. editable, saved vs. not), not a command a user issues, so
they read more naturally as a caption next to the title — the same pattern
Docs' own `DocumentPage.module.css` `.statusLine` already uses (inline,
next to the title, not among the action buttons) — than sitting among
Export/Import/Share. Verified live, including the actual state transition
(not just its resting appearance): typing into a cell flips the badge to
"Draft" immediately, and it flips back to "Synced" ~1200ms later once the
debounced autosave completes, both confirmed via a script that read the
badge text at controlled intervals rather than relying on a screenshot
alone — an unguarded screenshot after typing can land after the debounce
has already fired, reading as "no change happened" when it did (the same
timing pitfall documented for task 14's multi-click Add Columns test).

## Resizable columns (post-MVP, task 19)

Per-column width overrides, persisted per sheet: `sheets.col_widths_json`, a
sparse map of 0-indexed column (as a string key) → width in px — an absent
entry renders at `DEFAULT_COL_WIDTH_PX` (88px, matching the grid's previous
fixed `5.5rem` column width, so unresized columns render identically to
before this feature existed). Bounds: `MIN_COL_WIDTH_PX` (48) /
`MAX_COL_WIDTH_PX` (480), both enforced on every write path (live drag,
keyboard step, and parsed back out of a stored or imported
`colWidthsJson`) — `_lib/column-widths.ts`'s `clampColumnWidth()`.

Four ways to change a column's width, all `canEdit`-gated:

- **Drag** the handle on a column header's right edge (`role="separator"`,
  pointer-capture-based — `SheetGrid.tsx`'s `handleResizePointerDown/Move/Up`).
  The live drag mutates the `<colgroup>`'s `<col>` DOM node directly
  (`colEl.style.width`) rather than React state, so dragging doesn't
  re-render the grid per pixel moved; only the final width on pointer-up
  flows through `onColumnWidthChange` into persisted state.
- **Double-click** the handle to reset that column back to
  `DEFAULT_COL_WIDTH_PX`.
- **Keyboard**, once the handle has focus: Left/Right adjust by 8px,
  Shift+Left/Right by 32px — the WAI-ARIA "window splitter" pattern
  (`role="separator"` + `aria-orientation="vertical"` + `tabIndex={0}`),
  the same interactive-`separator` precedent `packages/ui`'s `Resizable`
  component already establishes.
- **Import** — column widths round-trip through the full-workbook JSON
  export/import format (task 13): `WorkbookExportSheet.colWidthsJson`,
  parsed and re-clamped on import the same way `cellsJson` already is.

Sizing mechanism: the grid table uses `table-layout: fixed` with an explicit
`<colgroup>` — each data column's `<col style={{ width }}>` is what actually
sizes the column under `table-layout: fixed`; `min-width` on the header/row
cells themselves plays no part in that layout algorithm, so
`SheetGrid.module.css` carries none. The row-number column has its own
fixed, non-resizable `<col>` (`.rowHeaderCol`, 2.5rem, unchanged from
before).

Persistence is a single whole-map write per resize gesture, not a per-column
CRUD action — `saveColumnWidthsAction(sheetId, workbookId, colWidthsJson)`,
same shape as `saveNamedRangesAction` (task 10). `serializeColumnWidthsJson`
drops entries equal to the default width before writing, matching
`serializeCellsJson`'s "don't store what isn't a real override" convention.

**A live-testing false alarm, corrected before this was called done:** an
initial verification pass using synthetic `PointerEvent`s (dispatched via
`element.dispatchEvent()` rather than real OS-level input) found the resized
width vanishing from the JSON export — `colWidthsJson: "{}"` even right
after a drag that visibly changed the column's DOM width. Root cause was
narrower than it first looked: `element.setPointerCapture()` throws
`NotFoundError` when called with a pointer id that has no genuine active
pointer session, which a `dispatchEvent`-only synthetic `PointerEvent` never
establishes — real mouse/touch input always has one by the time a
`pointerdown` handler runs, so this doesn't reproduce for actual users.
Confirmed by re-testing the identical downstream path (state update →
`saveColumnWidthsAction` → export serialization) via the keyboard-resize
interaction instead, which dispatches genuine `KeyboardEvent`s with no
pointer capture involved: the resize persisted correctly, reload preserved
it, and the JSON export/import round-trip both reflected it — proving the
feature's actual code was correct and the earlier finding was a test-harness
artifact, not a shipped bug.

## Formula bar and column-width fixes (post-MVP, task 20)

Two bugs reported directly from real usage right after task 19 shipped,
fixed together in the same pass:

**Formula bar rendering as a huge box instead of one line.** `FormulaBar.tsx`
wraps `@sovereignfs/ui`'s `CodeTextarea` (a multi-line editor component,
`min-height: 180px` by design, meant for Markdown/YAML/JSON) with `rows={1}`
and its own `FormulaBar.module.css` `.input` class overriding `min-height:
0` for the single-line case. Both `CodeTextarea`'s `.textarea` class and
`FormulaBar`'s `.input` class are equal-specificity single-class selectors
applied to the same element — which one wins the `min-height` cascade
depends on CSS-module chunk load order, which isn't guaranteed and was
observed differing between sessions (present via a direct URL load in one
tab, absent in another). Fixed by raising `FormulaBar.module.css`'s
selector to the compound `.bar .input`, which reliably outranks a bare
single-class selector regardless of load order — not a workaround, a correct
fix for relying on implicit source order for an override in the first place.

**Resized/default column widths rendering smaller than configured.** A
second, more serious bug found while re-verifying the fix above: task 19's
`SheetGrid.module.css` `.grid` table had `table-layout: fixed` and a
`<colgroup>` but no explicit `width`, so the table's own box underwent
ordinary shrink-to-fit sizing — capped at `.scroller`'s *available* width
rather than growing to the sum of the `<colgroup>`'s column widths. On any
sheet wide enough to need `.scroller`'s horizontal scroll (i.e. virtually
every default-sized sheet, 20 columns), every column silently rendered
proportionally smaller than its actual configured or resized width instead
of the table overflowing and `.scroller` scrolling as intended — confirmed
directly: a column explicitly resized to 128px rendered at ~58px until this
fix. Fixed with `width: max-content` on `.grid`, which sizes the table from
its own content (the `<colgroup>` widths) instead of the container's
available space, letting `.scroller`'s existing `overflow: auto` do the
scrolling. This bug shipped with task 19 and had gone unnoticed through that
task's own live verification, since every check there happened to compare
*relative* width differences (resized vs. unresized column, both
proportionally shrunk together) rather than an absolute pixel value against
the requested width.

**Default column width widened, 88px → 128px** (`DEFAULT_COL_WIDTH_PX`,
`_lib/config.ts`) — separately reported as too narrow: real content like
`$1,500.00` or a `"Note"` column header routinely truncated at the old
default. Column resizing (task 19) gave users an escape hatch either way,
but the default itself was still worth widening.

## Cell font and background color (post-MVP, task 21)

Extends task 11's cell styling (bold/italic) with two more `CellStyle`
fields, `color` (font) and `bg` (background) — both 6-digit hex or absent.
Absent is not "no color stored as a specific value" — it means "use the
theme default" (`--sv-color-text-primary` for text, no fill for
background), so a cell nobody has touched stays correct across light/dark
mode with zero migration and no behavior change (`isEmptyStyle` extended to
also check both new fields).

**UI**: two new toolbar buttons in `SheetGrid.tsx`, right after
Bold/Italic — "Font color" (a plain "A" with a colored bar underneath
showing the active cell's current color, or a bordered-but-transparent bar
when unset) and "Fill color" (a small bordered swatch, same idea). Each
opens a `@sovereignfs/ui` `Popover` containing a `@sovereignfs/ui`
`ColorPicker` (curated swatches + a native `<input type="color">` custom
trigger, `allowNone` for "back to default"/"no fill"). Originally, picking
a color did not auto-close the popover — closed only via outside click,
Escape, or re-clicking the trigger, avoiding a risk with the native
color-input firing `onChange` more than once mid-pick; task 27 changed
this — see "Color picker auto-close on selection" below.

**Curated palette** (`_lib/cell-colors.ts`, `CELL_COLOR_SWATCHES`, shared by
both pickers): colors are plugin *data*, not design tokens — same pattern
`plugins/sovereign-plugin-kanban.local/app/_lib/palette.ts` already
establishes for board colors, since the design system itself is
deliberately monochrome. Deliberately excludes black/white/gray-scale
extremes: a cell's font sits directly on `--sv-color-surface`, which flips
between light and dark mode, so there is no single "black" that reads
correctly in both — `allowNone` (which resolves to the theme-token default)
is how a user gets back to a genuinely theme-correct color, not a stored
literal. The nine swatches are moderate-saturation, moderate-lightness hues
chosen to stay legible as either text or a fill in both themes — the same
tradeoff every spreadsheet tool's user-chosen accent colors makes, not
pixel-verified WCAG contrast for every combination.

**Rendering**: applied as inline `style={{ color, backgroundColor }}` on the
cell's `<input>` (`SheetGrid.tsx`) — arbitrary hex values can't be
expressed as a fixed CSS-module class the way bold/italic are. `undefined`
values are omitted by React, so an unstyled cell's inline style contributes
nothing and the class-driven default (`--sv-color-text-primary`, no
background) applies exactly as before this feature existed.

**Persistence and export/import**: zero new plumbing needed beyond
`WorkbookView.tsx`'s `handleColorChange` (mirrors `handleToggleStyle`'s
shape, but sets/clears a value instead of toggling a boolean) — `color`/`bg`
live inside the same `CellStyle` object `cellsJson` already serializes
generically, so persistence, autosave, and both CSV-unrelated full-workbook
JSON export/import (task 13) round-trip them with no changes to
`_lib/workbook-export.ts` or `actions.ts` at all. Verified live: set both
colors on a cell, confirmed the inline styles, reloaded and confirmed they
persisted, cleared the font color via `allowNone` and confirmed only that
one field cleared (background stayed), and exported the workbook as JSON —
the payload's `cellsJson` correctly carried `style.bg` and correctly omitted
the already-cleared `color`.

## Cell color visibility fixes (post-MVP, task 22)

Direct follow-up to task 21, reported right after it shipped: applied
font/background colors and the toolbar's active-color indicators were both
too subtle to read at a glance. Two independent fixes:

- **`CELL_COLOR_SWATCHES` (`_lib/cell-colors.ts`) re-saturated and
  darkened.** The original curated set was tuned toward muted/pastel to
  stay legible in both light and dark mode, but that landed as washed-out
  once actually typed as text on a white cell — yellow in particular reads
  poorly as text at almost any real lightness, since it's the highest-
  luminance hue. Pulled every swatch toward a more saturated, mid-to-dark
  value (e.g. `Amber` `#b45309` replacing the earlier pale `Yellow`
  `#c9a227`); still no black/white extremes, for the same light/dark-mode
  reason task 21 documents.
- **Toolbar trigger indicators enlarged** (`SheetGrid.module.css`): the font
  color underline bar grew 14×3px → 18×5px, the fill color swatch 16×16px →
  20×20px — both had shrunk to the point of reading as decorative hairlines
  rather than an actual color preview. The bar/swatch's border also now
  matches the active color inline (`SheetGrid.tsx`) instead of always using
  the neutral `--sv-color-border`, so the edge reinforces the fill instead
  of competing with it.

## Multi-cell selection (post-MVP, task 23)

The grid's selection model — previously a single `{row, col}` — is now an
anchor + a focus corner, forming a rectangle. A plain click collapses both
to the same cell (identical to the old single-cell model); drag, shift-click,
or Shift+Arrow move the focus corner while the anchor stays put, the same
way Sheets/Excel keep the "active cell" (where typing goes, what the
formula bar shows) fixed at the selection's starting corner while it's
extended. Four ways to build a range: click+drag, shift+click, Shift+Arrow
keys, or (unchanged) a plain click/arrow for a single cell.

**Interactions on a selection:**

- **Bulk formatting** — Bold/Italic/Font color/Fill color/number format,
  applied to every cell in the current selection at once (a selection of 1
  behaves exactly as before this task). Bold/Italic are a *uniform* toggle,
  not per-cell independent: if every selected cell already has the flag on,
  the click turns it off for all of them; otherwise it turns it on for all
  of them (`WorkbookView.tsx`'s `handleToggleStyle`). Font/fill color always
  just sets the value uniformly — no toggle ambiguity there. Applying to N
  cells costs one persist call, not N (`applyMetadataPatch`, the shared
  primitive every bulk operation builds on).
- **Copy / Cut / Paste** (Ctrl/Cmd+C / X / V) — built directly on
  HyperFormula's own internal clipboard (`engine.copy`/`cut`/`paste`), which
  already handles relative formula-reference translation the way a real
  spreadsheet's copy/paste always has (copying `=B2*2` one row down and
  pasting produces `=B3*2`, verified live). The engine has no concept of
  this plugin's own per-cell metadata (format/style/validation) though, so
  that travels in parallel, keyed by offset from the copied range's
  top-left corner, and gets re-anchored at the paste target
  (`SheetGrid.tsx`'s `handleCopyOrCut`/`handlePaste`,
  `WorkbookView.tsx`'s new `onApplyMetadataPatch` prop). A cut additionally
  clears the *source* range's metadata once pasted, mirroring how
  `engine.paste()` already moves (not duplicates) the underlying values.
  Always whole-cell/range semantics, even when the focused `<input>` has
  its own native text selection — copying "this cell" is the primary
  spreadsheet expectation; a substring copy is still reachable via the
  browser's own right-click Copy. An in-app clipboard only — no OS
  clipboard integration (no paste from/to Excel or a text file); tracked as
  a possible follow-up, not attempted here.
- **Bulk clear** — Delete/Backspace over a multi-cell selection clears
  every selected cell's *value*, not its formatting, matching Excel/Sheets
  (formatting survives until explicitly cleared). A single-cell selection's
  Backspace/Delete is untouched, native in-`<input>` text editing.

**Rendering**: a translucent tint over the selected range plus a solid
border tracing the range's outer edge (not every individual cell) — same
visual language as Excel/Sheets' own selection marquee. The tint is a
separate absolutely-positioned `::after` layer, not a plain
`background-color` on the cell: a cell can already have its own arbitrary
inline fill color (task 21's `style.bg`), and a class-based `background`
here would either lose to or clash with that inline style depending on
paint order. Reuses `--sv-color-accent-subtle` (the design system's
existing `color-mix(in srgb, var(--sv-color-accent) 12%, transparent)`
token, already used for badge/chip tints) rather than inventing a new one.
The edge/tint CSS classes are compound selectors (`.cell.cellSelected`,
not bare `.cellSelected`) — deliberately, to sidestep the exact
CSS-cascade-order bug already hit and fixed once in this plugin (see
"Formula bar and column-width fixes" above): two equal-specificity
single-class rules on the same element have their winner decided by
unpredictable CSS-module chunk load order, not source intent, while a
two-class compound selector always outranks a single-class rule regardless
of load order.

**Drag-select implementation note**: cells are literal always-editable
`<input>` elements, so building a selection by dragging across them needs
to suppress the browser's own native text-selection-within-input that
would otherwise also fire. `user-select: none` is applied to the grid for
the duration of a drag (`SheetGrid.tsx`'s `dragging` state). A live-testing
false alarm surfaced and resolved while verifying this: an initial test
using `element.dispatchEvent(new MouseEvent('mouseenter', ...))` never
extended the selection at all. Root cause was narrower than it looked —
React's synthetic `onMouseEnter`/`onMouseLeave` are implemented on top of
native `mouseover`/`mouseout` tracking, not a native `mouseenter` listener
(`mouseenter` doesn't bubble, so React can't delegate it from the root the
way it does most other events) — a manually dispatched `mouseenter` event
never reaches that machinery no matter how it's constructed. Confirmed by
switching to a genuine OS-level drag (the `computer` tool's
`left_click_drag`, which generates real native mouse events start-to-finish):
selection, highlight, and formula-bar range label all worked correctly on
the first try. Every other synthetic-event interaction used to verify this
task (`Ctrl+C`/`X`/`V`, `Shift`+`Arrow`, `Delete`) dispatches `KeyboardEvent`s,
which React *does* listen for via a native `keydown` handler — those all
worked as plain synthetic dispatches with no such gap. (Cells were literal
always-editable `<input>` elements at the time this task shipped — task 24
below changed that; the drag-select mechanics described here are
unaffected, since a click still always selects first.)

## Click to select, double-click to edit (post-MVP, task 24)

Every cell was previously an always-editable `<input>` — a single click (or
arrow-nav) dropped straight into text-edit mode, with no distinct "selected
but not editing" state. Reported as surprising, unlike Google Sheets/Docs.
Reworked to match: a click **selects** a cell (shows its computed display
value, `readOnly`, `cursor: default`, no text caret); a **double-click**
enters inline edit mode (raw/formula value, editable, text caret).

**New `editingCell` state** (`SheetGrid.tsx`), orthogonal to the existing
anchor+focus selection model (task 23) — at most one cell can be editing
regardless of how large the current selection is. `selectCell` (driving
every selection action: click, drag-start, shift-click, Shift+Arrow) always
resets it to `null`, so none of those paths can accidentally land in edit
mode; only `startEditing()` (called from double-click, F2, or direct typing)
enters it.

**Three necessary complements**, added so the new model isn't a half-finished
click-vs-double-click toggle:

- **F2** enters edit mode on the selected cell, preserving its existing raw
  content — the standard spreadsheet accessibility path for keyboard-only
  users who can't double-click.
- **Direct typing** on a selected, non-editing cell replaces its entire
  content and immediately enters edit mode with just the typed character —
  Excel/Sheets' "destructive typing" convention. Detected via
  `e.key.length === 1 && !ctrlKey && !metaKey && !altKey`, which naturally
  excludes every multi-character key name (`'Enter'`, `'ArrowLeft'`,
  `'Backspace'`, `'F2'`, `'Escape'`, …) with no explicit exclusion list
  needed.
- **Escape while editing** cancels and reverts to the value captured the
  moment edit mode was entered (`editOriginalValue`, a ref) — necessary
  because this grid's autosave model commits on every keystroke, so there is
  no separate unsaved draft to just discard; "cancel" means writing the
  captured original value back via `commitCell`.

**Delete/Backspace on a single selected (non-editing) cell** now needs the
same explicit `clearSelectionValues()` path task 23 already built for a
multi-cell selection — previously this fell through to native
in-`<input>` text editing since the cell was always editable, but a
`readOnly` selected cell can no longer handle it natively. The pre-existing
Delete/Backspace branch (previously gated on `isMultiSelection`) is now
gated on `!editing` instead, so a single non-editing cell and a multi-cell
range both route through the same bulk-clear call — a 1×1 selection was
already handled correctly by `clearSelectionValues()`'s bounds math, so no
new clearing logic was needed, just a wider gate.

**Left/Right arrow "leave the cell only at the text boundary" logic**
(pre-existing) is now conditioned on `editing` — a read-only, non-editing
cell's `selectionStart` isn't a meaningful signal for that decision, so
arrows always navigate when not editing, and only check cursor position
while actually editing (unchanged from before this task).

Enter on a selected-but-not-editing cell still just moves the selection down
— deliberately unchanged; only F2, double-click, and direct typing start
editing, matching Excel/Sheets (Enter never opens edit mode there either).

`readOnly={!canEdit || !isEditing}` on the cell `<input>` — a viewer
(`canEdit=false`) stays permanently read-only regardless of `isEditing`,
since `startEditing()` itself early-returns on `!canEdit` before setting
that state, so double-click/F2/typing are all safe no-ops for a viewer even
though the JSX call sites don't each separately re-check the flag.

## Cell font size (post-MVP, task 24)

A third `CellStyle` field, `fontSize?: number` (px), alongside task 11's
bold/italic and task 21's color/bg — absent means "inherit the grid's own
default" (`--sv-font-size-sm`, 14px), not a stored literal, same shape as
every other optional `CellStyle` field.

**UI**: a new `<Select>` in `SheetGrid.tsx`'s toolbar, between the number-
format `Select` and the Bold button — options are a curated list of px sizes
(`_lib/font-sizes.ts`'s `CELL_FONT_SIZES`: 10/12/14/16/18/20/24/28/32/36/48)
plus a `"Default"` option that clears the override. Like task 21's colors,
these are plugin *data*, not a `--sv-*` design-system scale — a value a user
picks for their own cell content, not a token this plugin's own chrome is
built from.

**Rendering**: applied as inline `style={{ fontSize: '${n}px' }}` on the
cell's `<input>` (arbitrary numeric values can't be a fixed CSS-module
class, same reasoning as task 21's colors) — an unset cell contributes no
inline style and falls back to the class-driven `--sv-font-size-sm` exactly
as before this feature existed. Setting a larger size grows that row's
height naturally (no explicit row-height logic needed — the `<input>` just
takes more vertical space, and the `<tr>` follows).

**Bulk-apply**: reuses task 23's `applyMetadataPatch` infrastructure
directly — `WorkbookView.tsx`'s new `handleFontSizeChange` mirrors
`handleColorChange`'s exact shape (accepts `cellKeys: string[]`, builds a
per-cell patch preserving each cell's other style fields, one persist call
for the whole selection). Zero new plumbing needed in
`_lib/workbook-export.ts` or `actions.ts` — `fontSize` lives inside the same
generic `CellStyle` object `cellsJson` already serializes, so persistence
and full-workbook JSON export/import (task 13) round-trip it automatically.

**Formula bar font size** (unrelated field, same task, reported together):
`FormulaBar.module.css`'s `.bar .input` and `.cellLabel` both reduced from
`--sv-font-size-sm` (14px, matching the grid's own default cell size) to
`--sv-font-size-xs` (12px) — reported as reading too large for a single-line
reference bar relative to the grid content it describes.

Verified live end-to-end: single click selects without entering edit mode;
double-click enters edit mode; Escape while editing reverts to the pre-edit
value; typing directly on a selected empty cell replaces its content and
enters edit mode in one step; F2 enters edit mode preserving existing raw
content (confirmed showing the *raw* formula/value, not the formatted
display string); Delete on a single selected non-editing cell clears its
value without entering edit mode; the font-size `Select` applies a chosen
size (visually confirmed via a noticeably larger rendered value and the row
growing to fit) and "Default" correctly clears the override; every one of
the above survives a reload. Viewer-role gating confirmed by code
inspection (`startEditing`'s `canEdit` early-return covers every entry
point) rather than a live second-account session.

A repeat of task 23's `computer`-tool coordinate issue, different specific
gesture: the `computer` tool's `double_click` action landed on the wrong
cell twice (once hitting nothing, once landing several cells off), even
after the drag-select coordinate-mapping heuristic from task 23. Rather than
keep fighting tool coordinates, verification for this task dispatched real
`MouseEvent`/`KeyboardEvent`s directly via
`element.dispatchEvent(new MouseEvent('dblclick', ...))` on elements found
by `document.querySelector('[aria-label="B1"]')` — confirmed reliable for
`dblclick`/`mousedown`/`keydown` (all native events React listens for
directly), unlike task 23's `mouseenter` finding, which is specific to how
React synthesizes that one event.

## Toolbar icon polish: Bold/Italic/Fill color (post-MVP, task 25)

Reported directly against the Bold/Italic/Font color/Fill color group:
Italic rendered illegibly (a plain `font-style: italic` capital "I" in the
design system's sans-serif font is just a slanted vertical stroke — at
toolbar size it reads as an unlabeled slash, not a letter), and Fill color
had no icon at all — just a bare, empty bordered swatch, giving no visual
hint of what the control did until clicked. Compared directly against
Google Sheets' own toolbar as the reference.

**Bold and Italic** switched from styled text (`<strong>B</strong>` /
`<em>I</em>`) to dedicated Lucide icons (`bold`/`italic`, newly added to
`scripts/icon-list.ts` and regenerated into `packages/ui`'s curated icon
set via `pnpm generate:icons`). A dedicated icon sidesteps the italic
legibility problem entirely — Lucide's `Italic` glyph draws explicit top/
bottom serif bars around the vertical stroke as vector paths, unlike
`font-style: italic` on a bare "I" glyph, so it reads correctly regardless
of the surrounding font. Both switched together (not just Italic) so the
pair reads as a consistent icon-button set rather than one icon next to one
styled-text button.

**Fill color** gained a `paint-bucket` icon (also newly added), rendered
above the existing colored bar in the same vertical icon+bar layout as the
Font color trigger's "A" + bar (`.fillTrigger`/`.fillTriggerBar`, mirroring
`.colorTrigger`/`.colorTriggerBar`) — matching Google Sheets' own fill
control exactly: an icon that identifies the action, with a bar underneath
showing the currently-applied color (or none). Font color's "A" + bar was
already correct by this same comparison and needed no change — a plain
letter glyph is unambiguous, unlike italic's slanted-stroke problem.

**All four buttons** (plus the Font color trigger) switched from the
generic `Button` component (text-button padding, uneven widths per label)
to plain `<button>` elements using the toolbar's own `.toolbarIconButton`
class — the same uniform 28×28px square treatment already used for Undo/
Redo — for a tighter, evenly-spaced icon row instead of loosely-packed
text buttons. `Popover`'s `trigger` prop accepts any element with its own
wired `onClick` ("rendered as-is; caller wires its onClick"), so this
swap needed no `Popover` changes. Bold/Italic's pressed (toggled-on) state
moved from `Button`'s `variant="secondary"` prop to a new
`.toolbarIconButtonActive` class, layered on via a second class name
(same pattern as the cell `<input>`'s existing class-array construction) —
a sunken fill plus an inset border, mirroring Docs' `RichTextEditor`
toolbar's own `.toolbarButtonActive` treatment so the pressed state reads
clearly without relying on color alone.

**Icon curation**: `bold`/`italic`/`paint-bucket` added to
`scripts/icon-list.ts`'s curated Lucide set (a small, deliberately-scoped
list — "add only icons the platform chrome or plugin ecosystem actively
uses") and regenerated via `pnpm generate:icons`, which pulls the actual
SVG path data from the `lucide` devDependency into committed,
RSC-safe `.tsx` files under `packages/ui/src/components/Icon/icons/`. This
is a `packages/ui` change, so it falls under the Storybook-hygiene
requirement — no new component or renamed token here (icons are consumed
dynamically from `Object.keys(ICONS)` in `Icon.stories.tsx`, not a
hardcoded per-icon list), so no story file needed updating; confirmed via
`pnpm --filter @sovereignfs/ui typecheck`.

**A dev-environment false alarm, not a code bug, cost the bulk of this
task's verification time.** After implementing and passing every static
check (typecheck/lint/format/design-tokens), the live-verification browser
kept rendering the *old* toolbar — plain "B"/"/" text, no icons — across a
forced reload and even a brand-new browser tab, with zero console errors.
Root-caused by directly diffing the served JS/CSS bundles (fetched with
`cache: 'no-store'`) against the edited source: the compiled route's CSS
had the new class names (`toolbarIconButtonActive`, `fillTriggerBar`)
entirely absent, while an unrelated `packages/ui` change (the new Lucide
icon files, watched normally by Next's own compiler since `packages/ui` is
in `transpilePackages`) *did* show up fresh — proving the gap was specific
to this plugin's own source, not a browser cache or a real compile error.
Traced to the dev-DX mechanism documented in this plugin's own `CLAUDE.md`
("Plugin changes → HMR via re-copy... Plugins are copies, not symlinks —
Next's dev watcher does not follow symlinks"): the `next dev` process
being used for verification was running standalone, without the sibling
`generate --watch` process `scripts/dev.ts` normally starts alongside it
to re-copy plugin source into the runtime's route group on every edit —
confirmed by diffing file mtimes, the copied
`runtime/app/(platform)/(plugins)/sheets/_components/SheetGrid.module.css`
was ~30 minutes stale relative to the plugin's own source file. Fixed by
running the one-shot `pnpm generate` (`tsx scripts/generate-registry.ts`,
the same script `--watch` wraps) to force a fresh re-copy; the already-
running `next dev` then picked up the freshly-copied files normally on the
next request. Not a bug in this task's actual code changes — every static
check had already passed before this was investigated.

Verified live end-to-end after the resync: Bold/Italic icons render
clearly and toggle their pressed state correctly (sunken background, inset
border) on click; Fill color's popover still opens correctly and the
paint-bucket icon's bar updates to reflect the applied color (confirmed
setting green, then resetting to "No fill"); Font color unaffected. No
visual regressions to the surrounding Named ranges/format/font-size
controls.

## Font color default swatch fix (post-MVP, task 26)

Direct follow-up, reported right after task 25 shipped: the Font color
bar's *default* (unset) state rendered as `'transparent'` — the same
"no color" treatment Fill color legitimately uses when there's genuinely
no fill applied. But font color is never actually invisible; unset always
resolves to a real, visible color, `--sv-color-text-primary` (black in
light mode) — a transparent bar misleadingly implied "no color applied"
when the text was in fact rendering in a specific, visible color the
swatch just wasn't showing.

Fixed by defaulting the bar's background to
`var(--sv-color-text-primary)` instead of `'transparent'` when
`style.color` is unset (`SheetGrid.tsx`'s `colorTriggerBar` inline style) —
a live CSS variable reference, not a hardcoded `#000`, so it automatically
tracks light/dark mode and any future instance theming exactly like every
other semantic color consumer in this app, with no theme-awareness logic
of its own needed. Fill color's bar is intentionally unchanged (still
`'transparent'` for unset) — that one *is* correctly representing
"nothing," unlike font color, which always renders in some color.

Verified live: the bar renders solid black by default, matching the
`--sv-color-text-primary` token's computed value exactly (confirmed via
`getComputedStyle`); explicitly setting a color (e.g. red) still overrides
it correctly; and resetting via "Default color" in the picker correctly
returns the inline style to the token reference rather than leaving a
stale literal color behind.

## Color picker auto-close on selection (post-MVP, task 27)

Reported directly: picking a color from the Font/Fill color popover left
the popover open, requiring a separate dismiss action (outside click,
Escape, or re-clicking the trigger) — this plugin's own original design
note (see "Cell font and background color" above) called this out as
deliberate, to sidestep a risk with the native custom-color `<input
type="color">` firing `onChange` repeatedly mid-drag inside the browser's
own color dialog: closing on every `onChange` would have slammed the
popover shut while a user was still adjusting a custom color. Live use
showed that tradeoff reads as broken, not deliberate, for the much more
common case — picking one of the curated swatches, a single discrete
click that should behave like committing a choice.

**Fixed at the design-system level, not with a Sheets-local workaround** —
`ColorPicker` is a shared, published `@sovereignfs/ui` component (also
consumed by Kanban's board-color dialogs), so the fix belongs there per
this repo's DS-first placement rule, not duplicated as Sheets-only logic.
Added a new optional `onSelectionComplete?: () => void` prop to
`ColorPicker`, fired from the curated-swatch and "no color" buttons'
`onClick` handlers (both single, discrete actions) — deliberately **not**
wired to the native custom-color `<input>`'s `onChange`, preserving the
exact risk the original no-auto-close decision was protecting against.
`SheetGrid.tsx` passes `onSelectionComplete={() => setFontColorOpen(false)}`
/ `setFillColorOpen(false)` to close its own `Popover` on pick. Purely
additive to `ColorPicker`'s API — `onSelectionComplete` is optional and a
no-op when omitted, so Kanban's own `ColorPicker` usage (embedded directly
in a form `Dialog`, not a `Popover` — auto-close isn't a meaningful
question there) needed no changes at all; confirmed via
`pnpm --filter sovereign-plugin-kanban typecheck`.

Verified live: clicking a Fill color swatch (e.g. "Amber") applies the
color and closes the popover in one action; the same for Font color
(e.g. "Orange"); both colors confirmed applied via computed style before
resetting the test cell back to its defaults. The native custom-color
picker's own behavior is intentionally unchanged — still requires an
explicit dismiss, since there is no reliable, false-positive-free signal
from a bare `onChange` alone that the user has actually finished picking
rather than mid-drag; revisit if a future report asks for that path too.

## Home page polish: shared-heading spacing + ghost "add" tile (post-MVP, task 28)

Two reports against the Home page (`HomeWorkbooksList.tsx`), addressed
together:

**"Shared with me" heading had no gap above its grid.** "My workbooks"
had a visible gap before its tile grid, but "Shared with me" sat flush
against its own grid — the two headings weren't actually styled the same
way. Root cause: only "My workbooks" was wrapped in a `.headingRow` div
(needed to also hold its old heading-row "+"/import icon buttons, see
below) that carried the section's `margin-bottom`; "Shared with me" was a
bare `<h2>` with no such wrapper, so it inherited zero bottom margin.
Fixed by moving `margin-bottom` onto `.heading` itself and dropping
`.headingRow` — both sections are now bare `<h2 className={styles.heading}>`
elements, so they get identical spacing from the same rule with nothing
special-cased.

**Ghost "add" tile.** Requested directly, comparing to how Notion/Airtable/
Google Drive surface "add new" inside the grid itself rather than as
separate chrome buttons: a dashed ghost tile is now the first item in the
"My workbooks" `CardTileGrid`, using `@sovereignfs/ui`'s existing
`NewCardTile` (`variant="icon"`, matching the dense grid's icon-only
`WorkbookTile`s) — no new design-system component needed, this primitive
already existed for exactly this "grid's own add-new affordance" role.
Clicking it opens a `Menu` (same component `WorkbookView.tsx`'s header
already uses for its Export/Import dropdowns) offering "New workbook" and
"Import workbook", replacing what were previously two separate small icon
buttons in a `.headingRow` next to the heading text doing the same two
things — one entry point instead of three (the old two buttons plus this
tile) matching this plugin's own established one-trigger-many-options
consolidation pattern (see "Export/Import menu consolidation" above).

**Wiring the menu to the existing dialogs**: `NewWorkbookDialog` and
`ImportWorkbookButton` already supported a `renderTrigger` render-prop for
a custom visible trigger, but nothing to open them from elsewhere with no
visible trigger of their own. `NewWorkbookDialog` gained a
`NewWorkbookDialogHandle` ref (`{ open: () => void }`, `useImperativeHandle`)
— the exact same React-19-ref-as-prop pattern `ImportWorkbookHandle`
(task 17) already established for this identical problem.
`HomeWorkbooksList.tsx` renders one trigger-less instance of each
(`<NewWorkbookDialog ref={...} renderTrigger={() => null} />`,
`<ImportWorkbookButton ref={...} />`) alongside the grid, and the `Menu`'s
two items call `.open()` / `.triggerImport()` on them.

**A real bug found during live verification, not anticipated during
implementation**: the `Menu`'s panel defaulted to `align="right"`
(`Popover`'s own default — panel's *right* edge aligns to the trigger's
right edge, extending leftward) — fine for the header's Export/Import
menus, which sit near the right edge of a wide header with room to their
left, but the ghost tile sits at the *left* edge of the grid, right after
the sidebar, so a leftward-extending panel overflowed off-screen, its text
literally cut off mid-word in a screenshot. Fixed with `align="left"`
(panel's left edge aligns to the trigger's left edge, extending
rightward, into the rest of the grid where there's room). `CardTileGrid`
placement note: `Menu` was confirmed safe to render directly as a grid
child before this was even tested, by reading `Popover`'s (desktop) and
`Drawer`'s (mobile) own source — `Popover` renders one wrapping `<div>`
containing both trigger and an absolutely-positioned panel (one grid item,
panel escapes the grid visually without disrupting it), and `Drawer` is
`position: fixed` and returns `null` entirely while closed (out-of-flow,
also doesn't consume a grid track) — so no CSS workaround was needed for
either responsive path.

Verified live: clicking the ghost tile opens the menu fully on-screen
(after the `align` fix); "New workbook" opens the real dialog (confirmed
via its Name field, Cancel/Create workbook buttons) and Escape closes it
with no workbook created; "Import workbook" closes the menu and fires the
hidden file input's native picker (`triggerImport()`); no workbook was
actually created or imported during verification — home page state
unchanged throughout. **The claim that the ghost tile "renders at the
correct size matching sibling workbook tiles" was wrong** — a real sizing
bug survived this task's own verification pass uncaught (a quick visual
glance at a 2-tile grid didn't reveal it) and was only found from a
follow-up report with a fuller grid; see task 29 below.

## Ghost tile position + sizing fix (post-MVP, task 29)

Two direct follow-ups to task 28, reported together against a real
account with more workbooks — task 28's own 2-tile test grid had been too
sparse to reveal either issue:

**Position.** The ghost tile was first in the "My workbooks" grid; moved
to last, after every real workbook tile, so the grid reads
oldest/most-recent-first with "add" as a trailing affordance rather than
leading — the more common placement for this pattern (Notion, Airtable).
Purely a JSX reorder in `HomeWorkbooksList.tsx` (the `<Menu>` moved after
`myWorkbooks.map(...)` inside the same `<CardTileGrid>`), no CSS change
needed for this half.

**Sizing — a real, previously-uncaught bug.** The ghost tile rendered as
a narrow (~38px), full-height (106px) sliver at the left of its 160px
grid cell, instead of filling it like every sibling tile — visible once a
wider grid made the empty space next to it obvious. Root cause, found by
measuring computed layout live rather than guessing: `NewCardTile`'s
`variant="icon"` styling (`.newTileIcon`, `packages/ui`'s
`CardTile.module.css`) sized itself with `width: auto; height: auto`,
relying entirely on the CSS Grid parent's own item-stretch to reach the
cell's full footprint — which only reaches a component that is a *direct*
grid child. Wrapping the tile as a `Menu`'s `trigger` (task 28) inserts
`Popover`'s own `display: inline-flex` container between the grid and the
button; that intermediate flex box's cross-axis stretch correctly
sized the button's *height* (confirmed: `inline-flex`'s default
`align-items: stretch` did stretch it to 106px), but flex does not
stretch a child along its *main* axis without an explicit `flex-grow` or
width rule, so the button's *width* fell back to shrink-to-fit its own
icon + padding (~38px) — silently wrong even though the outer `Popover`
container itself measured the correct 160px, since nothing propagated
that width down to the actual visible button one level inside it.

Fixed at the design-system level (this is a `NewCardTile` bug, not
anything Sheets-specific — any future consumer wrapping it in a
`Menu`/`Popover` inside a grid would hit the identical issue): switched
`.newTileIcon` from `width: auto; height: auto` to explicit
`width: 100%; height: 100%`. A percentage resolves against whichever
immediate parent box is already correctly sized to the grid cell —
`Popover`'s intermediate container once *it* has been grid-stretched, or
the grid track directly for a consumer using `NewCardTile` with no
wrapper at all — so this works for both cases, unlike depending on
implicit stretch propagating through an arbitrary number of intermediate
boxes. `packages/ui` bumped `0.71.0` → `0.71.1` (a real bug fix, not
a new capability, so patch rather than task 28's minor).

Verified live via direct layout measurement (`getBoundingClientRect()` on
the actual button, not just a screenshot glance) before and after: the
ghost tile now measures exactly 160×106px, matching every sibling
`WorkbookTile` in the same grid pixel-for-pixel; the menu still opens
fully on-screen from its new trailing position (confirmed via the panel's
own bounding rect against the viewport width). A live-testing false alarm
along the way: the very first re-measurement attempt showed `window.
innerWidth: 0` and the `Menu` rendering via its mobile `Drawer` fallback
instead of `Popover` — traced to the browser tooling's viewport being
left at a stale 0×0 size by an unrelated earlier `resize_window` call in
this same session (task 26's dark-mode check), not a real bug; resolved
by explicitly resetting the viewport before re-testing.

## Architecture

```
plugins/sovereign-sheets.local/
  manifest.json
  package.json
  icon.svg
  SPEC.md / README.md / CLAUDE.md / ROADMAP.md
  app/
    (home)/                     # sidebar-having route group (ThreeColumnLayout)
      layout.tsx                 # Workbooks/Inbox nav + Recent list, data-plugin-fullbleed
      page.tsx                   # Workbooks — My workbooks / Shared with me
      inbox/page.tsx              # workbooks shared with you
    s/[workbookId]/page.tsx      # workbook editor — outside (home), no sidebar
    layout.tsx
    actions.ts                  # createWorkbook, getWorkbook, saveSheet, addSheet,
                                 # renameSheet, deleteSheet, getFinanceRate,
                                 # listWorkbooksOverview, listRecentWorkbooks,
                                 # resolveWorkbookRole
    _components/
      SheetsSidebar.tsx           # (home) nav + Recent list
      HomeWorkbooksList.tsx       # My workbooks / Shared with me, search
      NewWorkbookDialog.tsx
      WorkbookView.tsx            # owns the HyperFormula instance for the workbook
      WorkbookShareButton.tsx     # owner-only Share entry point
      WorkbookShareDialog.tsx     # member list + invite form
      SheetGrid.tsx              # active sheet's grid, reads/writes via the shared engine
      CellValidationDialog.tsx   # per-cell range/list validation rule editor
      ImportWorkbookButton.tsx   # Home page: creates a new workbook from an exported .json file
      SheetTabs.tsx
      FormulaBar.tsx             # built on CodeTextarea (@sovereignfs/ui)
    _lib/
      context.ts                 # getContext()/ActionResult, shared by every action
      workbook-rules.ts          # WorkbookMemberRole, canEditWorkbookRole()
      workbook-sharing.ts        # invite/remove/list members, in-app notify
      formula-engine.ts          # engine init, cellsJson<->grid conversion, error display
      finance-function.ts        # FINANCE() HyperFormula plugin + rate cache
      frankfurter.ts             # thin fetch client for api.frankfurter.dev
      a1.ts                      # A1<->row/col helpers
      cells.ts                   # CellData/CellsMap types, cellsJson parse/serialize
      validation.ts               # isCellValueValid(), describeValidationRule()
      ids.ts                      # newId() — short lowercase url-safe entity ids
      workbook-export.ts          # WorkbookExportPayload, build/download/parse — full-workbook JSON
      csv.ts
      config.ts                  # DEFAULT_ROW_COUNT/DEFAULT_COL_COUNT, MAX_ROW_COUNT/MAX_COL_COUNT, growth steps
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

## Critical: missing Postgres migrations (task 30)

Found immediately after the tasks-12–29 build-out was merged and deployed
to a real Postgres-backed instance: `migrations/postgres/` had never
existed for this plugin at all. Every other isolated Postgres-capable
plugin in this monorepo (`docs`, `kanban`, `tasks`, `shopper`,
`plainwrite`) ships both `migrations/sqlite/` and `migrations/postgres/`,
generated from a `db/schema.ts`/`db/schema.postgres.ts` pair — Sheets only
ever had the SQLite half. Not a regression from tasks 12–29's own work;
the gap is as old as task 6, which created the `workbook_members` table
that first exposed it.

**Why this had no visible symptom until a real deploy hit it**: the
runtime's per-plugin migration runner resolves each plugin's migration
folder via `pluginMigrationsFolder(pluginDir, dialect)`
(`packages/db/src/plugin-client.ts`) and silently `continue`s past any
plugin whose folder for the active dialect doesn't exist — no error, no
log line (`runtime/src/plugin-migrations.ts`). On SQLite (this plugin's
only dev/testing dialect throughout tasks 1–29) this was invisible, since
`migrations/sqlite/` always existed and ran fine. The first time this
plugin actually ran against `DB_DIALECT=postgres`, every query touching
`workbook_members` — starting with the Home page's very first query,
`listWorkbooksOverview()` — failed with Postgres error `42P01`:
`relation "workbook_members" does not exist`, surfacing as a generic
Next.js error boundary on every `/sheets` load, for every user, with no
workaround.

**Fix**: added the missing three-file pattern every sibling plugin already
has —

- `app/_db/schema.postgres.ts`: a `pgTable`-based structural mirror of
  `app/_db/schema.ts`. Exists only to drive `drizzle-kit generate --dialect
  postgresql`, which cannot read a `sqliteTable()`-based schema file
  directly (`docs/plugin-database.md`); application code never imports it.
- `drizzle.config.pg.ts` + a new `db:generate:pg` package.json script,
  identical in shape to every sibling plugin's own.
- The generated `migrations/postgres/0000_handy_puppet_master.sql`,
  covering all four tables (`workbooks`, `sheets`, `workbook_members`,
  `finance_rate_cache`) in one shot — a first-time install has no prior
  Postgres migration history to reconcile, so a single initial migration
  is correct and complete.

**Timestamps use `bigint({ mode: 'number' })`, deliberately diverging from
`docs/plugin-database.md`'s general "plain integer, never bigint"
guidance for non-boolean/non-ID columns.** That general rule exists
because a `sqliteTable()`-defined column serializes/deserializes assuming
SQLite's `integer` affinity (effectively unbounded width) — but Postgres's
own `integer` type is a real, fixed 32-bit column (max `2147483647`), and
a Unix millisecond timestamp is a 13-digit number, already roughly 800x
past that ceiling. `sovereign-plugin-kanban` shipped its own Postgres
schema with plain `integer` timestamps first and hit this for real in
production — every insert failing immediately, `value "..." is out of
range for type integer` — and had to `ALTER COLUMN ... SET DATA TYPE
bigint` on every timestamp column across a follow-up migration. Written
correctly here from the start instead of repeating that same incident:
every timestamp column (`workbooks.createdAt/updatedAt/deletedAt`,
`workbookMembers.joinedAt/lastOpenedAt`,
`financeRateCache.asOf/fetchedAt`) is `bigint`; non-timestamp integers
(`sheets.position/rowCount/colCount` — small values, no realistic
overflow risk) stay plain `integer`, matching Kanban's own precedent for
its non-timestamp `done` column.

**Foreign-key schema qualifiers manually stripped**: `drizzle-kit
generate --dialect postgresql` always qualifies a generated `FOREIGN KEY`
constraint's target table with the schema its `pgTable()` was declared in
— `public` by default, since `schema.postgres.ts` never declares an
explicit `pgSchema()`. At runtime a plugin's tables live in
`plugin_<slug>`, reached only via the connection's `search_path`, never
literally in `public` — a generated `REFERENCES "public"."workbooks"(...)`
would fail with `relation "public.workbooks" does not exist` the moment
this migration actually ran, taking its whole transaction (every
`CREATE TABLE` in the same file, since Drizzle wraps a migration file in
one transaction) down with it. Both generated `sheets`→`workbooks` and
`workbook_members`→`workbooks` foreign keys were manually corrected to
the unqualified `REFERENCES "workbooks"(...)`, per
`docs/plugin-database.md`'s "Foreign keys in a Postgres schema" — the
generator has no schema awareness and will re-add the qualifier on every
future regeneration that touches a foreign key; re-check by hand each time.

**Verification scope, honestly stated**: confirmed via
`pnpm --filter @sovereignfs/sovereign-sheets typecheck` and a full manual
review of the generated SQL against `app/_db/schema.ts` column-by-column,
but **not** live-verified against a real Postgres instance from this
development environment — there is no direct access to the affected
production database or server from here. Real verification is the
operator's own: redeploying (the automatic migration-on-startup path
picks this up on the next container recreate once the image includes
`migrations/postgres/`) or running `sv plugin migrate fs.sovereign.sheets`
manually against a rebuilt image, then confirming `/sheets` loads and a
workbook can be created/opened.

## Manifest & permissions

```json
{
  "schemaVersion": 1,
  "id": "fs.sovereign.sheets",
  "name": "Sheets",
  "version": "0.12.1",
  "description": "A lightweight spreadsheet with formulas and a built-in currency conversion function.",
  "type": "sovereign",
  "runtime": "native",
  "routePrefix": "/sheets",
  "shell": "default",
  "icon": "icon.svg",
  "permissions": ["auth:session", "db:readWrite", "notifications:send"],
  "repository": "https://github.com/sovereignfs/sovereign-plugin-sheets",
  "compatibility": { "minPlatformVersion": "0.42.0" }
}
```

- `auth:session` + `db:readWrite` + `notifications:send` (task 6, workbook
  sharing — the in-app "shared a workbook with you" notification). No
  `mailer:send` — sharing notifies in-app only, no email (see "Workbook
  sharing" above). No `data:export`/`data:import` — CSV export and import
  (task 8) are both a client-side `Blob` download/file read, not the
  platform's `portability.provideExport()`/`provideImport()` account-level
  flow. No `activity:write` — no `sdk.activity.log()` calls exist. No
  invented permission for a settings gate — none needed since `FINANCE()`
  requires no secret.
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
`@sovereignfs/ui`, `drizzle-orm`, `hyperformula`, `nanoid` (workbook/sheet id
generation, `_lib/ids.ts` — same convention as the Docs plugin's own),
`next`/`react`/`react-dom` at `catalog:`; devDeps `drizzle-kit`,
`@sovereignfs/tsconfig`, `typescript`/`@types/react*` at `catalog:`.

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
   toolbar button; full-workbook export stays post-MVP). **CSV import —
   resolved, shipped post-MVP (task 8)**, same single-sheet scope, full
   replace not merge. **Full-workbook export — resolved, shipped post-MVP
   (task 13)**, but as a native JSON backup/restore format, not CSV — see
   "Full-workbook JSON export/import" above. XLSX (either direction) stays
   post-MVP.

## Post-MVP (tracked, not designed in detail yet)

- Stock/security quotes and additional `FINANCE()` attributes
  (`"high"`/`"low"`/`"volume"`/historical ranges), once a suitable quoted-key
  provider and admin-config workflow are worth the complexity. Task 7's
  `FxRateProvider` abstraction is currency-conversion-only by design, not a
  general quote interface — this still needs its own design pass, not just
  a second implementation of that interface.
- Real-time multiplayer editing, presence, comments.
- Charts, pivot tables. (Named ranges shipped, task 10; data validation
  shipped, task 11 — per-cell range/list rules only, see "Cell styling and
  data validation" above.)
- Conditional formatting — task 9 shipped the number-format enum
  (plain/number/currency/date), task 11 added bold/italic, and task 21
  added font/background color (see "Cell font and background color" above);
  conditional (value-driven, rule-based) formatting is what's left. Task 23
  built the selection-range model its range-rule form had been waiting on
  (see "Multi-cell selection" above) — this is no longer blocked on that,
  just not designed/built yet.
- XLSX import/export (either direction) — deliberately not attempted by
  task 13's native JSON export/import; see "Full-workbook JSON
  export/import" above for the cost/fidelity tradeoffs that decided it.
