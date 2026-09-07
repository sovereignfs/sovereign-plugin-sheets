import { describe, expect, it } from 'vitest';
import { cellKey, colIndexToLetters, lettersToColIndex, parseCellKey, rangeLabel } from '../a1';

describe('a1 helpers', () => {
  it('converts column indexes to letters and back, including multi-letter columns', () => {
    expect(colIndexToLetters(0)).toBe('A');
    expect(colIndexToLetters(25)).toBe('Z');
    expect(colIndexToLetters(26)).toBe('AA');
    expect(colIndexToLetters(701)).toBe('ZZ');
    expect(colIndexToLetters(702)).toBe('AAA');
    for (const index of [0, 25, 26, 51, 52, 701, 702, 999]) {
      expect(lettersToColIndex(colIndexToLetters(index))).toBe(index);
    }
  });

  it('builds and parses cell keys', () => {
    expect(cellKey(0, 0)).toBe('A1');
    expect(cellKey(9, 27)).toBe('AB10');
    expect(parseCellKey('AB10')).toEqual({ row: 9, col: 27 });
    expect(parseCellKey('a1')).toBeNull();
    expect(parseCellKey('A0')).toBeNull();
    expect(parseCellKey('$A$1')).toBeNull();
    expect(parseCellKey('A1:B2')).toBeNull();
  });

  it('labels a single cell and a range', () => {
    expect(rangeLabel(0, 0, 0, 0)).toBe('A1');
    expect(rangeLabel(0, 0, 2, 1)).toBe('A1:B3');
  });
});
