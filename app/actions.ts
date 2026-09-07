'use server';

import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { financeRateCache, sheets, workbookMembers, workbooks } from './_db/schema';
import { parseCellsJson, serializeCellsJson } from './_lib/cells';
import { sanitizeColumnWidths, serializeColumnWidthsJson } from './_lib/column-widths';
import {
  DEFAULT_COL_COUNT,
  DEFAULT_ROW_COUNT,
  MAX_CELLS_JSON_BYTES,
  MAX_COL_COUNT,
  MAX_FINANCE_PAIRS_PER_REQUEST,
  MAX_NAMED_RANGES_JSON_BYTES,
  MAX_ROW_COUNT,
  MAX_WORKBOOK_NAME_LENGTH,
} from './_lib/config';
import {
  type ActionResult,
  type Db,
  DENIED_EDIT,
  DENIED_EDIT_MESSAGE,
  getContext,
  now,
} from './_lib/context';
import { formString } from './_lib/formUtils';
import { frankfurterProvider } from './_lib/frankfurter';
import type { FxRateProvider } from './_lib/fx-rate-provider';
import { isCurrencyCode, pairKey } from './_lib/finance-function';
import { newId } from './_lib/ids';
import { sanitizeNamedRanges } from './_lib/named-ranges';
import { nextDefaultSheetName, normalizeSheetName, validateSheetName } from './_lib/sheet-names';
import { canEditWorkbookRole, type WorkbookMemberRole } from './_lib/workbook-rules';
import { parseWorkbookExportPayload } from './_lib/workbook-export';

const RECENT_WORKBOOKS_LIMIT = 8;
const FINANCE_RATE_TTL_SECONDS = 6 * 60 * 60;

/**
 * The single swap point for FINANCE()'s currency-conversion provider — see
 * `_lib/fx-rate-provider.ts`'s own docblock. Swapping providers means
 * writing a new `FxRateProvider` and changing this one binding.
 */
const FX_PROVIDER: FxRateProvider = frankfurterProvider;

/**
 * A user's role for one *live* workbook, or `null` if they have no
 * `workbook_members` row — or the workbook has been deleted. Joining
 * `workbooks` here (rather than trusting the membership row alone) is what
 * stops a stale tab from autosaving into a workbook its owner already
 * deleted.
 */
export async function resolveWorkbookRole(
  db: Db,
  tenantId: string,
  userId: string,
  workbookId: string,
  options: { includeDeleted?: boolean } = {},
): Promise<WorkbookMemberRole | null> {
  const [membership] = await db
    .select({ role: workbookMembers.role, deletedAt: workbooks.deletedAt })
    .from(workbookMembers)
    .innerJoin(workbooks, eq(workbooks.id, workbookMembers.workbookId))
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, userId),
        eq(workbooks.tenantId, tenantId),
      ),
    );
  if (!membership) return null;
  if (membership.deletedAt !== null && !options.includeDeleted) return null;
  return membership.role;
}

/** `'read'` accepts any role; `'write'` requires owner/editor; `'owner'` requires the owner role. */
async function hasWorkbookAccess(
  db: Db,
  tenantId: string,
  userId: string,
  workbookId: string,
  need: 'read' | 'write' | 'owner',
): Promise<boolean> {
  const role = await resolveWorkbookRole(db, tenantId, userId, workbookId);
  if (!role) return false;
  if (need === 'read') return true;
  if (need === 'write') return canEditWorkbookRole(role);
  return role === 'owner';
}

/** Bumps `workbooks.updatedAt` — the Home list sorts on it, so every content change must move it, not just workbook-row edits. */
async function touchWorkbook(db: Db, tenantId: string, workbookId: string): Promise<void> {
  await db
    .update(workbooks)
    .set({ updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
}

function normalizeWorkbookName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_WORKBOOK_NAME_LENGTH);
}

export interface WorkbookOverviewItem {
  id: string;
  name: string;
  updatedAt: number;
  role: WorkbookMemberRole;
}

