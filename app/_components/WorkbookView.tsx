'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, ConfirmDialog, StatusBadge } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { BackLink } from './BackLink';
import { SheetTabs, type SheetTabItem } from './SheetTabs';
import { SheetGrid } from './SheetGrid';
import { WorkbookShareButton } from './WorkbookShareButton';
import { NamedRangesButton } from './NamedRangesDialog';
import {
  addSheetAction,
  deleteSheetAction,
  deleteWorkbookAction,
  getFinanceRatesAction,
  renameSheetAction,
  reorderSheetsAction,
  saveNamedRangesAction,
  saveSheetCellsAction,
  setActiveSheetAction,
} from '../actions';
import type { ActionResult } from '../_lib/context';
import { DEFAULT_COL_COUNT, DEFAULT_ROW_COUNT } from '../_lib/config';
import { cellsMapToGrid, createEngine, gridToCellsMap } from '../_lib/formula-engine';
import {
  extractCellFormats,
  mergeCellFormats,
  parseCellsJson,
  serializeCellsJson,
  type CellFormat,
} from '../_lib/cells';
import { extractFinancePairs, getCachedRate, setCachedRate } from '../_lib/finance-function';
import type { WorkbookMemberView } from '../_lib/workbook-sharing';
import styles from './WorkbookView.module.css';

export interface WorkbookSheet extends SheetTabItem {
  rowCount: number;
  colCount: number;
  cellsJson: string;
}

