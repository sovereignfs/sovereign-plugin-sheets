import { Spinner } from '@sovereignfs/ui';
import styles from './page.module.css';

/** Shown while `getWorkbook` loads — the route blocks on the database, so it needs a loading boundary. */
export default function WorkbookLoading() {
  return (
    <div className={styles.page} data-plugin-fullbleed>
      <div className={styles.loading} role="status" aria-label="Loading workbook">
        <Spinner />
      </div>
    </div>
  );
}
