'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Button,
  ConfirmDialog,
  Icon,
  Menu,
  StatusBadge,
  type MenuEntry,
  type StatusBadgeStatus,
} from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { SheetTabs, type SheetTabItem } from './SheetTabs';
import { SheetGrid, type SheetGridHandle } from './SheetGrid';
import { WorkbookShareButton } from './WorkbookShareButton';
import { ImportWorkbookButton, type ImportWorkbookHandle } from './ImportWorkbookButton';
import {
  addSheetAction,
  deleteSheetAction,
  deleteWorkbookAction,
  getFinanceRatesAction,
  renameSheetAction,
  reorderSheetsAction,
  saveColumnWidthsAction,
  saveNamedRangesAction,
  saveSheetCellsAction,
  setActiveSheetAction,
} from '../actions';
import type { ActionResult } from '../_lib/context';
import { DEFAULT_COL_COUNT, DEFAULT_ROW_COUNT } from '../_lib/config';
import { cellsMapToGrid, createEngine, gridToCellsMap } from '../_lib/formula-engine';
import {
  extractCellMetadata,
  mergeCellMetadata,
  parseCellsJson,
  serializeCellsJson,
  type CellFormat,
  type CellMetadata,
  type CellStyle,
  type DataValidationRule,
} from '../_lib/cells';
import {
  parseColumnWidthsJson,
  serializeColumnWidthsJson,
  type ColumnWidthsMap,
} from '../_lib/column-widths';
import { extractFinancePairs, getCachedRate, setCachedRate } from '../_lib/finance-function';
import type { WorkbookMemberView } from '../_lib/workbook-sharing';
import {
  buildWorkbookExportPayload,
  downloadWorkbookExport,
  type WorkbookExportSheet,
} from '../_lib/workbook-export';
import styles from './WorkbookView.module.css';

