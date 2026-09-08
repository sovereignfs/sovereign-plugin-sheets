export const DEFAULT_ROW_COUNT = 100;
export const DEFAULT_COL_COUNT = 20;

/**
 * Sheet size ceiling — shared by CSV/workbook import (grows to fit a larger
 * file, up to this cap), manual "Add rows"/"Add columns" (`SheetGrid.tsx`,
 * grows by `ROW_GROWTH_STEP`/`COL_GROWTH_STEP` at a time), and the server's
 * own clamp in `saveSheetAction` — a crafted request can never store a size
 * the grid can't render.
 */
export const MAX_ROW_COUNT = 2000;
export const MAX_COL_COUNT = 100;

/** Growth increment for the "Add rows"/"Add columns" actions. */
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

/**
 * Row geometry for the virtualized grid (`SheetGrid.tsx`). Every row has a
 * height computable *without* measuring the DOM — `DEFAULT_ROW_HEIGHT_PX`
 * unless a cell in it carries a larger `fontSize`, in which case
 * `rowHeightForFontSize` — so the scroller can position rows by arithmetic
 * and only mount the ones in view. The CSS in `SheetGrid.module.css` pins
 * each cell to exactly this height so the DOM never disagrees with the math.
 */
export const DEFAULT_ROW_HEIGHT_PX = 28;
export const ROW_HEADER_WIDTH_PX = 40;
export const ROW_LINE_HEIGHT_FACTOR = 1.4;
export const ROW_VERTICAL_PADDING_PX = 8;
export function rowHeightForFontSize(fontSizePx: number | undefined): number {
  if (!fontSizePx) return DEFAULT_ROW_HEIGHT_PX;
  return Math.max(
    DEFAULT_ROW_HEIGHT_PX,
    Math.ceil(fontSizePx * ROW_LINE_HEIGHT_FACTOR) + ROW_VERTICAL_PADDING_PX,
  );
}
/** Rows rendered above/below the visible window so keyboard navigation and fast scrolling never hit a blank strip. */
export const ROW_OVERSCAN = 8;

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

/**
 * Per-sheet `cellsJson` ceiling enforced by `saveSheetAction` — the same
 * 1MB server-action body limit applies to autosave, so a sheet that grows
 * past this would start failing to save *anyway*; capping it explicitly
 * turns that into a clear "sheet is too large" error instead of a generic
 * network failure, and bounds what a crafted request can store.
 */
export const MAX_CELLS_JSON_BYTES = 800 * 1024;
export const MAX_NAMED_RANGES = 200;
export const MAX_NAMED_RANGES_JSON_BYTES = 64 * 1024;
export const MAX_SHEET_NAME_LENGTH = 64;
export const MAX_WORKBOOK_NAME_LENGTH = 120;
/** Longest single cell value (typed text or formula source) the server accepts. */
export const MAX_CELL_VALUE_LENGTH = 8 * 1024;
/** `list` validation rule bounds. */
export const MAX_VALIDATION_LIST_VALUES = 100;
export const MAX_VALIDATION_LIST_VALUE_LENGTH = 200;

/** `getFinanceRatesAction` accepts at most this many distinct pairs per call. */
export const MAX_FINANCE_PAIRS_PER_REQUEST = 50;
/** Outbound Frankfurter request timeout. */
export const FX_FETCH_TIMEOUT_MS = 8_000;
/** How long a FINANCE() cell waits before retrying after the provider couldn't be reached. */
export const FINANCE_RETRY_MS = 30_000;

/**
 * How often an open workbook asks the server whether someone else changed
 * it. A viewer (or an editor with nothing unsaved) reloads on a change; an
 * editor mid-edit is left alone — their next save surfaces the conflict.
 */
export const WORKBOOK_REFRESH_POLL_MS = 20_000;

/** Autosave debounce after the last committed edit. */
export const AUTOSAVE_DELAY_MS = 1200;

/** Default currency for the `currency` cell format when a cell doesn't carry its own code. */
export const DEFAULT_CURRENCY = 'USD';
/** Curated currency picker list (Frankfurter's supported set, roughly). Any valid ISO code is accepted in stored data. */
export const CELL_CURRENCIES = [
  'USD',
  'EUR',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'CNY',
  'HKD',
  'SGD',
  'INR',
  'KRW',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'BGN',
  'ISK',
  'TRY',
  'BRL',
  'MXN',
  'ZAR',
  'ILS',
  'IDR',
  'MYR',
  'PHP',
  'THB',
];
