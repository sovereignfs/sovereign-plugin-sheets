import { sdk } from '@sovereignfs/sdk';
import type { DeletionContext, DeletionResult } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { sheets, workbookMembers, workbooks } from '../_db/schema';

// The SDK intentionally returns an opaque dialect-agnostic DB client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = BaseSQLiteDatabase<'async', any, any>;

export async function registerPortabilityHandlers(): Promise<void> {
  await sdk.portability.provideDelete(deleteAllSheetsData);
}

/**
 * Mirrors Docs' `deleteAllDocsData` (`plugins/sovereign-plugin-docs.local/app/_lib/portability.ts`):
 * a workbook the deleting user doesn't own just loses their membership row;
 * one they do own gets handed to a successor member (preferring an existing
 * `owner`-role member, else the earliest-joined) so it survives; only a
 * workbook with no member left at all is hard-deleted, along with its sheets.
 *
 * No nested-ownership branch is needed here (unlike Docs' folder/document
 * split) — a `sheets` row has no owner column of its own (see schema.ts's
 * docblock on `workbookMembers`: "access control lives entirely here"), so a
 * workbook's membership set is the *only* thing that can ever have a stake
 * in its contents.
 */
async function deleteAllSheetsData(ctx: DeletionContext): Promise<DeletionResult> {
  const db = ctx.db as Db;
  let deleted = 0;

  const memberships = await db
    .select()
    .from(workbookMembers)
    .where(and(eq(workbookMembers.tenantId, ctx.tenantId), eq(workbookMembers.userId, ctx.userId)));

  for (const membership of memberships) {
    const [workbook] = await db
      .select({ id: workbooks.id, ownerUserId: workbooks.ownerUserId })
      .from(workbooks)
      .where(and(eq(workbooks.id, membership.workbookId), eq(workbooks.tenantId, ctx.tenantId)));

    if (!workbook) {
      // Dangling membership row with no workbook behind it.
      await db
        .delete(workbookMembers)
        .where(
          and(
            eq(workbookMembers.tenantId, ctx.tenantId),
            eq(workbookMembers.workbookId, membership.workbookId),
            eq(workbookMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    if (workbook.ownerUserId !== ctx.userId) {
      // A share on someone else's workbook — just leave it.
      await db
        .delete(workbookMembers)
        .where(
          and(
            eq(workbookMembers.tenantId, ctx.tenantId),
            eq(workbookMembers.workbookId, workbook.id),
            eq(workbookMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
      continue;
    }

    const allMembers = await db
      .select()
      .from(workbookMembers)
      .where(
        and(eq(workbookMembers.tenantId, ctx.tenantId), eq(workbookMembers.workbookId, workbook.id)),
      );
    const successors = allMembers.filter((m) => m.userId !== ctx.userId);

    if (successors.length > 0) {
      const promotee =
        successors.find((m) => m.role === 'owner') ??
        [...successors].sort((a, b) => a.joinedAt - b.joinedAt)[0];
      if (promotee) {
        await db
          .update(workbooks)
          .set({ ownerUserId: promotee.userId })
          .where(and(eq(workbooks.id, workbook.id), eq(workbooks.tenantId, ctx.tenantId)));
        if (promotee.role !== 'owner') {
          await db
            .update(workbookMembers)
            .set({ role: 'owner' })
            .where(
              and(
                eq(workbookMembers.tenantId, ctx.tenantId),
                eq(workbookMembers.workbookId, workbook.id),
                eq(workbookMembers.userId, promotee.userId),
              ),
            );
        }
      }
      await db
        .delete(workbookMembers)
        .where(
          and(
            eq(workbookMembers.tenantId, ctx.tenantId),
            eq(workbookMembers.workbookId, workbook.id),
            eq(workbookMembers.userId, ctx.userId),
          ),
        );
      deleted += 1;
    } else {
      // Sole member, no one else has access — nothing left to preserve. No
      // FK cascade is defined on either dialect (schema.ts), so sheets and
      // membership rows must be deleted explicitly before the workbook row.
      await db.delete(sheets).where(and(eq(sheets.tenantId, ctx.tenantId), eq(sheets.workbookId, workbook.id)));
      await db
        .delete(workbookMembers)
        .where(and(eq(workbookMembers.tenantId, ctx.tenantId), eq(workbookMembers.workbookId, workbook.id)));
      await db
        .delete(workbooks)
        .where(and(eq(workbooks.id, workbook.id), eq(workbooks.tenantId, ctx.tenantId)));
      deleted += 1;
    }
  }

  return { deleted };
}
