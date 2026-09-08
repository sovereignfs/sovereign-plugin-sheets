'use client';

import type { FocusEvent, KeyboardEvent, ReactNode } from 'react';
import { CodeTextarea } from '@sovereignfs/ui';
import styles from './FormulaBar.module.css';

export function FormulaBar({
  cellLabel,
  value,
  draft,
  disabled,
  readOnly = false,
  hint,
  onDraftChange,
  onCaretChange,
  onFocus,
  onBlur,
  onKeyDown,
}: {
  cellLabel: string;
  /** The active cell's raw input, shown while the bar isn't being edited. */
  value: string;
  /** The in-progress text while the bar is focused; `null` when it isn't. Owned by the grid so point mode and autocomplete can edit it. */
  draft: string | null;
  disabled: boolean;
  /** Viewer role: content stays visible/selectable, but nothing commits. */
  readOnly?: boolean;
  /** Caption under the input — an argument hint while editing, an error explanation or a FINANCE rate date otherwise. */
  hint?: ReactNode;
  onDraftChange: (next: string, caret: number) => void;
  onCaretChange: (caret: number) => void;
  /** Receives the textarea element so the grid can read and place its caret (the design-system textarea takes no ref). */
  onFocus: (element: HTMLTextAreaElement) => void;
  onBlur: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  return (
    <div className={styles.bar}>
      <div className={styles.row}>
        <span className={styles.cellLabel}>{cellLabel || '—'}</span>
        <CodeTextarea
          rows={1}
          className={styles.input}
          value={draft ?? value}
          disabled={disabled}
          readOnly={readOnly}
          onChange={(e) => onDraftChange(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onSelect={(e) => onCaretChange(e.currentTarget.selectionStart ?? 0)}
          onKeyUp={(e) => onCaretChange(e.currentTarget.selectionStart ?? 0)}
          onClick={(e) => onCaretChange(e.currentTarget.selectionStart ?? 0)}
          onFocus={(e: FocusEvent<HTMLTextAreaElement>) => onFocus(e.currentTarget)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          aria-label="Formula bar"
          placeholder={disabled ? 'Select a cell to edit' : ''}
        />
      </div>
      {hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