/** Every live workbook the signed-in user has any `workbook_members` role on — owner or shared. */
export async function listWorkbooksOverview(): Promise<WorkbookOverviewItem[]> {
  const { db, userId, tenantId } = await getContext();

  const memberships = await db
    .select({ workbookId: workbookMembers.workbookId, role: workbookMembers.role })
    .from(workbookMembers)
    .where(and(eq(workbookMembers.tenantId, tenantId), eq(workbookMembers.userId, userId)));

  if (memberships.length === 0) return [];
  const roleByWorkbookId = new Map(memberships.map((m) => [m.workbookId, m.role]));

  const rows = await db
    .select({ id: workbooks.id, name: workbooks.name, updatedAt: workbooks.updatedAt })
    .from(workbooks)
    .where(
      and(
        eq(workbooks.tenantId, tenantId),
        inArray(
          workbooks.id,
          memberships.map((m) => m.workbookId),
        ),
        isNull(workbooks.deletedAt),
      ),
    )
    .orderBy(desc(workbooks.updatedAt));

  return rows.map((row) => ({ ...row, role: roleByWorkbookId.get(row.id) ?? 'viewer' }));
}

export interface DeletedWorkbookItem {
  id: string;
  name: string;
  deletedAt: number;
}

/** Soft-deleted workbooks the signed-in user owns — restorable from Home's "Recently deleted" section. */
export async function listDeletedWorkbooks(): Promise<DeletedWorkbookItem[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({ id: workbooks.id, name: workbooks.name, deletedAt: workbooks.deletedAt })
    .from(workbookMembers)
    .innerJoin(workbooks, eq(workbooks.id, workbookMembers.workbookId))
    .where(
      and(
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, userId),
        eq(workbookMembers.role, 'owner'),
        eq(workbooks.tenantId, tenantId),
        isNotNull(workbooks.deletedAt),
      ),
    )
    .orderBy(desc(workbooks.deletedAt));

  return rows.flatMap((row) =>
    row.deletedAt === null ? [] : [{ id: row.id, name: row.name, deletedAt: row.deletedAt }],
  );
}

export interface RecentWorkbookItem {
  id: string;
  name: string;
}

/**
 * Last `RECENT_WORKBOOKS_LIMIT` workbooks this user opened — owner or
 * shared, mixed by recency. `lastOpenedAt` lives on `workbookMembers`, per
 * (workbook, user) — a workbook another member opened must never appear in
 * *this* user's own Recent list.
 */
export async function listRecentWorkbooks(): Promise<RecentWorkbookItem[]> {
  const { db, userId, tenantId } = await getContext();

  const rows = await db
    .select({ id: workbooks.id, name: workbooks.name })
    .from(workbookMembers)
    .innerJoin(workbooks, eq(workbooks.id, workbookMembers.workbookId))
    .where(
      and(
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, userId),
        isNotNull(workbookMembers.lastOpenedAt),
        isNull(workbooks.deletedAt),
      ),
    )
    .orderBy(desc(workbookMembers.lastOpenedAt))
    .limit(RECENT_WORKBOOKS_LIMIT);

  return rows;
}

