# CLAUDE.md — sovereign-sheets

Guidance for Claude Code working in this plugin repository.

## What this is

**Sheets** — a lightweight, self-hostable spreadsheet: workbooks with
multiple sheet tabs, standard formulas, one custom function,
`FINANCE(base, quote)`, for currency conversion (the GOOGLEFINANCE
equivalent), and workbook-level sharing (owner/editor/viewer). A
`type: sovereign` Sovereign plugin, open source (AGPLv3).

**Status: MVP shipped** (tasks 1–5 in ROADMAP.md) — workbooks, sheets,
HyperFormula-backed formulas, `FINANCE()`, and CSV export are all live at
`/sheets`. **Workbook sharing shipped post-MVP** (task 6), alongside a
`ThreeColumnLayout` home redesign — see SPEC.md's "Workbook sharing" section.

Spec: [SPEC.md](SPEC.md) · Build order: [ROADMAP.md](ROADMAP.md)

## Identity

| Property     | Value                          |
| ------------- | ------------------------------ |
| Plugin ID     | `fs.sovereign.sheets`          |
| Route prefix  | `/sheets`                      |
| Database      | `isolated` — own SQLite file, no slug-prefix required |
| Permissions   | `auth:session`, `db:readWrite`, `notifications:send` |
| Min platform  | `0.42.0`                       |

## MVP scope discipline

The long-term ambition is a real Google Sheets alternative. **The MVP is
deliberately narrow** — single-workbook-per-doc, no real-time collaboration,
no charts/pivot tables/conditional formatting, no XLSX import/export.
Don't let "make it feel like Google Sheets" pull scope back in during
implementation; SPEC.md's "Post-MVP" section is where deferred features are
tracked, not silently reintroduced into an MVP task.

**Workbook sharing (task 6) and CSV import (task 8) are the deliberate
exceptions** — both shipped post-MVP as scoped-in additions, not scope
creep: SPEC.md's "Workbook sharing"/"CSV import" sections are the design
records. Sharing is still *workbook-level* only (no per-sheet sharing, no
real-time multiplayer/presence/comments — those stay out per the bullet
above); CSV import is still *single-sheet, full-replace* only (no
full-workbook import, no XLSX, no merge-with-existing-data mode). Don't
conflate "sharing/import shipped" with "collaboration/full-fidelity import
shipped."

## `FINANCE()` is currency conversion only

`FINANCE(base, quote)` — e.g. `FINANCE("USD","EUR")` — returns an exchange
rate. **It is not a stock/ticker quote function in MVP.** Do not build
GOOGLEFINANCE-style security-price support (`"price"`, `"high"`, `"volume"`,
tickers) without an explicit scope change — that's tracked as post-MVP in
SPEC.md and needs its own provider/admin-config design (a keyed provider like
Alpha Vantage, unlike Frankfurter, would reintroduce the admin-secrets
workstream this MVP deliberately avoids).

Provider is [Frankfurter](https://api.frankfurter.dev) — free, **no API key**.
This is why there's no admin settings page, no `sdk.secrets` usage, and no
capability-gated Console-style config form anywhere in this plugin's MVP
scope. If a future task swaps in a keyed provider, that reintroduces the
`sdk.secrets`/Console-settings pattern used elsewhere in the platform (see
`plugins/console/app/settings/SmtpSettingsForm.tsx` and `actions.ts` in the
platform monorepo for that pattern's reference implementation) — don't build
it preemptively.

## Data model direction

Cell data is stored as a **JSON blob per sheet** (`sheets.cells_json`), not
normalized per-cell rows. This is a deliberate MVP simplification given
single-user/no-concurrent-writer scope — see SPEC.md's "Data model" section
for the reasoning. Do not "improve" this into a per-cell table without a
scope discussion; that's real added complexity (diffing on every autosave,
row upserts per paste/fill-down) that only pays off once real-time
collaboration is in scope.

Two normalized tables sit alongside `workbooks`/`sheets`: `finance_rate_cache`,
keyed on `(base, quote)`, **instance-wide** — not tenant/user-scoped, since
exchange rates are public data (same rationale as the Ledger plugin's
untenanted `ledger_fx_rates` cache, `plugins/sovereign-ledger.local` in the
platform monorepo) — and `workbook_members` (task 6), the workbook-sharing
access-control table, which *is* tenant/user-scoped per row (see SPEC.md's
"Workbook sharing").

## SDK-only rule

**Never import from `@sovereignfs/db` directly.** All database access goes
through `sdk.db`. This is enforced by the platform's ESLint SDK boundary rule.

```ts
// correct
import { getSdk } from '@sovereignfs/sdk';
const sdk = getSdk();
const db = await sdk.db();

// wrong — breaks the plugin/platform boundary
import { getPlatformDb } from '@sovereignfs/db';
```

## Open question: formula engine license

`hyperformula` (dependency since task 3) ships its free tier under **GPLv3**.
This plugin is licensed AGPL-3.0-or-later, and the user has confirmed that's
fine for *this plugin's own* distribution. Whether a GPLv3 dependency in one
`type: sovereign` plugin imposes any obligation on the core Sovereign
platform or on other plugins with different licenses is still flagged in
SPEC.md as needing real legal confirmation, not just this repo's own
reasoning — get that before shipping beyond a local/dev instance.

## Versioning

Once implementation starts, this plugin follows its own semver, independent
of the platform version:

- `fix/` → patch (0.0.x)
- `feat/` → minor (0.x.0)
- Breaking change → major (x.0.0)

Current version: **0.3.0** (task 8 — single-sheet CSV import, full-replace semantics, see ROADMAP.md)
