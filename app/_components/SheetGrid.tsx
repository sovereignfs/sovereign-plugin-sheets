'use client';

import { useMemo, useRef, useState } from 'react';
import type { HyperFormula } from 'hyperformula';
import { Button, StatusBadge, useToast, type StatusBadgeStatus } from '@sovereignfs/ui';
import { saveSheetCellsAction } from '../actions';
import { cellKey, colIndexToLetters } from '../_lib/a1';
import { serializeCellsJson } from '../_lib/cells';
import { cellsToCsv, downloadCsv } from '../_lib/csv';
import { displayValue, gridToCellsMap } from '../_lib/formula-engine';
import { FormulaBar } from './FormulaBar';
import styles from './SheetGrid.module.css';

const AUTOSAVE_DELAY_MS = 1200;

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
  /** Viewer role: grid and formula bar render read-only, no autosave, no fill-down. */
  canEdit: boolean;
}) {
  const [status, setStatus] = useState<StatusBadgeStatus>('synced');
  const [activeCell, setActiveCell] = useState<{ row: number; col: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
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
    return displayValue(engine.getCellValue({ sheet: hfSheetId, row, col }));
  }

  function scheduleSave() {
    setStatus('draft');
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const grid = engine.getSheetSerialized(hfSheetId);
      void saveSheetCellsAction(workbookId, sheetId, serializeCellsJson(gridToCellsMap(grid)))
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
        <Button variant="ghost" size="sm" onClick={handleExportCsv}>
          Export CSV
        </Button>
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
                  return (
                    <td key={key} className={styles.cell}>
                      <input
                        ref={(el) => {
                          if (el) inputRefs.current.set(key, el);
                          else inputRefs.current.delete(key);
                        }}
                        className={styles.cellInput}
                        value={isActive ? getRawInput(row, col) : getDisplay(row, col)}
                        readOnly={!canEdit}
                        onFocus={() => setActiveCell({ row, col })}
                        onChange={(e) => commitCell(row, col, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, row, col)}
                        aria-label={key}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
