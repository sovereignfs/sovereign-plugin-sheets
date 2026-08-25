'use client';

import { useEffect, useRef, useState } from 'react';
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
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onReorder: (orderedIds: string[]) => void;
  /** Viewer role: tabs are still selectable, but add/rename/delete/reorder controls don't render. */
  canEdit: boolean;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const ordered = [...sheets].sort((a, b) => a.position - b.position);

  useEffect(() => {
    if (editingId) renameInputRef.current?.focus();
  }, [editingId]);

  function startRename(sheet: SheetTabItem) {
    setEditingId(sheet.id);
    setDraftName(sheet.name);
  }

  function commitRename() {
    if (editingId && draftName.trim()) onRename(editingId, draftName.trim());
    setEditingId(null);
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

  return (
    <div className={styles.tabs} role="tablist" aria-label="Sheets">
      {ordered.map((sheet, index) => {
        const isActive = sheet.id === activeSheetId;
        const isEditing = sheet.id === editingId;
        return (
          <div
            key={sheet.id}
            className={[styles.tab, isActive && styles.active].filter(Boolean).join(' ')}
          >
            {isEditing ? (
              <input
                ref={renameInputRef}
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onBlur={commitRename}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setEditingId(null);
                }}
                className={styles.renameInput}
                aria-label="Sheet name"
              />
            ) : (
              <button
                type="button"
                role="tab"
                aria-selected={isActive}
                className={styles.tabLabel}
                onClick={() => onSelect(sheet.id)}
                onDoubleClick={() => canEdit && startRename(sheet)}
              >
                {sheet.name}
              </button>
            )}

            {canEdit && (
              <span className={styles.tabControls}>
                <button
                  type="button"
                  className={styles.tabControl}
                  onClick={() => move(sheet.id, -1)}
                  disabled={index === 0}
                  aria-label={`Move ${sheet.name} left`}
                >
                  ‹
                </button>
                <button
                  type="button"
                  className={styles.tabControl}
                  onClick={() => move(sheet.id, 1)}
                  disabled={index === ordered.length - 1}
                  aria-label={`Move ${sheet.name} right`}
                >
                  ›
                </button>
                {ordered.length > 1 && (
                  <button
                    type="button"
                    className={styles.tabControl}
                    onClick={() => onDelete(sheet.id)}
                    aria-label={`Delete ${sheet.name}`}
                  >
                    ×
                  </button>
                )}
              </span>
            )}
          </div>
        );
      })}
      {canEdit && (
        <button type="button" className={styles.addTab} onClick={onAdd} aria-label="Add sheet">
          +
        </button>
      )}
    </div>
  );
}
