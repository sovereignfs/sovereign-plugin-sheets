'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { WorkbookView } from './WorkbookView';
import type { WorkbookWithSheets } from '../actions';
import type { ActionResult } from '../_lib/context';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { WorkbookMemberView } from '../_lib/workbook-sharing';

interface WorkbookEditorProps {
  data: WorkbookWithSheets;
  canEdit: boolean;
  isOwner: boolean;
  listMembersAction: () => Promise<WorkbookMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteMemberAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateRoleAction: (userId: string, role: string) => Promise<ActionResult>;
  removeMemberAction: (userId: string) => Promise<ActionResult>;
}

/**
 * Owns *when* the editor remounts. `WorkbookView` initializes its formula
 * engine once from props, so fresh server data only takes effect through a
 * remount — keyed on the server's `changeToken`, but only after the view
 * itself asked for a reload (its poll found a change made elsewhere and
 * nothing local is unsaved). A refetch for any other reason (a rename this
 * client just made, a sharing change) updates props without disturbing the
 * user's selection or in-progress edits.
 */
export function WorkbookEditor({ data, ...rest }: WorkbookEditorProps) {
  const router = useRouter();
  const [mountedToken, setMountedToken] = useState(data.changeToken);
  const reloadRequested = useRef(false);

  const handleRemoteChange = useCallback(() => {
    reloadRequested.current = true;
    router.refresh();
  }, [router]);

  useEffect(() => {
    if (reloadRequested.current && data.changeToken !== mountedToken) {
      reloadRequested.current = false;
      setMountedToken(data.changeToken);
    }
  }, [data.changeToken, mountedToken]);

  return (
    <WorkbookView
      key={mountedToken}
      workbookId={data.workbook.id}
      name={data.workbook.name}
      sheets={data.sheets}
      activeSheetId={data.workbook.activeSheetId}
      namedRangesJson={data.workbook.namedRangesJson}
      onRemoteChange={handleRemoteChange}
      {...rest}
    />
  );
}
