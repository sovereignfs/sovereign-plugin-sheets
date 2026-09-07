'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, FormField, Input, useToast } from '@sovereignfs/ui';
import styles from './FindReplacePopover.module.css';

interface FindReplacePopoverProps {
  open: boolean;
  onClose: () => void;
  /** Viewer role: find works, replace controls don't render. */
  canReplace: boolean;
  /** Selects the next matching cell; returns false when nothing matches. */
  onFindNext: (query: string, matchCase: boolean) => boolean;
  /** Replaces in the current cell (if it matches) and moves to the next match. */
  onReplace: (query: string, replacement: string, matchCase: boolean) => boolean;
  /** Replaces in every matching cell; returns how many cells changed. */
  onReplaceAll: (query: string, replacement: string, matchCase: boolean) => number;
}

/**
 * Find & replace for the active sheet — a non-modal-feeling small dialog
 * (`Dialog size="sm"`) rather than a floating popover, so it works
 * identically on touch (where `Popover` falls back to a drawer anyway) and
 * keeps keyboard focus contained. Matching is a plain substring test over
 * each cell's shown text and its raw input (so a formula's source text is
 * searchable too).
 */
export function FindReplacePopover({
  open,
  onClose,
  canReplace,
  onFindNext,
  onReplace,
  onReplaceAll,
}: FindReplacePopoverProps) {
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [matchCase, setMatchCase] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setStatus(null);
      const timer = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [open]);

  function findNext() {
    if (!query) return;
    setStatus(onFindNext(query, matchCase) ? null : `No cells contain "${query}".`);
  }

  function replace() {
    if (!query) return;
    setStatus(onReplace(query, replacement, matchCase) ? null : `No more cells contain "${query}".`);
  }

  function replaceAll() {
    if (!query) return;
    const count = onReplaceAll(query, replacement, matchCase);
    if (count === 0) {
      setStatus(`No cells contain "${query}".`);
      return;
    }
    toast.show({
      title: 'Replaced',
      message: `Changed ${String(count)} cell${count === 1 ? '' : 's'}.`,
      category: 'success',
    });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title={canReplace ? 'Find and replace' : 'Find'}>
      <div className={styles.body}>
        <FormField label="Find">
          {(field) => (
            <Input
              {...field}
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  findNext();
                }
              }}
              placeholder="Text to find"
              autoComplete="off"
            />
          )}
        </FormField>
        {canReplace && (
          <FormField label="Replace with">
            {(field) => (
              <Input
                {...field}
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    replace();
                  }
                }}
                placeholder="Leave empty to remove"
                autoComplete="off"
              />
            )}
          </FormField>
        )}
        <Checkbox checked={matchCase} onChange={setMatchCase} label="Match case" />
        {status ? (
          <p className={styles.status} role="status">
            {status}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button type="button" size="sm" variant="secondary" onClick={findNext} disabled={!query}>
            Find next
          </Button>
          {canReplace && (
            <>
              <Button type="button" size="sm" variant="secondary" onClick={replace} disabled={!query}>
                Replace
              </Button>
              <Button type="button" size="sm" onClick={replaceAll} disabled={!query}>
                Replace all
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
