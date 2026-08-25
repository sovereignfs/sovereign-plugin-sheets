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

## Post-MVP (not scheduled)

See SPEC.md's "Post-MVP" section for the full list. Roughly, in likely order
of value now that task 6 has shipped:

1. Stock/security quotes as a `FINANCE()` extension (needs a keyed provider +
   the admin-secrets/Console-settings workflow this MVP deliberately avoids).
2. CSV import.
3. Richer cell formatting / conditional formatting.
4. Named ranges, data validation.
5. Charts.
6. Real-time multiplayer editing (largest lift — conflict resolution,
   presence, likely a data-model change to per-cell rows; workbook sharing,
   task 6, is access control only — this is a separate, much larger
   collaboration feature).
