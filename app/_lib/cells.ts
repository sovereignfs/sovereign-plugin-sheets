/** A single cell's stored data. `f` (formula source, including the leading `=`) is added in a later task. */
export interface CellData {
  v?: string | number;
  f?: string;
  fmt?: 'plain' | 'number' | 'currency' | 'date';
  style?: CellStyle;
  validation?: DataValidationRule;
}

export type CellFormat = NonNullable<CellData['fmt']>;
export const CELL_FORMATS: CellFormat[] = ['plain', 'number', 'currency', 'date'];

/** Text styling — bold/italic only for now, no color (see SPEC.md's "Cell styling"). */
export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
}

export function isEmptyStyle(style: CellStyle | undefined): boolean {
  return !style || (!style.bold && !style.italic);
}

/**
 * A per-cell rule (not range-based — no multi-cell selection model exists
 * in this grid; see SPEC.md's "Data validation"). 'range' applies to the
 * cell's *resolved* numeric value (so a formula result is checked, not just
 * a typed literal); 'list' applies to the resolved value as text.
 */
export type DataValidationRule =
  | { type: 'range'; min?: number; max?: number }
  | { type: 'list'; values: string[] };

/** Per-cell presentation/behavior metadata the HyperFormula engine has no concept of — everything in CellData except `v`/`f`. */
export interface CellMetadata {
  fmt?: CellFormat;
  style?: CellStyle;
  validation?: DataValidationRule;
}

export type CellsMap = Record<string, CellData>;

export function parseCellsJson(json: string): CellsMap {
  try {
    const parsed: unknown = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CellsMap;
    }
    return {};
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
    const patch: Partial<CellData> = {};
    if (meta.fmt && meta.fmt !== 'plain') patch.fmt = meta.fmt;
    if (!isEmptyStyle(meta.style)) patch.style = meta.style;
    if (meta.validation) patch.validation = meta.validation;
    if (Object.keys(patch).length > 0) merged[key] = { ...merged[key], ...patch };
  }
  return merged;
}

/** The inverse of `mergeCellMetadata` — pulls the metadata overrides back out of a loaded `CellsMap`. */
export function extractCellMetadata(cells: CellsMap): Record<string, CellMetadata> {
  const metadata: Record<string, CellMetadata> = {};
  for (const [key, cell] of Object.entries(cells)) {
    const meta: CellMetadata = {};
    if (cell.fmt && cell.fmt !== 'plain') meta.fmt = cell.fmt;
    if (!isEmptyStyle(cell.style)) meta.style = cell.style;
    if (cell.validation) meta.validation = cell.validation;
    if (Object.keys(meta).length > 0) metadata[key] = meta;
  }
  return metadata;
}
