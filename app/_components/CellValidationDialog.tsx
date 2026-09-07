'use client';

import { useEffect, useState } from 'react';
import { Button, Dialog, FormField, Input, Select } from '@sovereignfs/ui';
import type { DataValidationRule } from '../_lib/cells';
import { MAX_VALIDATION_LIST_VALUES } from '../_lib/config';
import { describeValidationRule } from '../_lib/validation';
import styles from './CellValidationDialog.module.css';

type RuleType = 'none' | 'range' | 'list';

interface CellValidationDialogProps {
  open: boolean;
  onClose: () => void;
  /** A1 label of the cell or range the rule applies to, e.g. "B3" or "B3:B20". */
  rangeLabel: string;
  cellCount: number;
  /** The rule every selected cell currently shares, if they share one. */
  currentRule: DataValidationRule | undefined;
  onSave: (rule: DataValidationRule | undefined) => void;
}

/**
 * Sets/clears a validation rule for every cell in the selection. Soft
 * validation only: saving a rule never rejects a cell's current value, even
 * if it already violates the new rule — `SheetGrid.tsx` renders an
 * `.invalid` indicator going forward, and a list rule gets an in-cell
 * dropdown of its allowed values.
 */
export function CellValidationDialog({
  open,
  onClose,
  rangeLabel,
  cellCount,
  currentRule,
  onSave,
}: CellValidationDialogProps) {
  const [type, setType] = useState<RuleType>('none');
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [listValues, setListValues] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
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
      if ((minNum !== undefined && !Number.isFinite(minNum)) || (maxNum !== undefined && !Number.isFinite(maxNum))) {
        setError('Enter numbers for the minimum and maximum.');
        return;
      }
      if (minNum === undefined && maxNum === undefined) {
        setError('Enter a minimum, a maximum, or both.');
        return;
      }
      if (minNum !== undefined && maxNum !== undefined && minNum > maxNum) {
        setError('The minimum must be less than or equal to the maximum.');
        return;
      }
      onSave({ type: 'range', min: minNum, max: maxNum });
      onClose();
      return;
    }
    const values = listValues
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean);
    if (values.length === 0) {
      setError('Enter at least one allowed value.');
      return;
    }
    if (values.length > MAX_VALIDATION_LIST_VALUES) {
      setError(`A list can have at most ${String(MAX_VALIDATION_LIST_VALUES)} values.`);
      return;
    }
    onSave({ type: 'list', values });
    onClose();
  }

  const targetLabel = cellCount > 1 ? `${rangeLabel} (${String(cellCount)} cells)` : rangeLabel;

  return (
    <Dialog open={open} onClose={onClose} size="sm" title="Data validation">
      <div className={styles.body}>
        <p className={styles.cellLabel}>{targetLabel}</p>
        {currentRule ? (
          <p className={styles.current}>Current rule: {describeValidationRule(currentRule)}</p>
        ) : cellCount > 1 ? (
          <p className={styles.current}>These cells don&apos;t share a rule yet.</p>
        ) : null}

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
                <Input {...field} type="number" value={min} onChange={(e) => setMin(e.target.value)} placeholder="No minimum" />
              )}
            </FormField>
            <FormField label="Maximum">
              {(field) => (
                <Input {...field} type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="No maximum" />
              )}
            </FormField>
          </div>
        )}

        {type === 'list' && (
          <FormField label="Allowed values" hint="Comma-separated. Cells get a dropdown of these values.">
            {(field) => (
              <Input {...field} value={listValues} onChange={(e) => setListValues(e.target.value)} placeholder="Yes, No, Maybe" />
            )}
          </FormField>
        )}

        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}

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
