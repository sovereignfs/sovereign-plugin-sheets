'use client';

import { useMemo, useRef, useState } from 'react';
import type { HyperFormula } from 'hyperformula';
import {
  Button,
  ConfirmDialog,
  Select,
  StatusBadge,
  useToast,
  type StatusBadgeStatus,
} from '@sovereignfs/ui';
import { resizeSheetAction, saveSheetCellsAction } from '../actions';
import { cellKey, colIndexToLetters } from '../_lib/a1';
import {
  CELL_FORMATS,
  mergeCellMetadata,
  serializeCellsJson,
  type CellFormat,
  type CellMetadata,
  type CellStyle,
  type DataValidationRule,
} from '../_lib/cells';
import { MAX_IMPORT_COL_COUNT, MAX_IMPORT_ROW_COUNT } from '../_lib/config';
import { cellsToCsv, downloadCsv, parseCsv } from '../_lib/csv';
import { displayValue, gridToCellsMap } from '../_lib/formula-engine';
import { formatCellValue } from '../_lib/format';
import { isCellValueValid } from '../_lib/validation';
import { CellValidationDialog } from './CellValidationDialog';
import { FormulaBar } from './FormulaBar';
import styles from './SheetGrid.module.css';

const AUTOSAVE_DELAY_MS = 1200;
const FORMAT_LABELS: Record<CellFormat, string> = {
  plain: 'Plain',
  number: 'Number',
  currency: 'Currency',
  date: 'Date',
};

export function SheetGrid({
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
  cellMetadata,
  onFormatChange,
  onToggleStyle,
  onValidationChange,
  canEdit,
}: {
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
  /** Per-cell format/style/validation overrides for the active sheet, keyed by A1 cell key. */
  cellMetadata: Record<string, CellMetadata>;
  onFormatChange: (cellKey: string, fmt: CellFormat) => void;
  onToggleStyle: (cellKey: string, styleKey: keyof CellStyle) => void;
  onValidationChange: (cellKey: string, rule: DataValidationRule | undefined) => void;
  /** Viewer role: grid and formula bar render read-only, no autosave, no fill-down, no import, no format/style/validation changes. */
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<StatusBadgeStatus>('synced');
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [validationDialogOpen, setValidationDialogOpen] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const importInputRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

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
    setStatus('draft');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const grid = engine.getSheetSerialized(hfSheetId);
      const cells = mergeCellMetadata(gridToCellsMap(grid), cellMetadata);
      void saveSheetCellsAction(workbookId, sheetId, serializeCellsJson(cells))
        .then(() => setStatus('synced'))
        .catch(() => {
          setStatus('error');
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
    if (canEdit && (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
      // Fill down: copy this cell's raw input into the cell below.
      e.preventDefault();
      const raw = getRawInput(row, col);
      commitCell(row + 1, col, raw);
      focusCell(row + 1, col);
      return;
    }
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        focusCell(row + (e.shiftKey ? -1 : 1), col);
        break;
      case 'ArrowUp':
        e.preventDefault();
        focusCell(row - 1, col);
        break;
      case 'ArrowDown':
        e.preventDefault();
        focusCell(row + 1, col);
        break;
      case 'ArrowLeft':
        if ((e.target as HTMLInputElement).selectionStart === 0) {
          e.preventDefault();
          focusCell(row, col - 1);
        }
        break;
      case 'ArrowRight': {
        const input = e.target as HTMLInputElement;
        if (input.selectionStart === input.value.length) {
          e.preventDefault();
          focusCell(row, col + 1);
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
      const nextRowCount = Math.min(Math.max(rowCount, importedRowCount), MAX_IMPORT_ROW_COUNT);
      const nextColCount = Math.min(Math.max(colCount, importedColCount), MAX_IMPORT_COL_COUNT);

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

  return (
    <div className={styles.wrapper}>
      <FormulaBar
        cellLabel={activeCell ? cellKey(activeCell.row, activeCell.col) : ''}
        value={activeCell ? getRawInput(activeCell.row, activeCell.col) : ''}
        disabled={!activeCell}
        readOnly={!canEdit}
        onCommit={(value) => {
          if (activeCell) commitCell(activeCell.row, activeCell.col, value);
        }}
      />
      <div className={styles.toolbar}>
        <Select
          size="sm"
          className={styles.formatSelect}
          value={activeMetadata?.fmt ?? 'plain'}
          onChange={(e) => {
            if (activeCellKey) onFormatChange(activeCellKey, e.target.value as CellFormat);
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
        <Button
          variant={activeMetadata?.style?.bold ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={activeMetadata?.style?.bold ?? false}
          aria-label="Bold"
          disabled={!activeCell || !canEdit}
          onClick={() => activeCellKey && onToggleStyle(activeCellKey, 'bold')}
        >
          <strong>B</strong>
        </Button>
        <Button
          variant={activeMetadata?.style?.italic ? 'secondary' : 'ghost'}
          size="sm"
          aria-pressed={activeMetadata?.style?.italic ?? false}
          aria-label="Italic"
          disabled={!activeCell || !canEdit}
          onClick={() => activeCellKey && onToggleStyle(activeCellKey, 'italic')}
        >
          <em>I</em>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!activeCell || !canEdit}
          onClick={() => setValidationDialogOpen(true)}
        >
          Validation
        </Button>
        <div className={styles.toolbarSpacer} />
        <Button variant="ghost" size="sm" onClick={handleExportCsv}>
          Export CSV
        </Button>
        {canEdit && (
          <>
            <input
              ref={importInputRef}
              type="file"
              accept=".csv,text/csv"
              className={styles.hiddenFileInput}
              onChange={handleImportFileChange}
              aria-label="Import CSV file"
            />
            <Button variant="ghost" size="sm" onClick={handleImportClick}>
              Import CSV
            </Button>
          </>
        )}
        {canEdit && <StatusBadge status={status} />}
      </div>
      <div className={styles.scroller}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th className={styles.cornerHeader} />
              {columnLabels.map((label) => (
                <th key={label} className={styles.colHeader}>
                  {label}
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
                  const isActive = activeCell?.row === row && activeCell?.col === col;
                  const meta = cellMetadata[key];
                  const valid = isCellValueValid(engine.getCellValue({ sheet: hfSheetId, row, col }), meta?.validation);
                  const inputClassName = [
                    styles.cellInput,
                    meta?.style?.bold && styles.cellInputBold,
                    meta?.style?.italic && styles.cellInputItalic,
                    !valid && styles.invalid,
                  ]
                    .filter(Boolean)
                    .join(' ');
                  return (
                    <td key={key} className={styles.cell}>
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(key, el);
                          else inputRefs.current.delete(key);
                        }}
                        className={inputClassName}
                        value={isActive ? getRawInput(row, col) : getDisplay(row, col)}
                        readOnly={!canEdit}
                        onFocus={() => setActiveCell({ row, col })}
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
