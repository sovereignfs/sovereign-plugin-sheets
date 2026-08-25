export type WorkbookMemberRole = 'owner' | 'editor' | 'viewer';

/** Whether a `workbook_members` role may edit the workbook's sheets. */
export function canEditWorkbookRole(role: WorkbookMemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'editor';
}

/** Type guard for a `workbook_members.role` value submitted from the share/invite form. */
export function isWorkbookMemberRole(value: string): value is WorkbookMemberRole {
  return value === 'owner' || value === 'editor' || value === 'viewer';
}
