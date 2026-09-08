import type { HyperFormula } from 'hyperformula';
import type { CellFormat } from './cells';
import { DEFAULT_CURRENCY } from './config';

/** The engine's `getCellValueDetailedType` result — what a bare value "is", as opposed to a format the user chose. */
export type DetailedValueType =
  | 'NUMBER_RAW'
  | 'NUMBER_DATE'
  | 'NUMBER_TIME'
  | 'NUMBER_DATETIME'
  | 'NUMBER_PERCENT'
  | 'NUMBER_CURRENCY'
  | 'BOOLEAN'
  | 'STRING'
  | 'ERROR'
  | 'EMPTY'
  | string;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

/**
 * Renders a date using the pattern the value was typed in (the engine
 * reports it via `getCellValueFormat`: `MM/DD/YYYY`, `DD/MM/YYYY`,
 * `MM/DD/YY`, …) so a user who typed `9/8/2026` sees `09/08/2026`, not a
 * silently reformatted ISO date. A computed date (no pattern) is ISO.
 */
function formatDate(engine: HyperFormula, numeric: number, pattern?: string): string | null {
  try {
    const date = engine.numberToDate(numeric);
    if (!date || !('year' in date)) return null;
    if (pattern && /^[DMY/.\-\s]+$/i.test(pattern)) {
      return pattern.replace(/YYYY|YY|MM|DD/gi, (token) => {
        switch (token.toUpperCase()) {
          case 'YYYY':
            return pad(date.year, 4);
          case 'YY':
            return pad(date.year % 100);
          case 'MM':
            return pad(date.month);
          default:
            return pad(date.day);
        }
      });
    }
    return `${pad(date.year, 4)}-${pad(date.month)}-${pad(date.day)}`;
  } catch {
    return null;
  }
}

function formatTime(engine: HyperFormula, numeric: number): string | null {
  try {
    const time = engine.numberToTime(numeric);
    if (!time || !('hours' in time)) return null;
    const seconds = Math.round(time.seconds);
    return seconds > 0 ? `${pad(time.hours)}:${pad(time.minutes)}:${pad(seconds)}` : `${pad(time.hours)}:${pad(time.minutes)}`;
  } catch {
    return null;
  }
}

function formatCurrency(numeric: number, currency: string | undefined): string {
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

/**
 * Formats an already-computed cell display value. An explicit `fmt` the
 * user chose wins; with no format (or 'plain'), the value's own type
 * decides: a date function or a typed date renders as a date, `12:30`
 * stays a time, a typed `5%` stays `5%`, `$5` stays currency — instead of
 * the raw serial number or fraction the engine holds underneath. Locale is
 * pinned to `en-US` so server-rendered HTML and the client's hydration
 * agree byte-for-byte regardless of the viewer's OS locale.
 */
export function formatCellValue(
  raw: string,
  fmt: CellFormat | undefined,
  rawValue: unknown,
  engine: HyperFormula,
  currency?: string,
  detailedType?: DetailedValueType,
  /** The engine's own format string for a typed value (`MM/DD/YYYY`, `$`, `hh:mm`), when it has one. */
  valueFormat?: string,
): string {
  const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
  if (!fmt || fmt === 'plain') {
    if (!Number.isFinite(numeric) || typeof rawValue !== 'number') return raw;
    switch (detailedType) {
      case 'NUMBER_DATE':
        return formatDate(engine, numeric, valueFormat) ?? raw;
      case 'NUMBER_TIME':
        return formatTime(engine, numeric) ?? raw;
      case 'NUMBER_DATETIME': {
        const date = formatDate(engine, numeric);
        const time = formatTime(engine, numeric);
        return date && time ? `${date} ${time}` : raw;
      }
      case 'NUMBER_PERCENT':
        return numeric.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 4 });
      case 'NUMBER_CURRENCY':
        return formatCurrency(numeric, currency);
      default:
        return raw;
    }
  }
  if (!Number.isFinite(numeric)) return raw;

  if (fmt === 'number') {
    return numeric.toLocaleString('en-US', { maximumFractionDigits: 2 });
  }
  if (fmt === 'percent') {
    return numeric.toLocaleString('en-US', { style: 'percent', maximumFractionDigits: 2 });
  }
  if (fmt === 'currency') {
    return formatCurrency(numeric, currency);
  }
  if (fmt === 'date') {
    return formatDate(engine, numeric) ?? raw;
  }
  return raw;
}
