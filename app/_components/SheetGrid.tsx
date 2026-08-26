'use client';

import { useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from 'react';
import type { HyperFormula } from 'hyperformula';
import {
  Button,
  ColorPicker,
  ConfirmDialog,
  Icon,
  Popover,
  Select,
  useToast,
  type StatusBadgeStatus,
} from '@sovereignfs/ui';
import { resizeSheetAction, saveSheetCellsAction } from '../actions';
import { cellKey, colIndexToLetters } from '../_lib/a1';
import { CELL_COLOR_SWATCHES } from '../_lib/cell-colors';
import { CELL_FONT_SIZES, FONT_SIZE_DEFAULT_LABEL } from '../_lib/font-sizes';
import {
  CELL_FORMATS,
  mergeCellMetadata,
  serializeCellsJson,
  type CellFormat,
  type CellMetadata,
  type CellStyle,
  type DataValidationRule,
} from '../_lib/cells';
import {
  COL_GROWTH_STEP,
  DEFAULT_COL_WIDTH_PX,
  MAX_COL_COUNT,
  MAX_COL_WIDTH_PX,
  MAX_ROW_COUNT,
  MIN_COL_WIDTH_PX,
  ROW_GROWTH_STEP,
} from '../_lib/config';
import { cellsToCsv, downloadCsv, parseCsv } from '../_lib/csv';
import { displayValue, gridToCellsMap } from '../_lib/formula-engine';
import { formatCellValue } from '../_lib/format';
import { isCellValueValid } from '../_lib/validation';
import { CellValidationDialog } from './CellValidationDialog';
import { FormulaBar } from './FormulaBar';
import { NamedRangesButton, type NamedRangeItem } from './NamedRangesDialog';
import styles from './SheetGrid.module.css';

const AUTOSAVE_DELAY_MS = 1200;
const FORMAT_LABELS: Record<CellFormat, string> = {
  plain: 'Plain',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
};

/** Parses a `"relRow,relCol"` clipboard-metadata key (never user input — always one this file constructed itself in `handleCopyOrCut`) back into its two numbers. */
function parseRelKey(relKey: string): [number, number] {
  const [rowPart, colPart] = relKey.split(',');
  return [Number(rowPart), Number(colPart)];
}

/** Imperative handle so WorkbookView's header can trigger this sheet's CSV export/import without lifting the underlying file-input/confirm-dialog state up to it. */
export interface SheetGridHandle {
  exportCsv: () => void;
  triggerImport: () => void;
}

export function SheetGrid({
  ref,
  engine,
  workbookId,
  hfSheetId,
  sheetId,
  sheetName,
  rowCount,
  colCount,
  version,
  onVersionChange,
  onCellCommitted,
  onSheetResized,
  onStatusChange,
  cellMetadata,
  onFormatChange,
  onToggleStyle,
  onColorChange,
  onFontSizeChange,
  onApplyMetadataPatch,
  onValidationChange,
  columnWidths,
  onColumnWidthChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  namedRanges,
  onAddNamedRange,
  onRemoveNamedRange,
  canEdit,
}: {
  /** React 19 ref-as-prop — no `forwardRef` needed. */
  ref?: Ref<SheetGridHandle>;
  engine: HyperFormula;
  workbookId: string;
  hfSheetId: number;
  sheetId: string;
  sheetName: string;
  rowCount: number;
  colCount: number;
  version: number;
  onVersionChange: (next: number) => void;
  onCellCommitted?: (raw: string) => void;
  /** CSV import grew the sheet past its current stored dimensions — update the caller's own row/col state. */
  onSheetResized?: (rowCount: number, colCount: number) => void;
  /** Mirrors the autosave status up to WorkbookView's header, which renders the badge. */
  onStatusChange?: (status: StatusBadgeStatus) => void;
  /** Per-cell format/style/validation overrides for the active sheet, keyed by A1 cell key. */
  cellMetadata: Record<string, CellMetadata>;
  /** Applies to every cell in the current selection (a single cell when nothing is multi-selected). */
  onFormatChange: (cellKeys: string[], fmt: CellFormat) => void;
  /** Applies to every cell in the current selection — a uniform toggle (see `WorkbookView.tsx`'s `handleToggleStyle`), not a per-cell independent one. */
  onToggleStyle: (cellKeys: string[], styleKey: keyof CellStyle) => void;
  /** Sets (a hex value) or clears (`null`) the font color (`color`) or background/fill color (`bg`) across every cell in the current selection. */
  onColorChange: (cellKeys: string[], colorKey: 'color' | 'bg', value: string | null) => void;
  /** Sets (a px value from `_lib/font-sizes.ts`) or clears (`null`, back to the theme default) the font size across every cell in the current selection. */
  onFontSizeChange: (cellKeys: string[], size: number | null) => void;
  /** The metadata half of a paste — merges `patch` into the sheet's metadata map and removes `deleteKeys` outright (a cut's source range, once its formatting has moved to the paste target). */
  onApplyMetadataPatch: (patch: Record<string, CellMetadata>, deleteKeys: string[]) => void;
  onValidationChange: (cellKey: string, rule: DataValidationRule | undefined) => void;
  /** Column-resize overrides for the active sheet, keyed by 0-indexed column (as a string) — an absent entry renders at `DEFAULT_COL_WIDTH_PX`. */
  columnWidths: Record<string, number>;
  onColumnWidthChange: (colIndex: number, width: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  namedRanges: NamedRangeItem[];
  onAddNamedRange: (name: string, expression: string) => string | undefined;
  onRemoveNamedRange: (name: string) => void;
  /** Viewer role: grid and formula bar render read-only, no autosave, no fill-down, no import, no format/style/validation changes. */
  canEdit: boolean;
}) {
  // Selection is an anchor + a focus corner, not a single cell — a plain
  // click collapses both to the same cell (identical to the old single
  // `activeCell` model), while drag/shift-click/shift-arrow move `focus`
  // and leave `anchor` in place, forming a rectangle. `activeCell` below is
  // a computed alias for the ANCHOR specifically: the formula bar, "which
  // cell am I editing" logic, and the toolbar's own displayed on/off state
  // all key off the anchor, matching how Sheets/Excel keep the "active
  // cell" fixed at the selection's starting corner while it's extended —
  // typing always goes into the anchor, never wherever the mouse/keyboard
  // last extended to.
  const [selectionAnchor, setSelectionAnchor] = useState<{ row: number; col: number } | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<{ row: number; col: number } | null>(null);
  // A click *selects* a cell (shows its computed display value, read-only —
  // matching Google Sheets/Docs) rather than dropping straight into an
  // editable cursor the way every earlier version of this grid did.
  // `editingCell` is the one cell, if any, currently in that inline-edit
  // state — entered via double-click, F2, Enter is deliberately excluded
  // (see `handleKeyDown`: Enter on a selected-but-not-editing cell moves
  // the selection down, matching Excel/Sheets, not "start editing"), or
  // typing a printable character directly onto a selected cell (which also
  // replaces its content, the same destructive-typing convention every
  // spreadsheet tool uses). `selectCell` always clears it — any new
  // selection (click, drag, arrow nav) implies "not editing" by definition.
  const [editingCell, setEditingCell] = useState<{ row: number; col: number } | null>(null);
  // Captured the moment edit mode is entered, so Escape can restore it —
  // this grid commits on every keystroke (no separate "draft" state), so
  // "cancel" means writing this back, not just discarding unsaved text.
  const editOriginalValue = useRef<string | null>(null);
  // True only while a mousedown-then-drag is in progress — gates whether
  // onMouseEnter extends the selection, and applies `user-select: none` to
  // the grid so dragging across cells doesn't also trigger the browser's
  // own native text-selection within whichever `<input>` the drag started
  // in.
  const [dragging, setDragging] = useState(false);
  // mousedown already calls `selectCell` directly (so a plain click and a
  // shift-click are both handled precisely, including which corner moves);
  // the native `focus` event that follows immediately after would
  // otherwise call it AGAIN and — for a shift-click — incorrectly collapse
  // the extended selection back down to one cell. Suppresses exactly that
  // one redundant call, without needing to guess at event timing.
  const suppressNextFocusSelect = useRef(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [fontColorOpen, setFontColorOpen] = useState(false);
  const [fillColorOpen, setFillColorOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const importInputRef = useRef<HTMLInputElement>(null);
  // HyperFormula's own internal clipboard (`engine.copy`/`cut`/`paste`)
  // already handles values/formulas — including relative-reference
  // translation — for the copy/cut/paste keyboard shortcuts below. It has
  // no concept of this plugin's own per-cell metadata (format/style/
  // validation) though, so that travels separately here, keyed by the
  // copied range's own top-left corner (`"relRow,relCol"`, not an A1 key —
  // this is never rendered or persisted, just translated by the paste
  // offset in `handlePaste`).
  const clipboardMetadata = useRef<{
    isCut: boolean;
    sourceMinRow: number;
    sourceMinCol: number;
    cells: Record<string, CellMetadata>;
  } | null>(null);
  // Column resize: the dragged column's <col> element is mutated directly
  // (not via React state) on every pointermove, so a drag doesn't re-render
  // the whole grid per pixel — only the final width, on pointer-up, goes
  // through onColumnWidthChange (React state + persistence).
  const colElRefs = useRef<Map<number, HTMLTableColElement>>(new Map());
  const resizeDrag = useRef<{ col: number; startX: number; startWidth: number } | null>(null);
  const toast = useToast();

  const activeCell = selectionAnchor;
  const selectionBounds =
    selectionAnchor && selectionFocus
      ? {
          minRow: Math.min(selectionAnchor.row, selectionFocus.row),
          maxRow: Math.max(selectionAnchor.row, selectionFocus.row),
          minCol: Math.min(selectionAnchor.col, selectionFocus.col),
          maxCol: Math.max(selectionAnchor.col, selectionFocus.col),
        }
      : null;
  const isMultiSelection =
    !!selectionBounds &&
    (selectionBounds.minRow !== selectionBounds.maxRow || selectionBounds.minCol !== selectionBounds.maxCol);

  // Ends a drag regardless of where the mouse button is released — cells
  // are plain <input>s with no drag-capture of their own, so a mouseup
  // outside the grid (or even outside the window) must still stop it.
  useEffect(() => {
    function handleGlobalMouseUp() {
      setDragging(false);
    }
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  }, []);

  function getColWidth(col: number): number {
    return columnWidths[String(col)] ?? DEFAULT_COL_WIDTH_PX;
  }

  function selectCell(row: number, col: number, options?: { extend?: boolean }) {
    if (options?.extend && selectionAnchor) {
      setSelectionFocus({ row, col });
    } else {
      setSelectionAnchor({ row, col });
      setSelectionFocus({ row, col });
    }
    setEditingCell(null);
    editOriginalValue.current = null;
  }

  /** Enters inline-edit mode on a cell — double-click, F2, or (with `replaceWith`) typing a character directly onto a selected cell, which replaces its content the same way Excel/Sheets treat direct typing as destructive. */
  function startEditing(row: number, col: number, replaceWith?: string) {
    if (!canEdit) return;
    editOriginalValue.current = getRawInput(row, col);
    setEditingCell({ row, col });
    if (replaceWith !== undefined) commitCell(row, col, replaceWith);
  }

  function stopEditing() {
    setEditingCell(null);
    editOriginalValue.current = null;
  }

  /** Escape while editing — restores the value captured when edit mode was entered (this grid commits on every keystroke, so there's no separate unsaved draft to just discard). */
  function cancelEditing(row: number, col: number) {
    if (editOriginalValue.current !== null) commitCell(row, col, editOriginalValue.current);
    stopEditing();
  }

  function getSelectedCellKeys(): string[] {
    if (!selectionBounds) return [];
    const keys: string[] = [];
    for (let r = selectionBounds.minRow; r <= selectionBounds.maxRow; r++) {
      for (let c = selectionBounds.minCol; c <= selectionBounds.maxCol; c++) {
        keys.push(cellKey(r, c));
      }
    }
    return keys;
  }

  function extendSelection(deltaRow: number, deltaCol: number) {
    if (!selectionFocus) return;
    const nextRow = Math.max(0, Math.min(rowCount - 1, selectionFocus.row + deltaRow));
    const nextCol = Math.max(0, Math.min(colCount - 1, selectionFocus.col + deltaCol));
    setSelectionFocus({ row: nextRow, col: nextCol });
  }

  function handleCellMouseDown(e: React.MouseEvent<HTMLInputElement>, row: number, col: number) {
    suppressNextFocusSelect.current = true;
    setDragging(true);
    selectCell(row, col, { extend: e.shiftKey });
  }

  function handleCellMouseEnter(row: number, col: number) {
    if (dragging) setSelectionFocus({ row, col });
  }

  function handleCellFocus(row: number, col: number) {
    if (suppressNextFocusSelect.current) {
      suppressNextFocusSelect.current = false;
      return;
    }
    // Reached via keyboard-driven focus (Tab, or `focusCell()` below) —
    // mousedown/click already went through `selectCell` above and this
    // would be redundant for those, but is the only path for keyboard nav,
    // which always collapses to the single newly-focused cell.
    selectCell(row, col);
  }

  /** Clears every selected cell's *value* (not its formatting) — Delete/Backspace over a multi-cell selection, matching Excel/Sheets: formatting survives until explicitly cleared. */
  function clearSelectionValues() {
    if (!canEdit || !selectionBounds) return;
    const height = selectionBounds.maxRow - selectionBounds.minRow + 1;
    const width = selectionBounds.maxCol - selectionBounds.minCol + 1;
    const blank: null[][] = Array.from({ length: height }, () => Array<null>(width).fill(null));
    engine.setCellContents(
      { sheet: hfSheetId, row: selectionBounds.minRow, col: selectionBounds.minCol },
      blank,
    );
    onVersionChange(version + 1);
    scheduleSave();
  }

  /**
   * Stores the current selection in HyperFormula's own internal clipboard
   * (values + formulas — `paste` below translates cell references the same
   * way a real spreadsheet's copy/paste always has) and, in parallel, this
   * plugin's own per-cell metadata for the same range, keyed by offset from
   * the range's top-left corner so `handlePaste` can re-anchor it wherever
   * the paste lands.
   */
  function handleCopyOrCut(cut: boolean) {
    if (!selectionBounds) return;
    if (cut && !canEdit) return;
    const range = {
      start: { sheet: hfSheetId, row: selectionBounds.minRow, col: selectionBounds.minCol },
      end: { sheet: hfSheetId, row: selectionBounds.maxRow, col: selectionBounds.maxCol },
    };
    if (cut) engine.cut(range);
    else engine.copy(range);

    const cells: Record<string, CellMetadata> = {};
    for (let r = selectionBounds.minRow; r <= selectionBounds.maxRow; r++) {
      for (let c = selectionBounds.minCol; c <= selectionBounds.maxCol; c++) {
        const meta = cellMetadata[cellKey(r, c)];
        if (meta) cells[`${r - selectionBounds.minRow},${c - selectionBounds.minCol}`] = meta;
      }
    }
    clipboardMetadata.current = {
      isCut: cut,
      sourceMinRow: selectionBounds.minRow,
      sourceMinCol: selectionBounds.minCol,
      cells,
    };
  }

  /**
   * Pastes at the active cell (the selection's anchor). `engine.paste()`
   * handles values/formulas — after a `cut`, this is equivalent to a real
   * move, per HyperFormula's own semantics. The metadata half is applied
   * separately via `onApplyMetadataPatch`, translated by the same offset;
   * a cut additionally clears the *source* range's metadata, since it
   * moved rather than duplicated.
   */
  function handlePaste() {
    if (!canEdit || !activeCell || engine.isClipboardEmpty()) return;
    const clip = clipboardMetadata.current;
    try {
      engine.paste({ sheet: hfSheetId, row: activeCell.row, col: activeCell.col });
    } catch {
      toast.show({
        title: 'Could not paste',
        message: 'That paste target is not valid for the copied content.',
        category: 'error',
      });
      return;
    }
    onVersionChange(version + 1);
    scheduleSave();

    if (clip) {
      const patch: Record<string, CellMetadata> = {};
      for (const [relKey, meta] of Object.entries(clip.cells)) {
        const [relRow, relCol] = parseRelKey(relKey);
        const destRow = activeCell.row + relRow;
        const destCol = activeCell.col + relCol;
        if (destRow >= rowCount || destCol >= colCount) continue;
        patch[cellKey(destRow, destCol)] = meta;
      }
      const deleteKeys: string[] = [];
      if (clip.isCut) {
        for (const relKey of Object.keys(clip.cells)) {
          const [relRow, relCol] = parseRelKey(relKey);
          deleteKeys.push(cellKey(clip.sourceMinRow + relRow, clip.sourceMinCol + relCol));
        }
      }
      onApplyMetadataPatch(patch, deleteKeys);
      // A cut is a one-time move, not a reusable clipboard — matches
      // HyperFormula's own "almost any operation after cut aborts it"
      // semantics, which effectively makes a completed cut+paste one-shot
      // too.
      if (clip.isCut) clipboardMetadata.current = null;
    }
  }

  function handleResizePointerDown(e: React.PointerEvent<HTMLDivElement>, col: number) {
    if (!canEdit) return;
    e.preventDefault();
    e.stopPropagation();
    resizeDrag.current = { col, startX: e.clientX, startWidth: getColWidth(col) };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleResizePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = resizeDrag.current;
    if (!drag) return;
    const nextWidth = Math.min(
      MAX_COL_WIDTH_PX,
      Math.max(MIN_COL_WIDTH_PX, drag.startWidth + (e.clientX - drag.startX)),
    );
    const colEl = colElRefs.current.get(drag.col);
    if (colEl) colEl.style.width = `${nextWidth}px`;
  }

  function handleResizePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = resizeDrag.current;
    if (!drag) return;
    resizeDrag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const colEl = colElRefs.current.get(drag.col);
    const finalWidth = colEl ? Math.round(parseFloat(colEl.style.width)) : drag.startWidth;
    if (Number.isFinite(finalWidth) && finalWidth !== getColWidth(drag.col)) {
      onColumnWidthChange(drag.col, finalWidth);
    }
  }

  /** Double-click a column border to reset that column back to the default width. */
  function handleResizeDoubleClick(col: number) {
    if (!canEdit) return;
    const colEl = colElRefs.current.get(col);
    if (colEl) colEl.style.width = `${DEFAULT_COL_WIDTH_PX}px`;
    if (getColWidth(col) !== DEFAULT_COL_WIDTH_PX) onColumnWidthChange(col, DEFAULT_COL_WIDTH_PX);
  }

  /** `role="separator"` on the resize handle implies keyboard operability (WAI-ARIA "window splitter" pattern, same as `packages/ui`'s `Resizable`) — Left/Right adjust by 8px, Shift+Left/Right by 32px. */
  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>, col: number) {
    if (!canEdit) return;
    const step = e.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(MIN_COL_WIDTH_PX, getColWidth(col) - step);
    else if (e.key === 'ArrowRight') next = Math.min(MAX_COL_WIDTH_PX, getColWidth(col) + step);
    if (next === null) return;
    e.preventDefault();
    const colEl = colElRefs.current.get(col);
    if (colEl) colEl.style.width = `${next}px`;
    onColumnWidthChange(col, next);
  }

  const columnLabels = useMemo(
    () => Array.from({ length: colCount }, (_, i) => colIndexToLetters(i)),
    [colCount],
  );

  function getRawInput(row: number, col: number): string {
    const formula = engine.getCellFormula({ sheet: hfSheetId, row, col });
    if (formula !== undefined) return formula;
    const value = engine.getCellValue({ sheet: hfSheetId, row, col });
    return value === null || value === undefined ? '' : String(value);
  }

  function getDisplay(row: number, col: number): string {
    const value = engine.getCellValue({ sheet: hfSheetId, row, col });
    const raw = displayValue(value);
    const fmt = cellMetadata[cellKey(row, col)]?.fmt;
    return formatCellValue(raw, fmt, value, engine);
  }

  function scheduleSave() {
    onStatusChange?.('draft');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const grid = engine.getSheetSerialized(hfSheetId);
      const cells = mergeCellMetadata(gridToCellsMap(grid), cellMetadata);
      void saveSheetCellsAction(workbookId, sheetId, serializeCellsJson(cells))
        .then(() => onStatusChange?.('synced'))
        .catch(() => {
          onStatusChange?.('error');
          toast.show({
            title: 'Could not save changes',
            message: `${sheetName} has unsaved edits. Check your connection and try again.`,
            category: 'error',
          });
        });
    }, AUTOSAVE_DELAY_MS);
  }

  function commitCell(row: number, col: number, raw: string) {
    if (!canEdit) return;
    engine.setCellContents({ sheet: hfSheetId, row, col }, [[raw === '' ? null : raw]]);
    onVersionChange(version + 1);
    scheduleSave();
    onCellCommitted?.(raw);
  }

  function focusCell(row: number, col: number) {
    if (row < 0 || row >= rowCount || col < 0 || col >= colCount) return;
    inputRefs.current.get(cellKey(row, col))?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    const editing = editingCell?.row === row && editingCell?.col === col;

    if ((e.metaKey || e.ctrlKey) && !e.altKey) {
      const key = e.key.toLowerCase();
      // Always the whole-cell/range operation, even when the input has its
      // own native text selection — the primary spreadsheet expectation
      // (copy this cell) outweighs "copy a substring of its text", which a
      // user can still reach via the browser's own right-click Copy.
      if (key === 'c') {
        e.preventDefault();
        handleCopyOrCut(false);
        return;
      }
      if (key === 'x' && canEdit) {
        e.preventDefault();
        handleCopyOrCut(true);
        return;
      }
      if (key === 'v' && canEdit) {
        e.preventDefault();
        handlePaste();
        return;
      }
      if (key === 'd' && canEdit) {
        // Fill down: copy this cell's raw input into the cell below.
        e.preventDefault();
        const raw = getRawInput(row, col);
        commitCell(row + 1, col, raw);
        focusCell(row + 1, col);
        return;
      }
    }

    if (!editing) {
      // A selected-but-not-editing cell is read-only — none of the keys
      // below do anything at the DOM level on their own, so they need
      // explicit handling here instead of falling through to native
      // `<input>` behavior the way they would while actually editing.
      if (e.key === 'F2' && canEdit) {
        e.preventDefault();
        startEditing(row, col);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        // Matches Excel/Sheets for both a single selected cell and a
        // multi-cell range — `clearSelectionValues` already handles a 1×1
        // selection correctly, so there's no separate single-cell path.
        e.preventDefault();
        clearSelectionValues();
        return;
      }
      // Direct typing onto a selected cell replaces its content and enters
      // edit mode with just the typed character — the same "destructive
      // typing" convention Excel/Sheets both use. `e.key.length === 1`
      // covers letters/digits/punctuation/space while naturally excluding
      // every named key above and below (`'Enter'`, `'ArrowLeft'`, etc. are
      // all multi-character key names).
      if (canEdit && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        startEditing(row, col, e.key);
        return;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing(row, col);
      return;
    }

    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (editing) stopEditing();
        focusCell(row + (e.shiftKey ? -1 : 1), col);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (e.shiftKey) extendSelection(-1, 0);
        else focusCell(row - 1, col);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (e.shiftKey) extendSelection(1, 0);
        else focusCell(row + 1, col);
        break;
      case 'ArrowLeft':
        if (e.shiftKey) {
          e.preventDefault();
          extendSelection(0, -1);
        } else if (!editing || (e.target as HTMLInputElement).selectionStart === 0) {
          // Not editing: arrows always navigate cells, no cursor-position
          // check needed (a selected, read-only cell has no meaningful
          // text cursor). Editing: only leave the cell once the cursor is
          // already at the boundary, same as before this task.
          e.preventDefault();
          focusCell(row, col - 1);
        }
        break;
      case 'ArrowRight': {
        if (e.shiftKey) {
          e.preventDefault();
          extendSelection(0, 1);
        } else {
          const input = e.target as HTMLInputElement;
          if (!editing || input.selectionStart === input.value.length) {
            e.preventDefault();
            focusCell(row, col + 1);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  function handleExportCsv() {
    const rows: string[][] = [];
    for (let row = 0; row < rowCount; row++) {
      rows.push(columnLabels.map((_, col) => getDisplay(row, col)));
    }
    downloadCsv(`${sheetName}.csv`, cellsToCsv(rows));
  }

  /** Grows the sheet by `ROW_GROWTH_STEP` rows, capped at `MAX_ROW_COUNT` — a no-op past the cap. */
  function handleAddRows() {
    if (!canEdit) return;
    const nextRowCount = Math.min(rowCount + ROW_GROWTH_STEP, MAX_ROW_COUNT);
    if (nextRowCount === rowCount) return;
    engine.addRows(hfSheetId, [rowCount, nextRowCount - rowCount]);
    void resizeSheetAction(sheetId, workbookId, nextRowCount, colCount);
    onSheetResized?.(nextRowCount, colCount);
    onVersionChange(version + 1);
  }

  /** Grows the sheet by `COL_GROWTH_STEP` columns, capped at `MAX_COL_COUNT` — a no-op past the cap. */
  function handleAddColumns() {
    if (!canEdit) return;
    const nextColCount = Math.min(colCount + COL_GROWTH_STEP, MAX_COL_COUNT);
    if (nextColCount === colCount) return;
    engine.addColumns(hfSheetId, [colCount, nextColCount - colCount]);
    void resizeSheetAction(sheetId, workbookId, rowCount, nextColCount);
    onSheetResized?.(rowCount, nextColCount);
    onVersionChange(version + 1);
  }

  function handleImportClick() {
    importInputRef.current?.click();
  }

  function handleImportFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file next time
    if (file) setPendingImportFile(file);
  }

  async function handleConfirmImport() {
    const file = pendingImportFile;
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length === 0) {
        toast.show({ title: 'Nothing to import', message: `${file.name} has no rows.`, category: 'error' });
        return;
      }

      const importedRowCount = parsed.length;
      // Not Math.max(...parsed.map(...)) — a spread of one arg per row can
      // blow the call stack on a large file; reduce has no such limit.
      const importedColCount = parsed.reduce((max, r) => Math.max(max, r.length), 1);
      const nextRowCount = Math.min(Math.max(rowCount, importedRowCount), MAX_ROW_COUNT);
      const nextColCount = Math.min(Math.max(colCount, importedColCount), MAX_COL_COUNT);

      if (nextRowCount > rowCount) engine.addRows(hfSheetId, [rowCount, nextRowCount - rowCount]);
      if (nextColCount > colCount) engine.addColumns(hfSheetId, [colCount, nextColCount - colCount]);

      // Spans the full next-size grid (>= the sheet's prior size), not just
      // the imported range, so any pre-existing content outside the CSV's
      // own dimensions is actually cleared — a true replace, matching the
      // confirm dialog's own copy, not a patch of the overlapping region.
      const clippedRows = Math.min(importedRowCount, nextRowCount);
      const clippedCols = Math.min(importedColCount, nextColCount);
      const values: (string | null)[][] = [];
      for (let row = 0; row < nextRowCount; row++) {
        const line: (string | null)[] = [];
        for (let col = 0; col < nextColCount; col++) {
          const raw = row < clippedRows && col < clippedCols ? (parsed[row]?.[col] ?? '') : '';
          line.push(raw === '' ? null : raw);
        }
        values.push(line);
      }
      engine.setCellContents({ sheet: hfSheetId, row: 0, col: 0 }, values);

      if (nextRowCount !== rowCount || nextColCount !== colCount) {
        void resizeSheetAction(sheetId, workbookId, nextRowCount, nextColCount);
        onSheetResized?.(nextRowCount, nextColCount);
      }

      onVersionChange(version + 1);
      scheduleSave();

      const clipped = importedRowCount > nextRowCount || importedColCount > nextColCount;
      toast.show({
        title: 'Workbook imported',
        message: `Imported ${clippedRows} row${clippedRows === 1 ? '' : 's'} from ${file.name} into ${sheetName}, replacing its existing cells.${clipped ? ' Some rows/columns beyond the size limit were skipped.' : ''}`,
        category: clipped ? 'warning' : 'success',
      });
    } catch {
      toast.show({
        title: 'Could not import file',
        message: `${file.name} could not be read as CSV.`,
        category: 'error',
      });
    } finally {
      setImporting(false);
      setPendingImportFile(null);
    }
  }

  const activeCellKey = activeCell ? cellKey(activeCell.row, activeCell.col) : null;
  const activeMetadata = activeCellKey ? cellMetadata[activeCellKey] : undefined;

  useImperativeHandle(ref, () => ({
    exportCsv: handleExportCsv,
    triggerImport: handleImportClick,
  }));

  return (
    <div className={styles.wrapper}>
      <FormulaBar
        cellLabel={
          activeCell
            ? isMultiSelection && selectionBounds
              ? `${cellKey(selectionBounds.minRow, selectionBounds.minCol)}:${cellKey(selectionBounds.maxRow, selectionBounds.maxCol)}`
              : cellKey(activeCell.row, activeCell.col)
            : ''
        }
        value={activeCell ? getRawInput(activeCell.row, activeCell.col) : ''}
        disabled={!activeCell}
        readOnly={!canEdit}
        onCommit={(value) => {
          if (activeCell) commitCell(activeCell.row, activeCell.col, value);
        }}
      />
      <div className={styles.toolbar} role="toolbar" aria-label="Sheet actions">
        {canEdit && (
          <>
            <button
              type="button"
              className={styles.toolbarIconButton}
              aria-label="Undo"
              disabled={!canUndo}
              onClick={onUndo}
            >
              <Icon name="rotate-ccw" size="sm" aria-hidden />
            </button>
            <button
              type="button"
              className={styles.toolbarIconButton}
              aria-label="Redo"
              disabled={!canRedo}
              onClick={onRedo}
            >
              <Icon name="rotate-cw" size="sm" aria-hidden />
            </button>
            <div className={styles.divider} aria-hidden="true" />
          </>
        )}
        <NamedRangesButton
          ranges={namedRanges}
          canEdit={canEdit}
          onAdd={onAddNamedRange}
          onRemove={onRemoveNamedRange}
        />
        <div className={styles.divider} aria-hidden="true" />
        <Select
          size="sm"
          className={styles.formatSelect}
          value={activeMetadata?.fmt ?? 'plain'}
          onChange={(e) => {
            onFormatChange(getSelectedCellKeys(), e.target.value as CellFormat);
          }}
          disabled={!activeCell || !canEdit}
          aria-label="Cell format"
        >
          {CELL_FORMATS.map((fmt) => (
            <option key={fmt} value={fmt}>
              {FORMAT_LABELS[fmt]}
            </option>
          ))}
        </Select>
        <Select
          size="sm"
          className={styles.fontSizeSelect}
          value={activeMetadata?.style?.fontSize ? String(activeMetadata.style.fontSize) : 'default'}
          onChange={(e) => {
            const value = e.target.value;
            onFontSizeChange(getSelectedCellKeys(), value === 'default' ? null : Number(value));
          }}
          disabled={!activeCell || !canEdit}
          aria-label="Font size"
        >
          <option value="default">{FONT_SIZE_DEFAULT_LABEL}</option>
          {CELL_FONT_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </Select>
        <button
          type="button"
          className={
            activeMetadata?.style?.bold
              ? `${styles.toolbarIconButton} ${styles.toolbarIconButtonActive}`
              : styles.toolbarIconButton
          }
          aria-pressed={activeMetadata?.style?.bold ?? false}
          aria-label="Bold"
          disabled={!activeCell || !canEdit}
          onClick={() => onToggleStyle(getSelectedCellKeys(), 'bold')}
        >
          <Icon name="bold" size="sm" aria-hidden />
        </button>
        <button
          type="button"
          className={
            activeMetadata?.style?.italic
              ? `${styles.toolbarIconButton} ${styles.toolbarIconButtonActive}`
              : styles.toolbarIconButton
          }
          aria-pressed={activeMetadata?.style?.italic ?? false}
          aria-label="Italic"
          disabled={!activeCell || !canEdit}
          onClick={() => onToggleStyle(getSelectedCellKeys(), 'italic')}
        >
          <Icon name="italic" size="sm" aria-hidden />
        </button>
        <Popover
          open={fontColorOpen}
          onClose={() => setFontColorOpen(false)}
          width={244}
          aria-label="Font color picker"
          trigger={
            <button
              type="button"
              className={styles.toolbarIconButton}
              aria-label="Font color"
              disabled={!activeCell || !canEdit}
              onClick={() => setFontColorOpen((v) => !v)}
            >
              <span className={styles.colorTrigger}>
                A
                <span
                  className={styles.colorTriggerBar}
                  style={{
                    backgroundColor: activeMetadata?.style?.color ?? 'var(--sv-color-text-primary)',
                    borderColor: activeMetadata?.style?.color,
                  }}
                  aria-hidden="true"
                />
              </span>
            </button>
          }
        >
          <div className={styles.colorPickerPanel}>
            <ColorPicker
              swatches={CELL_COLOR_SWATCHES}
              value={activeMetadata?.style?.color ?? null}
              onChange={(value) => {
                onColorChange(getSelectedCellKeys(), 'color', value);
              }}
              onSelectionComplete={() => setFontColorOpen(false)}
              allowNone
              noneLabel="Default color"
              aria-label="Font color"
            />
          </div>
        </Popover>
        <Popover
          open={fillColorOpen}
          onClose={() => setFillColorOpen(false)}
          width={244}
          aria-label="Fill color picker"
          trigger={
            <button
              type="button"
              className={styles.toolbarIconButton}
              aria-label="Fill color"
              disabled={!activeCell || !canEdit}
              onClick={() => setFillColorOpen((v) => !v)}
            >
              <span className={styles.fillTrigger}>
                <Icon name="paint-bucket" size="sm" aria-hidden />
                <span
                  className={styles.fillTriggerBar}
                  style={{
                    backgroundColor: activeMetadata?.style?.bg ?? 'transparent',
                    borderColor: activeMetadata?.style?.bg,
                  }}
                  aria-hidden="true"
                />
              </span>
            </button>
          }
        >
          <div className={styles.colorPickerPanel}>
            <ColorPicker
              swatches={CELL_COLOR_SWATCHES}
              value={activeMetadata?.style?.bg ?? null}
              onChange={(value) => {
                onColorChange(getSelectedCellKeys(), 'bg', value);
              }}
              onSelectionComplete={() => setFillColorOpen(false)}
              allowNone
              noneLabel="No fill"
              aria-label="Fill color"
            />
          </div>
        </Popover>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeCell || !canEdit}
          onClick={() => setValidationDialogOpen(true)}
        >
          Validation
        </Button>
        <div className={styles.toolbarSpacer} />
        {canEdit && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddRows}
              disabled={rowCount >= MAX_ROW_COUNT}
            >
              Add {ROW_GROWTH_STEP} rows
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleAddColumns}
              disabled={colCount >= MAX_COL_COUNT}
            >
              Add {COL_GROWTH_STEP} columns
            </Button>
          </>
        )}
      </div>
      {canEdit && (
        <input
          ref={importInputRef}
          type="file"
          accept=".csv,text/csv"
          className={styles.hiddenFileInput}
          onChange={handleImportFileChange}
          aria-label="Import CSV file"
        />
      )}
      <div className={[styles.scroller, dragging && styles.dragging].filter(Boolean).join(' ')}>
        <table className={styles.grid}>
          {/* Authoritative column widths in `table-layout: fixed` — a <col>'s
              own `width` (not `min-width` on cells inside it) is what the
              fixed-layout algorithm actually reads, so this is the one place
              a resize needs to update the DOM for the drag to render live
              (see `handleResizePointerMove`, which writes directly to the
              matching <col>'s style rather than going through React state on
              every pixel dragged). */}
          <colgroup>
            <col className={styles.rowHeaderCol} />
            {columnLabels.map((_, col) => (
              <col
                key={col}
                ref={(el) => {
                  if (el) colElRefs.current.set(col, el);
                  else colElRefs.current.delete(col);
                }}
                style={{ width: `${getColWidth(col)}px` }}
              />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className={styles.cornerHeader} />
              {columnLabels.map((label, col) => (
                <th key={label} className={styles.colHeader}>
                  {label}
                  {canEdit && (
                    /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA "window splitter" pattern: a focusable, keyboard-operable separator is the documented exception to role="separator" being non-interactive (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), same as packages/ui's Resizable component. */
                    <div
                      className={styles.resizeHandle}
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize column ${label}`}
                      tabIndex={0}
                      onPointerDown={(e) => handleResizePointerDown(e, col)}
                      onPointerMove={handleResizePointerMove}
                      onPointerUp={handleResizePointerUp}
                      onDoubleClick={() => handleResizeDoubleClick(col)}
                      onKeyDown={(e) => handleResizeKeyDown(e, col)}
                    />
                    /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rowCount }, (_, row) => (
              <tr key={row}>
                <th className={styles.rowHeader}>{row + 1}</th>
                {columnLabels.map((_, col) => {
                  const key = cellKey(row, col);
                  const isEditing = editingCell?.row === row && editingCell?.col === col;
                  const meta = cellMetadata[key];
                  const valid = isCellValueValid(engine.getCellValue({ sheet: hfSheetId, row, col }), meta?.validation);
                  const inputClassName = [
                    styles.cellInput,
                    meta?.style?.bold && styles.cellInputBold,
                    meta?.style?.italic && styles.cellInputItalic,
                    !valid && styles.invalid,
                    isEditing && styles.cellInputEditing,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const inSelection =
                    isMultiSelection &&
                    !!selectionBounds &&
                    row >= selectionBounds.minRow &&
                    row <= selectionBounds.maxRow &&
                    col >= selectionBounds.minCol &&
                    col <= selectionBounds.maxCol;
                  const cellClassName = [
                    styles.cell,
                    inSelection && styles.cellSelected,
                    inSelection && selectionBounds?.minRow === row && styles.cellSelectionEdgeTop,
                    inSelection && selectionBounds?.maxRow === row && styles.cellSelectionEdgeBottom,
                    inSelection && selectionBounds?.minCol === col && styles.cellSelectionEdgeLeft,
                    inSelection && selectionBounds?.maxCol === col && styles.cellSelectionEdgeRight,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td key={key} className={cellClassName}>
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(key, el);
                          else inputRefs.current.delete(key);
                        }}
                        className={inputClassName}
                        style={{
                          color: meta?.style?.color,
                          backgroundColor: meta?.style?.bg,
                          fontSize: meta?.style?.fontSize ? `${meta.style.fontSize}px` : undefined,
                        }}
                        value={isEditing ? getRawInput(row, col) : getDisplay(row, col)}
                        readOnly={!canEdit || !isEditing}
                        onMouseDown={(e) => handleCellMouseDown(e, row, col)}
                        onMouseEnter={() => handleCellMouseEnter(row, col)}
                        onFocus={() => handleCellFocus(row, col)}
                        onDoubleClick={() => startEditing(row, col)}
                        onChange={(e) => commitCell(row, col, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, row, col)}
                        aria-label={key}
                        aria-invalid={!valid || undefined}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={pendingImportFile !== null}
        onClose={() => setPendingImportFile(null)}
        title="Import CSV"
        message={
          <>
            Import <strong>{pendingImportFile?.name}</strong> into <strong>{sheetName}</strong>?
            This replaces every cell currently in this sheet and can&apos;t be undone.
          </>
        }
        onConfirm={() => void handleConfirmImport()}
        confirmLabel={importing ? 'Importing…' : 'Import'}
        destructive
        pending={importing}
      />

      <CellValidationDialog
        open={validationDialogOpen}
        onClose={() => setValidationDialogOpen(false)}
        cellLabel={activeCellKey ?? ''}
        currentRule={activeMetadata?.validation}
        onSave={(rule) => {
          if (activeCellKey) onValidationChange(activeCellKey, rule);
        }}
      />
    </div>
  );
}
