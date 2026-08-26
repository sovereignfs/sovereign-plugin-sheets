'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  Button,
  CardTile,
  CardTileGrid,
  EmptyState,
  Icon,
  Input,
  Menu,
  NewCardTile,
  PageHeader,
  type MenuEntry,
} from '@sovereignfs/ui';
import type { WorkbookOverviewItem } from '../actions';
import { ImportWorkbookButton, type ImportWorkbookHandle } from './ImportWorkbookButton';
import { NewWorkbookDialog, type NewWorkbookDialogHandle } from './NewWorkbookDialog';
import styles from './HomeWorkbooksList.module.css';

/**
 * Home's main content — "My workbooks" / "Shared with me", split on
 * `workbook_members` role. Same shape as Docs' `HomeFoldersList`, adapted:
 * the "add" affordance is a ghost `NewCardTile` inside the "My workbooks"
 * grid itself (rather than a heading-row icon button, or living in the
 * sidebar — SheetsSidebar has no "My X" group to anchor it to), opening a
 * `Menu` offering "New workbook" / "Import workbook" — the same
 * one-trigger-many-options consolidation `WorkbookView.tsx`'s own
 * Export/Import menus already use, replacing what were previously two
 * separate heading-row icon buttons doing the same two things (see
 * docs/adhoc/home-and-sharing.md).
 *
 * Search collapses back to a flat match list (no grouping) across both
 * sections — grouping exists for browsing, not filtering.
 */
export function HomeWorkbooksList({ overview }: { overview: WorkbookOverviewItem[] }) {
  const [query, setQuery] = useState('');
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const newWorkbookRef = useRef<NewWorkbookDialogHandle>(null);
  const importWorkbookRef = useRef<ImportWorkbookHandle>(null);

  const addMenuItems: MenuEntry[] = [
    { label: 'New workbook', icon: 'plus', onSelect: () => newWorkbookRef.current?.open() },
    { label: 'Import workbook', icon: 'upload', onSelect: () => importWorkbookRef.current?.triggerImport() },
  ];

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
          action={
            <div className={styles.emptyActions}>
              <NewWorkbookDialog />
              <ImportWorkbookButton
                renderTrigger={({ onClick, pending }) => (
                  <Button type="button" variant="secondary" onClick={onClick} disabled={pending}>
                    {pending ? 'Importing…' : 'Import workbook'}
                  </Button>
                )}
              />
            </div>
          }
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
            <h2 className={styles.heading}>My workbooks</h2>
            <CardTileGrid dense minTileWidth={160}>
              {myWorkbooks.map((workbook) => (
                <WorkbookTile key={workbook.id} workbook={workbook} />
              ))}
              <Menu
                aria-label="Add workbook"
                open={addMenuOpen}
                onClose={() => setAddMenuOpen(false)}
                align="left"
                trigger={
                  <NewCardTile
                    variant="icon"
                    label="Add workbook"
                    aria-haspopup="menu"
                    aria-expanded={addMenuOpen}
                    onClick={() => setAddMenuOpen((v) => !v)}
                  />
                }
                items={addMenuItems}
              />
            </CardTileGrid>
            <NewWorkbookDialog ref={newWorkbookRef} renderTrigger={() => null} />
            <ImportWorkbookButton ref={importWorkbookRef} />
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
    <Link href={`/sheets/s/${workbook.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="sheet" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={workbook.name}>
          {workbook.name}
        </span>
        {shared && <span className={styles.tileBadge}>Shared</span>}
      </CardTile>
    </Link>
  );
}
