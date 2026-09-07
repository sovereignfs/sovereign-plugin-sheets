'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@sovereignfs/ui';
import styles from './error.module.css';

/**
 * Plugin-scoped error boundary (sv-ui-design convention) — an unexpected
 * error anywhere under `/sheets` degrades to this plain-copy card instead
 * of the bare platform 500. Expected failures (a bad sheet name, a lost
 * permission, a save conflict) never reach here; they're returned inline
 * via the `ActionResult` convention in `app/actions.ts`.
 */
export default function SheetsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={styles.frame}>
      <div className={styles.card}>
        <p className={styles.eyebrow}>Sheets</p>
        <h1 className={styles.heading}>Something went wrong.</h1>
        {/* Deliberately not `error.message` — anything reaching this
            boundary is unexpected, so its message is raw internal text a
            user can't act on. The digest correlates to the server log. */}
        <p className={styles.detail}>
          Sheets hit an unexpected problem. Try again — if it keeps happening, go back to your
          workbooks and reopen this one.
        </p>
        {error.digest ? <p className={styles.digest}>Reference: {error.digest}</p> : null}
        <div className={styles.actions}>
          <Button type="button" onClick={reset}>
            Try again
          </Button>
          <Link href="/sheets" className={styles.link}>
            Back to workbooks
          </Link>
        </div>
      </div>
    </div>
  );
}