export async function createWorkbookAction(formData: FormData): Promise<void> {
  const { db, userId, tenantId } = await getContext();

  const name = normalizeWorkbookName(formString(formData, 'name')) || 'Untitled workbook';
  const timestamp = now();
  const workbookId = newId();
  const sheetId = newId();

  await db.insert(workbooks).values({
    id: workbookId,
    tenantId,
    ownerUserId: userId,
    name,
    activeSheetId: sheetId,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(workbookMembers).values({
    workbookId,
    userId,
    tenantId,
    role: 'owner',
    invitedBy: null,
    joinedAt: timestamp,
    lastOpenedAt: timestamp,
  });

  await db.insert(sheets).values({
    id: sheetId,
    tenantId,
    workbookId,
    name: 'Sheet1',
    position: 0,
    rowCount: DEFAULT_ROW_COUNT,
    colCount: DEFAULT_COL_COUNT,
    cellsJson: '{}',
    colWidthsJson: '{}',
    revision: newId(),
    updatedAt: timestamp,
  });

  revalidatePath('/sheets', 'layout');
  redirect(`/sheets/s/${workbookId}`);
}

/**
 * Creates a new workbook from a previously-exported `.json` file (see
 * `_lib/workbook-export.ts`) — never an in-place overwrite of an existing
 * workbook, unlike CSV import's destructive full-sheet replace. `formData`'s
 * `payload` field is the already-parsed-and-sanitized JSON string produced
 * by `ImportWorkbookButton`'s own client-side `parseWorkbookExportPayload`
 * call; re-validated here regardless, since a server action is a public
 * endpoint dispatched by action id, not gated by whichever UI happens to
 * call it.
 */
export async function importWorkbookAction(
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();

  const raw = formString(formData, 'payload');
  if (!raw) return { ok: false, error: 'No file selected.' };

  const parsed = parseWorkbookExportPayload(raw);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const { workbook } = parsed.payload;
  const timestamp = now();
  const workbookId = newId();
  // Id generated inline per sheet (not looked up from a separate parallel
  // array by index) so `sheet.id` below is always a plain `string`, never
  // `string | undefined`.
  const newSheets = workbook.sheets.map((sheet) => ({ ...sheet, id: newId() }));

  await db.insert(workbooks).values({
    id: workbookId,
    tenantId,
    ownerUserId: userId,
    name: normalizeWorkbookName(workbook.name) || 'Untitled workbook',
    activeSheetId: newSheets[0]?.id ?? null,
    namedRangesJson: workbook.namedRangesJson,
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.insert(workbookMembers).values({
    workbookId,
    userId,
    tenantId,
    role: 'owner',
    invitedBy: null,
    joinedAt: timestamp,
    lastOpenedAt: timestamp,
  });

  await db.insert(sheets).values(
    newSheets.map((sheet) => ({
      id: sheet.id,
      tenantId,
      workbookId,
      name: sheet.name,
      position: sheet.position,
      rowCount: sheet.rowCount,
      colCount: sheet.colCount,
      cellsJson: sheet.cellsJson,
      colWidthsJson: sheet.colWidthsJson,
      frozenRows: sheet.frozenRows,
      frozenCols: sheet.frozenCols,
      revision: newId(),
      updatedAt: timestamp,
    })),
  );

  revalidatePath('/sheets', 'layout');
  redirect(`/sheets/s/${workbookId}`);
}

export interface WorkbookSheetRecord {
  id: string;
  name: string;
  position: number;
  rowCount: number;
  colCount: number;
  cellsJson: string;
  colWidthsJson: string;
  frozenRows: number;
  frozenCols: number;
  revision: string;
}

export interface WorkbookWithSheets {
  workbook: { id: string; name: string; activeSheetId: string | null; namedRangesJson: string };
  role: WorkbookMemberRole;
  sheets: WorkbookSheetRecord[];
  /** Changes whenever any sheet or the workbook row is saved — the page keys the editor on it so a refresh after a remote change remounts with fresh data. */
  changeToken: string;
}

function buildChangeToken(
  workbook: { name: string; updatedAt: number; namedRangesJson: string },
  sheetRows: { id: string; revision: string; name: string; position: number }[],
): string {
  return [
    workbook.name,
    String(workbook.updatedAt),
    String(workbook.namedRangesJson.length),
    ...sheetRows.map((s) => `${s.id}:${s.revision}:${s.name}:${String(s.position)}`),
  ].join('|');
}

/** Read-only load — no side effects. `recordWorkbookOpenedAction` (a client-triggered action) records the open. */
export async function getWorkbook(workbookId: string): Promise<WorkbookWithSheets | null> {
  const { db, userId, tenantId } = await getContext();

  const role = await resolveWorkbookRole(db, tenantId, userId, workbookId);
  if (!role) return null;

  const [workbook] = await db
    .select()
    .from(workbooks)
    .where(
      and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId), isNull(workbooks.deletedAt)),
    )
    .limit(1);

  if (!workbook) return null;

  const sheetRows = await db
    .select()
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)))
    .orderBy(asc(sheets.position));

  return {
    workbook: {
      id: workbook.id,
      name: workbook.name,
      activeSheetId: workbook.activeSheetId,
      namedRangesJson: workbook.namedRangesJson,
    },
    role,
    sheets: sheetRows.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      rowCount: s.rowCount,
      colCount: s.colCount,
      cellsJson: s.cellsJson,
      colWidthsJson: s.colWidthsJson,
      frozenRows: s.frozenRows,
      frozenCols: s.frozenCols,
      revision: s.revision,
    })),
    changeToken: buildChangeToken(workbook, sheetRows),
  };
}

