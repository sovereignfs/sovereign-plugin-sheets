import { MAX_SHEET_NAME_LENGTH } from './config';

/**
 * Sheet-name rules shared by the client (rename/add UI) and the server
 * (`renameSheetAction`, `addSheetAction`, import). HyperFormula treats sheet
 * names as unique *case-insensitively* and throws on a collision — a
 * case-sensitive check let `Sheet1` → `SHEET1` through and crashed the
 * page — so uniqueness is checked here the same way the engine does it.
 * The banned characters are the ones Excel forbids, kept so a name never
 * needs escaping inside a cross-sheet reference.
 */
const INVALID_SHEET_NAME_CHARS = /[\\/?*[\]:']/;

export function normalizeSheetName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

export function sheetNamesCollide(a: string, b: string): boolean {
  return normalizeSheetName(a).toLowerCase() === normalizeSheetName(b).toLowerCase();
}

/** Returns a user-facing error, or `null` when `name` is acceptable alongside `existingNames`. */
export function validateSheetName(name: string, existingNames: string[]): string | null {
  const normalized = normalizeSheetName(name);
  if (!normalized) return 'Enter a sheet name.';
  if (normalized.length > MAX_SHEET_NAME_LENGTH) {
    return `Sheet names can be at most ${String(MAX_SHEET_NAME_LENGTH)} characters.`;
  }
  if (INVALID_SHEET_NAME_CHARS.test(normalized)) {
    return "Sheet names can't contain \\ / ? * [ ] : or '.";
  }
  if (existingNames.some((existing) => sheetNamesCollide(existing, normalized))) {
    return 'A sheet with that name already exists.';
  }
  return null;
}

/** `base`, or `base (2)`, `base (3)`… — the first variant that doesn't collide with `existingNames`. */
export function uniqueSheetName(base: string, existingNames: string[]): string {
  const cleaned = normalizeSheetName(base).replace(new RegExp(INVALID_SHEET_NAME_CHARS.source, 'g'), '') || 'Sheet';
  const truncated = cleaned.slice(0, MAX_SHEET_NAME_LENGTH - 6);
  if (!existingNames.some((existing) => sheetNamesCollide(existing, truncated))) return truncated;
  for (let n = 2; ; n++) {
    const candidate = `${truncated} (${String(n)})`;
    if (!existingNames.some((existing) => sheetNamesCollide(existing, candidate))) return candidate;
  }
}

/** `Sheet1`, `Sheet2`, … — the lowest number not already taken (case-insensitively). */
export function nextDefaultSheetName(existingNames: string[]): string {
  let n = existingNames.length + 1;
  while (existingNames.some((existing) => sheetNamesCollide(existing, `Sheet${String(n)}`))) n += 1;
  return `Sheet${String(n)}`;
}
