export const DEFAULT_ROW_COUNT = 100;
export const DEFAULT_COL_COUNT = 20;

/**
 * Sheet growth ceiling — shared by CSV/workbook import (grows to fit a
 * larger file, up to this cap) and manual "Add rows"/"Add columns"
 * (`SheetGrid.tsx`, grows by `ROW_GROWTH_STEP`/`COL_GROWTH_STEP` at a time,
 * capped here too). A sane bound against an unbounded/malformed sheet, not a
 * hard product limit.
 */
export const MAX_ROW_COUNT = 2000;
export const MAX_COL_COUNT = 100;

/** Growth increment for the manual "Add rows"/"Add columns" toolbar buttons. */
export const ROW_GROWTH_STEP = 50;
export const COL_GROWTH_STEP = 10;

/**
 * Column-resize bounds, in px. `DEFAULT_COL_WIDTH_PX` was originally 88
 * (matching the grid's old fixed `5.5rem` column width) but was too narrow
 * for typical content — real values like "$1,500.00" or a "Note" header
 * truncated at that width — so it was widened to 8rem once resizing gave
 * users an escape hatch either way. `MIN`/`MAX` bound the drag in
 * `SheetGrid.tsx`'s resize handler, and clamp anything parsed back out of a
 * stored/imported `colWidthsJson` (`_lib/column-widths.ts`) against a
 * corrupted or hand-edited value.
 */
export const DEFAULT_COL_WIDTH_PX = 128;
export const MIN_COL_WIDTH_PX = 48;
export const MAX_COL_WIDTH_PX = 480;

/** Sheet-count ceiling for a full-workbook import (`_lib/workbook-export.ts`) — CSV import only ever touches one sheet, so this is new. */
export const MAX_IMPORT_SHEET_COUNT = 20;

/**
 * Full-workbook export/import files travel as a single `importWorkbookAction`
 * server-action form field, not a raw HTTP file upload — Next.js caps a
 * server action's whole request body at 1MB by default, and this plugin
 * isn't taking on a platform-wide `next.config.ts` override for one feature.
 * Comfortably under that ceiling.
 */
export const MAX_IMPORT_FILE_SIZE_BYTES = 800 * 1024;
