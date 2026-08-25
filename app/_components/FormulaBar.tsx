'use client';

import { useEffect, useState } from 'react';
import { CodeTextarea } from '@sovereignfs/ui';
import styles from './FormulaBar.module.css';

export function FormulaBar({
  cellLabel,
  value,
  disabled,
  readOnly = false,
  onCommit,
}: {
  cellLabel: string;
  value: string;
  disabled: boolean;
  /** Viewer role: content stays visible/selectable, but Enter/blur never commit. */
  readOnly?: boolean;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value, cellLabel]);

  return (
    <div className={styles.bar}>
      <span className={styles.cellLabel}>{cellLabel || '—'}</span>
      <CodeTextarea
        rows={1}
        className={styles.input}
        value={draft}
        disabled={disabled}
        readOnly={readOnly}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (!readOnly) onCommit(draft);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (!readOnly) onCommit(draft);
          }
        }}
        aria-label="Formula bar"
        placeholder={disabled ? 'Select a cell to edit' : ''}
      />
    </div>
  );
}
