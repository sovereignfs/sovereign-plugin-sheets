/** A single cell's stored data. `f` (formula source, including the leading `=`) is added in a later task. */
export interface CellData {
  v?: string | number;
  f?: string;
  fmt?: 'plain' | 'number' | 'currency' | 'date';
}

export type CellFormat = NonNullable<CellData['fmt']>;
export const CELL_FORMATS: CellFormat[] = ['plain', 'number', 'currency', 'date'];

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
  // Drop empty, unformatted cells so autosave doesn't grow the blob
  // unboundedly — but keep a cell with a non-default `fmt` even if it has
  // no value yet (formatting a column ahead of typing into it).
  const compact: CellsMap = {};
  for (const [key, cell] of Object.entries(cells)) {
    const hasValue = cell.v !== undefined && cell.v !== '';
    const hasFormat = cell.fmt !== undefined && cell.fmt !== 'plain';
    if (hasValue || hasFormat) compact[key] = cell;
  }
  return JSON.stringify(compact);
}

/**
 * Layers per-cell number-format overrides (`_components/SheetGrid.tsx`'s own
 * in-memory format map, not tracked by the HyperFormula engine — it only
 * knows values/formulas) on top of engine-derived cell values, ahead of
 * `serializeCellsJson`. `formats` only ever needs an entry for a cell whose
 * format differs from the default 'plain'.
 */
export function mergeCellFormats(cells: CellsMap, formats: Record<string, CellFormat>): CellsMap {
  const merged: CellsMap = { ...cells };
  for (const [key, fmt] of Object.entries(formats)) {
    if (!fmt || fmt === 'plain') continue;
    merged[key] = { ...merged[key], fmt };
  }
  return merged;
}

/** The inverse of `mergeCellFormats` — pulls the format overrides back out of a loaded `CellsMap`. */
export function extractCellFormats(cells: CellsMap): Record<string, CellFormat> {
  const formats: Record<string, CellFormat> = {};
  for (const [key, cell] of Object.entries(cells)) {
    if (cell.fmt && cell.fmt !== 'plain') formats[key] = cell.fmt;
  }
  return formats;
}
