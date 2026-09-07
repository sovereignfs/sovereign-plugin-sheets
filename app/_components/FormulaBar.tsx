'use client';

import { useEffect, useState } from 'react';
import { CodeTextarea } from '@sovereignfs/ui';
import styles from './FormulaBar.module.css';

export function FormulaBar({
  cellLabel,
  value,
  disabled,
  readOnly = false,
  hint,
  onFocus,
  onCommit,
}: {
  cellLabel: string;
  value: string;
  disabled: boolean;
  /** Viewer role: content stays visible/selectable, but Enter/blur never commit. */
  readOnly?: boolean;
  /** Muted caption under the input — e.g. the reference date of a FINANCE() rate. */
  hint?: string;
  /** Fires when editing starts here, so the grid can pin which cell a later blur-commit targets. */
  onFocus?: () => void;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);

  // Follow the active cell while the bar isn't being typed into — never
  // clobber an in-progress draft with a re-render from elsewhere.
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, cellLabel, focused]);

  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <span className={styles.cellLabel}>{cellLabel || '—'}</span>
        <CodeTextarea
          rows={1}
          className={styles.input}
          value={draft}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => {
            setFocused(true);
            onFocus?.();
          }}
          onBlur={() => {
            setFocused(false);
            if (!readOnly && draft !== value) onCommit(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (!readOnly) onCommit(draft);
              e.currentTarget.blur();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              setDraft(value);
              e.currentTarget.blur();
            }
          }}
          aria-label="Formula bar"
          placeholder={disabled ? 'Select a cell to edit' : ''}
        />
      </div>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