export function WorkbookView({
  workbookId,
  name,
  sheets: initialSheets,
  namedRangesJson,
  canEdit,
  isOwner,
  listMembersAction,
  searchUsersAction,
  inviteMemberAction,
  removeMemberAction,
}: {
  workbookId: string;
  name: string;
  sheets: WorkbookSheet[];
  namedRangesJson: string;
  /** Viewer role: grid/tabs render read-only, no Undo/Redo, no Delete workbook. */
  canEdit: boolean;
  /** Owner-only: gates the Share button/dialog. */
  isOwner: boolean;
  listMembersAction: () => Promise<WorkbookMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteMemberAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeMemberAction: (userId: string) => Promise<ActionResult>;
}) {
  const [sheetList, setSheetList] = useState(initialSheets);
  const [activeSheetId, setActiveSheetId] = useState(initialSheets[0]?.id ?? null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteWorkbook, setConfirmDeleteWorkbook] = useState(false);
  const [confirmDeleteSheetId, setConfirmDeleteSheetId] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [namedRanges, setNamedRanges] = useState<Record<string, string>>(() => {
    try {
      const parsed: unknown = JSON.parse(namedRangesJson);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, string>)
        : {};
    } catch {
      return {};
    }
  });

  // One HyperFormula instance for the whole workbook (cross-sheet formulas
  // need every sheet loaded), created once and mutated in place.
  const engineRef = useRef<ReturnType<typeof createEngine> | null>(null);
  const hfSheetIds = useRef<Map<string, number>>(new Map());
  // Per-sheet number-format overrides — the HyperFormula engine only knows
  // values/formulas, not this plugin's own `fmt` metadata, so it's tracked
  // alongside the engine rather than in it. Read back into `cellsJson` via
  // `mergeCellFormats` at every save (`saveAllSheets`/SheetGrid's own
  // autosave), same pattern as `finance-function.ts`'s rate cache.
  const formatMaps = useRef<Map<string, Record<string, CellFormat>>>(new Map());
  if (!engineRef.current) {
    const engine = createEngine();
    for (const sheet of [...initialSheets].sort((a, b) => a.position - b.position)) {
      engine.addSheet(sheet.name);
      const hfId = engine.getSheetId(sheet.name);
      if (hfId === undefined) continue;
      hfSheetIds.current.set(sheet.id, hfId);
      const cells = parseCellsJson(sheet.cellsJson);
      engine.setSheetContent(hfId, cellsMapToGrid(cells, sheet.rowCount, sheet.colCount));
      formatMaps.current.set(sheet.id, extractCellFormats(cells));
    }
    // After every sheet exists — a named expression referencing a sheet
    // (e.g. "=Sheet1!$B$2") throws if that sheet isn't registered yet.
    for (const [expressionName, expression] of Object.entries(namedRanges)) {
      try {
        engine.addNamedExpression(expressionName, expression);
      } catch {
        // Stored data was already validated once, on the add that first
        // persisted it — a load-time failure here means something upstream
        // corrupted it; skip it rather than blocking the whole workbook.
      }
    }
    engineRef.current = engine;
  }
  const engine = engineRef.current;

  const activeSheet = sheetList.find((s) => s.id === activeSheetId) ?? sheetList[0] ?? null;
  const activeHfSheetId = activeSheet ? hfSheetIds.current.get(activeSheet.id) : undefined;

  function handleSelectSheet(id: string) {
    setActiveSheetId(id);
    void setActiveSheetAction(workbookId, id);
  }

  async function handleAddSheet() {
    const created = await addSheetAction(workbookId);
    if (!created || !engine) return;
    engine.addSheet(created.name);
    const hfId = engine.getSheetId(created.name);
    if (hfId !== undefined) hfSheetIds.current.set(created.id, hfId);
    formatMaps.current.set(created.id, {});
    setSheetList((prev) => [
      ...prev,
      {
        id: created.id,
        name: created.name,
        position: prev.length,
        rowCount: DEFAULT_ROW_COUNT,
        colCount: DEFAULT_COL_COUNT,
        cellsJson: '{}',
      },
    ]);
    setActiveSheetId(created.id);
    void setActiveSheetAction(workbookId, created.id);
  }

  function handleRenameSheet(id: string, newName: string) {
    if (sheetList.some((s) => s.id !== id && s.name === newName)) return;
    const hfId = hfSheetIds.current.get(id);
    if (engine && hfId !== undefined) engine.renameSheet(hfId, newName);
    setSheetList((prev) => prev.map((s) => (s.id === id ? { ...s, name: newName } : s)));
    void renameSheetAction(id, workbookId, newName);
  }

  async function handleDeleteSheet(id: string) {
    if (sheetList.length <= 1) return;
    const hfId = hfSheetIds.current.get(id);
    if (engine && hfId !== undefined) {
      engine.removeSheet(hfId);
      hfSheetIds.current.delete(id);
    }
    formatMaps.current.delete(id);
    const remaining = sheetList.filter((s) => s.id !== id);
    setSheetList(remaining);
    if (activeSheetId === id) {
      const fallback = remaining[0];
      if (fallback) setActiveSheetId(fallback.id);
    }
    await deleteSheetAction(id, workbookId);
  }

  function handleReorder(orderedIds: string[]) {
    setSheetList((prev) => {
      const byId = new Map(prev.map((s) => [s.id, s]));
      return orderedIds
        .map((id, position) => {
          const sheet = byId.get(id);
          return sheet ? { ...sheet, position } : null;
        })
        .filter((s): s is WorkbookSheet => s !== null);
    });
    void reorderSheetsAction(workbookId, orderedIds);
  }

  async function handleDeleteWorkbook() {
    setDeleting(true);
    await deleteWorkbookAction(workbookId);
  }

  function saveAllSheets() {
    if (!engine) return;
    for (const sheet of sheetList) {
      const hfId = hfSheetIds.current.get(sheet.id);
      if (hfId === undefined) continue;
      const grid = engine.getSheetSerialized(hfId);
      const formats = formatMaps.current.get(sheet.id) ?? {};
      void saveSheetCellsAction(
        workbookId,
        sheet.id,
        serializeCellsJson(mergeCellFormats(gridToCellsMap(grid), formats)),
      );
    }
  }

  /** Format-select changes are discrete, infrequent actions — saved immediately, not debounced like typing. */
  function handleFormatChange(sheetId: string, targetCellKey: string, fmt: CellFormat) {
    if (!engine) return;
    const hfId = hfSheetIds.current.get(sheetId);
    if (hfId === undefined) return;

    // Setting it to 'plain' explicitly (rather than deleting the key) is
    // enough — mergeCellFormats already skips 'plain' entries on save, so
    // this never persists, but it does correctly overwrite whatever
    // non-plain value the key previously held in this in-memory map.
    const next = { ...formatMaps.current.get(sheetId), [targetCellKey]: fmt };
    formatMaps.current.set(sheetId, next);
    setVersion((v) => v + 1);

    const grid = engine.getSheetSerialized(hfId);
    void saveSheetCellsAction(
      workbookId,
      sheetId,
      serializeCellsJson(mergeCellFormats(gridToCellsMap(grid), next)),
    );
  }

  /** Returns an error message on failure (surfaced inline by NamedRangesButton), or undefined on success. */
  function handleAddNamedRange(expressionName: string, expression: string): string | undefined {
    if (!engine) return 'Workbook is not ready yet.';
    const existing = engine.getNamedExpression(expressionName);
    try {
      if (existing) engine.changeNamedExpression(expressionName, expression);
      else engine.addNamedExpression(expressionName, expression);
    } catch (err) {
      return err instanceof Error ? err.message : 'That name or expression is not valid.';
    }
    const next = { ...namedRanges, [expressionName]: expression };
    setNamedRanges(next);
    void saveNamedRangesAction(workbookId, JSON.stringify(next));
    return undefined;
  }

  function handleRemoveNamedRange(expressionName: string) {
    if (!engine) return;
    try {
      engine.removeNamedExpression(expressionName);
    } catch {
      // Already gone from the engine — still drop it from local/persisted state below.
    }
    const { [expressionName]: _removed, ...next } = namedRanges;
    setNamedRanges(next);
    void saveNamedRangesAction(workbookId, JSON.stringify(next));
  }

  async function resolveFinancePairs(pairs: { base: string; quote: string }[]) {
    const unresolved = pairs.filter((p) => getCachedRate(p.base, p.quote) === undefined);
    if (unresolved.length === 0) return;

    const results = await getFinanceRatesAction(unresolved);
    let changed = false;
    for (const pair of unresolved) {
      const key = `${pair.base.toUpperCase()}/${pair.quote.toUpperCase()}`;
      const value = results[key];
      if (value) {
        setCachedRate(pair.base, pair.quote, value.rate);
        changed = true;
      }
    }
    if (changed && engineRef.current) {
      engineRef.current.rebuildAndRecalculate();
      setVersion((v) => v + 1);
    }
  }

  // On mount, batch-resolve every FINANCE() pair already present across all
  // sheets — avoids one Frankfurter round-trip per cell.
  useEffect(() => {
    const pairs: { base: string; quote: string }[] = [];
    for (const sheet of initialSheets) {
      const cells = parseCellsJson(sheet.cellsJson);
      for (const cell of Object.values(cells)) {
        if (typeof cell.v === 'string') pairs.push(...extractFinancePairs(cell.v));
      }
    }
    void resolveFinancePairs(pairs);
    // Resolve once, from the initial server-loaded sheets.
  }, []);

  function handleCellCommitted(raw: string) {
    const pairs = extractFinancePairs(raw);
    if (pairs.length > 0) void resolveFinancePairs(pairs);
  }

  function handleUndo() {
    if (!engine?.isThereSomethingToUndo()) return;
    engine.undo();
    setVersion((v) => v + 1);
    saveAllSheets();
  }

  function handleRedo() {
    if (!engine?.isThereSomethingToRedo()) return;
    engine.redo();
    setVersion((v) => v + 1);
    saveAllSheets();
  }

  return (
    <div className={styles.view}>
      <div className={styles.header}>
        <div>
          <BackLink href="/sheets">Back to workbooks</BackLink>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{name}</h1>
            {!canEdit && (
              <StatusBadge status="unmodified" aria-label="You can view but not edit this workbook">
                View only
              </StatusBadge>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          {canEdit && (
            <>
              <Button variant="ghost" size="sm" onClick={handleUndo}>
                Undo
              </Button>
              <Button variant="ghost" size="sm" onClick={handleRedo}>
                Redo
              </Button>
            </>
          )}
          <NamedRangesButton
            ranges={Object.entries(namedRanges).map(([rangeName, expression]) => ({
              name: rangeName,
              expression,
            }))}
            canEdit={canEdit}
            onAdd={handleAddNamedRange}
            onRemove={handleRemoveNamedRange}
          />
          {isOwner && (
            <WorkbookShareButton
              listMembersAction={listMembersAction}
              searchUsersAction={searchUsersAction}
              inviteAction={inviteMemberAction}
              removeAction={removeMemberAction}
            />
          )}
          {isOwner && (
            <button
              type="button"
              className={styles.deleteWorkbook}
              onClick={() => setConfirmDeleteWorkbook(true)}
            >
              Delete workbook
            </button>
          )}
        </div>
      </div>

      <SheetTabs
        sheets={sheetList}
        activeSheetId={activeSheetId}
        onSelect={handleSelectSheet}
        onAdd={() => void handleAddSheet()}
        onRename={handleRenameSheet}
        onDelete={setConfirmDeleteSheetId}
        onReorder={handleReorder}
        canEdit={canEdit}
      />

      {activeSheet && engine && activeHfSheetId !== undefined && (
        <SheetGrid
          engine={engine}
          workbookId={workbookId}
          hfSheetId={activeHfSheetId}
          sheetId={activeSheet.id}
          sheetName={activeSheet.name}
          rowCount={activeSheet.rowCount}
          colCount={activeSheet.colCount}
          version={version}
          onVersionChange={setVersion}
          onCellCommitted={handleCellCommitted}
          onSheetResized={(nextRowCount, nextColCount) => {
            setSheetList((prev) =>
              prev.map((s) =>
                s.id === activeSheet.id ? { ...s, rowCount: nextRowCount, colCount: nextColCount } : s,
              ),
            );
          }}
          formatMap={formatMaps.current.get(activeSheet.id) ?? {}}
          onFormatChange={(targetCellKey, fmt) => handleFormatChange(activeSheet.id, targetCellKey, fmt)}
          canEdit={canEdit}
        />
      )}

      <ConfirmDialog
        open={confirmDeleteWorkbook}
        onClose={() => setConfirmDeleteWorkbook(false)}
        title="Delete workbook"
        message={
          <>
            Delete <strong>{name}</strong>? This can&apos;t be undone.
          </>
        }
        onConfirm={() => void handleDeleteWorkbook()}
        confirmLabel={deleting ? 'Deleting…' : 'Delete'}
        destructive
        pending={deleting}
      />

      <ConfirmDialog
        open={confirmDeleteSheetId !== null}
        onClose={() => setConfirmDeleteSheetId(null)}
        title="Delete sheet"
        message={
          <>
            Delete{' '}
            <strong>{sheetList.find((s) => s.id === confirmDeleteSheetId)?.name}</strong>? This
            can&apos;t be undone.
          </>
        }
        onConfirm={() => {
          if (confirmDeleteSheetId) void handleDeleteSheet(confirmDeleteSheetId);
          setConfirmDeleteSheetId(null);
        }}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}
