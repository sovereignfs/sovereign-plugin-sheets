import { parseCellKey } from './a1';
import {
  MAX_CELL_VALUE_LENGTH,
  MAX_VALIDATION_LIST_VALUES,
  MAX_VALIDATION_LIST_VALUE_LENGTH,
} from './config';
import { CELL_FONT_SIZES } from './font-sizes';

/**
 * A single cell's stored data. `v` holds a typed value or a formula's source
 * text (leading `=` included) — exactly what HyperFormula serializes, so
 * there's no separate formula field.
 */
export interface CellData {
  v?: string | number;
  fmt?: CellFormat;
  /** ISO 4217 code, only meaningful with `fmt: 'currency'`; absent means `DEFAULT_CURRENCY`. */
  currency?: string;
  style?: CellStyle;
  validation?: DataValidationRule;
}

export type CellFormat = 'plain' | 'number' | 'currency' | 'percent' | 'date';
export const CELL_FORMATS: CellFormat[] = ['plain', 'number', 'currency', 'percent', 'date'];

export type CellAlign = 'left' | 'center' | 'right';
export const CELL_ALIGNS: CellAlign[] = ['left', 'center', 'right'];

/**
 * Text styling. `color`/`bg` are 6-digit hex (e.g. `#d64545`) or absent —
 * absent means "use the theme default" (`--sv-color-text-primary` for text,
 * no fill for background), not a specific stored color, so a cell with no
 * explicit color stays correct across light/dark mode and any future theme.
 * See SPEC.md's "Cell font and background color". `fontSize` is a px value
 * from `_lib/font-sizes.ts`'s curated list, or absent (inherits the grid's
 * own default, `--sv-font-size-sm`) — see SPEC.md's "Cell font size".
 * `align` absent means automatic: numbers right, everything else left.
 */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  color?: string;
  bg?: string;
  fontSize?: number;
  align?: CellAlign;
}

export function isEmptyStyle(style: CellStyle | undefined): boolean {
  return (
    !style ||
    (!style.bold && !style.italic && !style.color && !style.bg && !style.fontSize && !style.align)
  );
}

/**
 * A per-cell rule, applied to every cell of a selection at once by the
 * validation dialog. 'range' applies to the cell's *resolved* numeric value
 * (so a formula result is checked, not just a typed literal); 'list' applies
 * to the resolved value as text.
 */
export type DataValidationRule =
  | { type: 'range'; min?: number; max?: number }
  | { type: 'list'; values: string[] };

/** Per-cell presentation/behavior metadata the HyperFormula engine has no concept of — everything in CellData except `v`. */
export interface CellMetadata {
  fmt?: CellFormat;
  currency?: string;
  style?: CellStyle;
  validation?: DataValidationRule;
}

export type CellsMap = Record<string, CellData>;

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CURRENCY_RE = /^[A-Z]{3}$/;

function sanitizeStyle(raw: unknown): CellStyle | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const style: CellStyle = {};
  if (r.bold === true) style.bold = true;
  if (r.italic === true) style.italic = true;
  if (typeof r.color === 'string' && HEX_COLOR_RE.test(r.color)) style.color = r.color.toLowerCase();
  if (typeof r.bg === 'string' && HEX_COLOR_RE.test(r.bg)) style.bg = r.bg.toLowerCase();
  if (typeof r.fontSize === 'number' && CELL_FONT_SIZES.includes(r.fontSize)) {
    style.fontSize = r.fontSize;
  }
  if (r.align === 'left' || r.align === 'center' || r.align === 'right') style.align = r.align;
  return isEmptyStyle(style) ? undefined : style;
}

function sanitizeValidation(raw: unknown): DataValidationRule | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  if (r.type === 'range') {
    const min = typeof r.min === 'number' && Number.isFinite(r.min) ? r.min : undefined;
    const max = typeof r.max === 'number' && Number.isFinite(r.max) ? r.max : undefined;
    if (min === undefined && max === undefined) return undefined;
    if (min !== undefined && max !== undefined && min > max) return undefined;
    return { type: 'range', min, max };
  }
  if (r.type === 'list' && Array.isArray(r.values)) {
    const values = r.values
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim().slice(0, MAX_VALIDATION_LIST_VALUE_LENGTH))
      .filter(Boolean)
      .slice(0, MAX_VALIDATION_LIST_VALUES);
    return values.length > 0 ? { type: 'list', values } : undefined;
  }
  return undefined;
}

/**
 * Validates one cell's raw stored shape field by field. Anything that isn't
 * a recognized, well-formed field is dropped — this is the *only* way cell
 * data enters memory (`parseCellsJson`) or storage (`saveSheetAction` runs
 * it server-side), so a hand-edited import file or a crafted save request
 * can't smuggle an arbitrary string into an inline `style` or an unbounded
 * value into the blob.
 */
export function sanitizeCellData(raw: unknown): CellData | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const cell: CellData = {};
  if (typeof r.v === 'number' && Number.isFinite(r.v)) cell.v = r.v;
  else if (typeof r.v === 'string' && r.v !== '') cell.v = r.v.slice(0, MAX_CELL_VALUE_LENGTH);
  if (typeof r.fmt === 'string' && r.fmt !== 'plain' && (CELL_FORMATS as string[]).includes(r.fmt)) {
    cell.fmt = r.fmt as CellFormat;
  }
  if (cell.fmt === 'currency' && typeof r.currency === 'string') {
    const code = r.currency.toUpperCase();
    if (CURRENCY_RE.test(code)) cell.currency = code;
  }
  const style = sanitizeStyle(r.style);
  if (style) cell.style = style;
  const validation = sanitizeValidation(r.validation);
  if (validation) cell.validation = validation;
  return Object.keys(cell).length > 0 ? cell : undefined;
}

