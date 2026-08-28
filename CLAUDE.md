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
`/sheets`. **Workbook sharing, CSV import, cell number formatting, named
ranges, cell styling/data validation, full-workbook JSON export/import,
manual sheet growth, the workbook editor header redesign, a follow-up
layout consolidation, an export/import menu consolidation, a
status-badge placement tweak, resizable columns, a formula-bar/
column-width bug-fix pass, cell font/background color, a cell-color
visibility fix, multi-cell selection (range formatting, copy/cut/
paste, bulk clear), a click-to-select/double-click-to-edit interaction
model, cell font size, a toolbar icon polish pass, a font-color
default swatch fix, color-picker auto-close-on-selection, Home page
polish (shared-heading spacing + a ghost "add" tile), a ghost-tile
position + sizing fix, and a critical missing-Postgres-migrations fix
shipped post-MVP** (tasks 6, 8–11, 13–30) —
see SPEC.md's "Workbook sharing"/"CSV import"/"Cell number formatting"/"Named
ranges"/"Cell styling and data validation"/"Full-workbook JSON
export/import"/"Sheet size: default and manual growth"/"Workbook editor
header redesign"/"Layout consolidation and bottom-docked sheet tabs"/
"Export/Import menu consolidation"/"Status badge placement"/"Resizable
columns"/"Formula bar and column-width fixes"/"Cell font and background
color"/"Cell color visibility fixes"/"Multi-cell selection"/"Click to
select, double-click to edit"/"Cell font size"/"Toolbar icon polish:
Bold/Italic/Fill color"/"Font color default swatch fix"/"Color picker
auto-close on selection"/"Home page polish: shared-heading spacing +
ghost \"add\" tile"/"Ghost tile position + sizing fix"/"Critical: missing
Postgres migrations" sections.

Spec: [SPEC.md](SPEC.md) · Build order: [ROADMAP.md](ROADMAP.md)

## Identity

| Property     | Value                                                 |
| ------------ | ----------------------------------------------------- |
| Plugin ID    | `fs.sovereign.sheets`                                 |
| Route prefix | `/sheets`                                             |
| Database     | `isolated` — own SQLite file, no slug-prefix required |
| Permissions  | `auth:session`, `db:readWrite`, `notifications:send`  |
| Min platform | `0.42.0`                                              |

## MVP scope discipline

The long-term ambition is a real Google Sheets alternative. **The MVP is
deliberately narrow** — single-workbook-per-doc, no real-time collaboration,
no charts/pivot tables/conditional formatting, no XLSX import/export.
Don't let "make it feel like Google Sheets" pull scope back in during
implementation; SPEC.md's "Post-MVP" section is where deferred features are
tracked, not silently reintroduced into an MVP task.

