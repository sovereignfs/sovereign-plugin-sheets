# Sheets

A lightweight, self-hostable spreadsheet for [Sovereign](https://github.com/sovereignfs/sovereign), with a built-in currency conversion function.

**Status:** v0.4.0 — MVP complete, workbook sharing + CSV import + cell number formatting added (see [ROADMAP.md](ROADMAP.md))
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
"Workbook sharing" section.

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
