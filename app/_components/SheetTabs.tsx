'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon, Menu, Tooltip, type MenuEntry } from '@sovereignfs/ui';
import styles from './SheetTabs.module.css';

export interface SheetTabItem {
  id: string;
  name: string;
  position: number;
}

export function SheetTabs({
  sheets,
  activeSheetId,
  onSelect,
  onAdd,
  onRename,
  onDelete,
  onReorder,
  canEdit,
}: {
  sheets: SheetTabItem[];
  activeSheetId: string | null;
  onSelect: (id: string) => void;
  onAdd: () => void;
  /** Returns an error message to show inline (a duplicate or invalid name), or null when the rename went through. */
  onRename: (id: string, name: string) => string | null;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  /** Viewer role: tabs are still selectable, but add/rename/delete/reorder controls don't render. */
  canEdit: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);
  const [menuSheetId, setMenuSheetId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const ordered = [...sheets].sort((a, b) => a.position - b.position);

  useEffect(() => {
    if (editingId) {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }
  }, [editingId]);

  function startRename(sheet: SheetTabItem) {
    if (!canEdit) return;
    setEditingId(sheet.id);
    setDraftName(sheet.name);
    setRenameError(null);
  }

  function commitRename() {
    if (!editingId) return;
    const error = onRename(editingId, draftName);
    if (error) {
      setRenameError(error);
      renameInputRef.current?.focus();
      return;
    }
    setEditingId(null);
    setRenameError(null);
  }

  function cancelRename() {
    setEditingId(null);
    setRenameError(null);
  }

  function move(id: string, direction: -1 | 1) {
    const index = ordered.findIndex((s) => s.id === id);
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    const [item] = next.splice(index, 1);
    if (!item) return;
    next.splice(target, 0, item);
    onReorder(next.map((s) => s.id));
  }

  /** Roving tabindex + arrow keys on the tab strip (WAI-ARIA tabs pattern). */
  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let target: number | null = null;
    if (e.key === 'ArrowRight') target = (index + 1) % ordered.length;
    else if (e.key === 'ArrowLeft') target = (index - 1 + ordered.length) % ordered.length;
    else if (e.key === 'Home') target = 0;
    else if (e.key === 'End') target = ordered.length - 1;
    else if (e.key === 'F2' || (e.key === 'Enter' && canEdit && e.altKey)) {
      const sheet = ordered[index];
      if (sheet) {
        e.preventDefault();
        startRename(sheet);
      }
      return;
    }
    if (target === null) return;
    e.preventDefault();
    const sheet = ordered[target];
    if (!sheet) return;
    onSelect(sheet.id);
    tabRefs.current.get(sheet.id)?.focus();
  }

  return (
    <div className={styles.strip}>
      <div className={styles.tabs} role="tablist" aria-label="Sheets">
        {ordered.map((sheet, index) => {
          const isActive = sheet.id === activeSheetId;
          const isEditing = sheet.id === editingId;
          const menuItems: MenuEntry[] = [
            { label: 'Rename', icon: 'pencil', onSelect: () => startRename(sheet) },
            { label: 'Move left', icon: 'chevron-left', disabled: index === 0, onSelect: () => move(sheet.id, -1) },
            {
              label: 'Move right',
              icon: 'chevron-right',
              disabled: index === ordered.length - 1,
              onSelect: () => move(sheet.id, 1),
            },
            { type: 'separator' },
            {
              label: 'Delete',
              icon: 'trash-2',
              destructive: true,
              disabled: ordered.length <= 1,
              onSelect: () => onDelete(sheet.id),
            },
          ];
          return (
            <div key={sheet.id} className={[styles.tab, isActive && styles.active].filter(Boolean).join(' ')}>
              {isEditing ? (
                <div className={styles.renameWrap}>
                  <input
                    ref={renameInputRef}
                    value={draftName}
                    onChange={(e) => {
                      setDraftName(e.target.value);
                      setRenameError(null);
                    }}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitRename();
                      }
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        cancelRename();
                      }
                    }}
                    className={[styles.renameInput, renameError && styles.renameInputInvalid].filter(Boolean).join(' ')}
                    aria-label="Sheet name"
                    aria-invalid={renameError ? true : undefined}
                    aria-describedby={renameError ? `sheet-rename-error-${sheet.id}` : undefined}
                  />
                  {renameError ? (
                    <p id={`sheet-rename-error-${sheet.id}`} className={styles.renameError} role="alert">
                      {renameError}
                    </p>
                  ) : null}
                </div>
              ) : (
                <button
                  ref={(el) => {
                    if (el) tabRefs.current.set(sheet.id, el);
                    else tabRefs.current.delete(sheet.id);
                  }}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  className={styles.tabLabel}
                  onClick={() => onSelect(sheet.id)}
                  onDoubleClick={() => startRename(sheet)}
                  onKeyDown={(e) => handleTabKeyDown(e, index)}
                  title={canEdit ? 'Double-click to rename' : undefined}
                >
                  {sheet.name}
                </button>
              )}

              {canEdit && isActive && !isEditing && (
                <Menu
                  aria-label={`Actions for ${sheet.name}`}
                  open={menuSheetId === sheet.id}
                  onClose={() => setMenuSheetId(null)}
                  align="left"
                  trigger={
                    <button
                      type="button"
                      className={styles.tabMenuButton}
                      aria-label={`Actions for ${sheet.name}`}
                      aria-haspopup="menu"
                      aria-expanded={menuSheetId === sheet.id}
                      onClick={() => setMenuSheetId((current) => (current === sheet.id ? null : sheet.id))}
                    >
                      <Icon name="chevron-down" size="sm" aria-hidden />
                    </button>
                  }
                  items={menuItems}
                />
              )}
            </div>
          );
        })}
      </div>
      {canEdit && (
        <Tooltip content="Add sheet">
          <button type="button" className={styles.addTab} onClick={onAdd} aria-label="Add sheet">
            <Icon name="plus" size="sm" aria-hidden />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