/**
 * Marks the workbook as opened by the current user (drives the sidebar's
 * Recent list). Called from the editor once it mounts — deliberately not a
 * side effect of `getWorkbook`, which also runs on every server refetch
 * and must stay a pure read. Revalidating the `/sheets` layout is what
 * makes Recent reflect this open the next time the user navigates back.
 */
export async function recordWorkbookOpenedAction(workbookId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'read'))) return;

  await db
    .update(workbookMembers)
    .set({ lastOpenedAt: now() })
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, userId),
      ),
    );
  revalidatePath('/sheets', 'layout');
}

export interface WorkbookSnapshot {
  name: string;
  namedRangesJson: string;
  sheets: { id: string; revision: string; name: string; position: number }[];
}

/**
 * Cheap poll target: everything the editor needs to decide whether someone
 * *else* changed the workbook since it loaded — compared field by field
 * against the client's own known revisions/names, never as one opaque token
 * (the client's own saves change `updatedAt` too, and must not count as a
 * remote change). `null` when the caller lost access or the workbook is
 * gone, so the client can say so rather than spinning.
 */
export async function getWorkbookSnapshotAction(workbookId: string): Promise<WorkbookSnapshot | null> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'read'))) return null;

  const [workbook] = await db
    .select({ name: workbooks.name, namedRangesJson: workbooks.namedRangesJson })
    .from(workbooks)
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)))
    .limit(1);
  if (!workbook) return null;

  const sheetRows = await db
    .select({ id: sheets.id, revision: sheets.revision, name: sheets.name, position: sheets.position })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)))
    .orderBy(asc(sheets.position));

  return { name: workbook.name, namedRangesJson: workbook.namedRangesJson, sheets: sheetRows };
}

export interface SaveSheetInput {
  cellsJson: string;
  rowCount: number;
  colCount: number;
  colWidthsJson: string;
  frozenRows: number;
  frozenCols: number;
}

export type SaveSheetResult =
  | { ok: true; revision: string }
  | { ok: false; error: string; conflict?: boolean; denied?: boolean };

function clampCount(raw: number, max: number): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, max);
}

/**
 * The one write path for a sheet's content and layout (cells, size, column
 * widths, frozen panes), replacing the earlier separate cells/size/widths
 * actions — one atomic row update, one revision check.
 *
 * Optimistic concurrency: the client sends the `revision` it loaded (or
 * last saved); if the row has moved on, the save is refused with
 * `conflict: true` and nothing is written. Two people editing the same
 * sheet therefore see a conflict instead of silently overwriting each other.
 *
 * Every field is re-validated here regardless of what the client already
 * did — a server action is a public endpoint. Sizes are clamped into
 * `[1, MAX_*]` (a crafted `rowCount` of a million would otherwise make the
 * grid try to render a million rows for every member), the cells blob is
 * size-capped and run through the same sanitizer that guards import, and
 * widths/frozen counts are clamped.
 */
