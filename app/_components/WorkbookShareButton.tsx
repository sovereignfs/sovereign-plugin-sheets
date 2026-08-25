'use client';

import { useState } from 'react';
import { Button, Icon } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { WorkbookMemberView } from '../_lib/workbook-sharing';
import { WorkbookShareDialog } from './WorkbookShareDialog';

interface WorkbookShareButtonProps {
  listMembersAction: () => Promise<WorkbookMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  removeAction: (userId: string) => Promise<ActionResult>;
}

/** Workbook page's Share entry point — owner-only (isOwner gate in WorkbookView). */
export function WorkbookShareButton({
  listMembersAction,
  searchUsersAction,
  inviteAction,
  removeAction,
}: WorkbookShareButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}>
        <Icon name="share-2" size="sm" aria-hidden={true} />
        Share
      </Button>
      <WorkbookShareDialog
        open={open}
        onClose={() => setOpen(false)}
        listMembersAction={listMembersAction}
        searchUsersAction={searchUsersAction}
        inviteAction={inviteAction}
        removeAction={removeAction}
      />
    </>
  );
}
