import {
  MAX_COL_COUNT,
  MAX_IMPORT_FILE_SIZE_BYTES,
  MAX_IMPORT_SHEET_COUNT,
  MAX_ROW_COUNT,
} from './config';
import { parseCellsJson, serializeCellsJson } from './cells';
import { parseColumnWidthsJson, serializeColumnWidthsJson } from './column-widths';
import { parseNamedRangesJson } from './named-ranges';
import { uniqueSheetName } from './sheet-names';

export const WORKBOOK_EXPORT_FORMAT_VERSION = 1;

export interface WorkbookExportSheet {
  name: string;
  position: number;
  rowCount: number;
  colCount: number;
  cellsJson: string;
  colWidthsJson: string;
  frozenRows: number;
  frozenCols: number;
}

export interface WorkbookExportWorkbook {
  name: string;
  namedRangesJson: string;
  sheets: WorkbookExportSheet[];
}

export interface WorkbookExportPayload {
  formatVersion: typeof WORKBOOK_EXPORT_FORMAT_VERSION;
  exportedAt: number;
  workbook: WorkbookExportWorkbook;
}

export function buildWorkbookExportPayload(
  workbook: WorkbookExportWorkbook,
  exportedAt: number,
): WorkbookExportPayload {
  return { formatVersion: WORKBOOK_EXPORT_FORMAT_VERSION, exportedAt, workbook };
}

/** Browser-only: triggers a download of `payload` as a JSON file. */
export function downloadWorkbookExport(filename: string, payload: WorkbookExportPayload): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export type WorkbookExportParseResult =
  | { ok: true; payload: WorkbookExportPayload }
  | { ok: false; error: string };

function clampFrozen(raw: unknown, max: number): number {
  const n = typeof raw === 'number' ? Math.floor(raw) : 0;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, max);
}

/**
 * Validates, caps, and normalizes an uploaded export file's shape — used
 * both client-side (`ImportWorkbookButton`, for immediate feedback before
 * ever hitting the network) and inside `importWorkbookAction` itself. The
 * server-side call is the real trust boundary: a server action is a public
 * endpoint dispatched by action id, not gated by whichever UI happens to
 * call it, so the client-side call is only a UX nicety, not the security
 * check. Every cap (sheet count, row/col count per sheet) lives here rather
 * than split between this function and the action, so both call sites agree
 * by construction instead of by convention.
 *
 * Sheet names are made unique the same way the formula engine requires
 * (case-insensitively) — an exported file edited by hand, or written by an
 * older build, could otherwise produce a workbook that throws on load and
 * can never be opened.
 */
export function parseWorkbookExportPayload(text: string): WorkbookExportParseResult {
  if (text.length > MAX_IMPORT_FILE_SIZE_BYTES) {
    return { ok: false, error: 'File is too large to import.' };
  }

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Not a valid Sheets export file.' };
  }

  if (!data || typeof data !== 'object') {
    return { ok: false, error: 'Not a valid Sheets export file.' };
  }
  const record = data as Record<string, unknown>;
  if (record.formatVersion !== WORKBOOK_EXPORT_FORMAT_VERSION) {
    return { ok: false, error: 'This file was exported by an unsupported version of Sheets.' };
  }

  const workbookRaw = record.workbook;
  if (!workbookRaw || typeof workbookRaw !== 'object') {
    return { ok: false, error: 'Not a valid Sheets export file.' };
  }
  const workbookRecord = workbookRaw as Record<string, unknown>;

  if (!Array.isArray(workbookRecord.sheets) || workbookRecord.sheets.length === 0) {
    return { ok: false, error: 'File has no sheets.' };
  }
  if (workbookRecord.sheets.length > MAX_IMPORT_SHEET_COUNT) {
    return { ok: false, error: `Too many sheets to import (max ${String(MAX_IMPORT_SHEET_COUNT)}).` };
  }

  const sheets: WorkbookExportSheet[] = [];
  const takenNames: string[] = [];
  for (const [index, entry] of workbookRecord.sheets.entries()) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Not a valid Sheets export file.' };
    }
    const sheetRecord = entry as Record<string, unknown>;
    const rowCount = Math.floor(Number(sheetRecord.rowCount));
    const colCount = Math.floor(Number(sheetRecord.colCount));
    if (!Number.isFinite(rowCount) || !Number.isFinite(colCount) || rowCount < 1 || colCount < 1) {
      return { ok: false, error: 'Not a valid Sheets export file.' };
    }
    const requestedName =
      typeof sheetRecord.name === 'string' && sheetRecord.name.trim()
        ? sheetRecord.name
        : `Sheet${String(index + 1)}`;
    if (rowCount > MAX_ROW_COUNT || colCount > MAX_COL_COUNT) {
      return {
        ok: false,
        error: `"${requestedName}" is too large to import (max ${String(MAX_ROW_COUNT)} rows × ${String(MAX_COL_COUNT)} columns).`,
      };
    }
    const sheetName = uniqueSheetName(requestedName, takenNames);
    takenNames.push(sheetName);
    sheets.push({
      name: sheetName,
      position: index,
      rowCount,
      colCount,
      // Round-trips through the same parse/serialize pair `cellsJson` is
      // always stored through — drops anything that isn't a recognized
      // field, so a hand-edited or malicious file can't smuggle unexpected
      // keys into storage.
      cellsJson: serializeCellsJson(
        parseCellsJson(typeof sheetRecord.cellsJson === 'string' ? sheetRecord.cellsJson : '{}'),
      ),
      // Same round-trip treatment as cellsJson — parseColumnWidthsJson also
      // clamps each width into [MIN_COL_WIDTH_PX, MAX_COL_WIDTH_PX].
      colWidthsJson: serializeColumnWidthsJson(
        parseColumnWidthsJson(
          typeof sheetRecord.colWidthsJson === 'string' ? sheetRecord.colWidthsJson : '{}',
        ),
      ),
      frozenRows: clampFrozen(sheetRecord.frozenRows, Math.min(5, rowCount - 1)),
      frozenCols: clampFrozen(sheetRecord.frozenCols, Math.min(5, colCount - 1)),
    });
  }

  return {
    ok: true,
    payload: {
      formatVersion: WORKBOOK_EXPORT_FORMAT_VERSION,
      exportedAt: typeof record.exportedAt === 'number' ? record.exportedAt : 0,
      workbook: {
        name: typeof workbookRecord.name === 'string' ? workbookRecord.name.trim() : '',
        namedRangesJson: JSON.stringify(
          parseNamedRangesJson(
            typeof workbookRecord.namedRangesJson === 'string' ? workbookRecord.namedRangesJson : '{}',
          ),
        ),
        sheets,
      },
    },
  };
}
