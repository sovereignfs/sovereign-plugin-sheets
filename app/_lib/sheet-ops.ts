import type { RawCellContent } from 'hyperformula';
import type { CellAlign, CellFormat, CellMetadata, CellStyle, DataValidationRule } from './cells';

/** A rectangle of cells, inclusive, 0-indexed. */
export interface CellBounds {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
}

export type SortDirection = 'asc' | 'desc';

/**
 * Everything `SheetGrid` can do to the *active* sheet, implemented by
 * `WorkbookView` — the one place that owns the formula engine, the per-sheet
 * metadata/width maps, the sheet list, and the save queue. The grid stays a
 * view: it turns pointer/keyboard input into these calls and renders the
 * result. Every mutation here marks the sheet dirty for autosave.
 */
export interface SheetOps {
  /** Writes one cell's raw input (a value, or a formula starting with `=`). Empty string clears it. */
  commitCell(row: number, col: number, raw: string): void;
  /** Clears values in the range; formatting survives (Excel/Sheets convention). */
  clearValues(bounds: CellBounds): void;
  /**
   * Writes a block of raw values at (row, col), growing the sheet to fit
   * (up to the size cap). Returns how many rows/cols were clipped, if any.
   */
  setValues(row: number, col: number, values: RawCellContent[][]): { clippedRows: number; clippedCols: number };
  /** Engine-internal copy/cut of a range plus its formatting (the grid puts the text form on the OS clipboard itself). */
  copyRange(bounds: CellBounds, cut: boolean): void;
  /** Pastes the engine-internal clipboard (values, formulas with translated references, formatting) at (row, col). */
  pasteInternal(row: number, col: number): boolean;
  /** Whether the engine-internal clipboard holds something `pasteInternal` can use. */
  hasInternalClipboard(): boolean;
  /** Autofill: repeats/extends `source` into `target` (formula references translate), formatting included. */
  fill(source: CellBounds, target: CellBounds): void;
  insertRows(at: number, count: number): void;
  deleteRows(at: number, count: number): void;
  insertColumns(at: number, count: number): void;
  deleteColumns(at: number, count: number): void;
  /** Appends blank rows/columns at the end (the "Add rows" affordance). */
  appendRows(count: number): void;
  appendColumns(count: number): void;
  sortByColumn(col: number, direction: SortDirection): void;
  setColumnWidth(col: number, width: number): void;
  setFrozen(rows: number, cols: number): void;
  /** Replaces the sheet's values with a CSV import (formatting is kept). */
  importCsv(rows: string[][]): { clipped: boolean; importedRows: number };
  setFormat(cellKeys: string[], fmt: CellFormat): void;
  setCurrency(cellKeys: string[], currency: string): void;
  toggleStyle(cellKeys: string[], styleKey: 'bold' | 'italic'): void;
  setColor(cellKeys: string[], colorKey: 'color' | 'bg', value: string | null): void;
  setFontSize(cellKeys: string[], size: number | null): void;
  setAlign(cellKeys: string[], align: CellAlign | null): void;
  setValidation(cellKeys: string[], rule: DataValidationRule | undefined): void;
  undo(): void;
  redo(): void;
}

export type { CellMetadata, CellStyle };
