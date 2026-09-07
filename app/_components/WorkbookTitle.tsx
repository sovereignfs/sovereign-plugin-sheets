'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, Tooltip } from '@sovereignfs/ui';
import { MAX_WORKBOOK_NAME_LENGTH } from '../_lib/config';
import styles from './WorkbookTitle.module.css';

interface WorkbookTitleProps {
  name: string;
  canEdit: boolean;
  /** Resolves to an error message to show inline, or null once the rename is saved. */
  onRename: (name: string) => Promise<string | null>;
}

/**
 * The workbook's name as an `<h1>` that editors can rename in place — click
 * the pencil (or the title itself), type, Enter/blur to save, Escape to
 * cancel. Expected failures (empty name, lost access) render inline under
 * the field; nothing here throws.
 */
export function WorkbookTitle({ name, canEdit, onRename }: WorkbookTitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const committing = useRef(false);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function start() {
    if (!canEdit) return;
    setDraft(name);
    setError(null);
    setEditing(true);
  }

  async function commit() {
    if (committing.current) return;
    const trimmed = draft.trim();
    if (trimmed === name) {
      setEditing(false);
      return;
    }
    if (!trimmed) {
      setError('Enter a workbook name.');
      inputRef.current?.focus();
      return;
    }
    committing.current = true;
    setSaving(true);
    const failure = await onRename(trimmed);
    setSaving(false);
    committing.current = false;
    if (failure) {
      setError(failure);
      inputRef.current?.focus();
      return;
    }
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className={styles.wrap}>
        <h1 className={styles.title} title={name}>
          {canEdit ? (
            <button type="button" className={styles.titleButton} onClick={start} aria-label={`Rename workbook ${name}`}>
              {name}
            </button>
          ) : (
            name
          )}
        </h1>
        {canEdit && (
          <Tooltip content="Rename workbook">
            <button type="button" className={styles.pencil} onClick={start} aria-label="Rename workbook">
              <Icon name="pencil" size="sm" aria-hidden />
            </button>
          </Tooltip>
        )}
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.editWrap}>
        <input
          ref={inputRef}
          className={[styles.input, error && styles.inputInvalid].filter(Boolean).join(' ')}
          value={draft}
          maxLength={MAX_WORKBOOK_NAME_LENGTH}
          disabled={saving}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              committing.current = true; // swallow the blur commit that follows
              setEditing(false);
              setError(null);
              setTimeout(() => {
                committing.current = false;
              }, 0);
            }
          }}
          aria-label="Workbook name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'workbook-title-error' : undefined}
        />
        {error ? (
          <p id="workbook-title-error" className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
