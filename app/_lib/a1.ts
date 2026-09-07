/** A1-style cell reference helpers: 0-indexed row/col <-> "A1" style keys. */

export function colIndexToLetters(colIndex: number): string {
  let n = colIndex + 1;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

export function lettersToColIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function cellKey(row: number, col: number): string {
  return `${colIndexToLetters(col)}${String(row + 1)}`;
}

const CELL_KEY_RE = /^([A-Z]{1,3})([1-9][0-9]{0,5})$/;

/** Inverse of `cellKey`; `null` for anything that isn't a plain A1 key (no `$`, no sheet prefix, no range). */
export function parseCellKey(key: string): { row: number; col: number } | null {
  const match = CELL_KEY_RE.exec(key);
  if (!match) return null;
  const letters = match[1];
  const digits = match[2];
  if (!letters || !digits) return null;
  return { row: Number(digits) - 1, col: lettersToColIndex(letters) };
}

/** `"A1:C3"` for a rectangle, or just `"B2"` when it's a single cell. */
export function rangeLabel(minRow: number, minCol: number, maxRow: number, maxCol: number): string {
  const start = cellKey(minRow, minCol);
  if (minRow === maxRow && minCol === maxCol) return start;
  return `${start}:${cellKey(maxRow, maxCol)}`;
}