export async function saveSheetAction(
  workbookId: string,
  sheetId: string,
  input: SaveSheetInput,
  expectedRevision: string,
): Promise<SaveSheetResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) {
    return { ok: false, denied: true, error: DENIED_EDIT_MESSAGE };
  }

  if (typeof input.cellsJson !== 'string' || input.cellsJson.length > MAX_CELLS_JSON_BYTES) {
    return {
      ok: false,
      error: 'This sheet is too large to save. Move some data to another sheet or workbook.',
    };
  }
  const rowCount = clampCount(input.rowCount, MAX_ROW_COUNT);
  const colCount = clampCount(input.colCount, MAX_COL_COUNT);
  const cellsJson = serializeCellsJson(parseCellsJson(input.cellsJson));
  let widths: Record<string, number> = {};
  try {
    widths = sanitizeColumnWidths(JSON.parse(typeof input.colWidthsJson === 'string' ? input.colWidthsJson : '{}'));
  } catch {
    widths = {};
  }
  const frozenRows = Math.min(clampCount(input.frozenRows + 1, 6) - 1, rowCount - 1);
  const frozenCols = Math.min(clampCount(input.frozenCols + 1, 6) - 1, colCount - 1);

  const [current] = await db
    .select({ revision: sheets.revision })
    .from(sheets)
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)))
    .limit(1);
  if (!current) return { ok: false, error: 'This sheet no longer exists.' };
  if (current.revision !== expectedRevision) {
    return { ok: false, conflict: true, error: 'This sheet was changed by someone else.' };
  }

  const nextRevision = newId();
  await db
    .update(sheets)
    .set({
      cellsJson,
      rowCount,
      colCount,
      colWidthsJson: serializeColumnWidthsJson(widths),
      frozenRows,
      frozenCols,
      revision: nextRevision,
      updatedAt: now(),
    })
    .where(
      and(
        eq(sheets.id, sheetId),
        eq(sheets.tenantId, tenantId),
        eq(sheets.workbookId, workbookId),
        eq(sheets.revision, expectedRevision),
      ),
    );

  // Re-read rather than trusting an affected-row count — the opaque SDK
  // client's update result shape differs between SQLite and Postgres, and
  // this check must be dialect-independent. Only one of two racing saves
  // from the same starting revision can have written `nextRevision`.
  const [after] = await db
    .select({ revision: sheets.revision })
    .from(sheets)
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId)))
    .limit(1);
  if (after?.revision !== nextRevision) {
    return { ok: false, conflict: true, error: 'This sheet was changed by someone else.' };
  }

  await touchWorkbook(db, tenantId, workbookId);
  return { ok: true, revision: nextRevision };
}

/**
 * Remembers which sheet tab the workbook opens on. Editors only — a
 * viewer's tab choice is theirs alone (kept client-side) and must not move
 * the workbook for everyone else. Doesn't bump `updatedAt`: switching tabs
 * isn't a content change and shouldn't reorder the Home list.
 */
export async function setActiveSheetAction(workbookId: string, sheetId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  const [sheet] = await db
    .select({ id: sheets.id })
    .from(sheets)
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)))
    .limit(1);
  if (!sheet) return;

  await db
    .update(workbooks)
    .set({ activeSheetId: sheetId })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
}

export type AddSheetResult =
  | { ok: true; sheet: { id: string; name: string; revision: string } }
  | { ok: false; error: string; denied?: boolean };

export async function addSheetAction(workbookId: string): Promise<AddSheetResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) {
    return { ok: false, denied: true, error: DENIED_EDIT_MESSAGE };
  }

  const existing = await db
    .select({ position: sheets.position, name: sheets.name })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)))
    .orderBy(asc(sheets.position));

  const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.position)) + 1;
  const name = nextDefaultSheetName(existing.map((s) => s.name));

  const timestamp = now();
  const sheetId = newId();
  const revision = newId();

  await db.insert(sheets).values({
    id: sheetId,
    tenantId,
    workbookId,
    name,
    position: nextPosition,
    rowCount: DEFAULT_ROW_COUNT,
    colCount: DEFAULT_COL_COUNT,
    cellsJson: '{}',
    colWidthsJson: '{}',
    revision,
    updatedAt: timestamp,
  });

  await touchWorkbook(db, tenantId, workbookId);
  return { ok: true, sheet: { id: sheetId, name, revision } };
}

export async function renameSheetAction(
  sheetId: string,
  workbookId: string,
  name: string,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return DENIED_EDIT;

  const others = await db
    .select({ id: sheets.id, name: sheets.name })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)));
  if (!others.some((s) => s.id === sheetId)) return { ok: false, error: 'This sheet no longer exists.' };

  const error = validateSheetName(
    name,
    others.filter((s) => s.id !== sheetId).map((s) => s.name),
  );
  if (error) return { ok: false, error };

  await db
    .update(sheets)
    .set({ name: normalizeSheetName(name), updatedAt: now() })
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  await touchWorkbook(db, tenantId, workbookId);
  return { ok: true };
}