export interface WorkbookSheet extends SheetTabItem {
  rowCount: number;
  colCount: number;
  cellsJson: string;
  colWidthsJson: string;
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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [version, setVersion] = useState(0);
  // Mirrors the active SheetGrid's own autosave status, so the header can
  // render the badge without lifting cell-save state itself up here.
  const [gridStatus, setGridStatus] = useState<StatusBadgeStatus>('synced');
  const sheetGridRef = useRef<SheetGridHandle>(null);
  // Drives the hidden file input rendered by `<ImportWorkbookButton>` below
  // (mounted with no `renderTrigger`, so it has no visible button of its
  // own) — the consolidated Import menu's "Import as JSON" item triggers it.
  const importWorkbookRef = useRef<ImportWorkbookHandle>(null);
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
  // Per-sheet cell metadata (number format, bold/italic, validation rule) —
  // the HyperFormula engine only knows values/formulas, not this plugin's
  // own per-cell metadata, so it's tracked alongside the engine rather than
  // in it. Read back into `cellsJson` via `mergeCellMetadata` at every save
  // (`saveAllSheets`/SheetGrid's own autosave), same pattern as
  // `finance-function.ts`'s rate cache.
  const cellMetadataMaps = useRef<Map<string, Record<string, CellMetadata>>>(new Map());
  // Per-sheet column-resize overrides, keyed by 0-indexed column (as a
  // string) — a display/layout concern the HyperFormula engine has no
  // concept of, so it's tracked alongside the engine the same way
  // `cellMetadataMaps` already is, not read back out of it.
  const columnWidthsMaps = useRef<Map<string, ColumnWidthsMap>>(new Map());
  if (!engineRef.current) {
    const engine = createEngine();
    for (const sheet of [...initialSheets].sort((a, b) => a.position - b.position)) {
      engine.addSheet(sheet.name);
      const hfId = engine.getSheetId(sheet.name);
      if (hfId === undefined) continue;
      hfSheetIds.current.set(sheet.id, hfId);
      const cells = parseCellsJson(sheet.cellsJson);
      engine.setSheetContent(hfId, cellsMapToGrid(cells, sheet.rowCount, sheet.colCount));
      cellMetadataMaps.current.set(sheet.id, extractCellMetadata(cells));
      columnWidthsMaps.current.set(sheet.id, parseColumnWidthsJson(sheet.colWidthsJson));
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
    cellMetadataMaps.current.set(created.id, {});
    columnWidthsMaps.current.set(created.id, {});
    setSheetList((prev) => [
      ...prev,
      {
        id: created.id,
        name: created.name,
        position: prev.length,
        rowCount: DEFAULT_ROW_COUNT,
        colCount: DEFAULT_COL_COUNT,
        cellsJson: '{}',
        colWidthsJson: '{}',
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
    cellMetadataMaps.current.delete(id);
    columnWidthsMaps.current.delete(id);
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
      const metadata = cellMetadataMaps.current.get(sheet.id) ?? {};
      void saveSheetCellsAction(
        workbookId,
        sheet.id,
        serializeCellsJson(mergeCellMetadata(gridToCellsMap(grid), metadata)),
      );
    }
  }

  /** Persists one sheet's current engine content + updated cell-metadata map immediately (not debounced — these are discrete, infrequent actions, unlike keystroke-by-keystroke typing). */
  function persistCellMetadata(sheetId: string, metadata: Record<string, CellMetadata>) {
    if (!engine) return;
    const hfId = hfSheetIds.current.get(sheetId);
    if (hfId === undefined) return;
    const grid = engine.getSheetSerialized(hfId);
    void saveSheetCellsAction(
      workbookId,
      sheetId,
      serializeCellsJson(mergeCellMetadata(gridToCellsMap(grid), metadata)),
    );
  }

  /** Called once per resize gesture (`SheetGrid.tsx`'s pointer-up), not per pixel dragged — cheap enough to persist immediately, same as `persistCellMetadata`. */
  function handleColumnWidthChange(sheetId: string, colIndex: number, width: number) {
    const current = columnWidthsMaps.current.get(sheetId) ?? {};
    const next = { ...current, [String(colIndex)]: width };
    columnWidthsMaps.current.set(sheetId, next);
    setVersion((v) => v + 1);
    void saveColumnWidthsAction(sheetId, workbookId, serializeColumnWidthsJson(next));
  }

  /**
   * Merges a patch of `{cellKey: CellMetadata}` into a sheet's metadata map
   * in one batched update — the shared primitive every bulk operation below
   * (format/style/color across a multi-cell selection, and paste's
   * metadata half) builds on, so applying to N cells costs one persist
   * call, not N. `deleteKeys` removes entries outright — used by a cut's
   * paste to clear the source range's formatting once it's moved to the
   * target, the same way `engine.paste()` already moves the values.
   */
  function applyMetadataPatch(
    sheetId: string,
    patch: Record<string, CellMetadata>,
    deleteKeys?: string[],
  ) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const merged = { ...current, ...patch };
    const deleteSet = deleteKeys && deleteKeys.length > 0 ? new Set(deleteKeys) : null;
    const next = deleteSet
      ? Object.fromEntries(Object.entries(merged).filter(([key]) => !deleteSet.has(key)))
      : merged;
    cellMetadataMaps.current.set(sheetId, next);
    setVersion((v) => v + 1);
    persistCellMetadata(sheetId, next);
  }

  function handleFormatChange(sheetId: string, targetCellKeys: string[], fmt: CellFormat) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    // Setting `fmt: 'plain'` explicitly (rather than deleting the key) is
    // enough — mergeCellMetadata already skips 'plain' entries on save, so
    // this never persists, but it does correctly overwrite whatever
    // non-plain value the key previously held in this in-memory map.
    const patch: Record<string, CellMetadata> = {};
    for (const key of targetCellKeys) patch[key] = { ...current[key], fmt };
    applyMetadataPatch(sheetId, patch);
  }

  /**
   * Toggles one style flag (bold or italic) across every selected cell,
   * preserving each cell's other style fields. A *uniform* toggle, not a
   * per-cell independent one — matching how Excel/Sheets behave: if every
   * selected cell already has the flag on, the click turns it off for all
   * of them; otherwise it turns it on for all of them (a mixed selection
   * resolves to "on").
   */
  function handleToggleStyle(sheetId: string, targetCellKeys: string[], styleKey: keyof CellStyle) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const allOn = targetCellKeys.length > 0 && targetCellKeys.every((key) => current[key]?.style?.[styleKey]);
    const nextValue = !allOn;
    const patch: Record<string, CellMetadata> = {};
    for (const key of targetCellKeys) {
      const currentCell = current[key] ?? {};
      patch[key] = { ...currentCell, style: { ...currentCell.style, [styleKey]: nextValue } };
    }
    applyMetadataPatch(sheetId, patch);
  }

