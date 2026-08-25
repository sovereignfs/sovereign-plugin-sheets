import { sdk } from '@sovereignfs/sdk';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import { now } from './formUtils';

/** Shared server-action result shape, per `docs/plugin-development.md`'s `useActionState` convention. */
export type ActionResult = { ok: true; message?: string } | { ok: false; error: string };

// The SDK intentionally returns an opaque dialect-agnostic DB client.
export type Db = BaseSQLiteDatabase<'async', unknown, Record<string, unknown>>;

/** Resolves the current session + DB client, shared by every `'use server'` action in this plugin. */
export async function getContext() {
  const session = await sdk.auth.requireSession();
  const db = (await sdk.db.getClient()) as Db;
  return { db, userId: session.user.id, tenantId: session.user.tenantId };
}

export { now };
