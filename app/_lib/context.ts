import { sdk } from '@sovereignfs/sdk';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { now } from './formUtils';

/**
 * Shared server-action result shape, per `docs/plugin-development.md`'s
 * `useActionState` convention. `denied` marks an authorization failure —
 * the caller's role changed (or the workbook was deleted) since the page
 * loaded — so the client can stop retrying and tell the user plainly,
 * instead of treating it like a transient network error.
 */
export type ActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string; denied?: boolean };

export const DENIED_EDIT_MESSAGE =
  "You can't edit this workbook anymore. Reload to see your current access.";
export const DENIED_EDIT: ActionResult = { ok: false, denied: true, error: DENIED_EDIT_MESSAGE };

// The SDK intentionally returns an opaque dialect-agnostic DB client.
export type Db = BaseSQLiteDatabase<'async', unknown, Record<string, unknown>>;

/** Resolves the current session + DB client, shared by every `'use server'` action in this plugin. */
export async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return {
    db,
    userId: session.user.id,
    tenantId: session.user.tenantId,
    userName: session.user.name ?? session.user.email,
  };
}

export { now };