  /** Sets or clears (`value: null`) the font/background color across every selected cell, preserving each cell's other style fields. */
  function handleColorChange(
    sheetId: string,
    targetCellKeys: string[],
    colorKey: 'color' | 'bg',
    value: string | null,
  ) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const patch: Record<string, CellMetadata> = {};
    for (const key of targetCellKeys) {
      const currentCell = current[key] ?? {};
      patch[key] = { ...currentCell, style: { ...currentCell.style, [colorKey]: value ?? undefined } };
    }
    applyMetadataPatch(sheetId, patch);
  }

  /** Sets or clears (`size: null`) the font size across every selected cell, preserving each cell's other style fields. */
  function handleFontSizeChange(sheetId: string, targetCellKeys: string[], size: number | null) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const patch: Record<string, CellMetadata> = {};
    for (const key of targetCellKeys) {
      const currentCell = current[key] ?? {};
      patch[key] = { ...currentCell, style: { ...currentCell.style, fontSize: size ?? undefined } };
    }
    applyMetadataPatch(sheetId, patch);
  }

  /** The metadata half of a paste — `SheetGrid.tsx` already drove the engine-level `copy`/`cut`/`paste` (values, formulas, reference translation); this carries the copied range's format/style/validation along with it, since the engine has no concept of that metadata. */
  function handleApplyMetadataPatch(
    sheetId: string,
    patch: Record<string, CellMetadata>,
    deleteKeys: string[],
  ) {
    applyMetadataPatch(sheetId, patch, deleteKeys);
  }

  /** `rule: undefined` clears validation for the cell. */
  function handleValidationChange(
    sheetId: string,
    targetCellKey: string,
    rule: DataValidationRule | undefined,
  ) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const currentCell = current[targetCellKey] ?? {};
    const next = { ...current, [targetCellKey]: { ...currentCell, validation: rule } };
    cellMetadataMaps.current.set(sheetId, next);
    setVersion((v) => v + 1);
    persistCellMetadata(sheetId, next);
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

  /**
   * Downloads the whole workbook — every sheet's live values/formulas
   * (via the same `getSheetSerialized`/`mergeCellMetadata` path
   * `saveAllSheets` persists through, not the debounced/possibly-stale
   * `sheetList.cellsJson` state) plus named ranges, as one importable JSON
   * file. Available to any role — a read operation, same as CSV export.
   */
  function handleExportWorkbook() {
    if (!engine) return;
    const exportSheets: WorkbookExportSheet[] = [...sheetList]
      .sort((a, b) => a.position - b.position)
      .map((sheet) => {
        const hfId = hfSheetIds.current.get(sheet.id);
        const cellsJson =
          hfId !== undefined
            ? serializeCellsJson(
                mergeCellMetadata(
                  gridToCellsMap(engine.getSheetSerialized(hfId)),
                  cellMetadataMaps.current.get(sheet.id) ?? {},
                ),
              )
            : sheet.cellsJson;
        return {
          name: sheet.name,
          position: sheet.position,
          rowCount: sheet.rowCount,
          colCount: sheet.colCount,
          cellsJson,
          colWidthsJson: serializeColumnWidthsJson(columnWidthsMaps.current.get(sheet.id) ?? {}),
        };
      });

    const payload = buildWorkbookExportPayload(
      { name, namedRangesJson: JSON.stringify(namedRanges), sheets: exportSheets },
      Math.floor(Date.now() / 1000),
    );
    downloadWorkbookExport(`${name}.sheets.json`, payload);
  }

  const overflowItems: MenuEntry[] = isOwner
    ? [
        {
          label: 'Delete workbook',
          icon: 'trash-2',
          destructive: true,
          onSelect: () => setConfirmDeleteWorkbook(true),
        },
      ]
    : [];

  // Available to any role — both are read operations, same as before this
  // consolidation (Export CSV and Export workbook were never canEdit-gated).
  const exportItems: MenuEntry[] = [
    {
      label: 'Export as CSV',
      icon: 'file-text',
      onSelect: () => sheetGridRef.current?.exportCsv(),
    },
    { label: 'Export as JSON', icon: 'file', onSelect: handleExportWorkbook },
  ];

  // The whole Import menu is canEdit-gated, not just its items — "Import as
  // JSON" always creates a brand-new, unrelated workbook regardless of this
  // one's own role, but a read-only viewer of this workbook has no reason to
  // see an Import affordance here at all (same reasoning as Undo/Redo).
  const importItems: MenuEntry[] = [
    { label: 'Import CSV', icon: 'file-text', onSelect: () => sheetGridRef.current?.triggerImport() },
    {
      label: 'Import as JSON (new workbook)',
      icon: 'file',
      onSelect: () => importWorkbookRef.current?.triggerImport(),
    },
  ];

  return (
    <div className={styles.view}>
      <div className={styles.metaBar}>
        <Link href="/sheets" className={styles.backLink} aria-label="Back to workbooks">
          <Icon name="chevron-left" size="md" aria-hidden />
        </Link>

        <div className={styles.titleBlock}>
          <h1 className={styles.title}>{name}</h1>
          {/* Mutually exclusive by role, same slot: viewers see "View only"
              (a fixed role indicator), editors see the live autosave status
              instead — both describe the state of the document itself, not
              an action, so they read as a caption next to the title rather
              than sitting among the Export/Import/Share command buttons. */}
          {!canEdit && (
            <StatusBadge status="unmodified" aria-label="You can view but not edit this workbook">
              View only
            </StatusBadge>
          )}
          {canEdit && <StatusBadge status={gridStatus} />}
        </div>

        <div className={styles.metaRight}>
          <Menu
            aria-label="Export"
            open={exportMenuOpen}
            onClose={() => setExportMenuOpen(false)}
            align="right"
            trigger={
              <Button
                variant="secondary"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={exportMenuOpen}
                onClick={() => setExportMenuOpen((v) => !v)}
              >
                <Icon name="download" size="sm" aria-hidden />
                Export
                <Icon name="chevron-down" size="sm" aria-hidden />
              </Button>
            }
            items={exportItems}
          />
          {canEdit && (
            <Menu
              aria-label="Import"
              open={importMenuOpen}
              onClose={() => setImportMenuOpen(false)}
              align="right"
              trigger={
                <Button
                  variant="secondary"
                  size="sm"
                  aria-haspopup="menu"
                  aria-expanded={importMenuOpen}
                  onClick={() => setImportMenuOpen((v) => !v)}
                >
                  <Icon name="upload" size="sm" aria-hidden />
                  Import
                  <Icon name="chevron-down" size="sm" aria-hidden />
                </Button>
              }
              items={importItems}
            />
          )}
          {isOwner && (
            <WorkbookShareButton
              listMembersAction={listMembersAction}
              searchUsersAction={searchUsersAction}
              inviteAction={inviteMemberAction}
              removeAction={removeMemberAction}
            />
          )}
          {overflowItems.length > 0 && (
            <Menu
              aria-label="More actions"
              open={overflowOpen}
              onClose={() => setOverflowOpen(false)}
              align="right"
              trigger={
                <button
                  type="button"
                  className={styles.iconButton}
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={overflowOpen}
                  onClick={() => setOverflowOpen((v) => !v)}
                >
                  <Icon name="ellipsis-vertical" size="sm" aria-hidden />
                </button>
              }
              items={overflowItems}
            />
          )}
        </div>
      </div>

      {activeSheet && engine && activeHfSheetId !== undefined && (
        <SheetGrid
          ref={sheetGridRef}
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
          onStatusChange={setGridStatus}
          cellMetadata={cellMetadataMaps.current.get(activeSheet.id) ?? {}}
          onFormatChange={(targetCellKeys, fmt) => handleFormatChange(activeSheet.id, targetCellKeys, fmt)}
          onToggleStyle={(targetCellKeys, styleKey) =>
            handleToggleStyle(activeSheet.id, targetCellKeys, styleKey)
          }
          onColorChange={(targetCellKeys, colorKey, value) =>
            handleColorChange(activeSheet.id, targetCellKeys, colorKey, value)
          }
          onFontSizeChange={(targetCellKeys, size) =>
            handleFontSizeChange(activeSheet.id, targetCellKeys, size)
          }
          onApplyMetadataPatch={(patch, deleteKeys) =>
            handleApplyMetadataPatch(activeSheet.id, patch, deleteKeys)
          }
          onValidationChange={(targetCellKey, rule) =>
            handleValidationChange(activeSheet.id, targetCellKey, rule)
          }
          columnWidths={columnWidthsMaps.current.get(activeSheet.id) ?? {}}
          onColumnWidthChange={(colIndex, width) =>
            handleColumnWidthChange(activeSheet.id, colIndex, width)
          }
          canUndo={engine.isThereSomethingToUndo()}
          canRedo={engine.isThereSomethingToRedo()}
          onUndo={handleUndo}
          onRedo={handleRedo}
          namedRanges={Object.entries(namedRanges).map(([rangeName, expression]) => ({
            name: rangeName,
            expression,
          }))}
          onAddNamedRange={handleAddNamedRange}
          onRemoveNamedRange={handleRemoveNamedRange}
          canEdit={canEdit}
        />
      )}

      {/* Google-Sheets-style: sheet tabs dock at the bottom of the viewport
          (last child of `.view`'s full-height flex column), not above the
          grid — SheetGrid's own `.scroller` absorbs all the vertical space
          this leaves behind, so the tab strip reads as pinned in place while
          only the grid content scrolls internally. */}
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

      {/* No `renderTrigger` — this mounts only the hidden file input/form;
          the consolidated Import menu's "Import as JSON" item drives it via
          `importWorkbookRef.current.triggerImport()`. */}
      <ImportWorkbookButton ref={importWorkbookRef} />

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