/**
 * Persists the whole named-ranges map in one write — the client already
 * holds the authoritative set (it's mirrored into the HyperFormula engine
 * for live formula resolution), so there's no per-item CRUD action here.
 * Sanitized server-side (`_lib/named-ranges.ts`) so a crafted request can't
 * store a shape the workbook then fails to load.
 */
export async function saveNamedRangesAction(
  workbookId: string,
  namedRangesJson: string,
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return DENIED_EDIT;

  if (typeof namedRangesJson !== 'string' || namedRangesJson.length > MAX_NAMED_RANGES_JSON_BYTES) {
    return { ok: false, error: 'Too many named ranges to save.' };
  }
  let clean: Record<string, string>;
  try {
    clean = sanitizeNamedRanges(JSON.parse(namedRangesJson));
  } catch {
    return { ok: false, error: 'Named ranges could not be saved.' };
  }

  await db
    .update(workbooks)
    .set({ namedRangesJson: JSON.stringify(clean), updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  return { ok: true };
}

export async function deleteSheetAction(sheetId: string, workbookId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return DENIED_EDIT;

  const remaining = await db
    .select({ id: sheets.id, position: sheets.position })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)))
    .orderBy(asc(sheets.position));

  if (!remaining.some((s) => s.id === sheetId)) return { ok: true };
  // Always keep at least one sheet per workbook.
  if (remaining.length <= 1) return { ok: false, error: 'A workbook needs at least one sheet.' };

  await db
    .delete(sheets)
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  const [workbook] = await db
    .select({ activeSheetId: workbooks.activeSheetId })
    .from(workbooks)
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)))
    .limit(1);

  if (workbook?.activeSheetId === sheetId) {
    const fallback = remaining.find((s) => s.id !== sheetId);
    if (fallback) {
      await db
        .update(workbooks)
        .set({ activeSheetId: fallback.id })
        .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
    }
  }

  await touchWorkbook(db, tenantId, workbookId);
  return { ok: true };
}

export async function reorderSheetsAction(
  workbookId: string,
  orderedSheetIds: string[],
): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return DENIED_EDIT;

  const existing = await db
    .select({ id: sheets.id })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)));
  const existingIds = new Set(existing.map((s) => s.id));
  const requested = Array.isArray(orderedSheetIds) ? orderedSheetIds : [];
  const isPermutation =
    requested.length === existingIds.size &&
    new Set(requested).size === requested.length &&
    requested.every((id) => existingIds.has(id));
  if (!isPermutation) return { ok: false, error: 'Sheet order is out of date. Reload and try again.' };

  for (const [position, sheetId] of requested.entries()) {
    await db
      .update(sheets)
      .set({ position, updatedAt: now() })
      .where(
        and(eq(sheets.id, sheetId), eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)),
      );
  }

  await touchWorkbook(db, tenantId, workbookId);
  return { ok: true };
}

export async function renameWorkbookAction(workbookId: string, name: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return DENIED_EDIT;

  const clean = normalizeWorkbookName(name);
  if (!clean) return { ok: false, error: 'Enter a workbook name.' };

  await db
    .update(workbooks)
    .set({ name: clean, updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath('/sheets', 'layout');
  return { ok: true };
}

/** Soft delete — the workbook moves to Home's "Recently deleted" section, where its owner can restore it or delete it for good. */
export async function deleteWorkbookAction(workbookId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'owner'))) return;

  await db
    .update(workbooks)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath('/sheets', 'layout');
  redirect('/sheets');
}

