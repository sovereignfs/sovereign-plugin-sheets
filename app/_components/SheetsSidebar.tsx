'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, Typography } from '@sovereignfs/ui';
import type { RecentWorkbookItem } from '../actions';
import styles from './SheetsSidebar.module.css';

/** Persistent secondary nav, same precedent as DocsSidebar/KanbanSidebar. */
const NAV = [
  { href: '/sheets', label: 'Workbooks', icon: 'sheet' as const },
  { href: '/sheets/inbox', label: 'Inbox', icon: 'inbox' as const },
];

/**
 * Scoped to `app/(home)/layout.tsx` — Workbooks and Inbox keep this sidebar
 * mounted across navigation. `/sheets/s/[id]` (the workbook editor) lives
 * outside `(home)` and gets no sidebar, same split as Docs' Document editor
 * and Kanban's Board View.
 *
 * Unlike DocsSidebar/KanbanSidebar, there's no "My X"/"Shared with me" group
 * here — that split lives in the Home page's own main content instead (see
 * docs/adhoc/home-and-sharing.md's "Direction"). Below the nav, `recent` is
 * a flat, un-grouped list — recency mixes owner and shared workbooks, since
 * it tracks the user's own access pattern, not ownership.
 */
export function SheetsSidebar({ recent }: { recent: RecentWorkbookItem[] }) {
  const pathname = usePathname();

  return (
    <nav className={styles.nav} aria-label="Sheets sections">
      {NAV.map((item) => {
        const active = item.href === '/sheets' ? pathname === '/sheets' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={[styles.link, active ? styles.linkActive : ''].filter(Boolean).join(' ')}
            aria-current={active ? 'page' : undefined}
          >
            <Icon name={item.icon} size="sm" aria-hidden={true} />
            {item.label}
          </Link>
        );
      })}

      <div className={styles.divider} />

      <div className={styles.group}>
        <Typography variant="label" className={styles.groupLabel}>
          Recent
        </Typography>
        {recent.length === 0 ? (
          <Typography variant="caption" className={styles.groupEmpty}>
            You haven&apos;t opened any workbooks yet.
          </Typography>
        ) : (
          recent.map((workbook) => (
            <Link key={workbook.id} href={`/sheets/s/${workbook.id}`} className={styles.link}>
              {workbook.name}
            </Link>
          ))
        )}
      </div>
    </nav>
  );
}
