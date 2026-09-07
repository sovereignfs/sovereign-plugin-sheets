import type { HyperFormula } from 'hyperformula';
import type { CellFormat } from './cells';
import { DEFAULT_CURRENCY } from './config';

/**
 * Formats an already-computed cell display value per its `fmt` — a no-op
 * for 'plain'/undefined or a non-numeric value (a format enum applies to a
 * number the formula engine actually resolved, not to arbitrary text).
 * Locale is pinned to `en-US` so the server-rendered HTML and the client's
 * hydration agree byte-for-byte regardless of the viewer's OS locale — the
 * grid is rendered on both sides.
 */
export function formatCellValue(
  raw: string,
  fmt: CellFormat | undefined,
  rawValue: unknown,
  engine: HyperFormula,
  currency?: string,
): string {
  if (!fmt || fmt === 'plain') return raw;
  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!Number.isFinite(numeric)) return raw;

  if (fmt === 'number') {
    return numeric.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (fmt === 'percent') {
    return numeric.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
  }
  if (fmt === 'currency') {
    try {
      return numeric.toLocaleString('en-US', {
        style: 'currency',
        currency: currency ?? DEFAULT_CURRENCY,
        currencyDisplay: 'narrowSymbol',
      });
    } catch {
      // An unknown ISO code (stored data is validated, but Intl's own list
      // can lag) — fall back to the code as a prefix rather than crashing.
      return `${currency ?? DEFAULT_CURRENCY} ${numeric.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  if (fmt === 'date') {
    try {
      const date = engine.numberToDate(numeric);
      // DateTime = SimpleTime | SimpleDate | SimpleDateTime — 'year' in date
      // narrows to the two variants that actually carry a calendar date
      // (instanceOfSimpleDate exists for this in HyperFormula, but isn't
      // part of its public package export).
      if (!date || !('year' in date)) return raw;
      const yyyy = String(date.year).padStart(4, '0');
      const mm = String(date.month).padStart(2, '0');
      const dd = String(date.day).padStart(2, '0');
      return `${yyyy}-${mm}-${dd}`;
    } catch {
      return raw;
    }
  }
  return raw;
}
