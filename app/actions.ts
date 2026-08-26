'use server';

import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import { financeRateCache, sheets, workbookMembers, workbooks } from './_db/schema';
import { DEFAULT_COL_COUNT, DEFAULT_ROW_COUNT } from './_lib/config';
import { type ActionResult, type Db, getContext, now } from './_lib/context';
import { formString } from './_lib/formUtils';
import { frankfurterProvider } from './_lib/frankfurter';
import type { FxRateProvider } from './_lib/fx-rate-provider';
import { pairKey } from './_lib/finance-function';
import { newId } from './_lib/ids';
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

/** A user's role for one workbook, or `null` if they have no `workbook_members` row at all. */
export async function resolveWorkbookRole(
  db: Db,
  tenantId: string,
  userId: string,
  workbookId: string,
): Promise<WorkbookMemberRole | null> {
  const [membership] = await db
    .select({ role: workbookMembers.role })
    .from(workbookMembers)
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, userId),
      ),
    );
  return membership?.role ?? null;
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

export interface WorkbookOverviewItem {
  id: string;
  name: string;
  updatedAt: number;
  role: WorkbookMemberRole;
}

/** Every workbook the signed-in user has any `workbook_members` role on — owner or shared. */
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

  const name = formString(formData, 'name') || 'Untitled workbook';
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
    updatedAt: timestamp,
  });

  revalidatePath('/sheets');
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
    name: workbook.name || 'Untitled workbook',
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
      updatedAt: timestamp,
    })),
  );

  revalidatePath('/sheets');
  redirect(`/sheets/s/${workbookId}`);
}

export interface WorkbookWithSheets {
  workbook: { id: string; name: string; activeSheetId: string | null; namedRangesJson: string };
  role: WorkbookMemberRole;
  sheets: {
    id: string;
    name: string;
    position: number;
    rowCount: number;
    colCount: number;
    cellsJson: string;
    colWidthsJson: string;
  }[];
}

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
    })),
  };
}

export async function saveSheetCellsAction(
  workbookId: string,
  sheetId: string,
  cellsJson: string,
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  await db
    .update(sheets)
    .set({ cellsJson, updatedAt: now() })
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));
}

export async function setActiveSheetAction(workbookId: string, sheetId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'read'))) return;

  await db
    .update(workbooks)
    .set({ activeSheetId: sheetId, updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
}

export async function addSheetAction(
  workbookId: string,
): Promise<{ id: string; name: string } | null> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return null;

  const existing = await db
    .select({ position: sheets.position, name: sheets.name })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)))
    .orderBy(asc(sheets.position));

  const nextPosition = existing.length === 0 ? 0 : Math.max(...existing.map((s) => s.position)) + 1;
  const existingNames = new Set(existing.map((s) => s.name));
  let n = existing.length + 1;
  let name = `Sheet${n}`;
  while (existingNames.has(name)) {
    n += 1;
    name = `Sheet${n}`;
  }

  const timestamp = now();
  const sheetId = newId();

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
    updatedAt: timestamp,
  });

  revalidatePath(`/sheets/s/${workbookId}`);
  return { id: sheetId, name };
}

export async function renameSheetAction(
  sheetId: string,
  workbookId: string,
  name: string,
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  await db
    .update(sheets)
    .set({ name: trimmed, updatedAt: now() })
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  revalidatePath(`/sheets/s/${workbookId}`);
}

/**
 * Grows (never shrinks) a sheet's stored dimensions — used by CSV import
 * when the imported file is larger than the sheet's current grid, so the
 * new cells are actually rendered/persisted on future loads (`SheetGrid`
 * renders exactly `rowCount`/`colCount` rows/cols, not whatever the client
 * HyperFormula engine happens to hold in memory).
 */
export async function resizeSheetAction(
  sheetId: string,
  workbookId: string,
  rowCount: number,
  colCount: number,
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  await db
    .update(sheets)
    .set({ rowCount, colCount, updatedAt: now() })
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  revalidatePath(`/sheets/s/${workbookId}`);
}

