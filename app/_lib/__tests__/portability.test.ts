import { getTableName, type Table } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeletionContext } from '@sovereignfs/sdk';

type Row = Record<string, unknown>;
type Condition =
  | { kind: 'eq'; key: string; value: unknown }
  | { kind: 'and'; conditions: Condition[] }
  | { kind: 'or'; conditions: Condition[] };

function toCamel(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_match, c: string) => c.toUpperCase());
}

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>();
  return {
    ...actual,
    eq: (column: { name: string }, value: unknown): Condition => ({
      kind: 'eq',
      key: toCamel(column.name),
      value,
    }),
    and: (...conditions: Condition[]): Condition => ({ kind: 'and', conditions }),
    or: (...conditions: Condition[]): Condition => ({ kind: 'or', conditions }),
  };
});

function matches(row: Row, condition?: Condition): boolean {
  if (!condition) return true;
  if (condition.kind === 'eq') return row[condition.key] === condition.value;
  if (condition.kind === 'and') return condition.conditions.every((c) => matches(row, c));
  return condition.conditions.some((c) => matches(row, c));
}

const capturedDeleter = {
  fn: null as ((ctx: DeletionContext) => Promise<{ deleted: number; errors?: string[] }>) | null,
};

vi.mock('@sovereignfs/sdk', () => ({
  sdk: {
    db: { getClient: vi.fn(async () => fakeDb) },
    portability: {
      provideDelete: vi.fn(async (fn: typeof capturedDeleter.fn) => {
        capturedDeleter.fn = fn;
      }),
    },
  },
}));

interface Store extends Record<string, Row[]> {
  workbooks: Row[];
  sheets: Row[];
  workbook_members: Row[];
}

let store: Store = { workbooks: [], sheets: [], workbook_members: [] };

function resetStore() {
  store = { workbooks: [], sheets: [], workbook_members: [] };
}

const fakeDb = {
  select(columns?: Record<string, unknown>) {
    return {
      from(table: Table) {
        const tableName = getTableName(table);
        return {
          where: async (condition?: Condition) => {
            const rows = (store[tableName] ?? []).filter((row) => matches(row, condition));
            if (!columns) return rows;
            return rows.map((row) => {
              const projected: Row = {};
              for (const key of Object.keys(columns)) projected[key] = row[key];
              return projected;
            });
          },
        };
      },
    };
  },
  update(table: Table) {
    const tableName = getTableName(table);
    return {
      set: (patch: Row) => ({
        where: async (condition?: Condition) => {
          store[tableName] = (store[tableName] ?? []).map((row) =>
            matches(row, condition) ? { ...row, ...patch } : row,
          );
        },
      }),
    };
  },
  delete(table: Table) {
    const tableName = getTableName(table);
    return {
      where: async (condition?: Condition) => {
        store[tableName] = (store[tableName] ?? []).filter((row) => !matches(row, condition));
      },
    };
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  resetStore();
});

describe('portability delete', () => {
  it("transfers ownership of a workbook with another member instead of deleting it, and removes the user's own share of a workbook they don't own", async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.workbooks = [
      { id: 'wb-1', tenantId: 't1', ownerUserId: 'u1', name: 'Mine, shared', createdAt: 1, updatedAt: 1 },
      { id: 'wb-2', tenantId: 't1', ownerUserId: 'other', name: 'Not mine', createdAt: 1, updatedAt: 1 },
    ];
    store.sheets = [
      { id: 'sheet-1', tenantId: 't1', workbookId: 'wb-1', name: 'Sheet1', position: 0, updatedAt: 1 },
      { id: 'sheet-2', tenantId: 't1', workbookId: 'wb-2', name: 'Sheet1', position: 0, updatedAt: 1 },
    ];
    store.workbook_members = [
      // wb-1: u1 owner, 'other' viewer -> transfers to 'other'.
      { workbookId: 'wb-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      { workbookId: 'wb-1', userId: 'other', tenantId: 't1', role: 'viewer', invitedBy: 'u1', joinedAt: 2 },
      // wb-2: u1 only has a share on someone else's workbook.
      { workbookId: 'wb-2', userId: 'u1', tenantId: 't1', role: 'editor', invitedBy: 'other', joinedAt: 1 },
      { workbookId: 'wb-2', userId: 'other', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });
    expect(result).toBeDefined();

    expect(store.workbooks.map((w) => w.id).sort()).toEqual(['wb-1', 'wb-2']);
    expect(store.workbooks.find((w) => w.id === 'wb-1')).toMatchObject({ ownerUserId: 'other' });
    expect(store.sheets.map((s) => s.id).sort()).toEqual(['sheet-1', 'sheet-2']);
    expect(store.workbook_members).toEqual([
      expect.objectContaining({ workbookId: 'wb-1', userId: 'other', role: 'owner' }),
      expect.objectContaining({ workbookId: 'wb-2', userId: 'other', role: 'owner' }),
    ]);
    expect(result?.deleted).toBeGreaterThan(0);
  });

  it('hard-deletes a workbook and its sheets when the deleting user is the sole member', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.workbooks = [
      { id: 'wb-1', tenantId: 't1', ownerUserId: 'u1', name: 'Mine, sole', createdAt: 1, updatedAt: 1 },
    ];
    store.sheets = [
      { id: 'sheet-1', tenantId: 't1', workbookId: 'wb-1', name: 'Sheet1', position: 0, updatedAt: 1 },
      { id: 'sheet-2', tenantId: 't1', workbookId: 'wb-1', name: 'Sheet2', position: 1, updatedAt: 1 },
    ];
    store.workbook_members = [
      { workbookId: 'wb-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });

    expect(store.workbooks).toEqual([]);
    expect(store.sheets).toEqual([]);
    expect(store.workbook_members).toEqual([]);
    expect(result?.deleted).toBe(1);
  });

  it('promotes an owner-role member over an earlier-joined non-owner member', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.workbooks = [
      { id: 'wb-1', tenantId: 't1', ownerUserId: 'u1', name: 'Co-owned', createdAt: 1, updatedAt: 1 },
    ];
    store.sheets = [];
    store.workbook_members = [
      { workbookId: 'wb-1', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
      // Joined earlier than 'co-owner' but is only an editor — should lose to the owner-role member regardless of join order.
      { workbookId: 'wb-1', userId: 'earlier-editor', tenantId: 't1', role: 'editor', invitedBy: 'u1', joinedAt: 2 },
      { workbookId: 'wb-1', userId: 'co-owner', tenantId: 't1', role: 'owner', invitedBy: 'u1', joinedAt: 3 },
    ];

    await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });

    expect(store.workbooks.find((w) => w.id === 'wb-1')).toMatchObject({ ownerUserId: 'co-owner' });
    expect(store.workbook_members).toEqual([
      expect.objectContaining({ workbookId: 'wb-1', userId: 'earlier-editor', role: 'editor' }),
      expect.objectContaining({ workbookId: 'wb-1', userId: 'co-owner', role: 'owner' }),
    ]);
  });

  it('cleans up a dangling membership row that has no workbook behind it', async () => {
    const { registerPortabilityHandlers } = await import('../portability');
    await registerPortabilityHandlers();

    store.workbooks = [];
    store.sheets = [];
    store.workbook_members = [
      { workbookId: 'gone', userId: 'u1', tenantId: 't1', role: 'owner', invitedBy: null, joinedAt: 1 },
    ];

    const result = await capturedDeleter.fn?.({ userId: 'u1', tenantId: 't1', db: fakeDb });

    expect(store.workbook_members).toEqual([]);
    expect(result?.deleted).toBe(1);
  });
});
