'use server';

import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { workbookMembers, workbooks } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { type WorkbookMemberRole, isWorkbookMemberRole } from './workbook-rules';

/**
 * Best-effort in-app notification for a new share — a failure here (the
 * notification center being briefly unavailable) must never block an invite
 * that already succeeded. In-app only, no email — smaller permission
 * surface than Docs' equivalent (see docs/adhoc/home-and-sharing.md's
 * "Open questions").
 */
async function notifyMember(
  recipientUserId: string,
  workbookName: string,
  workbookId: string,
  role: WorkbookMemberRole,
) {
  try {
    await sdk.notifications.send(
      {
        recipientUserId,
        title: 'Shared a workbook with you',
        body: `You were added to "${workbookName}" as ${role}.`,
        url: `/sheets/s/${workbookId}`,
      },
      await headers(),
    );
  } catch {
    // See docblock above.
  }
}

/**
 * Only a workbook's owner manages sharing (invite/remove/role-change) or
 * sees the member list — same gating as Docs' `folder-sharing.ts`.
 */
async function requireOwner(workbookId: string) {
  const { db, userId, tenantId } = await getContext();
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
  if (!membership || membership.role !== 'owner') {
    return {
      ok: false as const,
      error: "You don't have permission to manage sharing for this workbook.",
    };
  }
  return { ok: true as const, db, userId, tenantId };
}

/** Directory typeahead for the share dialog's member picker. */
export async function searchWorkbookDirectoryUsers(
  workbookId: string,
  query: string,
): Promise<DirectoryUser[]> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return [];
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];
  return sdk.directory.searchUsers({ query: trimmed, limit: 8 });
}

export interface WorkbookMemberView {
  userId: string;
  role: WorkbookMemberRole;
  name: string | null;
  email: string;
}

export async function listWorkbookMembers(workbookId: string): Promise<WorkbookMemberView[]> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return [];
  const { db, tenantId } = context;

  const rows = await db
    .select({ userId: workbookMembers.userId, role: workbookMembers.role })
    .from(workbookMembers)
    .where(and(eq(workbookMembers.workbookId, workbookId), eq(workbookMembers.tenantId, tenantId)));
  if (rows.length === 0) return [];

  const profiles = await sdk.directory.resolveUsers({ ids: rows.map((row) => row.userId) });
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return rows.map((row) => {
    const profile = profileById.get(row.userId);
    return {
      userId: row.userId,
      role: row.role,
      name: profile?.name ?? null,
      email: profile?.email ?? 'Unknown user',
    };
  });
}

/** Adds a new member or changes an existing one's role — one action for both. */
export async function inviteWorkbookMember(
  workbookId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return context;
  const { db, tenantId, userId } = context;

  const invitedUserId = String(formData.get('userId') ?? '').trim();
  const roleInput = String(formData.get('role') ?? '').trim();
  if (!invitedUserId) return { ok: false, error: 'Choose a person to add.' };
  if (!isWorkbookMemberRole(roleInput)) return { ok: false, error: 'Invalid role.' };

  const [invitedUser] = await sdk.directory.resolveUsers({ ids: [invitedUserId] });
  if (!invitedUser) return { ok: false, error: 'That user could not be found.' };

  const [workbook] = await db
    .select({ name: workbooks.name })
    .from(workbooks)
    .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
  if (!workbook) return { ok: false, error: 'Workbook not found.' };

  const [existing] = await db
    .select({ role: workbookMembers.role })
    .from(workbookMembers)
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, invitedUserId),
      ),
    );

  if (existing) {
    if (existing.role === 'owner' && roleInput !== 'owner') {
      const owners = await db
        .select({ userId: workbookMembers.userId })
        .from(workbookMembers)
        .where(
          and(
            eq(workbookMembers.workbookId, workbookId),
            eq(workbookMembers.tenantId, tenantId),
            eq(workbookMembers.role, 'owner'),
          ),
        );
      if (owners.length <= 1) return { ok: false, error: 'The last owner cannot be demoted.' };
    }
    await db
      .update(workbookMembers)
      .set({ role: roleInput })
      .where(
        and(
          eq(workbookMembers.workbookId, workbookId),
          eq(workbookMembers.tenantId, tenantId),
          eq(workbookMembers.userId, invitedUserId),
        ),
      );
  } else {
    await db.insert(workbookMembers).values({
      workbookId,
      userId: invitedUserId,
      tenantId,
      role: roleInput,
      invitedBy: userId,
      joinedAt: now(),
    });
    await notifyMember(invitedUserId, workbook.name, workbookId, roleInput);
  }

  revalidatePath(`/sheets/s/${workbookId}`);
  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${roleInput}.` };
}

export async function removeWorkbookMember(
  workbookId: string,
  memberUserId: string,
): Promise<ActionResult> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return context;
  const { db, tenantId } = context;

  const members = await db
    .select({ userId: workbookMembers.userId, role: workbookMembers.role })
    .from(workbookMembers)
    .where(and(eq(workbookMembers.workbookId, workbookId), eq(workbookMembers.tenantId, tenantId)));
  const target = members.find((member) => member.userId === memberUserId);
  if (!target) return { ok: true };

  // Callers reach this point only as an existing owner (requireOwner), so if
  // exactly one owner-role row remains, it can only be the caller — this
  // blocks the last owner from removing themselves (or, equivalently here,
  // anyone) without needing a separate "is this me" check.
  const ownerCount = members.filter((member) => member.role === 'owner').length;
  if (target.role === 'owner' && ownerCount <= 1) {
    return { ok: false, error: 'The last owner cannot be removed.' };
  }

  await db
    .delete(workbookMembers)
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, memberUserId),
      ),
    );

  revalidatePath(`/sheets/s/${workbookId}`);
  return { ok: true };
}
