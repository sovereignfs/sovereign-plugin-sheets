# Sheets

A lightweight, self-hostable spreadsheet for [Sovereign](https://github.com/sovereignfs/sovereign), with a built-in currency conversion function.

**Status:** v0.17.2 — MVP complete, workbook sharing + CSV import + cell number formatting + named ranges + cell styling/data validation + full-workbook JSON export/import + manual sheet growth + workbook editor header redesign + layout consolidation/bottom-docked sheet tabs + export/import menu consolidation + status badge placement + resizable columns + cell font/background color + multi-cell selection (range formatting, copy/cut/paste, bulk clear) + click-to-select/double-click-to-edit + cell font size + a ghost "add" tile on the Home page added, formula bar/column-width fixes, cell color visibility fixes, toolbar icon polish, font color default swatch fix, color picker auto-close on selection, Home page spacing fix, ghost tile position/sizing fix, **critical fix: missing Postgres migrations** (see [ROADMAP.md](ROADMAP.md))
**Plugin ID:** `fs.sovereign.sheets`
**Route:** `/sheets`

---

## What it is

Sheets is a Google-Sheets-like spreadsheet: a grid of cells, a formula bar,
and multiple sheet tabs per workbook. The MVP is intentionally small —
standard formulas and cell references, and one custom function,
`FINANCE(base, quote)`, Sheets' answer to `GOOGLEFINANCE()` for pulling a
live currency exchange rate into a cell. Workbooks can be shared with other
users on the same instance (owner/editor/viewer roles) — see SPEC.md's
"Workbook sharing" section. Cells support bold/italic styling, font and
background color, and a soft per-cell data-validation rule (number range or
list of values) — see SPEC.md's "Cell styling and data validation" and
"Cell font and background color" sections. Alongside CSV, a
workbook can be exported/imported as a lossless native JSON file — formulas,
styling, validation, and named ranges all round-trip, unlike CSV's
values-only single-sheet snapshot — see SPEC.md's "Full-workbook JSON
export/import" section. New sheets start at 100 rows × 20 columns, and grow
further any time via "Add rows"/"Add columns" in the sheet toolbar. Cells
can be multi-selected (click+drag, shift-click, or Shift+Arrow) to apply
formatting, copy/cut/paste (with formula references translating relatively,
same as Excel/Sheets), or clear a whole range at once — see SPEC.md's
"Multi-cell selection" section. A single click selects a cell; a
double-click (or F2) enters edit mode, matching Google Sheets/Docs — see
SPEC.md's "Click to select, double-click to edit" section. Cells also
support a per-cell font size, alongside bold/italic/color — see SPEC.md's
"Cell font size" section.

See [SPEC.md](SPEC.md) for the full functional requirements and data model,
and [ROADMAP.md](ROADMAP.md) for the proposed build order.

Sheets runs on your own Sovereign instance. Users sign in with their
Sovereign account; data is stored on and synced through your instance server.

## Installing on a Sovereign instance

```bash
sv plugin add https://github.com/sovereignfs/sovereign-plugin-sheets
```

Then restart the runtime. Sheets will appear in the launcher as **Sheets**.

## Local development

The plugin is developed as a `.local` workspace member inside the platform
monorepo.

```bash
# From the platform monorepo root
pnpm dev   # runtime on :3000; plugin routes live at /sheets
```

See the [plugin development guide](../../docs/plugin-development.md) for the
full workflow.

## Stack

- **Language:** TypeScript, React (Next.js App Router)
- **Database:** isolated SQLite database via `sdk.db` — no direct
  `@sovereignfs/db` imports
- **Formula engine:** [HyperFormula](https://hyperformula.handsontable.com/) (GPLv3 free tier — see SPEC.md's "Open questions")
- **UI:** `@sovereignfs/ui` components and `--sv-*` tokens exclusively

## Requirements

- Sovereign platform ≥ `0.42.0`
- Node ≥ 20
- pnpm 11.5.x (platform monorepo convention)

## Spec

Full functional requirements, data model, and the `FINANCE()` function
design: [SPEC.md](SPEC.md)

## License

AGPL-3.0-or-later — same license as the [Sovereign platform](https://github.com/sovereignfs/sovereign). See [LICENSE](LICENSE).
