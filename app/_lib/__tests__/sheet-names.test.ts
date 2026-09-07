import { describe, expect, it } from 'vitest';
import { nextDefaultSheetName, sheetNamesCollide, uniqueSheetName, validateSheetName } from '../sheet-names';

describe('sheet names', () => {
  it('collide case-insensitively, the way the formula engine treats them', () => {
    expect(sheetNamesCollide('Sheet1', 'SHEET1')).toBe(true);
    expect(sheetNamesCollide('  Budget ', 'budget')).toBe(true);
    expect(sheetNamesCollide('Sheet1', 'Sheet2')).toBe(false);
  });

  it('validateSheetName rejects empty, over-long, invalid-character, and duplicate names', () => {
    expect(validateSheetName('   ', [])).toMatch(/Enter a sheet name/);
    expect(validateSheetName('x'.repeat(65), [])).toMatch(/at most 64/);
    expect(validateSheetName("Q1'24", [])).toMatch(/can't contain/);
    expect(validateSheetName('data/2024', [])).toMatch(/can't contain/);
    expect(validateSheetName('SHEET1', ['Sheet1'])).toMatch(/already exists/);
    expect(validateSheetName('Sheet2', ['Sheet1'])).toBeNull();
  });

  it('uniqueSheetName appends a counter until the name is free', () => {
    expect(uniqueSheetName('Data', [])).toBe('Data');
    expect(uniqueSheetName('data', ['Data'])).toBe('data (2)');
    expect(uniqueSheetName('Data', ['Data', 'Data (2)'])).toBe('Data (3)');
    expect(uniqueSheetName('', [])).toBe('Sheet');
  });

  it('nextDefaultSheetName skips taken numbers', () => {
    expect(nextDefaultSheetName([])).toBe('Sheet1');
    expect(nextDefaultSheetName(['Sheet1', 'sheet2'])).toBe('Sheet3');
    expect(nextDefaultSheetName(['Sheet2'])).toBe('Sheet3');
  });
});
