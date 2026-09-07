import { DetailedCellError, HyperFormula } from 'hyperformula';
import type { RawCellContent } from 'hyperformula';
import { cellKey } from './a1';
import type { CellsMap } from './cells';
import { ensureFinanceFunctionRegistered } from './finance-function';

/**
 * hyperformula's free tier is GPLv3-licensed — see SPEC.md's "Open questions"
 * for the cross-plugin licensing reasoning behind depending on it here.
 */
export function createEngine(): HyperFormula {
  ensureFinanceFunctionRegistered();
  return HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });
}

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

/**
 * What goes into the engine for a raw typed/pasted string. A plain decimal
 * literal becomes a JS number so it is stored (and exported) as a number
 * rather than the string the user typed; anything else — formulas, dates,
 * percentages, text — is left for HyperFormula's own parser.
 */
export function normalizeRawInput(raw: string): RawCellContent {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  if (PLAIN_NUMBER_RE.test(trimmed)) {
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;
  }
  return raw;
}

export function isFormulaError(value: unknown): value is DetailedCellError {
  return value instanceof DetailedCellError;
}

/** Display string for a computed cell value — e.g. "#DIV/0!" for an error, "" for empty. */
export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (isFormulaError(value)) return value.value;
  return String(value);
}