export function sanitizeCellsMap(parsed: unknown): CellsMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const clean: CellsMap = {};
  for (const [key, raw] of Object.entries(parsed as Record<string, unknown>)) {
    if (!parseCellKey(key)) continue;
    const cell = sanitizeCellData(raw);
    if (cell) clean[key] = cell;
  }
  return clean;
}

export function parseCellsJson(json: string): CellsMap {
  try {
    return sanitizeCellsMap(JSON.parse(json));
  } catch {
    return {};
  }
}

export function serializeCellsJson(cells: CellsMap): string {
  // Drop empty, unmodified cells so autosave doesn't grow the blob
  // unboundedly — but keep a cell with any non-default metadata (format,
  // style, or a validation rule) even if it has no value yet (formatting/
  // styling/restricting a column ahead of typing into it).
  const compact: CellsMap = {};
  for (const [key, cell] of Object.entries(cells)) {
    const hasValue = cell.v !== undefined && cell.v !== '';
    const hasFormat = cell.fmt !== undefined && cell.fmt !== 'plain';
    const hasStyle = !isEmptyStyle(cell.style);
    const hasValidation = cell.validation !== undefined;
    if (hasValue || hasFormat || hasStyle || hasValidation) compact[key] = cell;
  }
  return JSON.stringify(compact);
}

/** Drops absent/default fields so an in-memory metadata entry is either meaningful or gone. */
export function compactMetadata(meta: CellMetadata): CellMetadata | undefined {
  const clean: CellMetadata = {};
  if (meta.fmt && meta.fmt !== 'plain') clean.fmt = meta.fmt;
  if (clean.fmt === 'currency' && meta.currency) clean.currency = meta.currency;
  if (!isEmptyStyle(meta.style)) clean.style = meta.style;
  if (meta.validation) clean.validation = meta.validation;
  return Object.keys(clean).length > 0 ? clean : undefined;
}

/**
 * Layers per-cell metadata overrides (`_components/SheetGrid.tsx`'s own
 * in-memory map, not tracked by the HyperFormula engine — it only knows
 * values/formulas) on top of engine-derived cell values, ahead of
 * `serializeCellsJson`. `metadata` only ever needs an entry for a cell that
 * actually has non-default format/style/validation.
 */
export function mergeCellMetadata(cells: CellsMap, metadata: Record<string, CellMetadata>): CellsMap {
  const merged: CellsMap = { ...cells };
  for (const [key, meta] of Object.entries(metadata)) {
    const patch = compactMetadata(meta);
    if (patch) merged[key] = { ...merged[key], ...patch };
  }
  return merged;
}

/** The inverse of `mergeCellMetadata` — pulls the metadata overrides back out of a loaded `CellsMap`. */
export function extractCellMetadata(cells: CellsMap): Record<string, CellMetadata> {
  const metadata: Record<string, CellMetadata> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const meta = compactMetadata({
      fmt: cell.fmt,
      currency: cell.currency,
      style: cell.style,
      validation: cell.validation,
    });
    if (meta) metadata[key] = meta;
  }
  return metadata;
}

/**
 * Re-keys a metadata map after rows/columns are inserted or deleted, the
 * same shift the formula engine applies to its own cell addresses — a bold
 * header stays on the header row when a row is inserted above it. Entries
 * inside a deleted band are dropped.
 */
export function shiftMetadata(
  metadata: Record<string, CellMetadata>,
  axis: 'row' | 'col',
  at: number,
  delta: number,
): Record<string, CellMetadata> {
  const next: Record<string, CellMetadata> = {};
  for (const [key, meta] of Object.entries(metadata)) {
    const address = parseCellKey(key);
    if (!address) continue;
    const index = axis === 'row' ? address.row : address.col;
    if (index < at) {
      next[key] = meta;
      continue;
    }
    if (delta < 0 && index < at - delta) continue; // inside the deleted band
    const shifted = index + delta;
    const row = axis === 'row' ? shifted : address.row;
    const col = axis === 'col' ? shifted : address.col;
    next[`${colLetters(col)}${String(row + 1)}`] = meta;
  }
  return next;
}

function colLetters(colIndex: number): string {
  let n = colIndex + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

/** Applies a row permutation (`newOrder[i]` = the old row now at position i) to a metadata map — sort moves styling with its row. */
export function permuteMetadataRows(
  metadata: Record<string, CellMetadata>,
  newOrder: number[],
): Record<string, CellMetadata> {
  const oldToNew = new Map<number, number>();
  newOrder.forEach((oldRow, newRow) => oldToNew.set(oldRow, newRow));
  const next: Record<string, CellMetadata> = {};
  for (const [key, meta] of Object.entries(metadata)) {
    const address = parseCellKey(key);
    if (!address) continue;
    const newRow = oldToNew.get(address.row) ?? address.row;
    next[`${colLetters(address.col)}${String(newRow + 1)}`] = meta;
  }
  return next;
}
