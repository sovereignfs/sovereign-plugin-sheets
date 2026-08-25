'use client';

import { useState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import { createWorkbookAction } from '../actions';
import styles from './NewWorkbookDialog.module.css';

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create workbook'}
    </Button>
  );
}

interface NewWorkbookDialogProps {
  /** Custom trigger instead of the default "New workbook" button — e.g. a compact "+" icon button beside the "My workbooks" heading. */
  renderTrigger?: (props: { onClick: () => void }) => ReactNode;
}

/**
 * `createWorkbookAction` can't fail with a user-actionable error (an empty
 * name just falls back to "Untitled workbook") and redirects straight to
 * the new workbook on success, so this is a plain server-action form — no
 * `useActionState`/`ActionResult` machinery needed, just a `useFormStatus`
 * submit button for the pending label.
 */
export function NewWorkbookDialog({ renderTrigger }: NewWorkbookDialogProps = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {renderTrigger ? (
        renderTrigger({ onClick: () => setOpen(true) })
      ) : (
        <Button type="button" onClick={() => setOpen(true)}>
          New workbook
        </Button>
      )}
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="New workbook">
        <form action={createWorkbookAction} className={styles.form}>
          <FormField label="Name">
            {(field) => <Input {...field} name="name" placeholder="Untitled workbook" />}
          </FormField>
          <div className={styles.actions}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton />
          </div>
        </form>
      </Dialog>
    </>
  );
}
