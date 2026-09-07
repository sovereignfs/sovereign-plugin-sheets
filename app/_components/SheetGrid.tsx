'use client';

import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent as ReactClipboardEvent,
  type Ref,
} from 'react';
import type { HyperFormula } from 'hyperformula';
import {
  Button,
  ColorPicker,
  ConfirmDialog,
  ContextMenu,
  Icon,
  Menu,
  Popover,
  Select,
  Tooltip,
  useToast,
  type MenuEntry,
} from '@sovereignfs/ui';
import { cellKey, colIndexToLetters, rangeLabel } from '../_lib/a1';
import { CELL_COLOR_SWATCHES } from '../_lib/cell-colors';
import { CELL_FONT_SIZES, FONT_SIZE_DEFAULT_LABEL } from '../_lib/font-sizes';
import {
  CELL_FORMATS,
  type CellAlign,
  type CellFormat,
  type CellMetadata,
  type DataValidationRule,
} from '../_lib/cells';
import {
  CELL_CURRENCIES,
  COL_GROWTH_STEP,
  DEFAULT_COL_WIDTH_PX,
  DEFAULT_CURRENCY,
  DEFAULT_ROW_HEIGHT_PX,
  MAX_COL_COUNT,
  MAX_COL_WIDTH_PX,
  MAX_ROW_COUNT,
  MIN_COL_WIDTH_PX,
  ROW_GROWTH_STEP,
  ROW_HEADER_WIDTH_PX,
  ROW_OVERSCAN,
  rowHeightForFontSize,
} from '../_lib/config';
import { cellsToCsv, cellsToTsv, downloadCsv, parseClipboardText, parseCsv } from '../_lib/csv';
import { displayValue } from '../_lib/formula-engine';
import { extractFinancePairs, getCachedRate } from '../_lib/finance-function';
import { formatCellValue } from '../_lib/format';
import type { CellBounds, SheetOps } from '../_lib/sheet-ops';
import { isCellValueValid, validationRulesEqual } from '../_lib/validation';
import { CellValidationDialog } from './CellValidationDialog';
import { FindReplacePopover } from './FindReplacePopover';
import { FormulaBar } from './FormulaBar';
import { NamedRangesButton, type NamedRangeItem } from './NamedRangesDialog';
import styles from './SheetGrid.module.css';

const HEADER_HEIGHT_PX = DEFAULT_ROW_HEIGHT_PX;
const FORMAT_LABELS: Record<CellFormat, string> = {
  plain: 'Plain',
  number: 'Number',
  currency: 'Currency',
  percent: 'Percent',
  date: 'Date',
};
const ALIGN_AUTO = 'auto';
const FROZEN_MAX = 5;

interface CellAddress {
  row: number;
  col: number;
}

interface EditingState extends CellAddress {
  draft: string;
}

/** Imperative handle so WorkbookView's header can trigger this sheet's CSV export/import without lifting the underlying file-input/confirm-dialog state up to it. */
export interface SheetGridHandle {
  exportCsv: () => void;
  triggerImport: () => void;
}

type ContextTarget = { kind: 'cell' } | { kind: 'row' } | { kind: 'col' };

function boundsOf(a: CellAddress, b: CellAddress): CellBounds {
  return {
    minRow: Math.min(a.row, b.row),
    maxRow: Math.max(a.row, b.row),
    minCol: Math.min(a.col, b.col),
    maxCol: Math.max(a.col, b.col),
  };
}

function boundsKeys(bounds: CellBounds): string[] {
  const keys: string[] = [];
  for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
    for (let c = bounds.minCol; c <= bounds.maxCol; c++) keys.push(cellKey(r, c));
  }
  return keys;
}

