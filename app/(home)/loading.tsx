import { Spinner } from '@sovereignfs/ui';
import styles from './loading.module.css';

/**
 * Covers Workbooks (`listWorkbooksOverview`) and Inbox
 * (`listDeletedWorkbooks`) — both await the database before they can
 * render. The editor route (`s/[workbookId]`) has its own loading state
 * already.
 */
export default function SheetsHomeLoading() {
  return (
    <div className={styles.root} role="status" aria-live="polite">
      <Spinner />
      <span>Loading…</span>
    </div>
  );
}
