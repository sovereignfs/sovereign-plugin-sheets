'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CardTile, CardTileGrid, EmptyState, Icon, Input, PageHeader } from '@sovereignfs/ui';
import type { WorkbookOverviewItem } from '../actions';
import { NewWorkbookDialog } from './NewWorkbookDialog';
import styles from './HomeWorkbooksList.module.css';

/**
 * Home's main content — "My workbooks" / "Shared with me", split on
 * `workbook_members` role. Same shape as Docs' `HomeFoldersList`, adapted:
 * the "+" (New workbook) trigger sits next to this page's own "My
 * workbooks" heading rather than in the sidebar, since SheetsSidebar has no
 * "My X" group to anchor it to (see docs/adhoc/home-and-sharing.md).
 *
 * Search collapses back to a flat match list (no grouping) across both
 * sections — grouping exists for browsing, not filtering.
 */
export function HomeWorkbooksList({ overview }: { overview: WorkbookOverviewItem[] }) {
  const [query, setQuery] = useState('');

  const normalizedQuery = query.trim().toLowerCase();
  const isSearching = normalizedQuery.length > 0;
  const filtered = isSearching
    ? overview.filter((workbook) => workbook.name.toLowerCase().includes(normalizedQuery))
    : overview;

  const isEmptyWorkspace = overview.length === 0;
  const hasNoResults = isSearching && filtered.length === 0;

  const myWorkbooks = filtered.filter((workbook) => workbook.role === 'owner');
  const sharedWorkbooks = filtered.filter((workbook) => workbook.role !== 'owner');

  return (
    <div className={styles.section}>
      <PageHeader
        title="Sheets"
        description="Your spreadsheets."
        action={
          !isEmptyWorkspace ? (
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search workbooks…"
              aria-label="Search workbooks"
              className={styles.search}
            />
          ) : undefined
        }
      />

      {isEmptyWorkspace ? (
        <EmptyState
          heading="No workbooks yet"
          description="Create your first workbook to get started."
          action={<NewWorkbookDialog />}
        />
      ) : hasNoResults ? (
        <EmptyState heading="No matches" description={`Nothing found for "${query}".`} />
      ) : isSearching ? (
        <div className={styles.lists}>
          <CardTileGrid dense minTileWidth={160}>
            {filtered.map((workbook) => (
              <WorkbookTile key={workbook.id} workbook={workbook} shared={workbook.role !== 'owner'} />
            ))}
          </CardTileGrid>
        </div>
      ) : (
        <div className={styles.lists}>
          <div>
            <div className={styles.headingRow}>
              <h2 className={styles.heading}>My workbooks</h2>
              <NewWorkbookDialog
                renderTrigger={({ onClick }) => (
                  <button type="button" className={styles.addButton} aria-label="New workbook" onClick={onClick}>
                    <Icon name="plus" size="sm" aria-hidden={true} />
                  </button>
                )}
              />
            </div>
            {myWorkbooks.length === 0 ? (
              <p className={styles.groupEmpty}>You haven&apos;t created a workbook yet.</p>
            ) : (
              <CardTileGrid dense minTileWidth={160}>
                {myWorkbooks.map((workbook) => (
                  <WorkbookTile key={workbook.id} workbook={workbook} />
                ))}
              </CardTileGrid>
            )}
          </div>

          <div>
            <h2 className={styles.heading}>Shared with me</h2>
            {sharedWorkbooks.length === 0 ? (
              <p className={styles.groupEmpty}>Nothing shared with you yet.</p>
            ) : (
              <CardTileGrid dense minTileWidth={160}>
                {sharedWorkbooks.map((workbook) => (
                  <WorkbookTile key={workbook.id} workbook={workbook} shared />
                ))}
              </CardTileGrid>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WorkbookTile({ workbook, shared = false }: { workbook: WorkbookOverviewItem; shared?: boolean }) {
  return (
    <Link href={`/sheets/w/${workbook.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="table" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={workbook.name}>
          {workbook.name}
        </span>
        {shared && <span className={styles.tileBadge}>Shared</span>}
      </CardTile>
    </Link>
  );
}
