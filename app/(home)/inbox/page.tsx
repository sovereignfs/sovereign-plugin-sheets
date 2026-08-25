import Link from 'next/link';
import { CardTile, CardTileGrid, EmptyState, Icon, PageHeader } from '@sovereignfs/ui';
import { listWorkbooksOverview, type WorkbookOverviewItem } from '../../actions';
import styles from './page.module.css';

/**
 * "For now" scope, same framing as Docs'/Kanban's own Inbox docblocks: a
 * "shared with you" digest of every workbook where the signed-in user holds
 * a non-owner role — not a richer activity feed (no mentions/comments
 * concept exists in Sheets to feed one yet).
 */
export default async function InboxPage() {
  const overview = await listWorkbooksOverview();
  const sharedWorkbooks = overview.filter((workbook) => workbook.role !== 'owner');
  const isEmpty = sharedWorkbooks.length === 0;

  return (
    <div className={styles.page}>
      <PageHeader title="Inbox" />

      {isEmpty ? (
        <EmptyState
          icon="inbox"
          heading="Nothing here yet"
          description="Workbooks shared with you will show up here."
        />
      ) : (
        <div className={styles.lists}>
          <div>
            <h2 className={styles.heading}>Workbooks shared with you</h2>
            <CardTileGrid dense minTileWidth={160}>
              {sharedWorkbooks.map((workbook) => (
                <WorkbookTile key={workbook.id} workbook={workbook} />
              ))}
            </CardTileGrid>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkbookTile({ workbook }: { workbook: WorkbookOverviewItem }) {
  return (
    <Link href={`/sheets/w/${workbook.id}`} className={styles.tileLink}>
      <CardTile variant="icon" banner={<Icon name="table" size="lg" aria-hidden={true} />}>
        <span className={styles.tileLabel} title={workbook.name}>
          {workbook.name}
        </span>
      </CardTile>
    </Link>
  );
}