**Workbook sharing (task 6), CSV import (task 8), cell number formatting
(task 9), named ranges (task 10), cell styling + data validation (task 11),
full-workbook JSON export/import (task 13), cell font/background color
(task 21), multi-cell selection (task 23), and the click-to-select/
double-click-to-edit model + cell font size (task 24) are the deliberate
exceptions** — all shipped post-MVP as scoped-in additions, not scope creep:
SPEC.md's "Workbook sharing"/"CSV import"/"Cell number formatting"/"Named
ranges"/"Cell styling and data validation"/"Full-workbook JSON
export/import"/"Cell font and background color"/"Multi-cell selection"/
"Click to select, double-click to edit"/"Cell font size" sections are the
design records. Sharing is still _workbook-level_
only (no per-sheet sharing, no real-time multiplayer/presence/comments —
those stay out per the bullet above); CSV import is still _single-sheet,
full-replace_ only (no full-workbook import, no XLSX, no
merge-with-existing-data mode); cell formatting is still _the number-format
enum, bold/italic, font/background color, and font size_ (no conditional
formatting — task 9 shipped the format enum, task 11 added bold/italic,
task 21 added color, task 24 added font size, still a thinner slice of
"richer cell formatting / conditional formatting" than the full phrase
implies); named ranges is _just names →
formula/reference_; data validation (task 11) is _per-cell soft validation
only_ — a number-range or list rule that renders a visual indicator, never
blocks a commit, and has no range-based/multi-cell or custom-formula rule
support (task 23's selection model didn't change this — validation stays
single-cell, a deliberate scope line, not an oversight); full-workbook
export/import (task 13) is a _native JSON backup/restore format only_ —
lossless within Sheets (formulas, styling, validation, named ranges all
round-trip), but not an XLSX/Excel-interoperable file, and import only ever
creates a **new** workbook, never an in-place merge/overwrite; multi-cell
selection (task 23) is copy/cut/paste, bulk formatting, and bulk clear
_within this app only_ — no OS clipboard integration (no paste from/to
Excel or a text file), and no range-based conditional formatting (still
tracked separately, see "Post-MVP" below); the click-to-select/
double-click-to-edit model (task 24) matches Google Sheets/Docs' basic
click semantics but doesn't add anything beyond that — no cell-range
autofill/drag-to-fill handle, no in-cell rich text. Don't conflate "sharing/
import/formatting/named-ranges/validation/full-workbook-export/selection/
edit-model shipped" with "collaboration/full-fidelity CSV import/full
styling/hard validation/XLSX interoperability/OS clipboard interop
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
access-control table, which _is_ tenant/user-scoped per row (see SPEC.md's
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
fine for _this plugin's own_ distribution. Whether a GPLv3 dependency in one
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

Current version: **0.18.0** — feat: account deletion handler
(`sdk.portability.provideDelete()`), task 31. Found via a cross-plugin
platform research survey (research doc 0020 in the platform monorepo,
prompted by the sibling Tally plugin's own joint-data deletion concerns):
Sheets has a real owner/collaborator model (`workbooks`/`workbook_members`)
but registered no deletion handler at all, so a deleted user's workbooks and
shares were silently left in place — protected only by the platform's
default "leave unregistered plugins' rows alone" fallback, not by design.
New `app/_lib/portability.ts` mirrors the Docs plugin's `deleteAllDocsData`
one level simpler: a workbook the deleting user doesn't own just loses
their `workbook_members` row; one they do own transfers to another member
(an existing `owner`-role member preferred, else earliest-joined); a
workbook with no member left at all is hard-deleted along with its sheets,
in explicit FK order (`sheets` → `workbook_members` → `workbooks` — neither
schema dialect defines a cascade). No manifest permission change needed —
unlike `provideExport`/`provideImport`, `provideDelete` is ungated. No
nested-ownership branch was needed either (unlike Docs' folder/document
split, where a document's owner can differ from its folder's): a `sheets`
row has no owner column of its own, so a workbook's membership set is the
only thing that can ever have a stake in its contents — confirmed by
reading `schema.ts`'s own docblock ("access control lives entirely
[in `workbook_members`]") before designing the handler, not assumed. Wired
into `app/layout.tsx`'s existing pass-through layout in a best-effort
`try/catch`, matching the in-process-registration reset-on-restart caveat
every other portability hook in this codebase already lives with. Also
bootstraps this plugin's first test infrastructure — `vitest`,
`vitest.config.ts`, a `test` script, none of which existed before this task
— using Docs' own `portability.test.ts` hand-rolled `fakeDb`/condition-tree
mocking convention as the direct template, verified with 4 new tests
(ownership transfer with a successor, hard-delete with no successor,
owner-role-over-earlier-joined-member promotion precedence, and a dangling
membership-row cleanup case) plus a clean `pnpm typecheck`.

(Previous version: 0.17.2 — fix: missing Postgres migrations, a critical
production bug found immediately after tasks 12–29 (this plugin's own
`migrations/sqlite/` history) shipped and deployed to a real Postgres-backed
instance for the first time. `migrations/postgres/` had never existed for
this plugin at all — not a regression from this session's work specifically,
a gap since the plugin's inception (task 6's `workbook_members` table,
already 20+ tasks old, had simply never had a Postgres migration generated).
The runtime's automatic migration-on-startup silently `continue`s past any
plugin whose `migrations/postgres/` folder doesn't exist
(`runtime/src/plugin-migrations.ts`) — no error, no log line — so this had
no visible symptom until a real deploy actually hit it: every query against
`workbook_members` (the Home page's very first query, `listWorkbooksOverview`)
failed with Postgres error `42P01, relation "workbook_members" does not
exist`, surfacing as a generic error boundary on `/sheets` for every user.

Fixed by adding the missing `app/_db/schema.postgres.ts` (a `pgTable`-based
structural mirror of `app/_db/schema.ts`, driving `drizzle-kit generate
--dialect postgresql` — it cannot read a `sqliteTable()` schema directly),
`drizzle.config.pg.ts`, and a `db:generate:pg` package.json script — the
same three-file pattern every other isolated Postgres-capable plugin
(`kanban`, `docs`, `tasks`, `shopper`, `plainwrite`) already has, just never
added here. Generated the single initial `migrations/postgres/0000_*.sql`
covering all four tables (`workbooks`, `sheets`, `workbook_members`,
`finance_rate_cache`) in one shot — a first-time install has no prior
Postgres migration history to preserve or reconcile.

**Timestamps deliberately use `bigint({ mode: 'number' })`, not plain
`integer`**, diverging from `docs/plugin-database.md`'s general "never
bigint" guidance for a documented reason: Postgres `integer` is a real,
fixed 32-bit type (max 2147483647), and a Unix millisecond timestamp is a
13-digit number, already ~800x past that limit — `sovereign-plugin-kanban`
hit exactly this in production (every insert failing immediately,
`value "..." is out of range for type integer`) and had to `ALTER COLUMN
... SET DATA TYPE bigint` on every timestamp column after the fact. Written
correctly here from the start instead of repeating that incident — every
timestamp column (`createdAt`, `updatedAt`, `deletedAt`, `joinedAt`,
`lastOpenedAt`, `asOf`, `fetchedAt`) is `bigint`; non-timestamp integers
(`position`, `rowCount`, `colCount` — small values, no overflow risk) stay
plain `integer`, matching Kanban's own `done` column precedent.

Also manually stripped the schema qualifier from both generated
`REFERENCES "public"."workbooks"(...)` foreign-key constraints down to
unqualified `REFERENCES "workbooks"(...)` — a plugin's tables live in
`plugin_<slug>`, reached only via the connection's `search_path`, never
literally in `public`; the qualified form fails at migration time
(`docs/plugin-database.md`'s "Foreign keys in a Postgres schema"). Confirmed
via `pnpm --filter @sovereignfs/sovereign-sheets typecheck` and a full
review of the generated SQL; not live-verified against a real Postgres
instance from this environment (no direct access to the affected
production database) — verification is the operator re-running migrations
(automatically on the next container recreate, or manually via
`sv plugin migrate fs.sovereign.sheets` against a rebuilt image) and
confirming `/sheets` loads.

(Previous version: 0.17.1 — task 29, ghost tile position + sizing
fix, direct follow-up to task 28 reported against a fuller account that
exposed what task 28's own sparse 2-tile test grid hadn't.

**Position**: moved from first to last in the "My workbooks" grid — a
plain JSX reorder in `HomeWorkbooksList.tsx` (the `<Menu>` moved after
`myWorkbooks.map(...)`, same `<CardTileGrid>`), no CSS change.

**Sizing — a real bug task 28's own verification pass had wrongly signed
off on** ("ghost tile renders at the correct size matching sibling
workbook tiles" — false; a quick glance at only 2 sibling tiles hadn't
caught it). The tile rendered as a narrow ~38px sliver at full height
(106px) inside its 160px-wide grid cell. Root-caused by measuring actual
layout (`getBoundingClientRect()`) rather than guessing: `NewCardTile`'s
`variant="icon"` CSS (`.newTileIcon`, `packages/ui`'s
`CardTile.module.css`) used `width: auto; height: auto`, relying on the
CSS Grid parent's item-stretch to reach the tile's full footprint — which
only works for a _direct_ grid child. Task 28 wrapped the tile as a
`Menu`'s trigger, which inserts `Popover`'s own `display: inline-flex`
container between the grid and the button; that flex box's cross-axis
stretch correctly sized the button's height (`inline-flex`'s default
`align-items: stretch`), but flex never stretches a child along its main
axis without an explicit width rule, so width silently fell back to
shrink-to-fit (~38px) — even though the outer `Popover` container itself
measured the correct 160px, nothing propagated that down one level
further to the actual visible button.

Fixed at the design-system level, not a Sheets-local workaround — this is
a `NewCardTile` bug any future `Menu`/`Popover`-wrapped-in-grid consumer
would hit identically. Switched `.newTileIcon` to explicit
`width: 100%; height: 100%` — percentages resolve against whichever
immediate parent box is already correctly sized to the grid cell
(`Popover`'s stretched container, or the grid track directly with no
wrapper at all), so this works regardless of how many intermediate boxes
sit between the tile and its grid. `packages/ui` bumped `0.71.0` →
`0.71.1` — patch, a bug fix not a new capability, unlike task 28's minor.

Verified live via direct measurement before/after, not a screenshot
glance: ghost tile now measures exactly 160×106px, matching every sibling
`WorkbookTile` pixel-for-pixel; the menu still opens fully on-screen from
its new trailing position (panel's own bounding rect checked against
viewport width). **A live-testing false alarm along the way**: the first
re-measurement attempt showed `window.innerWidth: 0` and `Menu` rendering
via its mobile `Drawer` fallback instead of desktop `Popover` — traced to
this session's own browser tooling viewport being left at a stale 0×0
size by an unrelated earlier `resize_window` call (task 26's dark-mode
check), not a real bug; resolved by explicitly resetting the viewport
before re-testing.

(Previous version: 0.17.0 — task 28, Home page polish (shared-
heading spacing + a ghost "add" tile), two reports addressed together.

**Spacing**: "Shared with me" sat flush against its own tile grid — only
"My workbooks" had visible breathing room, because only it was wrapped in
a `.headingRow` div (there to also hold its old heading-row icon buttons,
see below) carrying the section's `margin-bottom`; "Shared with me" was a
bare `<h2>` with none. Fixed by moving `margin-bottom` onto `.heading`
itself and dropping `.headingRow` entirely — both sections are now plain
`<h2 className={styles.heading}>` elements getting identical spacing from
one rule, nothing special-cased.

**Ghost "add" tile**: a dashed `NewCardTile` (`@sovereignfs/ui`,
`variant="icon"`) is now the first item in the "My workbooks" grid,
opening a `Menu` — the same component `WorkbookView.tsx`'s header already
uses for Export/Import — offering "New workbook"/"Import workbook".
Replaces two separate heading-row icon buttons that did the same two
things, matching this plugin's own established one-trigger-many-options
consolidation pattern. No new `packages/ui` component needed —
`NewCardTile` already existed for exactly this "grid's own add-new
affordance" role, just unused here until now.

`NewWorkbookDialog` gained a `NewWorkbookDialogHandle` ref
(`{ open: () => void }`) so the menu can open it with no visible trigger
of its own — the same React-19-ref-as-prop pattern `ImportWorkbookHandle`
(task 17) already established for the identical problem.
`HomeWorkbooksList.tsx` renders one trigger-less instance of each dialog
alongside the grid (`renderTrigger={() => null}` for `NewWorkbookDialog`,
no `renderTrigger` at all for `ImportWorkbookButton`), and the menu's two
items call `.open()` / `.triggerImport()` on their refs.

**A real bug found live, not anticipated during implementation**: the
`Menu`'s panel defaulted to `align="right"` (`Popover`'s own default,
extending leftward from the trigger's right edge) — fine for the header's
Export/Import menus with room to their left, but the ghost tile sits at
the grid's left edge right after the sidebar, so the panel overflowed
off-screen, text visibly cut off mid-word in a screenshot before the fix.
Fixed with `align="left"`. Confirmed `Menu` was safe to render directly as
a `CardTileGrid` child before this was even live-tested, by reading
`Popover`'s and `Drawer`'s own source first: `Popover` (desktop) renders
one wrapping `<div>` holding both trigger and an absolutely-positioned
panel — one grid item, panel escapes visually without disrupting grid
sizing — and `Drawer` (mobile) is `position: fixed` and returns `null`
entirely while closed, so out-of-flow either way; no CSS grid workaround
needed for either responsive path. Verified live end-to-end: ghost tile
sized correctly against sibling workbook tiles; menu opens fully on-screen
after the align fix; "New workbook" opens the real dialog (Name field,
Cancel/Create workbook buttons) and Escape closes it with nothing created;
"Import workbook" closes the menu and fires the hidden file input's native
picker.

(Previous version: 0.16.3 — task 27, color picker auto-close on
selection, reported directly right after task 26 shipped: picking a color
from the Font/Fill color popover left it open, requiring a separate
dismiss (outside click, Escape, or re-clicking the trigger) — the original
design (task 21's changelog entry) called this deliberate, to avoid
closing mid-drag while the native custom-color `<input type="color">`'s
`onChange` fires repeatedly inside the browser's own color dialog, but in
practice this read as broken rather than deliberate for the much more
common case: a single, discrete curated-swatch click.

Fixed at the design-system level, not as a Sheets-local workaround —
`ColorPicker` is a shared, published `@sovereignfs/ui` component (also used
by Kanban's board-color dialogs), so per this repo's DS-first placement
rule the fix belongs there. Added a new optional
`onSelectionComplete?: () => void` prop (`packages/ui`, now `0.71.0`),
fired only from the curated-swatch and "no color" buttons' `onClick`
handlers — deliberately **not** wired to the native custom-color input's
`onChange`, preserving the exact risk the original no-auto-close decision
protected against. `SheetGrid.tsx` passes
`onSelectionComplete={() => setFontColorOpen(false)}` /
`setFillColorOpen(false)` to close its own `Popover`s on pick. Purely
additive — optional, no-op when omitted — so Kanban's own `ColorPicker`
usage (embedded in a form `Dialog`, not a `Popover`; auto-close isn't a
meaningful question there) needed zero changes, confirmed via
`pnpm --filter sovereign-plugin-kanban typecheck`. Verified live: picking
"Amber" fill / "Orange" font both applied correctly and closed their
popovers in one click; the native custom-color picker's own behavior is
intentionally left unchanged (still needs an explicit dismiss — there's no
reliable, false-positive-free "user is actually done" signal from a bare
`onChange` alone).

(Previous version: 0.16.2 — task 26, font-color default swatch fix,
a direct follow-up reported right after task 25 shipped. The Font color
toolbar bar showed `transparent` for the unset/default state — the same
treatment Fill color legitimately uses for "no fill" — but font color is
never actually invisible; unset always resolves to a real, visible
`--sv-color-text-primary` (black in light mode), so a transparent bar
misleadingly implied no color was applied when the text was in fact
rendering in a specific color the swatch simply wasn't showing. Fixed by
defaulting the bar's inline `backgroundColor` to
`var(--sv-color-text-primary)` instead of `'transparent'`
(`SheetGrid.tsx`'s `colorTriggerBar`) — a live CSS variable reference, not
a hardcoded `#000`, so it automatically tracks light/dark mode and any
future instance theming the same way every other semantic-token consumer
in this app does. Fill color's bar deliberately left unchanged (still
`transparent` for unset) — that one correctly represents "nothing," unlike
font color. Verified live: bar renders solid black by default matching the
token's computed value exactly; an explicit color override (tested red)
still applies correctly; resetting via "Default color" returns the inline
style to the token reference, not a stale literal.

(Previous version: 0.16.1 — task 25, toolbar icon polish for Bold/Italic/
Fill color, reported directly against Google Sheets' own toolbar as the
reference. Italic's styled-text glyph (`<em>I</em>`) read as an unlabeled
slash at toolbar size — a `font-style: italic` capital "I" in the design
system's sans-serif font is just a slanted stroke, with no serifs to
disambiguate it; fixed by switching Bold and Italic together to dedicated
Lucide icons (`bold`/`italic`, added to `scripts/icon-list.ts` and
regenerated via `pnpm generate:icons`) — a real icon draws explicit serif
bars as vector paths, sidestepping the font-rendering problem entirely
rather than trying to tune font-style harder. Fill color gained a
`paint-bucket` icon (also new) rendered above its existing color bar, in
the same vertical layout as Font color's "A" + bar
(`.fillTrigger`/`.fillTriggerBar` mirroring `.colorTrigger`/
`.colorTriggerBar`) — previously a bare, iconless swatch with no visual
hint of what the control did. All four buttons (Bold/Italic/Font color/
Fill color) switched from the generic `Button` component to plain
`<button>`s using the toolbar's own uniform 28px `.toolbarIconButton` class
(already used for Undo/Redo) instead of `Button`'s text-button padding, for
a tighter row matching Google Sheets' own icon-button spacing; `Popover`'s
`trigger` prop accepts any element with its own wired `onClick`, so no
`Popover` changes were needed. Bold/Italic's pressed state moved from
`Button`'s `variant="secondary"` to a new `.toolbarIconButtonActive` class
(sunken fill + inset border, mirroring Docs' `RichTextEditor` toolbar's own
`.toolbarButtonActive`).

**A dev-environment false alarm consumed most of task 25's time, not a
code bug.** After every static check passed, the live-verification browser
kept showing the _old_ toolbar (plain text, no icons) across a forced
reload and a brand-new tab, with zero console errors — misleading at
first, since it looked exactly like the kind of stale-bundle issue a hard
reload normally fixes. Root-caused by diffing the served bundles (fetched
with `cache: 'no-store'`, ruling out browser caching) against the edited
source: the compiled CSS was missing the new class names entirely, while
an unrelated `packages/ui` change (the new icon files, which Next watches
directly since `packages/ui` is in `transpilePackages`) _did_ compile
fresh — isolating the gap to this plugin's own source specifically. Traced
to this file's own documented dev-DX mechanism: "Plugin changes → HMR via
re-copy... Next's dev watcher does not follow symlinks" — the `next dev`
process in use was running standalone, without the sibling
`generate --watch` process `scripts/dev.ts` normally starts to re-copy
plugin source into the runtime's route group on every edit. Confirmed by
diffing file mtimes (the copied
`runtime/app/(platform)/(plugins)/sheets/_components/SheetGrid.module.css`
was ~30 minutes stale) and fixed with a one-shot `pnpm generate` to force
the re-copy — the same fix was reused for task 26's own verification, with
no need to re-diagnose it a second time. See ROADMAP.md.)
