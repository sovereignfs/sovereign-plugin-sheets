import { notFound } from 'next/navigation';
import { getWorkbook } from '../../actions';
import { canEditWorkbookRole } from '../../_lib/workbook-rules';
import {
  inviteWorkbookMember,
  listWorkbookMembers,
  removeWorkbookMember,
  searchWorkbookDirectoryUsers,
} from '../../_lib/workbook-sharing';
import { WorkbookView } from '../../_components/WorkbookView';
import styles from './page.module.css';

export default async function WorkbookPage({
  params,
}: {
  params: Promise<{ workbookId: string }>;
}) {
  const { workbookId } = await params;
  const data = await getWorkbook(workbookId);
  if (!data) notFound();

  return (
    // `data-plugin-fullbleed` opts into the shell's hard-locked viewport
    // height + zero content padding (runtime/app/(platform)/shell.module.css)
    // so `SheetGrid.module.css`'s `.scroller` gets a real bounded height to
    // scroll internally within, instead of the whole document growing to fit
    // a 100+-row sheet — the header, toolbar, formula bar, and column-letter
    // row all stay in view as a result. The `(home)` route group's own
    // layout.tsx already does this for the workbook list; this route lived
    // outside that group (see its own comment) and was missing the same
    // opt-in, found live-testing task 16's bottom-docked sheet tabs.
    <div className={styles.page} data-plugin-fullbleed>
      <WorkbookView
        workbookId={data.workbook.id}
        name={data.workbook.name}
        sheets={data.sheets}
        namedRangesJson={data.workbook.namedRangesJson}
        canEdit={canEditWorkbookRole(data.role)}
        isOwner={data.role === 'owner'}
        listMembersAction={listWorkbookMembers.bind(null, workbookId)}
        searchUsersAction={searchWorkbookDirectoryUsers.bind(null, workbookId)}
        inviteMemberAction={inviteWorkbookMember.bind(null, workbookId)}
        removeMemberAction={removeWorkbookMember.bind(null, workbookId)}
      />
    </div>
  );
}
