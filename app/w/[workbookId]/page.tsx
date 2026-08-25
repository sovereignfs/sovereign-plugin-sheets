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
    <div className={styles.page}>
      <WorkbookView
        workbookId={data.workbook.id}
        name={data.workbook.name}
        sheets={data.sheets}
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
