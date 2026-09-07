import { notFound } from 'next/navigation';
import { getWorkbook } from '../../actions';
import { canEditWorkbookRole } from '../../_lib/workbook-rules';
import {
  inviteWorkbookMember,
  listWorkbookMembers,
  removeWorkbookMember,
  searchWorkbookDirectoryUsers,
  updateWorkbookMemberRole,
} from '../../_lib/workbook-sharing';
import { WorkbookEditor } from '../../_components/WorkbookEditor';
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
    // scroll internally within — the header, toolbar, formula bar, and
    // column-letter row all stay in view.
    <div className={styles.page} data-plugin-fullbleed>
      <WorkbookEditor
        data={data}
        canEdit={canEditWorkbookRole(data.role)}
        isOwner={data.role === 'owner'}
        listMembersAction={listWorkbookMembers.bind(null, workbookId)}
        searchUsersAction={searchWorkbookDirectoryUsers.bind(null, workbookId)}
        inviteMemberAction={inviteWorkbookMember.bind(null, workbookId)}
        updateRoleAction={updateWorkbookMemberRole.bind(null, workbookId)}
        removeMemberAction={removeWorkbookMember.bind(null, workbookId)}
      />
    </div>
  );
}
