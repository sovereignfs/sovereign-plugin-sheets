'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ExportedChange, RawCellContent } from 'hyperformula';
import {
  Button,
  ConfirmDialog,
  Icon,
  Menu,
  StatusBadge,
  SystemBanner,
  useToast,
  type MenuEntry,
  type StatusBadgeStatus,
} from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { SheetTabs, type SheetTabItem } from './SheetTabs';
import { SheetGrid, type SheetGridHandle } from './SheetGrid';
import { WorkbookShareButton } from './WorkbookShareButton';
import { WorkbookTitle } from './WorkbookTitle';
import { ImportWorkbookButton, type ImportWorkbookHandle } from './ImportWorkbookButton';
import {
  addSheetAction,
  deleteSheetAction,
  deleteWorkbookAction,
  getFinanceRatesAction,
  getWorkbookSnapshotAction,
  recordWorkbookOpenedAction,
  renameSheetAction,
  renameWorkbookAction,
  reorderSheetsAction,
  saveNamedRangesAction,
  saveSheetAction,
  setActiveSheetAction,
  type SaveSheetInput,
  type WorkbookSheetRecord,
} from '../actions';
import type { ActionResult } from '../_lib/context';
import { cellKey } from '../_lib/a1';
import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_COL_COUNT,
  DEFAULT_ROW_COUNT,
  FINANCE_RETRY_MS,
  MAX_COL_COUNT,
  MAX_ROW_COUNT,
  WORKBOOK_REFRESH_POLL_MS,
} from '../_lib/config';
import {
  BUILTIN_NAMED_EXPRESSIONS,
  cellsMapToGrid,
  createEngine,
  gridToCellsMap,
  normalizeRawInput,
} from '../_lib/formula-engine';
import {
  compactMetadata,
  extractCellMetadata,
  mergeCellMetadata,
  parseCellsJson,
  permuteMetadataRows,
  serializeCellsJson,
  shiftMetadata,
  type CellAlign,
  type CellFormat,
  type CellMetadata,
  type DataValidationRule,
} from '../_lib/cells';
import {
  parseColumnWidthsJson,
  serializeColumnWidthsJson,
  shiftColumnWidths,
  type ColumnWidthsMap,
} from '../_lib/column-widths';
import {
  drainPendingFinancePairs,
  markPairUnavailable,
  pairKey,
  setCachedRate,
} from '../_lib/finance-function';
import { parseNamedRangesJson, sanitizeNamedRanges, type NamedRangesMap } from '../_lib/named-ranges';
import { validateSheetName } from '../_lib/sheet-names';
import type { SheetOps } from '../_lib/sheet-ops';
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
  frozenRows: number;
  frozenCols: number;
}

type SaveState = 'synced' | 'draft' | 'error' | 'conflict';

const BADGE_STATUS: Record<SaveState, StatusBadgeStatus> = {
  synced: 'synced',
  draft: 'draft',
  error: 'error',
  conflict: 'conflict',
};

const BADGE_LABEL: Record<SaveState, string> = {
  synced: 'Saved',
  draft: 'Saving…',
  error: 'Not saved',
  conflict: 'Changed elsewhere',
};

interface WorkbookViewProps {
  workbookId: string;
  name: string;
  sheets: WorkbookSheetRecord[];
  activeSheetId: string | null;
  namedRangesJson: string;
  /** Viewer role: grid/tabs render read-only, no Undo/Redo, no Delete workbook. */
  canEdit: boolean;
  /** Owner-only: gates the Share button/dialog. */
  isOwner: boolean;
  /** Set by `WorkbookEditor` when its poll finds a change made elsewhere and nothing here is unsaved — asks the wrapper to reload fresh data. */
  onRemoteChange: () => void;
  listMembersAction: () => Promise<WorkbookMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteMemberAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateRoleAction: (userId: string, role: string) => Promise<ActionResult>;
  removeMemberAction: (userId: string) => Promise<ActionResult>;
}

