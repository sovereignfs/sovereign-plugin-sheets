'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import type { DataValidationRule } from '../_lib/cells';
import { describeValidationRule } from '../_lib/validation';
import styles from './CellValidationDialog.module.css';

type RuleType = 'none' | 'range' | 'list';

interface CellValidationDialogProps {
  open: boolean;
  onClose: () => void;
  /** A1 label of the cell this rule applies to, e.g. "B3". */
  cellLabel: string;
  currentRule: DataValidationRule | undefined;
  onSave: (rule: DataValidationRule | undefined) => void;
}

/**
 * Sets/clears a validation rule for one cell — per-cell, not range-based,
 * since this grid has no multi-cell selection model (same constraint noted
 * for conditional formatting; see SPEC.md's "Data validation"). Soft
 * validation only: saving a rule never rejects the cell's current value,
 * even if it already violates the new rule — `SheetGrid.tsx` just renders
 * an `.invalid` indicator going forward.
 */
export function CellValidationDialog({
  open,
  onClose,
  cellLabel,
  currentRule,
  onSave,
}: CellValidationDialogProps) {
  const [type, setType] = useState<RuleType>('none');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [listValues, setListValues] = useState('');

  useEffect(() => {
    if (!open) return;
    setType(currentRule?.type ?? 'none');
    setMin(currentRule?.type === 'range' && currentRule.min !== undefined ? String(currentRule.min) : '');
    setMax(currentRule?.type === 'range' && currentRule.max !== undefined ? String(currentRule.max) : '');
    setListValues(currentRule?.type === 'list' ? currentRule.values.join(', ') : '');
  }, [open, currentRule]);

  function handleSave() {
    if (type === 'none') {
      onSave(undefined);
      onClose();
      return;
    }
    if (type === 'range') {
      const minNum = min.trim() === '' ? undefined : Number(min);
      const maxNum = max.trim() === '' ? undefined : Number(max);
      if (minNum === undefined && maxNum === undefined) return;
      onSave({ type: 'range', min: minNum, max: maxNum });
      onClose();
      return;
    }
    const values = listValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) return;
    onSave({ type: 'list', values });
    onClose();
  }

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Data validation">
      <div className={styles.body}>
        <p className={styles.cellLabel}>{cellLabel}</p>
        {currentRule && <p className={styles.current}>Current rule: {describeValidationRule(currentRule)}</p>}

        <FormField label="Rule">
          {(field) => (
            <Select {...field} value={type} onChange={(e) => setType(e.target.value as RuleType)}>
              <option value="none">No validation</option>
              <option value="range">Number range</option>
              <option value="list">List of values</option>
            </Select>
          )}
        </FormField>

        {type === 'range' && (
          <div className={styles.row}>
            <FormField label="Minimum">
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  value={min}
                  onChange={(e) => setMin(e.target.value)}
                  placeholder="No minimum"
                />
              )}
            </FormField>
            <FormField label="Maximum">
              {(field) => (
                <Input
                  {...field}
                  type="number"
                  value={max}
                  onChange={(e) => setMax(e.target.value)}
                  placeholder="No maximum"
                />
              )}
            </FormField>
          </div>
        )}

        {type === 'list' && (
          <FormField label="Allowed values" hint="Comma-separated">
            {(field) => (
              <Input
                {...field}
                value={listValues}
                onChange={(e) => setListValues(e.target.value)}
                placeholder="Yes, No, Maybe"
              />
            )}
          </FormField>
        )}

        <div className={styles.actions}>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" size="sm" onClick={handleSave}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
