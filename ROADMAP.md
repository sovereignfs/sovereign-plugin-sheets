# Roadmap — Sheets

Full requirements, data model, and the `FINANCE()` design live in the spec
(`SPEC.md`); **this doc is the source of truth for build order and status.**

Status legend: 📋 not started · 🚧 in progress · ✅ shipped

Each task is sized to be one branch + one PR, per the platform's own "one
task = one branch = one PR" convention. Tasks are sequenced — assume each
depends on the previous unless noted otherwise.

---

## MVP

| # | Task | Spec ref | Depends on | Status |
| - | ---- | -------- | ---------- | ------ |
| 1 | **Scaffold** — `manifest.json`, `package.json`, `icon.svg`, empty `/sheets` page with a static grid shell (no persistence, no formulas), `tsconfig.json` | Manifest & permissions | — | ✅ |
| 2 | **Data model + basic editing/save** — `workbooks`/`sheets` tables + migrations, workbook list/create/open, editable grid (plain text/number, no formulas yet), debounced autosave to `cells_json`, sheet tabs (add/rename/delete/reorder) | Data model | Task 1 | ✅ |
| 3 | **Formula engine integration** — wire the chosen formula engine client-side, formula bar, `=` parsing, cell refs/ranges/cross-sheet refs, the built-in function set (`SUM`, `AVERAGE`, etc.), undo/redo, error-cell display | MVP scope | Task 2 | ✅ |
| 4 | **`FINANCE()` currency conversion** — `finance_rate_cache` table, Frankfurter fetch client, `FINANCE(base, quote)` registration + async-resolve bridge, basic error handling for unsupported currency codes | The `FINANCE()` function | Task 3 | ✅ |
| 5 | **Polish** — CSV export, keyboard nav (arrows, tab/enter commit, copy/paste, fill-down), empty states, delete confirmation, save-error toasts, finalize docs | MVP scope | Task 4 | ✅ |

**MVP done when:** a user can create a workbook, add/edit sheets, type
formulas that recalculate correctly using the standard function set, pull a
live currency rate into a cell via `FINANCE()`, and export a sheet to CSV.
**Done as of task 5.**

Task 3 shipped with HyperFormula (GPLv3 free tier) as the formula engine —
see SPEC.md's "Open questions" (§1) for the licensing reasoning.

**Task 5 scope note:** "copy/paste" shipped as single-cell fill-down
(Cmd/Ctrl+D copies the active cell's raw input into the cell below), not
multi-cell range copy/paste — that needs a selection-range model this MVP's
always-editable-input grid doesn't have. Tracked as a post-MVP follow-up
alongside richer cell formatting, since both want the same selection concept.

---

## Post-MVP (shipped)

| # | Task | Spec ref | Depends on | Status |
| - | ---- | -------- | ---------- | ------ |
| 6 | **Home redesign + workbook sharing** — `ThreeColumnLayout` home (`SheetsSidebar`: Workbooks/Inbox nav + Recent list; main content: My workbooks/Shared with me), `workbook_members` table (owner/editor/viewer), `resolveWorkbookRole()` authorization on every action, owner-only Share dialog, viewer-mode read-only grid, Inbox digest, route move to `/sheets/w/[id]` | [docs/adhoc/home-and-sharing.md](docs/adhoc/home-and-sharing.md), SPEC.md's "Workbook sharing" | Task 5 | ✅ |
| 7 | **FX-provider abstraction** — extracted `FxRateProvider` interface (`_lib/fx-rate-provider.ts`); Frankfurter is now one implementation (`frankfurterProvider`) behind it, swapped in at `actions.ts`'s single `FX_PROVIDER` binding. Currency conversion only — no behavior change, no new provider added yet. Scoped narrowly ahead of the not-yet-scheduled stock-quotes task (Post-MVP item 1 below) so that future task only has to add a new provider implementation, not touch the caching/formula-engine integration layer. Not a dependency of task 8 below — CSV import is unrelated. | SPEC.md's "The `FINANCE()` function" | Task 6 | ✅ |
| 8 | **CSV import** — single-sheet, full-replace (not merge). `_lib/csv.ts`'s `parseCsv()` (RFC 4180-ish, inverse of `cellsToCsv()`), "Import CSV" toolbar button next to "Export CSV" (`canEdit`-gated), `ConfirmDialog` naming the file/sheet, sheet grows to fit a larger CSV via new `resizeSheetAction` (capped at `MAX_IMPORT_ROW_COUNT`/`MAX_IMPORT_COL_COUNT`). No manifest permission change — client-side file read, not the platform's `data:import` portability flow. | SPEC.md's "CSV import" | Task 7 | ✅ |
| 9 | **Cell number formatting** — finishes the `CellData.fmt` enum (plain/number/currency/date) that was typed since task 1 but never wired to any UI/display logic. Format `Select` in `SheetGrid.tsx`'s toolbar; per-sheet format map tracked alongside the HyperFormula engine (`WorkbookView.tsx`), merged into `cellsJson` at every save via new `mergeCellFormats()`/`extractCellFormats()` (`_lib/cells.ts`) and rendered via new `_lib/format.ts`. **Partial scope, deliberately** — bold/italic/text color and conditional formatting are explicitly deferred, not silently dropped; see SPEC.md's "Cell number formatting" for why. | SPEC.md's "Cell number formatting" | Task 8 | ✅ |
| 10 | **Named ranges** — workbook-scoped names resolving to a formula/cell reference (e.g. `TaxRate` → `=0.08`), usable in any formula. Built directly on HyperFormula's own native named-expression API — no custom resolution logic. "Named ranges" button/dialog in `WorkbookView.tsx`'s header (`_components/NamedRangesDialog.tsx`, same list+add-form shape as `WorkbookShareDialog`); new `workbooks.named_ranges_json` column + `saveNamedRangesAction` (whole-map writes, same pattern as task 9's format overrides). Viewing is available to any role; add/remove is `canEdit`-gated. | SPEC.md's "Named ranges" | Task 9 | ✅ |

## Post-MVP (not scheduled)

See SPEC.md's "Post-MVP" section for the full list. Roughly, in likely order
of value now that tasks 6–10 have shipped:

1. Stock/security quotes as a `FINANCE()` extension. Task 7 built the
   swappable-provider plumbing this needs; still blocked on picking an
   actual keyed provider + building the admin-secrets/Console-settings
   workflow this MVP has otherwise avoided.
2. Richer cell styling (bold/italic/text color) and conditional formatting.
   Task 9 shipped only the number-format enum piece of "richer cell
   formatting / conditional formatting" — see SPEC.md for the split and why
   (conditional formatting in particular wants a selection-range model this
   app doesn't have, for the range-rule form; a single-cell rule form is
   buildable without one and remains a smaller follow-up option).
3. Data validation (named ranges shipped, task 10 — data validation is the
   remaining, separate half of the original "named ranges, data validation"
   backlog item).
4. Charts.
5. Real-time multiplayer editing (largest lift — conflict resolution,
   presence, likely a data-model change to per-cell rows; workbook sharing,
   task 6, is access control only — this is a separate, much larger
   collaboration feature).
6. XLSX import/export (either direction) — CSV import/export are the only
   spreadsheet formats supported today (tasks 5 and 8).
