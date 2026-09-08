import { DetailedCellError, HyperFormula } from 'hyperformula';
import type { RawCellContent } from 'hyperformula';
import { cellKey } from './a1';
import type { CellsMap } from './cells';
import { ensureFinanceFunctionRegistered } from './finance-function';

/**
 * hyperformula's free tier is GPLv3-licensed — see SPEC.md's "Open questions"
 * for the cross-plugin licensing reasoning behind depending on it here.
 *
 * Engine configuration, all deliberate:
 * - `dateFormats`: the engine's own default is day-first (`DD/MM/YYYY`),
 *   which turned a typed `9/8/2026` into 9 August while every display in
 *   this plugin is pinned to `en-US`. Month-first and ISO come first now;
 *   day-first still parses an unambiguous `25/12/2026`.
 * - `TRUE`/`FALSE` as global named expressions: HyperFormula only knows the
 *   `TRUE()`/`FALSE()` function forms, so `=IF(A1>2,TRUE,FALSE)` — the way
 *   every spreadsheet user writes it — was `#NAME?`.
 */
export const ENGINE_DATE_FORMATS = ['MM/DD/YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YY'];

export function createEngine(): HyperFormula {
  ensureFinanceFunctionRegistered();
  const engine = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3', dateFormats: ENGINE_DATE_FORMATS });
  engine.addNamedExpression('TRUE', '=TRUE()');
  engine.addNamedExpression('FALSE', '=FALSE()');
  engine.clearUndoStack();
  return engine;
}

/** Names reserved by `createEngine` — never listed as, or overwritten by, a user's named range. */
export const BUILTIN_NAMED_EXPRESSIONS = new Set(['TRUE', 'FALSE']);

export function cellsMapToGrid(cells: CellsMap, rowCount: number, colCount: number): RawCellContent[][] {
  const grid: RawCellContent[][] = [];
  for (let row = 0; row < rowCount; row++) {
    const rowValues: RawCellContent[] = [];
    for (let col = 0; col < colCount; col++) {
      rowValues.push(cells[cellKey(row, col)]?.v ?? null);
    }
    grid.push(rowValues);
  }
  return grid;
}

export function gridToCellsMap(grid: RawCellContent[][]): CellsMap {
  const cells: CellsMap = {};
  grid.forEach((rowValues, row) => {
    rowValues.forEach((value, col) => {
      if (value !== null && value !== undefined && value !== '') {
        cells[cellKey(row, col)] = { v: value as string | number };
      }
    });
  });
  return cells;
}

const PLAIN_NUMBER_RE = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const GROUPED_NUMBER_RE = /^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;
const GROUPED_CURRENCY_RE = /^(-?)\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d+)?)$/;

/**
 * What goes into the engine for a raw typed/pasted string. A plain decimal
 * literal becomes a JS number so it is stored (and exported) as a number
 * rather than the string the user typed; `1,234.50` has its thousands
 * separators removed for the same reason (the engine can't be told to
 * accept `,` as a thousands separator while it is also the argument
 * separator); `$1,234.50` becomes `$1234.50`, which the engine parses as a
 * currency amount. Anything else — formulas, dates, percentages, text —
 * is left for HyperFormula's own parser.
 */
export function normalizeRawInput(raw: string): RawCellContent {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (PLAIN_NUMBER_RE.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  if (GROUPED_NUMBER_RE.test(trimmed)) {
    const numeric = Number(trimmed.replace(/,/g, ''));
    if (Number.isFinite(numeric)) return numeric;
  }
  const currency = GROUPED_CURRENCY_RE.exec(trimmed);
  if (currency) return `${currency[1] ?? ''}$${(currency[2] ?? '').replace(/,/g, '')}`;
  return raw;
}

export function isFormulaError(value: unknown): value is DetailedCellError {
  return value instanceof DetailedCellError;
}

/** Display string for a computed cell value — e.g. "#DIV/0!" for an error, "" for empty, "TRUE" for a boolean. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isFormulaError(value)) return value.value;
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

/**
 * A plain-language explanation of an error cell — what the tooltip and
 * the formula bar show. The engine's own message is specific but written
 * for developers ("Expecting token of type --> RParen"), so the common
 * cases are translated; anything else falls back to the engine's text.
 */
export function describeCellError(error: DetailedCellError): string {
  const code = error.value;
  const message = error.message ?? '';
  switch (code) {
    case '#ERROR!':
      return "This formula can't be read. Check for a missing parenthesis, comma, or quote.";
    case '#NAME?': {
      const fn = /Function name (\S+) not recognized/.exec(message)?.[1];
      if (fn) return `${fn} isn't a function this sheet knows. Check the spelling, or type = and start typing to see suggestions.`;
      const name = /Named expression (\S+) not recognized/.exec(message)?.[1];
      if (name) return `${name} isn't a named range or function this sheet knows.`;
      return "This formula uses a name this sheet doesn't know.";
    }
    case '#DIV/0!':
      return 'This formula divides by zero (or by an empty cell).';
    case '#REF!':
      return 'This formula refers to a cell that was deleted.';
    case '#VALUE!':
      return message ? `Wrong kind of value: ${message.replace(/\.$/, '')}.` : 'This formula got the wrong kind of value (for example text where a number was expected).';
    case '#CYCLE!':
      return 'This formula refers to itself, directly or through other cells.';
    case '#NUM!':
      return 'This calculation produced a number that is too large, too small, or not real.';
    case '#N/A':
      return message || 'No value is available here.';
    default:
      return message || `Formula error ${code}.`;
  }
}
