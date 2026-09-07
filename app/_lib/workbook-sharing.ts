'use server';

import { headers } from 'next/headers';
import { sdk } from '@sovereignfs/sdk';
import type { DirectoryUser } from '@sovereignfs/sdk';
import { and, eq } from 'drizzle-orm';
import { workbookMembers, workbooks } from '../_db/schema';
import type { ActionResult } from './context';
import { getContext, now } from './context';
import { type WorkbookMemberRole, isWorkbookMemberRole } from './workbook-rules';

/**
 * Best-effort in-app notification for a share or a role change — a failure
 * here (the notification center being briefly unavailable) must never block
 * an invite that already succeeded. In-app only, no email — smaller
 * permission surface than Docs' equivalent.
 */
async function notifyMember(recipientUserId: string, title: string, body: string, workbookId: string) {
  try {
    await sdk.notifications.send(
      { recipientUserId, title, body, url: `/sheets/s/${workbookId}` },
      await headers(),
    );
  } catch {
    // See docblock above.
  }
}

function roleLabel(role: WorkbookMemberRole): string {
  if (role === 'owner') return 'an owner';
  if (role === 'editor') return 'an editor';
  return 'a viewer';
}

/**
 * Only a workbook's owner manages sharing (invite/remove/role-change) or
 * sees the member list — same gating as Docs' `folder-sharing.ts`.
 */
async function requireOwner(workbookId: string) {
  const { db, userId, tenantId, userName } = await getContext();
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
  if (!membership || membership.role !== 'owner' || membership.deletedAt !== null) {
    return {
      ok: false as const,
      error: "You don't have permission to manage sharing for this workbook.",
    };
  }
  return { ok: true as const, db, userId, tenantId, userName };
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
  /** The signed-in user's own row — rendered as "You", with "Leave" instead of "Remove". */
  isSelf: boolean;
}

export async function listWorkbookMembers(workbookId: string): Promise<WorkbookMemberView[]> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return [];
  const { db, tenantId, userId } = context;

  const rows = await db
    .select({ userId: workbookMembers.userId, role: workbookMembers.role, joinedAt: workbookMembers.joinedAt })
    .from(workbookMembers)
    .where(and(eq(workbookMembers.workbookId, workbookId), eq(workbookMembers.tenantId, tenantId)));
  if (rows.length === 0) return [];

  const profiles = await sdk.directory.resolveUsers({ ids: rows.map((row) => row.userId) });
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));

  return rows
    .sort((a, b) => a.joinedAt - b.joinedAt)
    .map((row) => {
      const profile = profileById.get(row.userId);
      return {
        userId: row.userId,
        role: row.role,
        name: profile?.name ?? null,
        email: profile?.email ?? 'Unknown user',
        isSelf: row.userId === userId,
      };
    });
}

/** Adds a new member. An existing member's role is changed via `updateWorkbookMemberRole` instead. */
export async function inviteWorkbookMember(
  workbookId: string,
  _prevState: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return context;
  const { db, tenantId, userId, userName } = context;

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
    return {
      ok: false,
      error: `${invitedUser.name ?? invitedUser.email} already has access. Change their role in the list above.`,
    };
  }

  await db.insert(workbookMembers).values({
    workbookId,
    userId: invitedUserId,
    tenantId,
    role: roleInput,
    invitedBy: userId,
    joinedAt: now(),
  });
  await notifyMember(
    invitedUserId,
    `${userName} shared "${workbook.name}" with you`,
    `You can open it as ${roleLabel(roleInput)}.`,
    workbookId,
  );

  return { ok: true, message: `Added ${invitedUser.name ?? invitedUser.email} as ${roleInput}.` };
}

/** Changes an existing member's role in place — the last owner can't be demoted. */
export async function updateWorkbookMemberRole(
  workbookId: string,
  memberUserId: string,
  role: string,
): Promise<ActionResult> {
  const context = await requireOwner(workbookId);
  if (!context.ok) return context;
  const { db, tenantId, userId, userName } = context;

  if (!isWorkbookMemberRole(role)) return { ok: false, error: 'Invalid role.' };

  const members = await db
    .select({ userId: workbookMembers.userId, role: workbookMembers.role })
    .from(workbookMembers)
    .where(and(eq(workbookMembers.workbookId, workbookId), eq(workbookMembers.tenantId, tenantId)));
  const target = members.find((member) => member.userId === memberUserId);
  if (!target) return { ok: false, error: 'That person no longer has access.' };
  if (target.role === role) return { ok: true };

  const ownerCount = members.filter((member) => member.role === 'owner').length;
  if (target.role === 'owner' && role !== 'owner' && ownerCount <= 1) {
    return { ok: false, error: 'The last owner cannot be demoted. Make someone else an owner first.' };
  }

  await db
    .update(workbookMembers)
    .set({ role })
    .where(
      and(
        eq(workbookMembers.workbookId, workbookId),
        eq(workbookMembers.tenantId, tenantId),
        eq(workbookMembers.userId, memberUserId),
      ),
    );

  if (memberUserId !== userId) {
    const [workbook] = await db
      .select({ name: workbooks.name })
      .from(workbooks)
      .where(and(eq(workbooks.id, workbookId), eq(workbooks.tenantId, tenantId)));
    await notifyMember(
      memberUserId,
      `${userName} changed your access to "${workbook?.name ?? 'a workbook'}"`,
      `You are now ${roleLabel(role)}.`,
      workbookId,
    );
  }

  return { ok: true };
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
    return { ok: false, error: 'The last owner cannot be removed. Make someone else an owner first.' };
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

  return { ok: true };
}