/** Largest index `r` with `offsets[r] <= y` (offsets ascending, offsets[0] = 0). */
function rowAtOffset(offsets: number[], y: number): number {
  let lo = 0;
  let hi = offsets.length - 2;
  if (hi < 0) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((offsets[mid] ?? 0) <= y) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function fillTargetFor(source: CellBounds, target: CellAddress): CellBounds | null {
  const dRow = target.row > source.maxRow ? target.row - source.maxRow : target.row < source.minRow ? target.row - source.minRow : 0;
  const dCol = target.col > source.maxCol ? target.col - source.maxCol : target.col < source.minCol ? target.col - source.minCol : 0;
  if (dRow === 0 && dCol === 0) return null;
  if (Math.abs(dRow) >= Math.abs(dCol)) {
    return dRow > 0
      ? { minRow: source.maxRow + 1, maxRow: target.row, minCol: source.minCol, maxCol: source.maxCol }
      : { minRow: target.row, maxRow: source.minRow - 1, minCol: source.minCol, maxCol: source.maxCol };
  }
  return dCol > 0
    ? { minRow: source.minRow, maxRow: source.maxRow, minCol: source.maxCol + 1, maxCol: target.col }
    : { minRow: source.minRow, maxRow: source.maxRow, minCol: target.col, maxCol: source.minCol - 1 };
}

interface SheetGridProps {
  /** React 19 ref-as-prop — no `forwardRef` needed. */
  ref?: Ref<SheetGridHandle>;
  engine: HyperFormula;
  hfSheetId: number;
  sheetName: string;
  rowCount: number;
  colCount: number;
  frozenRows: number;
  frozenCols: number;
  /** Bumped by `WorkbookView` after any engine/metadata change — re-renders the visible cells. */
  version: number;
  /** Per-cell format/style/validation overrides for this sheet, keyed by A1 cell key. */
  cellMetadata: Record<string, CellMetadata>;
  /** Column-resize overrides, keyed by 0-indexed column (as a string) — an absent entry renders at `DEFAULT_COL_WIDTH_PX`. */
  columnWidths: Record<string, number>;
  ops: SheetOps;
  canUndo: boolean;
  canRedo: boolean;
  namedRanges: NamedRangeItem[];
  onAddNamedRange: (name: string, expression: string) => string | undefined;
  onRemoveNamedRange: (name: string) => void;
  /** Ctrl+PageUp/PageDown — the tab strip sits after the grid in the tab order, so this is the keyboard route between sheets. */
  onSwitchSheet: (delta: number) => void;
  /** Viewer role: grid and formula bar render read-only; every editing affordance is hidden. */
  canEdit: boolean;
}

export function SheetGrid({
  ref,
  engine,
  hfSheetId,
  sheetName,
  rowCount,
  colCount,
  frozenRows,
  frozenCols,
  version: _version,
  cellMetadata,
  columnWidths,
  ops,
  canUndo,
  canRedo,
  namedRanges,
  onAddNamedRange,
  onRemoveNamedRange,
  onSwitchSheet,
  canEdit,
}: SheetGridProps) {
  const toast = useToast();

  // Selection is an anchor + a focus corner: a plain click collapses both
  // to one cell; drag/shift-click/shift-arrow move `focus` and leave
  // `anchor` in place. The anchor is the "active cell" — the formula bar,
  // typing, and the toolbar's shown state all key off it.
  const [selectionAnchor, setSelectionAnchor] = useState<CellAddress | null>(null);
  const [selectionFocus, setSelectionFocus] = useState<CellAddress | null>(null);
  // Edit mode holds a *draft*: nothing reaches the formula engine until the
  // edit commits (Enter, Tab, blur, arrow-out). One commit = one undo step,
  // one recalculation — not one per keystroke.
  const [editing, setEditingState] = useState<EditingState | null>(null);
  // Mirrors `editing` synchronously: Enter commits and then moves focus,
  // and the blur that follows arrives *before* React re-renders — the ref
  // is what stops that blur from committing the same draft a second time.
  const editingRef = useRef<EditingState | null>(null);
  const editJustStarted = useRef(false);
  function setEditing(next: EditingState | null) {
    editingRef.current = next;
    setEditingState(next);
  }
  const [dragging, setDragging] = useState(false);
  const [fillDrag, setFillDrag] = useState<{ target: CellAddress | null } | null>(null);
  const [contextTarget, setContextTarget] = useState<ContextTarget>({ kind: 'cell' });
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const [fontColorOpen, setFontColorOpen] = useState(false);
  const [fillColorOpen, setFillColorOpen] = useState(false);
  const [insertMenuOpen, setInsertMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [listMenuOpen, setListMenuOpen] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ height: 600, width: 900 });

  const scrollerRef = useRef<HTMLDivElement>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const pendingFocus = useRef<CellAddress | null>(null);
  const suppressNextFocusSelect = useRef(false);
  const importInputRef = useRef<HTMLInputElement>(null);
  const colElRefs = useRef<Map<number, HTMLTableColElement>>(new Map());
  const resizeDrag = useRef<{ col: number; startX: number; startWidth: number } | null>(null);
  const scrollFrame = useRef<number | null>(null);
  // The cell the formula bar was opened on. Captured on focus so a commit
  // on blur lands there — clicking another cell re-renders (and moves the
  // anchor) *before* the textarea's blur fires.
  const formulaBarTarget = useRef<CellAddress | null>(null);
  // Text this grid last put on the OS clipboard. A paste whose text matches
  // it is one of our own copies, so the engine-internal clipboard (formulas,
  // translated references, formatting) is used instead of parsing text.
  const lastCopiedText = useRef<string | null>(null);

  const activeCell = selectionAnchor;
  const selectionBounds = selectionAnchor && selectionFocus ? boundsOf(selectionAnchor, selectionFocus) : null;
  const isMultiSelection =
    !!selectionBounds &&
    (selectionBounds.minRow !== selectionBounds.maxRow || selectionBounds.minCol !== selectionBounds.maxCol);
  const activeCellKey = activeCell ? cellKey(activeCell.row, activeCell.col) : null;
  const activeMetadata = activeCellKey ? cellMetadata[activeCellKey] : undefined;
  const fillPreview = fillDrag?.target && selectionBounds ? fillTargetFor(selectionBounds, fillDrag.target) : null;

  // ---------------------------------------------------------------------
  // Geometry — every row's height is known without measuring the DOM, so
  // rows are positioned by arithmetic and only the visible band is mounted.
  // ---------------------------------------------------------------------
  const rowHeights = useMemo(() => {
    const heights = new Array<number>(rowCount).fill(DEFAULT_ROW_HEIGHT_PX);
    for (const [key, meta] of Object.entries(cellMetadata)) {
      const size = meta.style?.fontSize;
      if (!size) continue;
      const match = /^[A-Z]+([0-9]+)$/.exec(key);
      if (!match) continue;
      const row = Number(match[1]) - 1;
      if (row >= 0 && row < rowCount) {
        heights[row] = Math.max(heights[row] ?? DEFAULT_ROW_HEIGHT_PX, rowHeightForFontSize(size));
      }
    }
    return heights;
  }, [cellMetadata, rowCount]);

  const rowOffsets = useMemo(() => {
    const offsets = new Array<number>(rowCount + 1);
    offsets[0] = 0;
    for (let r = 0; r < rowCount; r++) offsets[r + 1] = (offsets[r] ?? 0) + (rowHeights[r] ?? DEFAULT_ROW_HEIGHT_PX);
    return offsets;
  }, [rowHeights, rowCount]);

  function getColWidth(col: number): number {
    return columnWidths[String(col)] ?? DEFAULT_COL_WIDTH_PX;
  }

  const colLefts = useMemo(() => {
    const lefts = new Array<number>(colCount + 1);
    lefts[0] = 0;
    for (let c = 0; c < colCount; c++) lefts[c + 1] = (lefts[c] ?? 0) + (columnWidths[String(c)] ?? DEFAULT_COL_WIDTH_PX);
    return lefts;
  }, [columnWidths, colCount]);

  const columnLabels = useMemo(() => Array.from({ length: colCount }, (_, i) => colIndexToLetters(i)), [colCount]);

  const frozenRowCount = Math.min(frozenRows, Math.max(0, rowCount - 1), FROZEN_MAX);
  const frozenColCount = Math.min(frozenCols, Math.max(0, colCount - 1), FROZEN_MAX);
  const theadHeight = HEADER_HEIGHT_PX + (rowOffsets[frozenRowCount] ?? 0);
  const totalRowsHeight = rowOffsets[rowCount] ?? 0;

  const bodyStart = frozenRowCount;
  const firstVisible = Math.max(bodyStart, rowAtOffset(rowOffsets, scrollTop + theadHeight - HEADER_HEIGHT_PX) - ROW_OVERSCAN);
  const lastVisible = Math.min(rowCount - 1, rowAtOffset(rowOffsets, scrollTop + viewport.height - HEADER_HEIGHT_PX) + ROW_OVERSCAN);
  const topSpacer = Math.max(0, (rowOffsets[firstVisible] ?? 0) - (rowOffsets[bodyStart] ?? 0));
  const bottomSpacer = Math.max(0, totalRowsHeight - (rowOffsets[lastVisible + 1] ?? totalRowsHeight));

  useLayoutEffect(() => {
    function measure() {
      const el = scrollerRef.current;
      // A zero box means no layout yet (hidden tab, test DOM) — keep the
      // default window rather than collapsing to nothing.
      if (!el || el.clientHeight === 0) return;
      setViewport({ height: el.clientHeight, width: el.clientWidth });
    }
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  function handleScroll() {
    if (scrollFrame.current !== null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      const el = scrollerRef.current;
      if (el) setScrollTop(el.scrollTop);
    });
  }

  function ensureCellVisible(row: number, col: number) {
    const el = scrollerRef.current;
    if (!el) return;
    if (row >= frozenRowCount) {
      const top = HEADER_HEIGHT_PX + (rowOffsets[row] ?? 0);
      const bottom = HEADER_HEIGHT_PX + (rowOffsets[row + 1] ?? top);
      if (top < el.scrollTop + theadHeight) el.scrollTop = top - theadHeight;
      else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
    }
    if (col >= frozenColCount) {
      const frozenWidth = ROW_HEADER_WIDTH_PX + (colLefts[frozenColCount] ?? 0);
      const left = ROW_HEADER_WIDTH_PX + (colLefts[col] ?? 0);
      const right = ROW_HEADER_WIDTH_PX + (colLefts[col + 1] ?? left);
      if (left < el.scrollLeft + frozenWidth) el.scrollLeft = left - frozenWidth;
      else if (right > el.scrollLeft + el.clientWidth) el.scrollLeft = right - el.clientWidth;
    }
  }

  // Focus the cell keyboard navigation asked for once it's mounted (it may
  // have been outside the virtualized window when the move was requested).
  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    const input = inputRefs.current.get(cellKey(target.row, target.col));
    if (input) {
      pendingFocus.current = null;
      suppressNextFocusSelect.current = true;
      input.focus({ preventScroll: true });
    }
  });

  // Place the caret at the end when an edit starts by typing.
  useEffect(() => {
    if (!editing || !editJustStarted.current) return;
    editJustStarted.current = false;
    const input = inputRefs.current.get(cellKey(editing.row, editing.col));
    if (input) {
      const end = input.value.length;
      input.setSelectionRange(end, end);
    }
  }, [editing]);

  // Ends a drag regardless of where the mouse button is released.
  useEffect(() => {
    function handleGlobalMouseUp() {
      setDragging(false);
      setFillDrag((current) => {
        if (current) completeFill(current.target);
        return null;
      });
    }
    window.addEventListener('mouseup', handleGlobalMouseUp);
    return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
  });

  // ---------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------
  function clampAddress(row: number, col: number): CellAddress {
    return {
      row: Math.max(0, Math.min(rowCount - 1, row)),
      col: Math.max(0, Math.min(colCount - 1, col)),
    };
  }

  function selectCell(row: number, col: number, options?: { extend?: boolean }) {
    const address = clampAddress(row, col);
    if (options?.extend && selectionAnchor) {
      setSelectionFocus(address);
    } else {
      setSelectionAnchor(address);
      setSelectionFocus(address);
    }
  }

  function selectRange(anchor: CellAddress, focus: CellAddress) {
    setSelectionAnchor(clampAddress(anchor.row, anchor.col));
    setSelectionFocus(clampAddress(focus.row, focus.col));
  }

  /** Moves the active cell (collapsing any range) and focuses its input, scrolling it into view first. */
  function focusCell(row: number, col: number) {
    const address = clampAddress(row, col);
    selectCell(address.row, address.col);
    pendingFocus.current = address;
    ensureCellVisible(address.row, address.col);
    const input = inputRefs.current.get(cellKey(address.row, address.col));
    if (input) {
      pendingFocus.current = null;
      suppressNextFocusSelect.current = true;
      input.focus({ preventScroll: true });
    }
  }

  function extendSelection(deltaRow: number, deltaCol: number) {
    if (!selectionFocus) return;
    const next = clampAddress(selectionFocus.row + deltaRow, selectionFocus.col + deltaCol);
    setSelectionFocus(next);
    ensureCellVisible(next.row, next.col);
  }

  function getSelectedCellKeys(): string[] {
    return selectionBounds ? boundsKeys(selectionBounds) : [];
  }

  // ---------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------
  function getRawInput(row: number, col: number): string {
    const formula = engine.getCellFormula({ sheet: hfSheetId, row, col });
    if (formula !== undefined) return formula;
    const value = engine.getCellValue({ sheet: hfSheetId, row, col });
    return value === null || value === undefined ? '' : String(value);
  }

  function getDisplay(meta: CellMetadata | undefined, value: unknown): string {
    return formatCellValue(displayValue(value), meta?.fmt, value, engine, meta?.currency);
  }

  function startEditing(row: number, col: number, replaceWith?: string) {
    if (!canEdit) return;
    editJustStarted.current = true;
    setEditing({ row, col, draft: replaceWith ?? getRawInput(row, col) });
  }

  function commitEditing() {
    const current = editingRef.current;
    if (!current) return;
    setEditing(null);
    if (current.draft !== getRawInput(current.row, current.col)) {
      ops.commitCell(current.row, current.col, current.draft);
    }
  }

  function cancelEditing() {
    setEditing(null);
  }

  /** Formula-bar commit — targets the cell the bar was opened on, not whatever is active by the time blur fires. */
  function commitFromFormulaBar(value: string) {
    const target = formulaBarTarget.current ?? activeCell;
    if (!target) return;
    if (value !== getRawInput(target.row, target.col)) ops.commitCell(target.row, target.col, value);
  }

  // ---------------------------------------------------------------------
  // Clipboard — engine-internal (formulas, translated references,
  // formatting) *and* the OS clipboard (tab-separated text), so copy/paste
  // works with Excel, Google Sheets, and plain text.
  // ---------------------------------------------------------------------
  function rangeToText(bounds: CellBounds): string {
    const rows: string[][] = [];
    for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
      const line: string[] = [];
      for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
        const value = engine.getCellValue({ sheet: hfSheetId, row: r, col: c });
        line.push(getDisplay(cellMetadata[cellKey(r, c)], value));
      }
      rows.push(line);
    }
    return cellsToTsv(rows);
  }

  function copySelection(cut: boolean, clipboardData?: DataTransfer) {
    if (!selectionBounds) return;
    if (cut && !canEdit) return;
    const text = rangeToText(selectionBounds);
    ops.copyRange(selectionBounds, cut);
    lastCopiedText.current = text;
    if (clipboardData) {
      clipboardData.setData('text/plain', text);
    } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        // Clipboard permission denied — the in-app copy still works.
      });
    }
  }

  function pasteText(text: string) {
    if (!canEdit || !activeCell) return;
    if (text && text === lastCopiedText.current && ops.hasInternalClipboard()) {
      if (!ops.pasteInternal(activeCell.row, activeCell.col)) {
        toast.show({ title: 'Could not paste', message: 'That paste target is not valid for the copied content.', category: 'error' });
      }
      return;
    }
    if (!text) return;
    const rows = parseClipboardText(text);
    const clipped = ops.setValues(activeCell.row, activeCell.col, rows);
    const height = rows.length;
    const width = rows.reduce((max, r) => Math.max(max, r.length), 1);
    selectRange(activeCell, { row: activeCell.row + height - 1, col: activeCell.col + width - 1 });
    if (clipped.clippedRows > 0 || clipped.clippedCols > 0) {
      toast.show({
        title: 'Paste was cut short',
        message: `A sheet can have at most ${String(MAX_ROW_COUNT)} rows and ${String(MAX_COL_COUNT)} columns.`,
        category: 'warning',
      });
    }
  }

  function handleCopyEvent(e: ReactClipboardEvent, cut: boolean) {
    if (editing) return; // native text copy inside the cell being edited
    e.preventDefault();
    copySelection(cut, e.clipboardData);
  }

  function handlePasteEvent(e: ReactClipboardEvent) {
    if (editing) return; // native paste into the cell being edited
    e.preventDefault();
    pasteText(e.clipboardData.getData('text/plain'));
  }

  async function pasteFromMenu() {
    if (typeof navigator === 'undefined' || !navigator.clipboard?.readText) {
      toast.show({ title: 'Paste with the keyboard', message: 'Press Ctrl+V (⌘V on Mac) to paste here.', category: 'info' });
      return;
    }
    try {
      pasteText(await navigator.clipboard.readText());
    } catch {
      toast.show({ title: 'Paste with the keyboard', message: 'Press Ctrl+V (⌘V on Mac) to paste here.', category: 'info' });
    }
  }

  // ---------------------------------------------------------------------
  // Fill handle
  // ---------------------------------------------------------------------
  function completeFill(target: CellAddress | null) {
    if (!target || !selectionBounds || !canEdit) return;
    const range = fillTargetFor(selectionBounds, target);
    if (!range) return;
    ops.fill(selectionBounds, range);
    selectRange(
      { row: Math.min(selectionBounds.minRow, range.minRow), col: Math.min(selectionBounds.minCol, range.minCol) },
      { row: Math.max(selectionBounds.maxRow, range.maxRow), col: Math.max(selectionBounds.maxCol, range.maxCol) },
    );
  }

  function fillDown() {
    if (!canEdit || !selectionBounds) return;
    if (!isMultiSelection) {
      if (selectionBounds.minRow === 0) return;
      const above = { ...selectionBounds, minRow: selectionBounds.minRow - 1, maxRow: selectionBounds.minRow - 1 };
      ops.fill(above, selectionBounds);
      return;
    }
    if (selectionBounds.maxRow === selectionBounds.minRow) return;
    const source = { ...selectionBounds, maxRow: selectionBounds.minRow };
    ops.fill(source, { ...selectionBounds, minRow: selectionBounds.minRow + 1 });
  }

  // ---------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------
  function handleCellMouseDown(e: React.MouseEvent<HTMLInputElement>, row: number, col: number) {
    if (editing && (editing.row !== row || editing.col !== col)) commitEditing();
    if (e.button === 2) {
      // Right-click: keep an existing selection that contains the cell.
      const inside =
        selectionBounds &&
        row >= selectionBounds.minRow &&
        row <= selectionBounds.maxRow &&
        col >= selectionBounds.minCol &&
        col <= selectionBounds.maxCol;
      if (!inside) selectCell(row, col);
      setContextTarget({ kind: 'cell' });
      suppressNextFocusSelect.current = true;
      return;
    }
    if (editing && editing.row === row && editing.col === col) return; // caret placement inside the edit
    suppressNextFocusSelect.current = true;
    setDragging(true);
    setContextTarget({ kind: 'cell' });
    selectCell(row, col, { extend: e.shiftKey });
  }

  function handleCellMouseEnter(row: number, col: number) {
    if (fillDrag) setFillDrag({ target: { row, col } });
    else if (dragging) setSelectionFocus({ row, col });
  }

  function handleCellFocus(row: number, col: number) {
    if (suppressNextFocusSelect.current) {
      suppressNextFocusSelect.current = false;
      return;
    }
    // Reached via native Tab into the grid — collapse to the focused cell.
    selectCell(row, col);
  }

  function handleColHeaderMouseDown(e: React.MouseEvent, col: number) {
    if (editing) commitEditing();
    setContextTarget({ kind: 'col' });
    if (e.button === 2 && selectionBounds && col >= selectionBounds.minCol && col <= selectionBounds.maxCol) return;
    if (e.shiftKey && selectionAnchor) {
      selectRange({ row: 0, col: selectionAnchor.col }, { row: rowCount - 1, col });
    } else {
      selectRange({ row: 0, col }, { row: rowCount - 1, col });
    }
  }

  function handleRowHeaderMouseDown(e: React.MouseEvent, row: number) {
    if (editing) commitEditing();
    setContextTarget({ kind: 'row' });
    if (e.button === 2 && selectionBounds && row >= selectionBounds.minRow && row <= selectionBounds.maxRow) return;
    if (e.shiftKey && selectionAnchor) {
      selectRange({ row: selectionAnchor.row, col: 0 }, { row, col: colCount - 1 });
    } else {
      selectRange({ row, col: 0 }, { row, col: colCount - 1 });
    }
  }

  // ---------------------------------------------------------------------
  // Column resize
  // ---------------------------------------------------------------------
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
    const nextWidth = Math.min(MAX_COL_WIDTH_PX, Math.max(MIN_COL_WIDTH_PX, drag.startWidth + (e.clientX - drag.startX)));
    const colEl = colElRefs.current.get(drag.col);
    if (colEl) colEl.style.width = `${String(nextWidth)}px`;
  }

  function handleResizePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const drag = resizeDrag.current;
    if (!drag) return;
    resizeDrag.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    const colEl = colElRefs.current.get(drag.col);
    const finalWidth = colEl ? Math.round(parseFloat(colEl.style.width)) : drag.startWidth;
    if (Number.isFinite(finalWidth) && finalWidth !== getColWidth(drag.col)) ops.setColumnWidth(drag.col, finalWidth);
  }

  function handleResizeDoubleClick(col: number) {
    if (!canEdit) return;
    if (getColWidth(col) !== DEFAULT_COL_WIDTH_PX) ops.setColumnWidth(col, DEFAULT_COL_WIDTH_PX);
  }

  function handleResizeKeyDown(e: React.KeyboardEvent<HTMLDivElement>, col: number) {
    if (!canEdit) return;
    const step = e.shiftKey ? 32 : 8;
    let next: number | null = null;
    if (e.key === 'ArrowLeft') next = Math.max(MIN_COL_WIDTH_PX, getColWidth(col) - step);
    else if (e.key === 'ArrowRight') next = Math.min(MAX_COL_WIDTH_PX, getColWidth(col) + step);
    if (next === null) return;
    e.preventDefault();
    ops.setColumnWidth(col, next);
  }

  // ---------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------
  function visibleRowSpan(): number {
    return Math.max(1, Math.floor((viewport.height - theadHeight) / DEFAULT_ROW_HEIGHT_PX) - 1);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>, row: number, col: number) {
    const isEditingThis = !!editing && editing.row === row && editing.col === col;
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();

    if (mod && !e.altKey) {
      if (isEditingThis && (key === 'c' || key === 'x' || key === 'v' || key === 'a')) return; // native text editing
      switch (key) {
        case 'c':
          e.preventDefault();
          copySelection(false);
          return;
        case 'x':
          e.preventDefault();
          copySelection(true);
          return;
        case 'v':
          return; // let the `paste` event carry the clipboard text to us
        case 'z':
          e.preventDefault();
          if (e.shiftKey) ops.redo();
          else ops.undo();
          return;
        case 'y':
          e.preventDefault();
          ops.redo();
          return;
        case 'b':
          e.preventDefault();
          if (canEdit) ops.toggleStyle(getSelectedCellKeys(), 'bold');
          return;
        case 'i':
          e.preventDefault();
          if (canEdit) ops.toggleStyle(getSelectedCellKeys(), 'italic');
          return;
        case 'a':
          e.preventDefault();
          selectRange({ row: 0, col: 0 }, { row: rowCount - 1, col: colCount - 1 });
          return;
        case 'f':
        case 'h':
          e.preventDefault();
          setFindOpen(true);
          return;
        case 'd':
          e.preventDefault();
          fillDown();
          return;
        case 'home':
          e.preventDefault();
          if (isEditingThis) commitEditing();
          focusCell(0, 0);
          return;
        case 'end':
          e.preventDefault();
          if (isEditingThis) commitEditing();
          focusCell(rowCount - 1, colCount - 1);
          return;
        case 'pageup':
          e.preventDefault();
          if (isEditingThis) commitEditing();
          onSwitchSheet(-1);
          return;
        case 'pagedown':
          e.preventDefault();
          if (isEditingThis) commitEditing();
          onSwitchSheet(1);
          return;
        case 'arrowup':
        case 'arrowdown':
        case 'arrowleft':
        case 'arrowright': {
          if (isEditingThis) return;
          e.preventDefault();
          const target =
            key === 'arrowup'
              ? { row: 0, col }
              : key === 'arrowdown'
                ? { row: rowCount - 1, col }
                : key === 'arrowleft'
                  ? { row, col: 0 }
                  : { row, col: colCount - 1 };
          if (e.shiftKey) {
            setSelectionFocus(target);
            ensureCellVisible(target.row, target.col);
          } else focusCell(target.row, target.col);
          return;
        }
        default:
          break;
      }
    }

    if (!isEditingThis) {
      if (e.key === 'F2' && canEdit) {
        e.preventDefault();
        startEditing(row, col);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) {
        e.preventDefault();
        if (selectionBounds) ops.clearValues(selectionBounds);
        return;
      }
      if (e.key === 'Escape') {
        setFillDrag(null);
        return;
      }
      if (canEdit && e.key.length === 1 && !mod && !e.altKey) {
        // Typing onto a selected cell replaces its content (Excel/Sheets).
        e.preventDefault();
        startEditing(row, col, e.key);
        return;
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelEditing();
      return;
    }

    const input = e.currentTarget;
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        if (isEditingThis) commitEditing();
        focusCell(row + (e.shiftKey ? -1 : 1), col);
        break;
      case 'Tab': {
        const atEdge = e.shiftKey ? col === 0 : col === colCount - 1;
        if (atEdge) {
          // Let native Tab carry focus out of the grid at the edges.
          if (isEditingThis) commitEditing();
          return;
        }
        e.preventDefault();
        if (isEditingThis) commitEditing();
        focusCell(row, col + (e.shiftKey ? -1 : 1));
        break;
      }
      case 'ArrowUp':
        e.preventDefault();
        if (isEditingThis) commitEditing();
        if (e.shiftKey) extendSelection(-1, 0);
        else focusCell(row - 1, col);
        break;
      case 'ArrowDown':
        e.preventDefault();
        if (isEditingThis) commitEditing();
        if (e.shiftKey) extendSelection(1, 0);
        else focusCell(row + 1, col);
        break;
      case 'ArrowLeft':
        if (e.shiftKey && !isEditingThis) {
          e.preventDefault();
          extendSelection(0, -1);
        } else if (!isEditingThis || input.selectionStart === 0) {
          e.preventDefault();
          if (isEditingThis) commitEditing();
          focusCell(row, col - 1);
        }
        break;
      case 'ArrowRight':
        if (e.shiftKey && !isEditingThis) {
          e.preventDefault();
          extendSelection(0, 1);
        } else if (!isEditingThis || input.selectionStart === input.value.length) {
          e.preventDefault();
          if (isEditingThis) commitEditing();
          focusCell(row, col + 1);
        }
        break;
      case 'Home':
        if (isEditingThis) return;
        e.preventDefault();
        if (e.shiftKey) extendSelection(0, -colCount);
        else focusCell(row, 0);
        break;
      case 'End':
        if (isEditingThis) return;
        e.preventDefault();
        if (e.shiftKey) extendSelection(0, colCount);
        else focusCell(row, colCount - 1);
        break;
      case 'PageUp':
        e.preventDefault();
        if (isEditingThis) commitEditing();
        if (e.shiftKey) extendSelection(-visibleRowSpan(), 0);
        else focusCell(row - visibleRowSpan(), col);
        break;
      case 'PageDown':
        e.preventDefault();
        if (isEditingThis) commitEditing();
        if (e.shiftKey) extendSelection(visibleRowSpan(), 0);
        else focusCell(row + visibleRowSpan(), col);
        break;
      default:
        break;
    }
  }

  /** Keys that arrive on the scroller itself — focus falls back here when the active cell's input scrolls out of the virtual window and unmounts. */
  function handleScrollerKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget || !activeCell) return;
    const navKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', 'Home', 'End', 'PageUp', 'PageDown'];
    if (navKeys.includes(e.key) || e.key.length === 1) {
      e.preventDefault();
      focusCell(activeCell.row, activeCell.col);
    }
  }

  // ---------------------------------------------------------------------
  // Find & replace
  // ---------------------------------------------------------------------
  function cellMatches(row: number, col: number, query: string, matchCase: boolean): boolean {
    const value = engine.getCellValue({ sheet: hfSheetId, row, col });
    if (value === null || value === undefined) return false;
    const text = displayValue(value);
    const raw = getRawInput(row, col);
    if (matchCase) return text.includes(query) || raw.includes(query);
    const q = query.toLowerCase();
    return text.toLowerCase().includes(q) || raw.toLowerCase().includes(q);
  }

  function findNext(query: string, matchCase: boolean): boolean {
    if (!query) return false;
    const total = rowCount * colCount;
    const start = activeCell ? activeCell.row * colCount + activeCell.col : -1;
    for (let step = 1; step <= total; step++) {
      const index = (start + step) % total;
      const row = Math.floor(index / colCount);
      const col = index % colCount;
      if (cellMatches(row, col, query, matchCase)) {
        focusCell(row, col);
        return true;
      }
    }
    return false;
  }

  function replaceIn(raw: string, query: string, replacement: string, matchCase: boolean): string {
    if (matchCase) return raw.split(query).join(replacement);
    const re = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    return raw.replace(re, replacement);
  }

  function replaceCurrent(query: string, replacement: string, matchCase: boolean): boolean {
    if (!canEdit || !query || !activeCell) return false;
    if (cellMatches(activeCell.row, activeCell.col, query, matchCase)) {
      const raw = getRawInput(activeCell.row, activeCell.col);
      const next = replaceIn(raw, query, replacement, matchCase);
      if (next !== raw) ops.commitCell(activeCell.row, activeCell.col, next);
    }
    return findNext(query, matchCase);
  }

  function replaceAll(query: string, replacement: string, matchCase: boolean): number {
    if (!canEdit || !query) return 0;
    let count = 0;
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < colCount; col++) {
        if (!cellMatches(row, col, query, matchCase)) continue;
        const raw = getRawInput(row, col);
        const next = replaceIn(raw, query, replacement, matchCase);
        if (next !== raw) {
          ops.commitCell(row, col, next);
          count += 1;
        }
      }
    }
    return count;
  }

  // ---------------------------------------------------------------------
  // Import / export
  // ---------------------------------------------------------------------
  function handleExportCsv() {
    // Unformatted computed values — a re-import gets numbers back as
    // numbers, not "$1,234.00" strings.
    const rows: string[][] = [];
    for (let row = 0; row < rowCount; row++) {
      const line: string[] = [];
      for (let col = 0; col < colCount; col++) line.push(displayValue(engine.getCellValue({ sheet: hfSheetId, row, col })));
      rows.push(line);
    }
    while (rows.length > 0 && rows[rows.length - 1]?.every((v) => v === '')) rows.pop();
    downloadCsv(`${sheetName.replace(/[\\/:*?"<>|]/g, '_')}.csv`, cellsToCsv(rows));
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
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) {
        toast.show({ title: 'Nothing to import', message: `${file.name} has no rows.`, category: 'error' });
        return;
      }
      const result = ops.importCsv(parsed);
      toast.show({
        title: 'CSV imported',
        message: `Replaced ${sheetName} with ${String(result.importedRows)} row${result.importedRows === 1 ? '' : 's'} from ${file.name}.${result.clipped ? ' Some rows or columns beyond the size limit were skipped.' : ''}`,
        category: result.clipped ? 'warning' : 'success',
      });
    } catch {
      toast.show({ title: 'Could not import file', message: `${file.name} could not be read as CSV.`, category: 'error' });
    } finally {
      setImporting(false);
      setPendingImportFile(null);
    }
  }

  useImperativeHandle(ref, () => ({
    exportCsv: handleExportCsv,
    triggerImport: () => importInputRef.current?.click(),
  }));

  // ---------------------------------------------------------------------
  // Menus
  // ---------------------------------------------------------------------
  const selRows = selectionBounds ? selectionBounds.maxRow - selectionBounds.minRow + 1 : 0;
  const selCols = selectionBounds ? selectionBounds.maxCol - selectionBounds.minCol + 1 : 0;
  const plural = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? '' : 's'}`;

  const rowItems: MenuEntry[] = selectionBounds
    ? [
        { label: selRows > 1 ? `Insert ${plural(selRows, 'row')} above` : 'Insert row above', icon: 'plus', onSelect: () => ops.insertRows(selectionBounds.minRow, selRows) },
        { label: selRows > 1 ? `Insert ${plural(selRows, 'row')} below` : 'Insert row below', icon: 'plus', onSelect: () => ops.insertRows(selectionBounds.maxRow + 1, selRows) },
        { label: selRows > 1 ? `Delete ${plural(selRows, 'row')}` : `Delete row ${String(selectionBounds.minRow + 1)}`, icon: 'trash-2', destructive: true, disabled: rowCount <= selRows, onSelect: () => ops.deleteRows(selectionBounds.minRow, selRows) },
      ]
    : [];
  const colItems: MenuEntry[] = selectionBounds
    ? [
        { label: selCols > 1 ? `Insert ${plural(selCols, 'column')} left` : 'Insert column left', icon: 'plus', onSelect: () => ops.insertColumns(selectionBounds.minCol, selCols) },
        { label: selCols > 1 ? `Insert ${plural(selCols, 'column')} right` : 'Insert column right', icon: 'plus', onSelect: () => ops.insertColumns(selectionBounds.maxCol + 1, selCols) },
        { label: selCols > 1 ? `Delete ${plural(selCols, 'column')}` : `Delete column ${colIndexToLetters(selectionBounds.minCol)}`, icon: 'trash-2', destructive: true, disabled: colCount <= selCols, onSelect: () => ops.deleteColumns(selectionBounds.minCol, selCols) },
      ]
    : [];
  const sortItems: MenuEntry[] = selectionBounds
    ? [
        { label: `Sort sheet by ${colIndexToLetters(selectionBounds.minCol)}, A → Z`, icon: 'list-ordered', onSelect: () => ops.sortByColumn(selectionBounds.minCol, 'asc') },
        { label: `Sort sheet by ${colIndexToLetters(selectionBounds.minCol)}, Z → A`, icon: 'list-ordered', onSelect: () => ops.sortByColumn(selectionBounds.minCol, 'desc') },
      ]
    : [];

  const clipboardItems: MenuEntry[] = [
    { label: 'Cut', icon: 'copy', disabled: !canEdit, onSelect: () => copySelection(true) },
    { label: 'Copy', icon: 'copy', onSelect: () => copySelection(false) },
    { label: 'Paste', icon: 'copy', disabled: !canEdit, onSelect: () => void pasteFromMenu() },
  ];

  const contextItems: MenuEntry[] = !selectionBounds
    ? []
    : contextTarget.kind === 'col'
      ? canEdit
        ? [...colItems, { type: 'separator' }, ...sortItems, { type: 'separator' }, { label: 'Reset column width', onSelect: () => handleResizeDoubleClick(selectionBounds.minCol) }]
        : [{ label: 'Copy', icon: 'copy', onSelect: () => copySelection(false) }]
      : contextTarget.kind === 'row'
        ? canEdit
          ? rowItems
          : [{ label: 'Copy', icon: 'copy', onSelect: () => copySelection(false) }]
        : canEdit
          ? [
              ...clipboardItems,
              { type: 'separator' },
              ...rowItems,
              { type: 'separator' },
              ...colItems,
              { type: 'separator' },
              { label: 'Clear contents', icon: 'x', onSelect: () => ops.clearValues(selectionBounds) },
            ]
          : [{ label: 'Copy', icon: 'copy', onSelect: () => copySelection(false) }];

  const insertItems: MenuEntry[] = [
    ...rowItems,
    { type: 'separator' },
    ...colItems,
    { type: 'separator' },
    { label: `Add ${String(ROW_GROWTH_STEP)} rows at the end`, icon: 'plus', disabled: rowCount >= MAX_ROW_COUNT, onSelect: () => ops.appendRows(ROW_GROWTH_STEP) },
    { label: `Add ${String(COL_GROWTH_STEP)} columns at the end`, icon: 'plus', disabled: colCount >= MAX_COL_COUNT, onSelect: () => ops.appendColumns(COL_GROWTH_STEP) },
  ];

  const viewItems: MenuEntry[] = [
    ...(activeCell
      ? [
          {
            label: `Freeze rows up to ${String(activeCell.row + 1)}`,
            icon: 'pin' as const,
            disabled: !canEdit || activeCell.row + 1 > FROZEN_MAX || activeCell.row + 1 >= rowCount,
            onSelect: () => ops.setFrozen(activeCell.row + 1, frozenColCount),
          },
          {
            label: `Freeze columns up to ${colIndexToLetters(activeCell.col)}`,
            icon: 'pin' as const,
            disabled: !canEdit || activeCell.col + 1 > FROZEN_MAX || activeCell.col + 1 >= colCount,
            onSelect: () => ops.setFrozen(frozenRowCount, activeCell.col + 1),
          },
        ]
      : []),
    { label: 'Unfreeze rows', disabled: !canEdit || frozenRowCount === 0, onSelect: () => ops.setFrozen(0, frozenColCount) },
    { label: 'Unfreeze columns', disabled: !canEdit || frozenColCount === 0, onSelect: () => ops.setFrozen(frozenRowCount, 0) },
    { type: 'separator' },
    { label: 'Find and replace…', icon: 'search', onSelect: () => setFindOpen(true) },
  ];

  const listRule = activeMetadata?.validation?.type === 'list' ? activeMetadata.validation : null;
  const listItems: MenuEntry[] =
    listRule && activeCell
      ? listRule.values.map((value) => ({
          label: value,
          onSelect: () => ops.commitCell(activeCell.row, activeCell.col, value),
        }))
      : [];

  const selectionRule = selectionBounds
    ? (() => {
        const keys = boundsKeys(selectionBounds);
        const first = cellMetadata[keys[0] ?? '']?.validation;
        return keys.every((key) => validationRulesEqual(cellMetadata[key]?.validation, first)) ? first : undefined;
      })()
    : undefined;

  const financeHint = (() => {
    if (!activeCell) return undefined;
    const pairs = extractFinancePairs(getRawInput(activeCell.row, activeCell.col));
    const first = pairs[0];
    if (!first) return undefined;
    const cached = getCachedRate(first.base, first.quote);
    if (!cached) return 'Loading exchange rate…';
    const date = new Date(cached.asOf * 1000).toISOString().slice(0, 10);
    return `${first.base}/${first.quote} rate as of ${date} (ECB reference rate via Frankfurter)`;
  })();

  // ---------------------------------------------------------------------
  // Render helpers
  // ---------------------------------------------------------------------
  function renderCell(row: number, col: number, frozenRowTop: number | null) {
    const key = cellKey(row, col);
    const isEditingThis = !!editing && editing.row === row && editing.col === col;
    const meta = cellMetadata[key];
    const value = engine.getCellValue({ sheet: hfSheetId, row, col });
    const valid = isCellValueValid(value, meta?.validation);
    const isActive = !!activeCell && activeCell.row === row && activeCell.col === col;
    const inSelection =
      !!selectionBounds &&
      row >= selectionBounds.minRow &&
      row <= selectionBounds.maxRow &&
      col >= selectionBounds.minCol &&
      col <= selectionBounds.maxCol;
    const inFill =
      !!fillPreview && row >= fillPreview.minRow && row <= fillPreview.maxRow && col >= fillPreview.minCol && col <= fillPreview.maxCol;
    const isFrozenCol = col < frozenColCount;
    const align: CellAlign = meta?.style?.align ?? (typeof value === 'number' ? 'right' : 'left');
    const height = rowHeights[row] ?? DEFAULT_ROW_HEIGHT_PX;

    const cellClassName = [
      styles.cell,
      isFrozenCol && styles.frozenCol,
      frozenRowTop !== null && styles.frozenRow,
      inSelection && isMultiSelection && styles.cellSelected,
      inSelection && isMultiSelection && selectionBounds?.minRow === row && styles.edgeTop,
      inSelection && isMultiSelection && selectionBounds?.maxRow === row && styles.edgeBottom,
      inSelection && isMultiSelection && selectionBounds?.minCol === col && styles.edgeLeft,
      inSelection && isMultiSelection && selectionBounds?.maxCol === col && styles.edgeRight,
      inFill && styles.fillPreview,
    ]
      .filter(Boolean)
      .join(' ');
    const inputClassName = [
      styles.cellInput,
      meta?.style?.bold && styles.cellInputBold,
      meta?.style?.italic && styles.cellInputItalic,
      !valid && styles.invalid,
      isEditingThis && styles.cellInputEditing,
    ]
      .filter(Boolean)
      .join(' ');

    const cellStyle: React.CSSProperties = {};
    if (isFrozenCol) cellStyle.left = ROW_HEADER_WIDTH_PX + (colLefts[col] ?? 0);
    if (frozenRowTop !== null) cellStyle.top = frozenRowTop;

    const showHandle = canEdit && !!selectionBounds && selectionBounds.maxRow === row && selectionBounds.maxCol === col && !editing;
    const showList = canEdit && isActive && !!listRule && !isEditingThis;

    return (
      <td key={key} className={cellClassName} style={cellStyle}>
        <input
          ref={(el) => {
            if (el) inputRefs.current.set(key, el);
            else inputRefs.current.delete(key);
          }}
          className={inputClassName}
          style={{
            color: meta?.style?.color,
            backgroundColor: meta?.style?.bg,
            fontSize: meta?.style?.fontSize ? `${String(meta.style.fontSize)}px` : undefined,
            height,
            textAlign: align,
          }}
          value={isEditingThis ? editing.draft : getDisplay(meta, value)}
          readOnly={!isEditingThis}
          tabIndex={isActive || (!activeCell && row === 0 && col === 0) ? 0 : -1}
          onMouseDown={(e) => handleCellMouseDown(e, row, col)}
          onMouseEnter={() => handleCellMouseEnter(row, col)}
          onFocus={() => handleCellFocus(row, col)}
          onBlur={() => {
            const current = editingRef.current;
            if (current && current.row === row && current.col === col) commitEditing();
          }}
          onDoubleClick={() => startEditing(row, col)}
          onChange={(e) => {
            if (isEditingThis) setEditing({ row, col, draft: e.target.value });
          }}
          onKeyDown={(e) => handleKeyDown(e, row, col)}
          aria-label={key}
          aria-invalid={!valid || undefined}
        />
        {showList && (
          <Menu
            aria-label="Choose a value"
            open={listMenuOpen}
            onClose={() => setListMenuOpen(false)}
            align="right"
            trigger={
              <button
                type="button"
                className={styles.listTrigger}
                aria-label="Choose a value"
                aria-haspopup="menu"
                aria-expanded={listMenuOpen}
                tabIndex={-1}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={() => setListMenuOpen((v) => !v)}
              >
                <Icon name="chevron-down" size="sm" aria-hidden />
              </button>
            }
            items={listItems}
          />
        )}
        {showHandle && (
          <div
            className={styles.fillHandle}
            aria-hidden="true"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setFillDrag({ target: null });
            }}
          />
        )}
      </td>
    );
  }

  function renderRow(row: number, frozenRowTop: number | null) {
    const height = rowHeights[row] ?? DEFAULT_ROW_HEIGHT_PX;
    const rowSelected = !!selectionBounds && row >= selectionBounds.minRow && row <= selectionBounds.maxRow;
    const headerStyle: React.CSSProperties = { height };
    if (frozenRowTop !== null) headerStyle.top = frozenRowTop;
    return (
      <tr key={row}>
        <th
          className={[styles.rowHeader, rowSelected && styles.headerSelected, frozenRowTop !== null && styles.frozenRow].filter(Boolean).join(' ')}
          style={headerStyle}
          onMouseDown={(e) => handleRowHeaderMouseDown(e, row)}
        >
          {row + 1}
        </th>
        {columnLabels.map((_, col) => renderCell(row, col, frozenRowTop))}
      </tr>
    );
  }

  const bodyRows: React.ReactNode[] = [];
  for (let row = firstVisible; row <= lastVisible; row++) bodyRows.push(renderRow(row, null));

  const frozenRowsNodes: React.ReactNode[] = [];
  for (let row = 0; row < frozenRowCount; row++) {
    frozenRowsNodes.push(renderRow(row, HEADER_HEIGHT_PX + (rowOffsets[row] ?? 0)));
  }

  const scrollerClassName = [styles.scroller, dragging && styles.dragging, fillDrag && styles.filling].filter(Boolean).join(' ');

  return (
    <div className={styles.wrapper}>
      <FormulaBar
        cellLabel={selectionBounds ? rangeLabel(selectionBounds.minRow, selectionBounds.minCol, selectionBounds.maxRow, selectionBounds.maxCol) : ''}
        value={activeCell ? (editing && editing.row === activeCell.row && editing.col === activeCell.col ? editing.draft : getRawInput(activeCell.row, activeCell.col)) : ''}
        disabled={!activeCell}
        readOnly={!canEdit}
        hint={financeHint}
        onFocus={() => {
          formulaBarTarget.current = activeCell;
        }}
        onCommit={commitFromFormulaBar}
      />

      <div className={styles.toolbar} role="toolbar" aria-label="Sheet actions">
        {canEdit && (
          <>
            <Tooltip content="Undo (Ctrl+Z)">
              <button type="button" className={styles.toolbarIconButton} aria-label="Undo" disabled={!canUndo} onClick={ops.undo}>
                <Icon name="rotate-ccw" size="sm" aria-hidden />
              </button>
            </Tooltip>
            <Tooltip content="Redo (Ctrl+Y)">
              <button type="button" className={styles.toolbarIconButton} aria-label="Redo" disabled={!canRedo} onClick={ops.redo}>
                <Icon name="rotate-cw" size="sm" aria-hidden />
              </button>
            </Tooltip>
            <div className={styles.divider} aria-hidden="true" />
          </>
        )}
        <Select
          size="sm"
          className={styles.formatSelect}
          value={activeMetadata?.fmt ?? 'plain'}
          onChange={(e) => ops.setFormat(getSelectedCellKeys(), e.target.value as CellFormat)}
          disabled={!activeCell || !canEdit}
          aria-label="Number format"
        >
          {CELL_FORMATS.map((fmt) => (
            <option key={fmt} value={fmt}>
              {FORMAT_LABELS[fmt]}
            </option>
          ))}
        </Select>
        {activeMetadata?.fmt === 'currency' && (
          <Select
            size="sm"
            className={styles.currencySelect}
            value={activeMetadata.currency ?? DEFAULT_CURRENCY}
            onChange={(e) => ops.setCurrency(getSelectedCellKeys(), e.target.value)}
            disabled={!canEdit}
            aria-label="Currency"
          >
            {CELL_CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </Select>
        )}
        <Select
          size="sm"
          className={styles.fontSizeSelect}
          value={activeMetadata?.style?.fontSize ? String(activeMetadata.style.fontSize) : 'default'}
          onChange={(e) => ops.setFontSize(getSelectedCellKeys(), e.target.value === 'default' ? null : Number(e.target.value))}
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
        <Select
          size="sm"
          className={styles.alignSelect}
          value={activeMetadata?.style?.align ?? ALIGN_AUTO}
          onChange={(e) => ops.setAlign(getSelectedCellKeys(), e.target.value === ALIGN_AUTO ? null : (e.target.value as CellAlign))}
          disabled={!activeCell || !canEdit}
          aria-label="Text alignment"
        >
          <option value={ALIGN_AUTO}>Align: auto</option>
          <option value="left">Align: left</option>
          <option value="center">Align: center</option>
          <option value="right">Align: right</option>
        </Select>
        <Tooltip content="Bold (Ctrl+B)">
          <button
            type="button"
            className={activeMetadata?.style?.bold ? `${styles.toolbarIconButton} ${styles.toolbarIconButtonActive}` : styles.toolbarIconButton}
            aria-pressed={activeMetadata?.style?.bold ?? false}
            aria-label="Bold"
            disabled={!activeCell || !canEdit}
            onClick={() => ops.toggleStyle(getSelectedCellKeys(), 'bold')}
          >
            <Icon name="bold" size="sm" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip content="Italic (Ctrl+I)">
          <button
            type="button"
            className={activeMetadata?.style?.italic ? `${styles.toolbarIconButton} ${styles.toolbarIconButtonActive}` : styles.toolbarIconButton}
            aria-pressed={activeMetadata?.style?.italic ?? false}
            aria-label="Italic"
            disabled={!activeCell || !canEdit}
            onClick={() => ops.toggleStyle(getSelectedCellKeys(), 'italic')}
          >
            <Icon name="italic" size="sm" aria-hidden />
          </button>
        </Tooltip>
        <Popover
          open={fontColorOpen}
          onClose={() => setFontColorOpen(false)}
          width={244}
          aria-label="Font color picker"
          trigger={
            <button type="button" className={styles.toolbarIconButton} aria-label="Font color" disabled={!activeCell || !canEdit} onClick={() => setFontColorOpen((v) => !v)}>
              <span className={styles.colorTrigger}>
                A
                <span
                  className={styles.colorTriggerBar}
                  style={{ backgroundColor: activeMetadata?.style?.color ?? 'var(--sv-color-text-primary)', borderColor: activeMetadata?.style?.color }}
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
              onChange={(value) => ops.setColor(getSelectedCellKeys(), 'color', value)}
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
            <button type="button" className={styles.toolbarIconButton} aria-label="Fill color" disabled={!activeCell || !canEdit} onClick={() => setFillColorOpen((v) => !v)}>
              <span className={styles.fillTrigger}>
                <Icon name="paint-bucket" size="sm" aria-hidden />
                <span className={styles.fillTriggerBar} style={{ backgroundColor: activeMetadata?.style?.bg ?? 'transparent', borderColor: activeMetadata?.style?.bg }} aria-hidden="true" />
              </span>
            </button>
          }
        >
          <div className={styles.colorPickerPanel}>
            <ColorPicker
              swatches={CELL_COLOR_SWATCHES}
              value={activeMetadata?.style?.bg ?? null}
              onChange={(value) => ops.setColor(getSelectedCellKeys(), 'bg', value)}
              onSelectionComplete={() => setFillColorOpen(false)}
              allowNone
              noneLabel="No fill"
              aria-label="Fill color"
            />
          </div>
        </Popover>
        <Button variant="ghost" size="sm" disabled={!activeCell || !canEdit} onClick={() => setValidationDialogOpen(true)}>
          Validation
        </Button>
        <div className={styles.divider} aria-hidden="true" />
        <NamedRangesButton ranges={namedRanges} canEdit={canEdit} onAdd={onAddNamedRange} onRemove={onRemoveNamedRange} />
        <div className={styles.toolbarSpacer} />
        <Tooltip content="Find and replace (Ctrl+F)">
          <button type="button" className={styles.toolbarIconButton} aria-label="Find and replace" onClick={() => setFindOpen(true)}>
            <Icon name="search" size="sm" aria-hidden />
          </button>
        </Tooltip>
        {canEdit && (
          <Menu
            aria-label="Insert"
            open={insertMenuOpen}
            onClose={() => setInsertMenuOpen(false)}
            align="right"
            trigger={
              <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={insertMenuOpen} disabled={!selectionBounds} onClick={() => setInsertMenuOpen((v) => !v)}>
                Insert
                <Icon name="chevron-down" size="sm" aria-hidden />
              </Button>
            }
            items={insertItems}
          />
        )}
        <Menu
          aria-label="View"
          open={viewMenuOpen}
          onClose={() => setViewMenuOpen(false)}
          align="right"
          trigger={
            <Button variant="ghost" size="sm" aria-haspopup="menu" aria-expanded={viewMenuOpen} onClick={() => setViewMenuOpen((v) => !v)}>
              View
              <Icon name="chevron-down" size="sm" aria-hidden />
            </Button>
          }
          items={viewItems}
        />
      </div>

      {canEdit && (
        <input ref={importInputRef} type="file" accept=".csv,text/csv" className={styles.hiddenFileInput} onChange={handleImportFileChange} aria-label="Import CSV file" />
      )}

      <FindReplacePopover
        open={findOpen}
        onClose={() => setFindOpen(false)}
        canReplace={canEdit}
        onFindNext={findNext}
        onReplace={replaceCurrent}
        onReplaceAll={replaceAll}
      />

      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- not a control: the scroll container catches clipboard events bubbling from the focused cell input (so copy/paste work while a read-only cell is focused) and takes focus only as a fallback when the active cell scrolls out of the virtualized window and unmounts; every interaction is routed back to the cell inputs, which are the real interactive elements. */}
      <div
        ref={scrollerRef}
        className={scrollerClassName}
        onScroll={handleScroll}
        onCopy={(e) => handleCopyEvent(e, false)}
        onCut={(e) => handleCopyEvent(e, true)}
        onPaste={handlePasteEvent}
        onKeyDown={handleScrollerKeyDown}
        tabIndex={-1}
      >
        <ContextMenu items={contextItems} aria-label="Cell actions">
          <table className={styles.grid} style={{ width: ROW_HEADER_WIDTH_PX + (colLefts[colCount] ?? 0) }}>
            <colgroup>
              <col className={styles.rowHeaderCol} style={{ width: ROW_HEADER_WIDTH_PX }} />
              {columnLabels.map((_, col) => (
                <col
                  key={col}
                  ref={(el) => {
                    if (el) colElRefs.current.set(col, el);
                    else colElRefs.current.delete(col);
                  }}
                  style={{ width: `${String(getColWidth(col))}px` }}
                />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th className={styles.cornerHeader} style={{ height: HEADER_HEIGHT_PX }} aria-label="Select all" onMouseDown={() => selectRange({ row: 0, col: 0 }, { row: rowCount - 1, col: colCount - 1 })} />
                {columnLabels.map((label, col) => {
                  const colSelected = !!selectionBounds && col >= selectionBounds.minCol && col <= selectionBounds.maxCol;
                  const isFrozenCol = col < frozenColCount;
                  const headerStyle: React.CSSProperties = { height: HEADER_HEIGHT_PX };
                  if (isFrozenCol) headerStyle.left = ROW_HEADER_WIDTH_PX + (colLefts[col] ?? 0);
                  return (
                    <th
                      key={label}
                      className={[styles.colHeader, colSelected && styles.headerSelected, isFrozenCol && styles.frozenCol].filter(Boolean).join(' ')}
                      style={headerStyle}
                      onMouseDown={(e) => handleColHeaderMouseDown(e, col)}
                    >
                      {label}
                      {canEdit && (
                        /* eslint-disable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex -- WAI-ARIA "window splitter" pattern: a focusable, keyboard-operable separator is the documented exception to role="separator" being non-interactive (https://www.w3.org/WAI/ARIA/apg/patterns/windowsplitter/), same as packages/ui's Resizable component. */
                        <div
                          className={styles.resizeHandle}
                          role="separator"
                          aria-orientation="vertical"
                          aria-label={`Resize column ${label}`}
                          tabIndex={0}
                          onMouseDown={(e) => e.stopPropagation()}
                          onPointerDown={(e) => handleResizePointerDown(e, col)}
                          onPointerMove={handleResizePointerMove}
                          onPointerUp={handleResizePointerUp}
                          onDoubleClick={() => handleResizeDoubleClick(col)}
                          onKeyDown={(e) => handleResizeKeyDown(e, col)}
                        />
                        /* eslint-enable jsx-a11y/no-noninteractive-element-interactions, jsx-a11y/no-noninteractive-tabindex */
                      )}
                    </th>
                  );
                })}
              </tr>
              {frozenRowsNodes}
            </thead>
            <tbody>
              {topSpacer > 0 && (
                <tr aria-hidden="true" className={styles.spacer} style={{ height: topSpacer }}>
                  <td colSpan={colCount + 1} style={{ height: topSpacer }} />
                </tr>
              )}
              {bodyRows}
              {bottomSpacer > 0 && (
                <tr aria-hidden="true" className={styles.spacer} style={{ height: bottomSpacer }}>
                  <td colSpan={colCount + 1} style={{ height: bottomSpacer }} />
                </tr>
              )}
            </tbody>
          </table>
        </ContextMenu>
      </div>

      <ConfirmDialog
        open={pendingImportFile !== null}
        onClose={() => setPendingImportFile(null)}
        title="Import CSV"
        message={
          <>
            Import <strong>{pendingImportFile?.name}</strong> into <strong>{sheetName}</strong>? This replaces every value in this sheet and can&apos;t be undone.
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
        rangeLabel={selectionBounds ? rangeLabel(selectionBounds.minRow, selectionBounds.minCol, selectionBounds.maxRow, selectionBounds.maxCol) : ''}
        cellCount={selectionBounds ? selRows * selCols : 0}
        currentRule={selectionRule}
        onSave={(rule: DataValidationRule | undefined) => ops.setValidation(getSelectedCellKeys(), rule)}
      />
    </div>
  );
}
