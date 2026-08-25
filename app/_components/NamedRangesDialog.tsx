'use client';

import { useState } from 'react';
import { Button, Dialog, FormField, Input } from '@sovereignfs/ui';
import styles from './NamedRangesDialog.module.css';

export interface NamedRangeItem {
  name: string;
  expression: string;
}

interface NamedRangesButtonProps {
  ranges: NamedRangeItem[];
  /** Anyone can view named ranges; only canEdit gates adding/removing them. */
  canEdit: boolean;
  /** Returns an error message on failure (e.g. an invalid name/expression the formula engine rejected), or undefined on success. */
  onAdd: (name: string, expression: string) => string | undefined;
  onRemove: (name: string) => void;
}

/**
 * Workbook-scoped named ranges — a name manager, same list+add-form shape
 * as WorkbookShareDialog. The formula engine (HyperFormula) does the actual
 * name/expression validation; this dialog just surfaces whatever error it
 * throws back, via the `onAdd` return value (not `ActionResult`/
 * `useActionState` — this mutates the client-side engine directly, not a
 * server action, same as cell format changes).
 */
export function NamedRangesButton({ ranges, canEdit, onAdd, onRemove }: NamedRangesButtonProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [expression, setExpression] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleAdd() {
    const trimmedName = name.trim();
    const trimmedExpression = expression.trim();
    if (!trimmedName || !trimmedExpression) return;

    const failure = onAdd(trimmedName, trimmedExpression);
    if (failure) {
      setError(failure);
      return;
    }
    setError(null);
    setName('');
    setExpression('');
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Named ranges
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="md" title="Named ranges">
        <div className={styles.body}>
          {ranges.length === 0 ? (
            <p className={styles.empty}>No named ranges in this workbook yet.</p>
          ) : (
            <ul className={styles.list}>
              {ranges.map((range) => (
                <li key={range.name} className={styles.item}>
                  <div>
                    <p className={styles.name}>{range.name}</p>
                    <p className={styles.expression}>{range.expression}</p>
                  </div>
                  {canEdit && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => onRemove(range.name)}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}

          {canEdit && (
            <div className={styles.form}>
              <FormField label="Name">
                {(field) => (
                  <Input
                    {...field}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="TaxRate"
                  />
                )}
              </FormField>
              <FormField label="Refers to" hint="A formula or cell reference, e.g. =0.08 or =Sheet1!$B$2">
                {(field) => (
                  <Input
                    {...field}
                    value={expression}
                    onChange={(e) => setExpression(e.target.value)}
                    placeholder="=Sheet1!$B$2"
                  />
                )}
              </FormField>
              {error ? (
                <p className={styles.error} role="alert">
                  {error}
                </p>
              ) : null}
              <Button
                type="button"
                size="sm"
                onClick={handleAdd}
                disabled={!name.trim() || !expression.trim()}
              >
                Add named range
              </Button>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
