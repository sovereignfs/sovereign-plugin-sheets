/**
 * Sovereign Sheets — Postgres migration-twin schema.
 *
 * Exists ONLY to drive `drizzle-kit generate --dialect postgresql`;
 * application code never imports it — queries always go through
 * `./schema.ts` (sqlite-core), whose column serialization this file must
 * match as closely as possible: plain `integer` for non-timestamp numeric
 * columns (row/column counts, sheet position — small values, no overflow
 * risk), never native Postgres `boolean` (docs/plugin-database.md's
 * "You still need a genuine, separate Postgres schema file").
 *
 * Timestamps are the one deliberate divergence: `./schema.ts` stores them as
 * plain `integer` because SQLite's `integer` affinity has no real width
 * limit (values are stored as 64-bit regardless of the declared type), but
 * Postgres's `integer` is a real, fixed 32-bit type (max 2147483647). A Unix
 * millisecond timestamp is a 13-digit number, already ~800x past that limit
 * today. `plugins/sovereign-plugin-kanban.local`'s own Postgres twin hit
 * this in production the moment it shipped (`value "..." is out of range
 * for type integer`, Postgres error 22003) and had to ALTER every timestamp
 * column to `bigint` after the fact — every timestamp column here
 * (`createdAt`, `updatedAt`, `deletedAt`, `joinedAt`, `lastOpenedAt`,
 * `asOf`, `fetchedAt`) uses `bigint({ mode: 'number' })` from the start
 * instead, safe up to 2^53, far beyond any real timestamp.
 *
 * After regenerating Postgres migrations, strip any
 * `REFERENCES "public"."..."` schema qualifier down to an unqualified
 * `REFERENCES "..."` — plugin tables live in `plugin_<slug>` reached via
 * search_path, and the qualified form fails at migration time. See
 * docs/plugin-database.md's "Foreign keys in a Postgres schema".
 */
import { bigint, index, integer, pgTable, primaryKey, text, uniqueIndex } from 'drizzle-orm/pg-core';

export const workbooks = pgTable(
  'workbooks',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    name: text('name').notNull(),
    activeSheetId: text('active_sheet_id'),
    namedRangesJson: text('named_ranges_json').notNull().default('{}'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
    deletedAt: bigint('deleted_at', { mode: 'number' }),
  },
  (t) => [index('workbooks_tenant_owner_idx').on(t.tenantId, t.ownerUserId)],
);

export const sheets = pgTable(
  'sheets',
  {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    workbookId: text('workbook_id')
      .notNull()
      .references(() => workbooks.id),
    name: text('name').notNull(),
    position: integer('position').notNull(),
    rowCount: integer('row_count').notNull().default(200),
    colCount: integer('col_count').notNull().default(26),
    cellsJson: text('cells_json').notNull().default('{}'),
    colWidthsJson: text('col_widths_json').notNull().default('{}'),
    frozenRows: integer('frozen_rows').notNull().default(0),
    frozenCols: integer('frozen_cols').notNull().default(0),
    revision: text('revision').notNull().default(''),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (t) => [index('sheets_workbook_idx').on(t.workbookId)],
);

export const workbookMembers = pgTable(
  'workbook_members',
  {
    workbookId: text('workbook_id')
      .notNull()
      .references(() => workbooks.id),
    userId: text('user_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    role: text('role', { enum: ['owner', 'editor', 'viewer'] }).notNull(),
    invitedBy: text('invited_by'),
    joinedAt: bigint('joined_at', { mode: 'number' }).notNull(),
    lastOpenedAt: bigint('last_opened_at', { mode: 'number' }),
  },
  (t) => [
    primaryKey({ columns: [t.workbookId, t.userId] }),
    uniqueIndex('workbook_members_workbook_user_idx').on(t.workbookId, t.userId),
  ],
);

export const financeRateCache = pgTable(
  'finance_rate_cache',
  {
    base: text('base').notNull(),
    quote: text('quote').notNull(),
    rate: text('rate').notNull(),
    asOf: bigint('as_of', { mode: 'number' }).notNull(),
    fetchedAt: bigint('fetched_at', { mode: 'number' }).notNull(),
    source: text('source').notNull().default('frankfurter'),
  },
  (t) => [primaryKey({ columns: [t.base, t.quote] })],
);
