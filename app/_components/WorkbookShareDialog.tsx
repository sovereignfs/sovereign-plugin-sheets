'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { Button, Dialog, FormField, Input, Select, Spinner } from '@sovereignfs/ui';
import type { DirectoryUser } from '@sovereignfs/sdk';
import type { ActionResult } from '../_lib/context';
import type { WorkbookMemberView } from '../_lib/workbook-sharing';
import styles from './WorkbookShareDialog.module.css';

const SEARCH_DEBOUNCE_MS = 250;
const MIN_QUERY_LENGTH = 2;

interface WorkbookShareDialogProps {
  open: boolean;
  onClose: () => void;
  listMembersAction: () => Promise<WorkbookMemberView[]>;
  searchUsersAction: (query: string) => Promise<DirectoryUser[]>;
  inviteAction: (prevState: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  updateRoleAction: (userId: string, role: string) => Promise<ActionResult>;
  removeAction: (userId: string) => Promise<ActionResult>;
}

/**
 * Workbook-level sharing — owner-only member management: a member list
 * with an inline role picker per person (change a role in place — no need
 * to re-add someone), Remove/Leave, and an invite form with a directory
 * typeahead. Every failure (last owner, lost permission) renders inline.
 */
export function WorkbookShareDialog({
  open,
  onClose,
  listMembersAction,
  searchUsersAction,
  inviteAction,
  updateRoleAction,
  removeAction,
}: WorkbookShareDialogProps) {
  const [members, setMembers] = useState<WorkbookMemberView[] | null>(null);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DirectoryUser[]>([]);
  const [selected, setSelected] = useState<DirectoryUser | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [inviteState, inviteFormAction, invitePending] = useActionState<ActionResult | null, FormData>(
    inviteAction,
    null,
  );

  function refreshMembers() {
    listMembersAction()
      .then(setMembers)
      .catch(() => setMemberError("Couldn't load who has access. Close and reopen to try again."));
  }

  useEffect(() => {
    if (!open) {
      setMembers(null);
      setMemberError(null);
      return;
    }
    refreshMembers();
    // refreshMembers wraps a stable bound action; keying only on `open` (not
    // re-created each render) avoids a fetch loop.
  }, [open]);

  useEffect(() => {
    if (inviteState?.ok) {
      setSelected(null);
      setQuery('');
      setResults([]);
      formRef.current?.reset();
      refreshMembers();
    }
  }, [inviteState]);

  useEffect(() => {
    if (selected || query.trim().length < MIN_QUERY_LENGTH) {
      setResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchUsersAction(query.trim())
        .then((users) => {
          if (!cancelled) setResults(users);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, selected, searchUsersAction]);

  async function handleRemove(member: WorkbookMemberView) {
    setMemberError(null);
    setBusyUserId(member.userId);
    try {
      const result = await removeAction(member.userId);
      if (result.ok) {
        if (member.isSelf) {
          // Left the workbook — the page no longer belongs to this user.
          window.location.assign('/sheets');
          return;
        }
        refreshMembers();
      } else {
        setMemberError(result.error);
      }
    } catch {
      setMemberError("Couldn't remove that person. Try again.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRoleChange(member: WorkbookMemberView, role: string) {
    setMemberError(null);
    setBusyUserId(member.userId);
    try {
      const result = await updateRoleAction(member.userId, role);
      if (result.ok) {
        if (member.isSelf && role !== 'owner') {
          // Demoted yourself — reload so the page reflects the new role.
          window.location.reload();
          return;
        }
        refreshMembers();
      } else {
        setMemberError(result.error);
        refreshMembers();
      }
    } catch {
      setMemberError("Couldn't change that role. Try again.");
      refreshMembers();
    } finally {
      setBusyUserId(null);
    }
  }

  const alreadyMemberIds = new Set((members ?? []).map((member) => member.userId));
  const visibleResults = results.filter((user) => !alreadyMemberIds.has(user.id));

  return (
    <Dialog open={open} onClose={onClose} size="md" title="Share">
      <div className={styles.body}>
        <p className={styles.sectionLabel}>Who has access</p>
        {members === null && !memberError ? (
          <Spinner />
        ) : (
          <ul className={styles.members}>
            {(members ?? []).map((member) => (
              <li key={member.userId} className={styles.member}>
                <div className={styles.memberIdentity}>
                  <p className={styles.memberName}>
                    {member.name ?? member.email}
                    {member.isSelf ? <span className={styles.you}> (you)</span> : null}
                  </p>
                  {member.name ? <p className={styles.memberEmail}>{member.email}</p> : null}
                </div>
                <div className={styles.memberActions}>
                  <Select
                    size="sm"
                    value={member.role}
                    disabled={busyUserId === member.userId}
                    onChange={(e) => void handleRoleChange(member, e.target.value)}
                    aria-label={`Role for ${member.name ?? member.email}`}
                  >
                    <option value="viewer">Viewer</option>
                    <option value="editor">Editor</option>
                    <option value="owner">Owner</option>
                  </Select>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busyUserId === member.userId}
                    onClick={() => void handleRemove(member)}
                  >
                    {member.isSelf ? 'Leave' : 'Remove'}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        {memberError ? (
          <p className={styles.error} role="alert">
            {memberError}
          </p>
        ) : null}

        <form ref={formRef} action={inviteFormAction} className={styles.inviteForm}>
          <p className={styles.sectionLabel}>Add someone</p>
          <input type="hidden" name="userId" value={selected?.id ?? ''} />
          <FormField label="Person" hint={selected ? undefined : 'Search by name or email'}>
            {(field) => (
              <div className={styles.picker}>
                <Input
                  {...field}
                  value={selected ? (selected.name ?? selected.email) : query}
                  onChange={(event) => {
                    setSelected(null);
                    setQuery(event.currentTarget.value);
                  }}
                  placeholder="Search by name or email"
                  autoComplete="off"
                />
                {visibleResults.length > 0 && !selected ? (
                  <ul className={styles.results}>
                    {visibleResults.map((user) => (
                      <li key={user.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(user);
                            setResults([]);
                          }}
                        >
                          {user.name ?? user.email}
                          {user.name ? ` (${user.email})` : ''}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )}
          </FormField>
          <FormField label="Role" hint="Viewers can look but not edit. Editors can change cells. Owners can also share and delete.">
            {(field) => (
              <Select {...field} name="role" defaultValue="viewer">
                <option value="viewer">Viewer</option>
                <option value="editor">Editor</option>
                <option value="owner">Owner</option>
              </Select>
            )}
          </FormField>
          {inviteState && !inviteState.ok ? (
            <p className={styles.error} role="alert">
              {inviteState.error}
            </p>
          ) : null}
          <Button type="submit" disabled={!selected || invitePending}>
            {invitePending ? 'Adding…' : 'Add person'}
          </Button>
        </form>
      </div>
    </Dialog>
  );
}
