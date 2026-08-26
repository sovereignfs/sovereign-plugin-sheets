import type { DataValidationRule } from './cells';

/**
 * Checks a cell's *resolved* value (not its raw formula text) against its
 * validation rule — so a formula result is checked the same as a typed
 * literal. An empty cell is never flagged invalid (no data entered yet is
 * not the same as bad data). Soft validation only: this is used to render a
 * visual indicator (`SheetGrid.tsx`'s `.invalid` class), never to block a
 * commit/save — see SPEC.md's "Data validation" for why blocking on every
 * keystroke isn't attempted here.
 */
export function isCellValueValid(rawValue: unknown, rule: DataValidationRule | undefined): boolean {
  if (!rule) return true;
  if (rawValue === null || rawValue === undefined || rawValue === '') return true;

  if (rule.type === 'range') {
    const numeric = typeof rawValue === 'number' ? rawValue : Number(rawValue);
    if (!Number.isFinite(numeric)) return false;
    if (rule.min !== undefined && numeric < rule.min) return false;
    if (rule.max !== undefined && numeric > rule.max) return false;
    return true;
  }

  if (rule.type === 'list') {
    const text = String(rawValue).trim().toLowerCase();
    return rule.values.some((allowed) => allowed.trim().toLowerCase() === text);
  }

  return true;
}

/** Short, human-readable summary of a rule for the validation dialog/list. */
export function describeValidationRule(rule: DataValidationRule): string {
  if (rule.type === 'range') {
    if (rule.min !== undefined && rule.max !== undefined) return `Between ${rule.min} and ${rule.max}`;
    if (rule.min !== undefined) return `At least ${rule.min}`;
    if (rule.max !== undefined) return `At most ${rule.max}`;
    return 'Any number';
  }
  return `One of: ${rule.values.join(', ')}`;
}
