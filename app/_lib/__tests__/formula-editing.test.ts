import { describe, expect, it } from 'vitest';
import {
  acceptFunctionSuggestion,
  describeSignature,
  functionContextAt,
  functionQueryAt,
  insertReference,
  referenceInsertionRange,
  suggestFunctions,
} from '../formula-editing';

const NAMES = ['SUM', 'SUMIF', 'SUMIFS', 'SUMPRODUCT', 'SUBSTITUTE', 'SQRT', 'AVERAGE', 'FINANCE', 'SEARCH'];

describe('point mode', () => {
  it('accepts a reference after =, an operator, an opening paren, or a separator', () => {
    expect(referenceInsertionRange('=', 1, null)).toEqual({ start: 1, end: 1 });
    expect(referenceInsertionRange('=SUM(', 5, null)).toEqual({ start: 5, end: 5 });
    expect(referenceInsertionRange('=A1+', 4, null)).toEqual({ start: 4, end: 4 });
    expect(referenceInsertionRange('=SUM(A1, ', 9, null)).toEqual({ start: 9, end: 9 });
    expect(referenceInsertionRange('=A1:', 4, null)).toEqual({ start: 4, end: 4 });
  });

  it('refuses when the draft is not a formula or the caret follows a value', () => {
    expect(referenceInsertionRange('hello', 5, null)).toBeNull();
    expect(referenceInsertionRange('=A1', 3, null)).toBeNull();
    expect(referenceInsertionRange('=SUM(A1)', 8, null)).toBeNull();
    expect(referenceInsertionRange('=12', 3, null)).toBeNull();
  });

  it('keeps replacing the reference it last inserted while the caret is still after it', () => {
    const first = insertReference('=SUM(', { start: 5, end: 5 }, 'A1');
    expect(first).toEqual({ text: '=SUM(A1', caret: 7, span: { start: 5, end: 7 } });
    expect(referenceInsertionRange(first.text, first.caret, first.span)).toEqual({ start: 5, end: 7 });
    const second = insertReference(first.text, first.span, 'A1:B3');
    expect(second.text).toBe('=SUM(A1:B3');
    // Once the user types past it, a new reference goes after the operator instead.
    expect(referenceInsertionRange('=SUM(A1:B3)+', 12, second.span)).toEqual({ start: 12, end: 12 });
  });
});

describe('function autocomplete', () => {
  it('finds the partial name under the caret and ignores cell references and mid-word carets', () => {
    expect(functionQueryAt('=su', 3)).toEqual({ query: 'su', start: 1, end: 3 });
    expect(functionQueryAt('=A1+av', 6)).toEqual({ query: 'av', start: 4, end: 6 });
    expect(functionQueryAt('=A1', 3)).toBeNull();
    expect(functionQueryAt('=SUM(B2', 7)).toBeNull();
    expect(functionQueryAt('=SUM', 2)).toBeNull();
    expect(functionQueryAt('sum', 3)).toBeNull();
    expect(functionQueryAt('="text"', 7)).toBeNull();
  });

  it('suggests popular and documented functions first, then the rest alphabetically', () => {
    expect(suggestFunctions('su', NAMES).map((s) => s.name)).toEqual([
      'SUM',
      'SUBSTITUTE',
      'SUMIF',
      'SUMIFS',
      'SUMPRODUCT',
    ]);
    expect(suggestFunctions('fin', NAMES)[0]?.signature?.params).toBe('"base", "quote"');
    expect(suggestFunctions('', NAMES)).toEqual([]);
    expect(suggestFunctions('s', NAMES, 3)).toHaveLength(3);
  });

  it('accepting a suggestion inserts NAME( and places the caret inside', () => {
    expect(acceptFunctionSuggestion('=su', { query: 'su', start: 1, end: 3 }, 'SUM')).toEqual({
      text: '=SUM(',
      caret: 5,
    });
    expect(acceptFunctionSuggestion('=A1+av*2', { query: 'av', start: 4, end: 6 }, 'AVERAGE')).toEqual({
      text: '=A1+AVERAGE(*2',
      caret: 12,
    });
    expect(acceptFunctionSuggestion('=su(1)', { query: 'su', start: 1, end: 3 }, 'SUM')).toEqual({
      text: '=SUM(1)',
      caret: 5,
    });
  });
});

describe('argument hint', () => {
  it('finds the innermost call and the argument index, skipping commas inside strings', () => {
    expect(functionContextAt('=SUM(A1, ', 9)).toMatchObject({ name: 'SUM', argIndex: 1 });
    expect(functionContextAt('=IF(A1>2, SUM(B1,', 18)).toMatchObject({ name: 'SUM', argIndex: 1 });
    expect(functionContextAt('=IF(A1>2, SUM(B1,B2), ', 22)).toMatchObject({ name: 'IF', argIndex: 2 });
    expect(functionContextAt('=TEXTJOIN(", ", TRUE, ', 22)).toMatchObject({ name: 'TEXTJOIN', argIndex: 2 });
    expect(functionContextAt('=A1+1', 5)).toBeNull();
    expect(functionContextAt('=SUM(A1)', 8)).toBeNull();
  });

  it('describes the signature with the active parameter flagged, and lets a trailing … absorb extra arguments', () => {
    const sum = describeSignature({ name: 'SUM', argIndex: 4, signature: { params: 'number1, [number2], …', description: 'x' } });
    expect(sum.params.map((p) => p.active)).toEqual([false, false, true]);
    const unknown = describeSignature({ name: 'FOO', argIndex: 0, signature: undefined });
    expect(unknown.params).toEqual([{ label: '…', active: true }]);
  });
});