export async function restoreWorkbookAction(workbookId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  const role = await resolveWorkbookRole(db, tenantId, userId, workbookId, { includeDeleted: true });
  if (role !== 'owner') return { ok: false, error: 'Only an owner can restore this workbook.' };

  await db
    .update(workbooks)
    .set({ deletedAt: null, updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath('/sheets', 'layout');
  return { ok: true };
}

/** Hard delete of an already soft-deleted workbook — sheets, memberships, then the row (no FK cascade on either dialect). */
export async function purgeWorkbookAction(workbookId: string): Promise<ActionResult> {
  const { db, userId, tenantId } = await getContext();
  const role = await resolveWorkbookRole(db, tenantId, userId, workbookId, { includeDeleted: true });
  if (role !== 'owner') return { ok: false, error: 'Only an owner can delete this workbook.' };

  const [workbook] = await db
    .select({ deletedAt: workbooks.deletedAt })
    .from(workbooks)
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)))
    .limit(1);
  if (!workbook) return { ok: true };
  if (workbook.deletedAt === null) {
    return { ok: false, error: 'Delete the workbook first, then delete it permanently.' };
  }

  await db.delete(sheets).where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)));
  await db
    .delete(workbookMembers)
    .where(and(eq(workbookMembers.workbookId, workbookId), eq(workbookMembers.tenantId, tenantId)));
  await db.delete(workbooks).where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath('/sheets', 'layout');
  return { ok: true };
}

export interface FinanceRateResult {
  rate: number;
  asOf: number;
}

/**
 * Resolves currency rates for FINANCE() calls, one batched round-trip per
 * distinct base currency. Rates are cached instance-wide (public market
 * data), same rationale as sovereign-ledger's ledger_fx_rates — but the
 * *action* is still session-gated: it writes the cache table and makes
 * outbound requests, so it authorizes inside the action like every other
 * mutation here rather than relying on the proxy alone. Codes are validated
 * and the pair count is capped before anything reaches the provider.
 */
export async function getFinanceRatesAction(
  pairs: { base: string; quote: string }[],
): Promise<Record<string, FinanceRateResult | null>> {
  await sdk.auth.requireSession();
  const client = (await sdk.db.getClient()) as Db;
  const nowTs = now();
  const result: Record<string, FinanceRateResult | null> = {};
  const toFetch = new Map<string, Set<string>>();

  const requested = Array.isArray(pairs) ? pairs.slice(0, MAX_FINANCE_PAIRS_PER_REQUEST) : [];
  for (const pair of requested) {
    if (!pair || typeof pair.base !== 'string' || typeof pair.quote !== 'string') continue;
    const base = pair.base.trim().toUpperCase();
    const quote = pair.quote.trim().toUpperCase();
    if (!isCurrencyCode(base) || !isCurrencyCode(quote)) continue;
    const key = pairKey(base, quote);
    if (key in result) continue;
    if (base === quote) {
      result[key] = { rate: 1, asOf: nowTs };
      continue;
    }

    const [cached] = await client
      .select()
      .from(financeRateCache)
      .where(and(eq(financeRateCache.base, base), eq(financeRateCache.quote, quote)))
      .limit(1);

    if (cached && nowTs - cached.fetchedAt < FINANCE_RATE_TTL_SECONDS) {
      result[key] = { rate: Number(cached.rate), asOf: cached.asOf };
      continue;
    }

    if (!toFetch.has(base)) toFetch.set(base, new Set());
    toFetch.get(base)?.add(quote);
  }

  for (const [base, quotes] of toFetch) {
    const fetched = await FX_PROVIDER.getRates(base, [...quotes]);

    if (!fetched) {
      // Provider unreachable — serve stale cache if we have it, else null.
      for (const quote of quotes) {
        const key = pairKey(base, quote);
        const [cached] = await client
          .select()
          .from(financeRateCache)
          .where(and(eq(financeRateCache.base, base), eq(financeRateCache.quote, quote)))
          .limit(1);
        result[key] = cached ? { rate: Number(cached.rate), asOf: cached.asOf } : null;
      }
      continue;
    }

    const asOf = Math.floor(new Date(fetched.date).getTime() / 1000) || nowTs;
    for (const quote of quotes) {
      const key = pairKey(base, quote);
      const rate = fetched.rates[quote];
      if (rate === undefined) {
        result[key] = null;
        continue;
      }
      result[key] = { rate, asOf };
      const rateStr = String(rate);
      await client
        .insert(financeRateCache)
        .values({ base, quote, rate: rateStr, asOf, fetchedAt: nowTs, source: FX_PROVIDER.id })
        .onConflictDoUpdate({
          target: [financeRateCache.base, financeRateCache.quote],
          set: { rate: rateStr, asOf, fetchedAt: nowTs, source: FX_PROVIDER.id },
        });
    }
  }

  return result;
}
