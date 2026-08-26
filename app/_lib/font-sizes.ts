/**
 * Curated per-cell font sizes, in px — plugin *data* (like
 * `_lib/cell-colors.ts`'s curated palette), not a design-system scale:
 * `CellStyle.fontSize` is a value a user picks for their own content, not a
 * `--sv-font-size-*` token used to build this plugin's own chrome. The
 * default (absent `fontSize`) inherits `--sv-font-size-sm` (14px) — not
 * itself in this list, since "Default" is its own distinct choice
 * (`FONT_SIZE_DEFAULT_LABEL`), the same "absent means theme default, not a
 * stored literal" shape `cell-colors.ts` already uses for `allowNone`.
 */
export const CELL_FONT_SIZES: number[] = [10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48];

export const FONT_SIZE_DEFAULT_LABEL = 'Default';
