import { MAX_NAMED_RANGES, MAX_NAMED_RANGES_JSON_BYTES } from './config';

/**
 * Workbook-level named ranges as stored in `workbooks.namedRangesJson`:
 * `{ [name]: expression }`. HyperFormula validates the *expression* when a
 * name is added (the client surfaces its error inline); this module only
 * guards the stored shape — a name that HyperFormula would also accept,
 * string expressions, bounded count and size — so the server never stores
 * something the workbook can't load.
 */
export type NamedRangesMap = Record<string, string>;

/** HyperFormula's own naming rule: a letter or underscore, then letters/digits/underscores/periods, and not something that parses as a cell reference. */
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,254}$/;
const LOOKS_LIKE_CELL_REF = /^[A-Za-z]{1,3}[0-9]+$/;
/** Reserved by the engine setup (`formula-engine.ts`) so `=IF(…, TRUE, FALSE)` works — never a user's name. */
const RESERVED_NAMES = new Set(['TRUE', 'FALSE']);

export function isValidNamedRangeName(name: string): boolean {
  return NAME_RE.test(name) && !LOOKS_LIKE_CELL_REF.test(name) && !RESERVED_NAMES.has(name.toUpperCase());
}

export function sanitizeNamedRanges(parsed: unknown): NamedRangesMap {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const clean: NamedRangesMap = {};
  for (const [name, expression] of Object.entries(parsed as Record<string, unknown>)) {
    if (Object.keys(clean).length >= MAX_NAMED_RANGES) break;
    if (!isValidNamedRangeName(name)) continue;
    if (typeof expression !== 'string' || !expression.trim()) continue;
    clean[name] = expression.trim().slice(0, 1024);
  }
  return clean;
}

export function parseNamedRangesJson(json: string): NamedRangesMap {
  if (json.length > MAX_NAMED_RANGES_JSON_BYTES) return {};
  try {
    return sanitizeNamedRanges(JSON.parse(json));
  } catch {
    return {};
  }
}
