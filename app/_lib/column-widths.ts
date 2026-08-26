import { DEFAULT_COL_WIDTH_PX, MAX_COL_WIDTH_PX, MIN_COL_WIDTH_PX } from './config';

/** Sparse map, 0-indexed column index (as a string key) -> width in px. An absent entry renders at `DEFAULT_COL_WIDTH_PX`. */
export type ColumnWidthsMap = Record<string, number>;

/** Clamps to [MIN_COL_WIDTH_PX, MAX_COL_WIDTH_PX] — guards a corrupted or hand-edited stored/imported value the same way a live drag is already bounded in `SheetGrid.tsx`. */
export function clampColumnWidth(width: number): number {
  return Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_COL_WIDTH_PX, Math.round(width)));
}

export function parseColumnWidthsJson(json: string): ColumnWidthsMap {
  try {
    const parsed: unknown = JSON.parse(json);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const clean: ColumnWidthsMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value)) clean[key] = clampColumnWidth(value);
    }
    return clean;
  } catch {
    return {};
  }
}

/** Drops entries equal to the default width, matching `serializeCellsJson`'s "don't store what isn't a real override" convention — keeps the blob from growing for every column a user never touched. */
export function serializeColumnWidthsJson(widths: ColumnWidthsMap): string {
  const compact: ColumnWidthsMap = {};
  for (const [key, value] of Object.entries(widths)) {
    if (value !== DEFAULT_COL_WIDTH_PX) compact[key] = value;
  }
  return JSON.stringify(compact);
}
