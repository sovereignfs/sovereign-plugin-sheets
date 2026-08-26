import type { ReactNode } from 'react';
import { ThreeColumnLayout } from '@sovereignfs/ui';
import { SheetsSidebar } from '../_components/SheetsSidebar';
import { listRecentWorkbooks } from '../actions';
import styles from './layout.module.css';

/**
 * Route-group layout for every view that keeps the persistent sidebar:
 * Workbooks (`/sheets`) and Inbox (`/sheets/inbox`). The workbook editor
 * (`/sheets/s/[id]`) lives outside this group — same split as Docs'
 * Document editor / Kanban's Board View.
 *
 * A shared ancestor layout isn't re-fetched by the Next.js App Router on
 * client-side navigation between sibling routes under it, so the sidebar
 * (and its Recent list) stays mounted with no flash moving between Workbooks
 * and Inbox.
 */
export default async function SheetsHomeLayout({ children }: { children: ReactNode }) {
  const recent = await listRecentWorkbooks();

  return (
    <div className={styles.homeFrame} data-plugin-fullbleed>
      {/* No wrapper div around `children` — ThreeColumnLayout's own `.main`
          slot already provides `flex: 1; overflow-y: auto`. */}
      <ThreeColumnLayout>
        <SheetsSidebar recent={recent} />
        {children}
      </ThreeColumnLayout>
    </div>
  );
}
