'use client';

import {
  useActionState,
  useEffect,
  useImperativeHandle,
  useRef,
  type ChangeEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { useToast } from '@sovereignfs/ui';
import type { ActionResult } from '../_lib/context';
import { parseWorkbookExportPayload } from '../_lib/workbook-export';
import { importWorkbookAction } from '../actions';
import styles from './ImportWorkbookButton.module.css';

/** Exposed via ref for callers that drive this imperatively instead of rendering `renderTrigger` — e.g. a `Menu` item's `onSelect` (`WorkbookView.tsx`'s consolidated Import menu). */
export interface ImportWorkbookHandle {
  triggerImport: () => void;
}

interface ImportWorkbookButtonProps {
  /** React 19 ref-as-prop — no `forwardRef` needed. */
  ref?: Ref<ImportWorkbookHandle>;
  /** Omit to render no visible trigger of its own — the caller drives it via `ref.triggerImport()` instead. */
  renderTrigger?: (props: { onClick: () => void; pending: boolean }) => ReactNode;
}

/**
 * Creates a new workbook from a previously-exported `.json` file
 * (`_lib/workbook-export.ts`). Deliberately not a dialog — unlike CSV
 * import (which replaces the active sheet's content and so needs a
 * destructive-action confirm), this always creates a brand-new workbook, so
 * there's nothing to confirm; picking a file is the only step.
 *
 * Validates client-side first (`parseWorkbookExportPayload`, shared with
 * `importWorkbookAction`'s own server-side call) purely for immediate
 * feedback on an obviously-wrong file — the server action re-validates the
 * same way regardless, since it's a public endpoint reachable independent of
 * this component.
 */
export function ImportWorkbookButton({ ref, renderTrigger }: ImportWorkbookButtonProps) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const payloadFieldRef = useRef<HTMLInputElement>(null);
  const [state, formAction, pending] = useActionState<ActionResult | null, FormData>(
    importWorkbookAction,
    null,
  );

  useEffect(() => {
    if (state && !state.ok) {
      toast.show({ title: 'Could not import file', message: state.error, category: 'error' });
    }
  }, [state]);

  useImperativeHandle(ref, () => ({
    triggerImport: () => inputRef.current?.click(),
  }));

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file next time
    if (!file) return;

    const text = await file.text();
    const parsed = parseWorkbookExportPayload(text);
    if (!parsed.ok) {
      toast.show({ title: 'Could not import file', message: parsed.error, category: 'error' });
      return;
    }

    if (payloadFieldRef.current) {
      payloadFieldRef.current.value = JSON.stringify(parsed.payload);
      formRef.current?.requestSubmit();
    }
  }

  return (
    <>
      {renderTrigger?.({ onClick: () => inputRef.current?.click(), pending })}
      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className={styles.hiddenFileInput}
        onChange={(event) => void handleFileChange(event)}
        aria-label="Import workbook file"
      />
      <form ref={formRef} action={formAction} className={styles.hiddenForm}>
        <input ref={payloadFieldRef} type="hidden" name="payload" />
      </form>
    </>
  );
}
