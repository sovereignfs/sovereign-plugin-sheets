import { DEFAULT_COL_WIDTH_PX, MAX_COL_WIDTH_PX, MIN_COL_WIDTH_PX } from './config';

/** Sparse map, 0-indexed column index (as a string key) -> width in px. An absent entry renders at `DEFAULT_COL_WIDTH_PX`. */
export type ColumnWidthsMap = Record<string, number>;

/** Clamps to [MIN_COL_WIDTH_PX, MAX_COL_WIDTH_PX] — guards a corrupted or hand-edited stored/imported value the same way a live drag is already bounded in `SheetGrid.tsx`. */
export function clampColumnWidth(width: number): number {
  return Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_COL_WIDTH_PX, Math.round(width)));
}

export function sanitizeColumnWidths(parsed: unknown): ColumnWidthsMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const clean: ColumnWidthsMap = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!/^[0-9]{1,3}$/.test(key)) continue;
    if (typeof value === 'number' && Number.isFinite(value)) clean[key] = clampColumnWidth(value);
  }
  return clean;
}

export function parseColumnWidthsJson(json: string): ColumnWidthsMap {
  try {
    return sanitizeColumnWidths(JSON.parse(json));
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

/** Re-keys the map after columns are inserted (`delta > 0`) or deleted (`delta < 0`) at `at`. */
export function shiftColumnWidths(widths: ColumnWidthsMap, at: number, delta: number): ColumnWidthsMap {
  const next: ColumnWidthsMap = {};
  for (const [key, value] of Object.entries(widths)) {
    const col = Number(key);
    if (col < at) {
      next[key] = value;
      continue;
    }
    if (delta < 0 && col < at - delta) continue;
    next[String(col + delta)] = value;
  }
  return next;
}