export function WorkbookView({
  workbookId,
  name: initialName,
  sheets: initialSheets,
  activeSheetId: initialActiveSheetId,
  namedRangesJson,
  canEdit,
  isOwner,
  onRemoteChange,
  listMembersAction,
  searchUsersAction,
  inviteMemberAction,
  updateRoleAction,
  removeMemberAction,
}: WorkbookViewProps) {
  const router = useRouter();
  const toast = useToast();
  const [workbookName, setWorkbookName] = useState(initialName);
  const [sheetList, setSheetListState] = useState<WorkbookSheet[]>(() =>
    initialSheets.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      rowCount: s.rowCount,
      colCount: s.colCount,
      frozenRows: s.frozenRows,
      frozenCols: s.frozenCols,
    })),
  );
  const sheetListRef = useRef(sheetList);
  const [activeSheetId, setActiveSheetId] = useState<string | null>(() => {
    const stored = initialSheets.find((s) => s.id === initialActiveSheetId);
    return stored?.id ?? initialSheets[0]?.id ?? null;
  });
  const [deleting, setDeleting] = useState(false);
  const [confirmDeleteWorkbook, setConfirmDeleteWorkbook] = useState(false);
  const [confirmDeleteSheetId, setConfirmDeleteSheetId] = useState<string | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [importMenuOpen, setImportMenuOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>('synced');
  const [accessLost, setAccessLost] = useState(false);
  const [conflictSheetIds, setConflictSheetIds] = useState<string[]>([]);
  const [engineError, setEngineError] = useState<string | null>(null);
  const sheetGridRef = useRef<SheetGridHandle>(null);
  const importWorkbookRef = useRef<ImportWorkbookHandle>(null);
  const [namedRanges, setNamedRanges] = useState<NamedRangesMap>(() =>
    parseNamedRangesJson(namedRangesJson),
  );

  // One HyperFormula instance for the whole workbook (cross-sheet formulas
  // need every sheet loaded), created once and mutated in place. A load
  // failure (corrupt stored content) is captured rather than thrown so the
  // route degrades to an explanation, not the platform 500.
  const engineRef = useRef<ReturnType<typeof createEngine> | null>(null);
  const hfSheetIds = useRef<Map<string, number>>(new Map());
  const cellMetadataMaps = useRef<Map<string, Record<string, CellMetadata>>>(new Map());
  const columnWidthsMaps = useRef<Map<string, ColumnWidthsMap>>(new Map());
  const revisions = useRef<Map<string, string>>(new Map(initialSheets.map((s) => [s.id, s.revision])));
  if (!engineRef.current && engineError === null) {
    try {
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
      for (const [expressionName, expression] of Object.entries(parseNamedRangesJson(namedRangesJson))) {
        if (BUILTIN_NAMED_EXPRESSIONS.has(expressionName.toUpperCase())) continue;
        try {
          engine.addNamedExpression(expressionName, expression);
        } catch {
          // Stored data was already validated once, on the add that first
          // persisted it — a load-time failure here means something upstream
          // corrupted it; skip it rather than blocking the whole workbook.
        }
      }
      engine.clearUndoStack();
      engineRef.current = engine;
    } catch (err) {
      setEngineError(err instanceof Error ? err.message : 'Unknown error');
    }
  }
  const engine = engineRef.current;

  const activeSheet = sheetList.find((s) => s.id === activeSheetId) ?? sheetList[0] ?? null;
  const activeHfSheetId = activeSheet ? hfSheetIds.current.get(activeSheet.id) : undefined;

  function setSheetList(update: (prev: WorkbookSheet[]) => WorkbookSheet[]) {
    const next = update(sheetListRef.current);
    sheetListRef.current = next;
    setSheetListState(next);
  }

  // ---------------------------------------------------------------------
  // Save queue — one path for every persisted sheet change.
  //
  // Each sheet is saved as one row (cells, size, widths, frozen panes) with
  // a revision check. At most one request per sheet is in flight; a change
  // that lands mid-flight queues one follow-up save, so the last state
  // always wins on *this* client and requests never race each other. A
  // conflict (someone else saved first) or a denial (access lost) stops
  // autosave for that sheet and is surfaced as a banner with a Reload
  // action — never overwritten silently, never retried blindly.
  // ---------------------------------------------------------------------
  const saveTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const dirtySheets = useRef<Set<string>>(new Set());
  const inFlight = useRef<Set<string>>(new Set());
  const rerunAfter = useRef<Set<string>>(new Set());
  const blockedSheets = useRef<Set<string>>(new Set());
  const accessLostRef = useRef(false);
  const hasUnsavedRef = useRef(false);

  const refreshSaveState = useCallback(() => {
    const unsaved = dirtySheets.current.size > 0 || inFlight.current.size > 0;
    hasUnsavedRef.current = unsaved;
    if (accessLostRef.current) setSaveState('error');
    else if (blockedSheets.current.size > 0) setSaveState('conflict');
    else if (unsaved) setSaveState('draft');
    else setSaveState('synced');
  }, []);

  function buildSheetPayload(sheet: WorkbookSheet): SaveSheetInput | null {
    if (!engine) return null;
    const hfId = hfSheetIds.current.get(sheet.id);
    if (hfId === undefined) return null;
    const grid = engine.getSheetSerialized(hfId);
    const metadata = cellMetadataMaps.current.get(sheet.id) ?? {};
    return {
      cellsJson: serializeCellsJson(mergeCellMetadata(gridToCellsMap(grid), metadata)),
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      colWidthsJson: serializeColumnWidthsJson(columnWidthsMaps.current.get(sheet.id) ?? {}),
      frozenRows: sheet.frozenRows,
      frozenCols: sheet.frozenCols,
    };
  }

  const flushSheet = useCallback(
    async (sheetId: string) => {
      const timer = saveTimers.current.get(sheetId);
      if (timer) {
        clearTimeout(timer);
        saveTimers.current.delete(sheetId);
      }
      if (blockedSheets.current.has(sheetId) || accessLostRef.current) return;
      if (inFlight.current.has(sheetId)) {
        rerunAfter.current.add(sheetId);
        return;
      }
      const sheet = sheetListRef.current.find((s) => s.id === sheetId);
      if (!sheet) {
        dirtySheets.current.delete(sheetId);
        refreshSaveState();
        return;
      }
      const payload = buildSheetPayload(sheet);
      if (!payload) return;

      inFlight.current.add(sheetId);
      dirtySheets.current.delete(sheetId);
      refreshSaveState();
      try {
        const result = await saveSheetAction(
          workbookId,
          sheetId,
          payload,
          revisions.current.get(sheetId) ?? '',
        );
        if (result.ok) {
          revisions.current.set(sheetId, result.revision);
        } else if (result.conflict) {
          blockedSheets.current.add(sheetId);
          setConflictSheetIds([...blockedSheets.current]);
        } else if (result.denied) {
          accessLostRef.current = true;
          setAccessLost(true);
        } else {
          dirtySheets.current.add(sheetId);
          toast.show({ title: 'Could not save', message: result.error, category: 'error' });
        }
      } catch {
        dirtySheets.current.add(sheetId);
        toast.show({
          title: 'Could not save changes',
          message: `${sheet.name} has unsaved edits. Check your connection — saving will retry when you edit again.`,
          category: 'error',
        });
      } finally {
        inFlight.current.delete(sheetId);
        if (rerunAfter.current.has(sheetId)) {
          rerunAfter.current.delete(sheetId);
          void flushSheet(sheetId);
        } else {
          refreshSaveState();
        }
      }
    },
    [workbookId, refreshSaveState],
  );

  /** Marks a sheet changed. Debounced by default (typing); `immediate` for discrete actions (formatting, structure). */
  function markDirty(sheetId: string, immediate = false) {
    if (!canEdit) return;
    dirtySheets.current.add(sheetId);
    refreshSaveState();
    const existing = saveTimers.current.get(sheetId);
    if (existing) clearTimeout(existing);
    saveTimers.current.set(
      sheetId,
      setTimeout(() => void flushSheet(sheetId), immediate ? 0 : AUTOSAVE_DELAY_MS),
    );
  }

  function bump() {
    setVersion((v) => v + 1);
  }

  // Flush anything pending if the user leaves via client-side navigation;
  // warn before a tab close/reload while a save is pending or in flight.
  useEffect(() => {
    const timers = saveTimers.current;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (!hasUnsavedRef.current) return;
      event.preventDefault();
    }
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      for (const [sheetId, timer] of timers) {
        clearTimeout(timer);
        if (dirtySheets.current.has(sheetId)) void flushSheet(sheetId);
      }
    };
  }, [flushSheet]);

  // Record the open once (drives the sidebar's Recent list).
  useEffect(() => {
    void recordWorkbookOpenedAction(workbookId);
  }, [workbookId]);

  // Poll for changes made elsewhere. Compared field-by-field against what
  // this client knows, so its own saves never count as "remote".
  useEffect(() => {
    let cancelled = false;
    const interval = setInterval(() => {
      void (async () => {
        let snapshot;
        try {
          snapshot = await getWorkbookSnapshotAction(workbookId);
        } catch {
          return;
        }
        if (cancelled) return;
        if (snapshot === null) {
          accessLostRef.current = true;
          setAccessLost(true);
          refreshSaveState();
          return;
        }
        const local = sheetListRef.current;
        const remoteById = new Map(snapshot.sheets.map((s) => [s.id, s]));
        const changed =
          snapshot.name !== workbookName ||
          snapshot.sheets.length !== local.length ||
          local.some((s) => {
            const remote = remoteById.get(s.id);
            return (
              !remote ||
              remote.name !== s.name ||
              remote.position !== s.position ||
              remote.revision !== revisions.current.get(s.id)
            );
          }) ||
          JSON.stringify(parseNamedRangesJson(snapshot.namedRangesJson)) !==
            JSON.stringify(sanitizeNamedRanges(namedRanges));
        if (changed && !hasUnsavedRef.current && blockedSheets.current.size === 0) {
          onRemoteChange();
        }
      })();
    }, WORKBOOK_REFRESH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [workbookId, workbookName, namedRanges, onRemoteChange, refreshSaveState]);

  // FINANCE(): after every recalculation, fetch whatever rates the function
  // asked for and didn't have, then let the engine re-evaluate — FINANCE is
  // volatile, so a suspend/resume pass recomputes every FINANCE cell without
  // touching the undo history (`rebuildAndRecalculate` would clear it).
  // A pair the provider doesn't offer is marked unavailable, so its cell
  // says so instead of "fetching" forever; a pair that couldn't be fetched
  // (provider down) is retried on a timer.
  const failedPairs = useRef<Set<string>>(new Set());
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recalculateFinance = useCallback(() => {
    const current = engineRef.current;
    if (!current) return;
    current.suspendEvaluation();
    current.resumeEvaluation();
    setVersion((v) => v + 1);
  }, []);
  useEffect(() => {
    if (!engine) return;
    const pending = drainPendingFinancePairs().filter(
      (pair) => !failedPairs.current.has(pairKey(pair.base, pair.quote)),
    );
    if (pending.length === 0) return;
    let cancelled = false;
    void (async () => {
      let results: Awaited<ReturnType<typeof getFinanceRatesAction>>;
      let changed = false;
      let transientFailure = false;
      try {
        results = await getFinanceRatesAction(pending);
      } catch {
        results = {};
      }
      if (cancelled) return;
      for (const pair of pending) {
        const key = pairKey(pair.base, pair.quote);
        const value = results[key];
        if (value && 'rate' in value) {
          setCachedRate(pair.base, pair.quote, value.rate, value.asOf);
          changed = true;
        } else if (value && value.error === 'unsupported') {
          markPairUnavailable(
            pair.base,
            pair.quote,
            `${pair.base}/${pair.quote} isn't available from the exchange-rate provider.`,
          );
          changed = true;
        } else {
          failedPairs.current.add(key);
          transientFailure = true;
        }
      }
      if (changed) recalculateFinance();
      if (transientFailure && retryTimer.current === null) {
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          failedPairs.current.clear();
          recalculateFinance();
        }, FINANCE_RETRY_MS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engine, version, recalculateFinance]);
  useEffect(
    () => () => {
      if (retryTimer.current !== null) clearTimeout(retryTimer.current);
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Sheet structure
  // ---------------------------------------------------------------------
  function handleSelectSheet(id: string) {
    setActiveSheetId(id);
    if (canEdit) void setActiveSheetAction(workbookId, id);
  }

  function handleSwitchSheet(delta: number) {
    const ordered = [...sheetListRef.current].sort((a, b) => a.position - b.position);
    const index = ordered.findIndex((s) => s.id === activeSheetId);
    const next = ordered[(index + delta + ordered.length) % ordered.length];
    if (next) handleSelectSheet(next.id);
  }

  async function handleAddSheet() {
    if (!engine) return;
    const result = await addSheetAction(workbookId);
    if (!result.ok) {
      if (result.denied) {
        accessLostRef.current = true;
        setAccessLost(true);
        refreshSaveState();
      } else {
        toast.show({ title: 'Could not add sheet', message: result.error, category: 'error' });
      }
      return;
    }
    const created = result.sheet;
    try {
      engine.addSheet(created.name);
    } catch {
      toast.show({
        title: 'Could not add sheet',
        message: 'Reload the workbook to see the new sheet.',
        category: 'error',
      });
      return;
    }
    const hfId = engine.getSheetId(created.name);
    if (hfId !== undefined) hfSheetIds.current.set(created.id, hfId);
    cellMetadataMaps.current.set(created.id, {});
    columnWidthsMaps.current.set(created.id, {});
    revisions.current.set(created.id, created.revision);
    engine.clearUndoStack();
    engine.clearRedoStack();
    setSheetList((prev) => [
      ...prev,
      {
        id: created.id,
        name: created.name,
        position: prev.reduce((max, s) => Math.max(max, s.position), -1) + 1,
        rowCount: DEFAULT_ROW_COUNT,
        colCount: DEFAULT_COL_COUNT,
        frozenRows: 0,
        frozenCols: 0,
      },
    ]);
    setActiveSheetId(created.id);
    void setActiveSheetAction(workbookId, created.id);
  }

  /** Returns an error message to show inline, or null on success. */
  function handleRenameSheet(id: string, newName: string): string | null {
    const others = sheetListRef.current.filter((s) => s.id !== id).map((s) => s.name);
    const error = validateSheetName(newName, others);
    if (error) return error;
    const trimmed = newName.trim().replace(/\s+/g, ' ');
    const current = sheetListRef.current.find((s) => s.id === id);
    if (!current || current.name === trimmed) return null;
    const hfId = hfSheetIds.current.get(id);
    if (engine && hfId !== undefined) {
      try {
        engine.renameSheet(hfId, trimmed);
      } catch (err) {
        return err instanceof Error ? err.message : 'That name is not allowed.';
      }
      engine.clearUndoStack();
      engine.clearRedoStack();
    }
    setSheetList((prev) => prev.map((s) => (s.id === id ? { ...s, name: trimmed } : s)));
    void renameSheetAction(id, workbookId, trimmed).then((result) => {
      if (!result.ok) handleActionFailure('Could not rename sheet', result);
    });
    return null;
  }

  function handleActionFailure(title: string, result: ActionResult) {
    if (result.ok) return;
    if (result.denied) {
      accessLostRef.current = true;
      setAccessLost(true);
      refreshSaveState();
      return;
    }
    toast.show({ title, message: result.error, category: 'error' });
  }

  async function handleDeleteSheet(id: string) {
    if (sheetListRef.current.length <= 1) return;
    const result = await deleteSheetAction(id, workbookId);
    if (!result.ok) {
      handleActionFailure('Could not delete sheet', result);
      return;
    }
    const hfId = hfSheetIds.current.get(id);
    if (engine && hfId !== undefined) {
      engine.removeSheet(hfId);
      engine.clearUndoStack();
      engine.clearRedoStack();
      hfSheetIds.current.delete(id);
    }
    cellMetadataMaps.current.delete(id);
    columnWidthsMaps.current.delete(id);
    revisions.current.delete(id);
    dirtySheets.current.delete(id);
    blockedSheets.current.delete(id);
    setConflictSheetIds([...blockedSheets.current]);
    const remaining = sheetListRef.current.filter((s) => s.id !== id);
    setSheetList(() => remaining);
    if (activeSheetId === id) {
      const fallback = [...remaining].sort((a, b) => a.position - b.position)[0];
      if (fallback) setActiveSheetId(fallback.id);
    }
    refreshSaveState();
    bump();
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
    void reorderSheetsAction(workbookId, orderedIds).then((result) => {
      if (!result.ok) handleActionFailure('Could not reorder sheets', result);
    });
  }

  async function handleDeleteWorkbook() {
    setDeleting(true);
    await deleteWorkbookAction(workbookId);
  }

  async function handleRenameWorkbook(newName: string): Promise<string | null> {
    const result = await renameWorkbookAction(workbookId, newName);
    if (!result.ok) {
      if (result.denied) {
        accessLostRef.current = true;
        setAccessLost(true);
        refreshSaveState();
      }
      return result.error;
    }
    setWorkbookName(newName.trim().replace(/\s+/g, ' '));
    return null;
  }

  // ---------------------------------------------------------------------
  // Named ranges
  // ---------------------------------------------------------------------
  function persistNamedRanges(next: NamedRangesMap) {
    setNamedRanges(next);
    void saveNamedRangesAction(workbookId, JSON.stringify(next)).then((result) => {
      if (!result.ok) handleActionFailure('Could not save named ranges', result);
    });
  }

  /** Returns an error message on failure (surfaced inline by NamedRangesButton), or undefined on success. */
  function handleAddNamedRange(expressionName: string, expression: string): string | undefined {
    if (!engine) return 'Workbook is not ready yet.';
    if (BUILTIN_NAMED_EXPRESSIONS.has(expressionName.toUpperCase())) {
      return `${expressionName.toUpperCase()} is built in and can't be redefined.`;
    }
    const existing = engine.getNamedExpression(expressionName);
    try {
      if (existing) engine.changeNamedExpression(expressionName, expression);
      else engine.addNamedExpression(expressionName, expression);
    } catch (err) {
      return err instanceof Error ? err.message : 'That name or expression is not valid.';
    }
    persistNamedRanges({ ...namedRanges, [expressionName]: expression });
    bump();
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
    persistNamedRanges(next);
    bump();
  }

  // ---------------------------------------------------------------------
  // Undo / redo — engine-level, cell values only. Structural changes
  // (sheets, rows, columns, sort) clear the stacks: they touch state the
  // engine doesn't own (row counts, metadata keys, the sheet list, the DB),
  // so a half-undo would desync them.
  // ---------------------------------------------------------------------
  function markSheetsFromChanges(changes: ExportedChange[]) {
    const touched = new Set<number>();
    for (const change of changes) {
      if ('address' in change && change.address) touched.add(change.address.sheet);
    }
    for (const [sheetId, hfId] of hfSheetIds.current) if (touched.has(hfId)) markDirty(sheetId);
  }

  function handleUndo() {
    if (!engine || !canEdit || !engine.isThereSomethingToUndo()) return;
    const changes = engine.undo();
    markSheetsFromChanges(changes);
    bump();
  }

  function handleRedo() {
    if (!engine || !canEdit || !engine.isThereSomethingToRedo()) return;
    const changes = engine.redo();
    markSheetsFromChanges(changes);
    bump();
  }

  function clearHistory() {
    engine?.clearUndoStack();
    engine?.clearRedoStack();
  }

  // ---------------------------------------------------------------------
  // Per-sheet operations handed to the grid
  // ---------------------------------------------------------------------
  const clipboard = useRef<{
    isCut: boolean;
    sourceSheetId: string;
    sourceMinRow: number;
    sourceMinCol: number;
    cells: Record<string, CellMetadata>;
  } | null>(null);

  function updateMetadata(
    sheetId: string,
    update: (current: Record<string, CellMetadata>) => Record<string, CellMetadata>,
  ) {
    const current = cellMetadataMaps.current.get(sheetId) ?? {};
    const next = update(current);
    const compacted: Record<string, CellMetadata> = {};
    for (const [key, meta] of Object.entries(next)) {
      const clean = compactMetadata(meta);
      if (clean) compacted[key] = clean;
    }
    cellMetadataMaps.current.set(sheetId, compacted);
    bump();
    markDirty(sheetId, true);
  }

  function patchCells(
    sheetId: string,
    keys: string[],
    patch: (meta: CellMetadata) => CellMetadata,
  ) {
    updateMetadata(sheetId, (current) => {
      const next = { ...current };
      for (const key of keys) next[key] = patch(current[key] ?? {});
      return next;
    });
  }

  function updateSheet(sheetId: string, patch: Partial<WorkbookSheet>) {
    setSheetList((prev) => prev.map((s) => (s.id === sheetId ? { ...s, ...patch } : s)));
  }

  function makeOps(sheet: WorkbookSheet, hfId: number): SheetOps {
    if (!engine) throw new Error('engine not ready');
    const sheetId = sheet.id;
    const live = () => sheetListRef.current.find((s) => s.id === sheetId) ?? sheet;

    function grow(rows: number, cols: number): { clippedRows: number; clippedCols: number } {
      const current = live();
      const nextRows = Math.min(Math.max(current.rowCount, rows), MAX_ROW_COUNT);
      const nextCols = Math.min(Math.max(current.colCount, cols), MAX_COL_COUNT);
      if (nextRows !== current.rowCount || nextCols !== current.colCount) {
        updateSheet(sheetId, { rowCount: nextRows, colCount: nextCols });
      }
      return { clippedRows: Math.max(0, rows - nextRows), clippedCols: Math.max(0, cols - nextCols) };
    }

    return {
      commitCell(row, col, raw) {
        if (!canEdit) return;
        failedPairs.current.clear();
        engine.setCellContents({ sheet: hfId, row, col }, [[normalizeRawInput(raw)]]);
        bump();
        markDirty(sheetId);
      },
      clearValues(bounds) {
        if (!canEdit) return;
        const height = bounds.maxRow - bounds.minRow + 1;
        const width = bounds.maxCol - bounds.minCol + 1;
        const blank: null[][] = Array.from({ length: height }, () => Array<null>(width).fill(null));
        engine.setCellContents({ sheet: hfId, row: bounds.minRow, col: bounds.minCol }, blank);
        bump();
        markDirty(sheetId);
      },
      setValues(row, col, values) {
        if (!canEdit) return { clippedRows: 0, clippedCols: 0 };
        const width = values.reduce((max, r) => Math.max(max, r.length), 0);
        const clipped = grow(row + values.length, col + width);
        const current = live();
        const maxRows = Math.min(values.length, current.rowCount - row);
        const maxCols = Math.min(width, current.colCount - col);
        const block: RawCellContent[][] = values
          .slice(0, Math.max(0, maxRows))
          .map((r) => {
            const line: RawCellContent[] = [];
            for (let c = 0; c < maxCols; c++) {
              const value = r[c];
              line.push(
                value === undefined || value === null
                  ? null
                  : typeof value === 'string'
                    ? normalizeRawInput(value)
                    : value,
              );
            }
            return line;
          });
        if (block.length > 0 && maxCols > 0) {
          engine.setCellContents({ sheet: hfId, row, col }, block);
        }
        failedPairs.current.clear();
        bump();
        markDirty(sheetId);
        return clipped;
      },
      copyRange(bounds, cut) {
        if (cut && !canEdit) cut = false;
        const range = {
          start: { sheet: hfId, row: bounds.minRow, col: bounds.minCol },
          end: { sheet: hfId, row: bounds.maxRow, col: bounds.maxCol },
        };
        if (cut) engine.cut(range);
        else engine.copy(range);
        const cells: Record<string, CellMetadata> = {};
        const metadata = cellMetadataMaps.current.get(sheetId) ?? {};
        for (let r = bounds.minRow; r <= bounds.maxRow; r++) {
          for (let c = bounds.minCol; c <= bounds.maxCol; c++) {
            const meta = metadata[cellKey(r, c)];
            if (meta) cells[`${String(r - bounds.minRow)},${String(c - bounds.minCol)}`] = meta;
          }
        }
        clipboard.current = {
          isCut: cut,
          sourceSheetId: sheetId,
          sourceMinRow: bounds.minRow,
          sourceMinCol: bounds.minCol,
          cells,
        };
      },
      hasInternalClipboard() {
        return !engine.isClipboardEmpty();
      },
      pasteInternal(row, col) {
        if (!canEdit || engine.isClipboardEmpty()) return false;
        const clip = clipboard.current;
        try {
          engine.paste({ sheet: hfId, row, col });
        } catch {
          return false;
        }
        if (clip) {
          let maxRow = 0;
          let maxCol = 0;
          const patch: Record<string, CellMetadata> = {};
          for (const [relKey, meta] of Object.entries(clip.cells)) {
            const [relRowText, relColText] = relKey.split(',');
            const relRow = Number(relRowText);
            const relCol = Number(relColText);
            maxRow = Math.max(maxRow, relRow);
            maxCol = Math.max(maxCol, relCol);
            patch[cellKey(row + relRow, col + relCol)] = meta;
          }
          grow(row + maxRow + 1, col + maxCol + 1);
          updateMetadata(sheetId, (current) => ({ ...current, ...patch }));
          if (clip.isCut) {
            // A cut moved the cells — their formatting leaves the *source*
            // sheet, which may not be this one.
            const deleteKeys = Object.keys(clip.cells).map((relKey) => {
              const [relRowText, relColText] = relKey.split(',');
              return cellKey(clip.sourceMinRow + Number(relRowText), clip.sourceMinCol + Number(relColText));
            });
            const deleteSet = new Set(deleteKeys);
            const withoutSource = (current: Record<string, CellMetadata>) =>
              Object.fromEntries(Object.entries(current).filter(([key]) => !deleteSet.has(key)));
            if (clip.sourceSheetId === sheetId) {
              updateMetadata(sheetId, withoutSource);
            } else if (hfSheetIds.current.has(clip.sourceSheetId)) {
              updateMetadata(clip.sourceSheetId, withoutSource);
            }
            clipboard.current = null;
          }
        }
        // `engine.paste` after a cut also changed the source sheet's values.
        if (clip?.isCut && clip.sourceSheetId !== sheetId) markDirty(clip.sourceSheetId);
        failedPairs.current.clear();
        bump();
        markDirty(sheetId);
        return true;
      },
      fill(source, target) {
        if (!canEdit) return;
        const data = engine.getFillRangeData(
          {
            start: { sheet: hfId, row: source.minRow, col: source.minCol },
            end: { sheet: hfId, row: source.maxRow, col: source.maxCol },
          },
          {
            start: { sheet: hfId, row: target.minRow, col: target.minCol },
            end: { sheet: hfId, row: target.maxRow, col: target.maxCol },
          },
        );
        grow(target.maxRow + 1, target.maxCol + 1);
        engine.setCellContents({ sheet: hfId, row: target.minRow, col: target.minCol }, data);
        const metadata = cellMetadataMaps.current.get(sheetId) ?? {};
        const srcHeight = source.maxRow - source.minRow + 1;
        const srcWidth = source.maxCol - source.minCol + 1;
        const patch: Record<string, CellMetadata> = {};
        const clear: string[] = [];
        for (let r = target.minRow; r <= target.maxRow; r++) {
          for (let c = target.minCol; c <= target.maxCol; c++) {
            const srcRow = source.minRow + (((r - target.minRow) % srcHeight) + srcHeight) % srcHeight;
            const srcCol = source.minCol + (((c - target.minCol) % srcWidth) + srcWidth) % srcWidth;
            const meta = metadata[cellKey(srcRow, srcCol)];
            if (meta) patch[cellKey(r, c)] = meta;
            else clear.push(cellKey(r, c));
          }
        }
        const clearSet = new Set(clear);
        updateMetadata(sheetId, (current) => ({
          ...Object.fromEntries(Object.entries(current).filter(([key]) => !clearSet.has(key))),
          ...patch,
        }));
        failedPairs.current.clear();
        markDirty(sheetId);
      },
      insertRows(at, count) {
        if (!canEdit) return;
        const current = live();
        if (current.rowCount + count > MAX_ROW_COUNT) {
          toast.show({
            title: "Can't add rows",
            message: `A sheet can have at most ${String(MAX_ROW_COUNT)} rows.`,
            category: 'warning',
          });
          return;
        }
        engine.addRows(hfId, [at, count]);
        cellMetadataMaps.current.set(sheetId, shiftMetadata(cellMetadataMaps.current.get(sheetId) ?? {}, 'row', at, count));
        updateSheet(sheetId, { rowCount: current.rowCount + count });
        clearHistory();
        bump();
        markDirty(sheetId, true);
      },
      deleteRows(at, count) {
        if (!canEdit) return;
        const current = live();
        const removable = Math.min(count, current.rowCount - 1, current.rowCount - at);
        if (removable <= 0) return;
        engine.removeRows(hfId, [at, removable]);
        cellMetadataMaps.current.set(sheetId, shiftMetadata(cellMetadataMaps.current.get(sheetId) ?? {}, 'row', at, -removable));
        updateSheet(sheetId, {
          rowCount: current.rowCount - removable,
          frozenRows: Math.min(current.frozenRows, Math.max(0, at)),
        });
        clearHistory();
        bump();
        markDirty(sheetId, true);
      },
      insertColumns(at, count) {
        if (!canEdit) return;
        const current = live();
        if (current.colCount + count > MAX_COL_COUNT) {
          toast.show({
            title: "Can't add columns",
            message: `A sheet can have at most ${String(MAX_COL_COUNT)} columns.`,
            category: 'warning',
          });
          return;
        }
        engine.addColumns(hfId, [at, count]);
        cellMetadataMaps.current.set(sheetId, shiftMetadata(cellMetadataMaps.current.get(sheetId) ?? {}, 'col', at, count));
        columnWidthsMaps.current.set(sheetId, shiftColumnWidths(columnWidthsMaps.current.get(sheetId) ?? {}, at, count));
        updateSheet(sheetId, { colCount: current.colCount + count });
        clearHistory();
        bump();
        markDirty(sheetId, true);
      },
      deleteColumns(at, count) {
        if (!canEdit) return;
        const current = live();
        const removable = Math.min(count, current.colCount - 1, current.colCount - at);
        if (removable <= 0) return;
        engine.removeColumns(hfId, [at, removable]);
        cellMetadataMaps.current.set(sheetId, shiftMetadata(cellMetadataMaps.current.get(sheetId) ?? {}, 'col', at, -removable));
        columnWidthsMaps.current.set(sheetId, shiftColumnWidths(columnWidthsMaps.current.get(sheetId) ?? {}, at, -removable));
        updateSheet(sheetId, {
          colCount: current.colCount - removable,
          frozenCols: Math.min(current.frozenCols, Math.max(0, at)),
        });
        clearHistory();
        bump();
        markDirty(sheetId, true);
      },
      appendRows(count) {
        if (!canEdit) return;
        const current = live();
        const next = Math.min(current.rowCount + count, MAX_ROW_COUNT);
        if (next === current.rowCount) return;
        updateSheet(sheetId, { rowCount: next });
        bump();
        markDirty(sheetId, true);
      },
      appendColumns(count) {
        if (!canEdit) return;
        const current = live();
        const next = Math.min(current.colCount + count, MAX_COL_COUNT);
        if (next === current.colCount) return;
        updateSheet(sheetId, { colCount: next });
        bump();
        markDirty(sheetId, true);
      },
      sortByColumn(col, direction) {
        if (!canEdit) return;
        const { height } = engine.getSheetDimensions(hfId);
        if (height <= 1) return;
        const current = live();
        // The first row stays put when it reads as a header: frozen, or a
        // text label above a column that otherwise holds numbers.
        const firstValue = engine.getCellValue({ sheet: hfId, row: 0, col });
        const hasNumbersBelow = Array.from({ length: height - 1 }, (_, i) =>
          engine.getCellValue({ sheet: hfId, row: i + 1, col }),
        ).some((value) => typeof value === 'number');
        const keepHeader = current.frozenRows > 0 || (typeof firstValue === 'string' && hasNumbersBelow);
        const start = keepHeader ? 1 : 0;
        const rows = Array.from({ length: height - start }, (_, i) => i + start);
        const rank = (value: unknown): [number, number | string] => {
          if (value === null || value === undefined || value === '') return [2, ''];
          if (typeof value === 'number') return [0, value];
          if (typeof value === 'boolean') return [1, value ? 1 : 0];
          return [1, String(value).toLowerCase()];
        };
        rows.sort((a, b) => {
          const [ga, va] = rank(engine.getCellValue({ sheet: hfId, row: a, col }));
          const [gb, vb] = rank(engine.getCellValue({ sheet: hfId, row: b, col }));
          if (ga !== gb) return ga - gb; // empties always last
          const cmp = va < vb ? -1 : va > vb ? 1 : 0;
          return direction === 'asc' ? cmp : -cmp;
        });
        const newOrder = [...Array.from({ length: start }, (_, i) => i), ...rows];
        engine.setRowOrder(hfId, newOrder);
        cellMetadataMaps.current.set(sheetId, permuteMetadataRows(cellMetadataMaps.current.get(sheetId) ?? {}, newOrder));
        clearHistory();
        bump();
        markDirty(sheetId, true);
      },
      setColumnWidth(col, width) {
        if (!canEdit) return;
        const currentWidths = columnWidthsMaps.current.get(sheetId) ?? {};
        columnWidthsMaps.current.set(sheetId, { ...currentWidths, [String(col)]: width });
        bump();
        markDirty(sheetId, true);
      },
      setFrozen(rows, cols) {
        if (!canEdit) return;
        const current = live();
        updateSheet(sheetId, {
          frozenRows: Math.max(0, Math.min(rows, 5, current.rowCount - 1)),
          frozenCols: Math.max(0, Math.min(cols, 5, current.colCount - 1)),
        });
        bump();
        markDirty(sheetId, true);
      },
      importCsv(rows) {
        if (!canEdit) return { clipped: false, importedRows: 0 };
        const current = live();
        const importedRowCount = rows.length;
        const importedColCount = rows.reduce((max, r) => Math.max(max, r.length), 1);
        const nextRowCount = Math.min(Math.max(current.rowCount, importedRowCount), MAX_ROW_COUNT);
        const nextColCount = Math.min(Math.max(current.colCount, importedColCount), MAX_COL_COUNT);
        // Spans the full next-size grid, not just the imported range, so
        // pre-existing content outside the CSV's own dimensions is cleared —
        // a true replace, matching the confirm dialog's copy.
        const clippedRows = Math.min(importedRowCount, nextRowCount);
        const clippedCols = Math.min(importedColCount, nextColCount);
        const values: RawCellContent[][] = [];
        for (let row = 0; row < nextRowCount; row++) {
          const line: RawCellContent[] = [];
          for (let col = 0; col < nextColCount; col++) {
            const raw = row < clippedRows && col < clippedCols ? (rows[row]?.[col] ?? '') : '';
            line.push(normalizeRawInput(raw));
          }
          values.push(line);
        }
        engine.setCellContents({ sheet: hfId, row: 0, col: 0 }, values);
        updateSheet(sheetId, { rowCount: nextRowCount, colCount: nextColCount });
        clearHistory();
        failedPairs.current.clear();
        bump();
        markDirty(sheetId, true);
        return {
          clipped: importedRowCount > nextRowCount || importedColCount > nextColCount,
          importedRows: clippedRows,
        };
      },
      setFormat(keys, fmt: CellFormat) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, fmt }));
      },
      setCurrency(keys, currency) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, fmt: 'currency', currency }));
      },
      toggleStyle(keys, styleKey) {
        if (!canEdit) return;
        const current = cellMetadataMaps.current.get(sheetId) ?? {};
        // Uniform toggle (Excel/Sheets): all on → off for all; otherwise on for all.
        const allOn = keys.length > 0 && keys.every((key) => current[key]?.style?.[styleKey]);
        patchCells(sheetId, keys, (meta) => ({ ...meta, style: { ...meta.style, [styleKey]: !allOn } }));
      },
      setColor(keys, colorKey, value) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, style: { ...meta.style, [colorKey]: value ?? undefined } }));
      },
      setFontSize(keys, size) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, style: { ...meta.style, fontSize: size ?? undefined } }));
      },
      setAlign(keys, align: CellAlign | null) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, style: { ...meta.style, align: align ?? undefined } }));
      },
      setValidation(keys, rule: DataValidationRule | undefined) {
        if (!canEdit) return;
        patchCells(sheetId, keys, (meta) => ({ ...meta, validation: rule }));
      },
      undo: handleUndo,
      redo: handleRedo,
    };
  }

  const ops = useMemo(
    () => (activeSheet && engine && activeHfSheetId !== undefined ? makeOps(activeSheet, activeHfSheetId) : null),
    [activeSheet?.id, activeHfSheetId, engine, canEdit],
  );

  // ---------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------
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
            : '{}';
        return {
          name: sheet.name,
          position: sheet.position,
          rowCount: sheet.rowCount,
          colCount: sheet.colCount,
          cellsJson,
          colWidthsJson: serializeColumnWidthsJson(columnWidthsMaps.current.get(sheet.id) ?? {}),
          frozenRows: sheet.frozenRows,
          frozenCols: sheet.frozenCols,
        };
      });

    const payload = buildWorkbookExportPayload(
      { name: workbookName, namedRangesJson: JSON.stringify(namedRanges), sheets: exportSheets },
      Math.floor(Date.now() / 1000),
    );
    downloadWorkbookExport(`${workbookName}.sheets.json`, payload);
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

  const exportItems: MenuEntry[] = [
    {
      label: 'Export sheet as CSV',
      icon: 'file-text',
      onSelect: () => sheetGridRef.current?.exportCsv(),
    },
    { label: 'Export workbook as JSON', icon: 'file', onSelect: handleExportWorkbook },
  ];

  const importItems: MenuEntry[] = [
    {
      label: 'Import CSV into this sheet',
      icon: 'file-text',
      onSelect: () => sheetGridRef.current?.triggerImport(),
    },
    {
      label: 'Import JSON as a new workbook',
      icon: 'file',
      onSelect: () => importWorkbookRef.current?.triggerImport(),
    },
  ];

  const conflictNames = conflictSheetIds
    .map((id) => sheetList.find((s) => s.id === id)?.name)
    .filter((n): n is string => !!n);

  if (engineError !== null) {
    return (
      <div className={styles.view}>
        <div className={styles.metaBar}>
          <Link href="/sheets" className={styles.backLink} aria-label="Back to workbooks">
            <Icon name="chevron-left" size="md" aria-hidden />
          </Link>
          <div className={styles.titleBlock}>
            <h1 className={styles.title}>{workbookName}</h1>
          </div>
        </div>
        <SystemBanner variant="error">
          This workbook couldn&apos;t be opened because its stored content is damaged. Export a
          backup from a working copy, or contact your instance admin.
        </SystemBanner>
      </div>
    );
  }

  return (
    <div className={styles.view}>
      <div className={styles.metaBar}>
        <Link href="/sheets" className={styles.backLink} aria-label="Back to workbooks">
          <Icon name="chevron-left" size="md" aria-hidden />
        </Link>

        <div className={styles.titleBlock}>
          <WorkbookTitle name={workbookName} canEdit={canEdit && !accessLost} onRename={handleRenameWorkbook} />
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
          {canEdit && <StatusBadge status={BADGE_STATUS[saveState]}>{BADGE_LABEL[saveState]}</StatusBadge>}
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
              updateRoleAction={updateRoleAction}
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

      {accessLost && (
        <SystemBanner variant="error">
          <span className={styles.bannerText}>
            {canEdit
              ? "You can't edit this workbook anymore — your access changed, or the workbook was deleted. Changes since then aren't saved."
              : "You can't view this workbook anymore — your access changed, or the workbook was deleted."}
          </span>
          <Button size="sm" variant="secondary" onClick={() => router.refresh()}>
            Reload
          </Button>
        </SystemBanner>
      )}
      {!accessLost && conflictNames.length > 0 && (
        <SystemBanner variant="warning">
          <span className={styles.bannerText}>
            {conflictNames.length === 1
              ? `${conflictNames[0] ?? 'This sheet'} was changed by someone else while you were editing. Your latest changes to it aren't saved — export a copy if you need them, then reload.`
              : `${conflictNames.join(', ')} were changed by someone else while you were editing. Your latest changes to them aren't saved — export a copy if you need them, then reload.`}
          </span>
          <Button size="sm" variant="secondary" onClick={handleExportWorkbook}>
            Export a copy
          </Button>
          <Button size="sm" onClick={() => router.refresh()}>
            Reload
          </Button>
        </SystemBanner>
      )}

      {activeSheet && engine && activeHfSheetId !== undefined && ops && (
        <SheetGrid
          key={activeSheet.id}
          ref={sheetGridRef}
          engine={engine}
          hfSheetId={activeHfSheetId}
          sheetName={activeSheet.name}
          rowCount={activeSheet.rowCount}
          colCount={activeSheet.colCount}
          frozenRows={activeSheet.frozenRows}
          frozenCols={activeSheet.frozenCols}
          version={version}
          cellMetadata={cellMetadataMaps.current.get(activeSheet.id) ?? {}}
          columnWidths={columnWidthsMaps.current.get(activeSheet.id) ?? {}}
          ops={ops}
          canUndo={canEdit && engine.isThereSomethingToUndo()}
          canRedo={canEdit && engine.isThereSomethingToRedo()}
          namedRanges={Object.entries(namedRanges).map(([rangeName, expression]) => ({
            name: rangeName,
            expression,
          }))}
          onAddNamedRange={handleAddNamedRange}
          onRemoveNamedRange={handleRemoveNamedRange}
          onSwitchSheet={handleSwitchSheet}
          canEdit={canEdit && !accessLost}
        />
      )}

      {/* Google-Sheets-style: sheet tabs dock at the bottom of the viewport
          (last child of `.view`'s full-height flex column), not above the
          grid — SheetGrid's own `.scroller` absorbs all the vertical space
          this leaves behind, so the tab strip reads as pinned in place while
          only the grid content scrolls internally. */}
      <SheetTabs
        sheets={sheetList}
        activeSheetId={activeSheet?.id ?? null}
        onSelect={handleSelectSheet}
        onAdd={() => void handleAddSheet()}
        onRename={handleRenameSheet}
        onDelete={setConfirmDeleteSheetId}
        onReorder={handleReorder}
        canEdit={canEdit && !accessLost}
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
            Delete <strong>{workbookName}</strong>? You can restore it from the Workbooks page
            later.
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