/**
 * Persists the whole column-widths map in one write, same pattern as
 * `saveNamedRangesAction` below — the client (`SheetGrid.tsx`'s resize
 * handle, via `WorkbookView.tsx`'s `columnWidthsMaps`) already holds the
 * authoritative per-column map, so there's no per-column CRUD action here.
 * Called once per resize gesture (on pointer-up), not per pixel dragged.
 */
export async function saveColumnWidthsAction(
  sheetId: string,
  workbookId: string,
  colWidthsJson: string,
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  await db
    .update(sheets)
    .set({ colWidthsJson, updatedAt: now() })
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  revalidatePath(`/sheets/s/${workbookId}`);
}

/**
 * Persists the whole named-ranges map in one write — the client already
 * holds the authoritative set (it's mirrored into the HyperFormula engine
 * for live formula resolution), so there's no per-item CRUD action here,
 * matching how cell format overrides are saved as one map too.
 */
export async function saveNamedRangesAction(
  workbookId: string,
  namedRangesJson: string,
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  await db
    .update(workbooks)
    .set({ namedRangesJson, updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath(`/sheets/s/${workbookId}`);
}

export async function deleteSheetAction(sheetId: string, workbookId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  const remaining = await db
    .select({ id: sheets.id })
    .from(sheets)
    .where(and(eq(sheets.workbookId, workbookId), eq(sheets.tenantId, tenantId)));

  // Always keep at least one sheet per workbook.
  if (remaining.length <= 1) return;

  await db
    .delete(sheets)
    .where(and(eq(sheets.id, sheetId), eq(sheets.tenantId, tenantId), eq(sheets.workbookId, workbookId)));

  const [workbook] = await db
    .select({ activeSheetId: workbooks.activeSheetId })
    .from(workbooks)
    .where(eq(workbooks.id, workbookId))
    .limit(1);

  if (workbook?.activeSheetId === sheetId) {
    const fallback = remaining.find((s) => s.id !== sheetId);
    if (fallback) {
      await db
        .update(workbooks)
        .set({ activeSheetId: fallback.id, updatedAt: now() })
        .where(eq(workbooks.id, workbookId));
    }
  }

  revalidatePath(`/sheets/s/${workbookId}`);
}

export async function reorderSheetsAction(
  workbookId: string,
  orderedSheetIds: string[],
): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'write'))) return;

  await Promise.all(
    orderedSheetIds.map((sheetId, position) =>
      db
        .update(sheets)
        .set({ position, updatedAt: now() })
        .where(
          and(
            eq(sheets.id, sheetId),
            eq(sheets.workbookId, workbookId),
            eq(sheets.tenantId, tenantId),
          ),
        ),
    ),
  );

  revalidatePath(`/sheets/s/${workbookId}`);
}

export async function deleteWorkbookAction(workbookId: string): Promise<void> {
  const { db, userId, tenantId } = await getContext();
  if (!(await hasWorkbookAccess(db, tenantId, userId, workbookId, 'owner'))) return;

  await db
    .update(workbooks)
    .set({ deletedAt: now(), updatedAt: now() })
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));

  revalidatePath('/sheets');
  redirect('/sheets');
}

export interface FinanceRateResult {
  rate: number;
  asOf: number;
}

/**
 * Resolves currency rates for FINANCE() calls, one batched round-trip per
 * distinct base currency. No auth/tenant scoping — rates are cached
 * instance-wide (public market data), same rationale as
 * sovereign-ledger's ledger_fx_rates. Unchanged by workbook sharing: this
 * isn't workbook-scoped data.
 */
export async function getFinanceRatesAction(
  pairs: { base: string; quote: string }[],
): Promise<Record<string, FinanceRateResult | null>> {
  const client = (await sdk.db.getClient()) as Db;
  const nowTs = now();
  const result: Record<string, FinanceRateResult | null> = {};
  const toFetch = new Map<string, Set<string>>();

  for (const { base: rawBase, quote: rawQuote } of pairs) {
    const base = rawBase.trim().toUpperCase();
    const quote = rawQuote.trim().toUpperCase();
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
