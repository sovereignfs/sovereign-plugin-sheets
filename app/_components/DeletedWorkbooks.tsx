'use client';

import { useState } from 'react';
import { Button, ConfirmDialog, useToast } from '@sovereignfs/ui';
import { purgeWorkbookAction, restoreWorkbookAction, type DeletedWorkbookItem } from '../actions';
import styles from './DeletedWorkbooks.module.css';

/**
 * Home's "Recently deleted" list — a deleted workbook is only soft-deleted
 * (`workbooks.deletedAt`), so its owner can bring it back here, or delete
 * it for good after a confirmation. Rendered only when there is something
 * in it; the empty state is simply no section.
 */
export function DeletedWorkbooks({ deleted }: { deleted: DeletedWorkbookItem[] }) {
  const toast = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<DeletedWorkbookItem | null>(null);

  async function restore(item: DeletedWorkbookItem) {
    setBusyId(item.id);
    try {
      const result = await restoreWorkbookAction(item.id);
      if (!result.ok) toast.show({ title: 'Could not restore', message: result.error, category: 'error' });
      else toast.show({ title: 'Workbook restored', message: `${item.name} is back in your workbooks.`, category: 'success' });
    } catch {
      toast.show({ title: 'Could not restore', message: 'Check your connection and try again.', category: 'error' });
    } finally {
      setBusyId(null);
    }
  }

  async function purge(item: DeletedWorkbookItem) {
    setBusyId(item.id);
    try {
      const result = await purgeWorkbookAction(item.id);
      if (!result.ok) toast.show({ title: 'Could not delete', message: result.error, category: 'error' });
    } catch {
      toast.show({ title: 'Could not delete', message: 'Check your connection and try again.', category: 'error' });
    } finally {
      setBusyId(null);
      setPurgeTarget(null);
    }
  }

  if (deleted.length === 0) return null;

  return (
    <div>
      <h2 className={styles.heading}>Recently deleted</h2>
      <p className={styles.hint}>Restore a workbook to get it back, or delete it permanently.</p>
      <ul className={styles.list}>
        {deleted.map((item) => (
          <li key={item.id} className={styles.item}>
            <span className={styles.name} title={item.name}>
              {item.name}
            </span>
            <span className={styles.actions}>
              <Button type="button" size="sm" variant="secondary" disabled={busyId === item.id} onClick={() => void restore(item)}>
                {busyId === item.id ? 'Restoring…' : 'Restore'}
              </Button>
              <Button type="button" size="sm" variant="ghost" disabled={busyId === item.id} onClick={() => setPurgeTarget(item)}>
                Delete permanently
              </Button>
            </span>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title="Delete permanently"
        message={
          <>
            Permanently delete <strong>{purgeTarget?.name}</strong> and all of its sheets? This can&apos;t be undone.
          </>
        }
        onConfirm={() => {
          if (purgeTarget) void purge(purgeTarget);
        }}
        confirmLabel={busyId && purgeTarget && busyId === purgeTarget.id ? 'Deleting…' : 'Delete permanently'}
        destructive
        pending={!!busyId && !!purgeTarget && busyId === purgeTarget.id}
      />
    </div>
  );
}
