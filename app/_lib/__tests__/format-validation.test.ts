import { describe, expect, it } from 'vitest';
import { HyperFormula } from 'hyperformula';
import { clampColumnWidth, parseColumnWidthsJson, serializeColumnWidthsJson, shiftColumnWidths } from '../column-widths';
import { extractFinancePairs, isCurrencyCode, pairKey } from '../finance-function';
import { formatCellValue } from '../format';
import { normalizeRawInput } from '../formula-engine';
import { describeValidationRule, isCellValueValid, validationRulesEqual } from '../validation';

const engine = HyperFormula.buildEmpty({ licenseKey: 'gpl-v3' });

describe('formatCellValue', () => {
  it('formats numbers, percents, and currencies with a stable locale', () => {
    expect(formatCellValue('1234.567', 'number', 1234.567, engine)).toBe('1,234.57');
    expect(formatCellValue('0.256', 'percent', 0.256, engine)).toBe('25.6%');
    expect(formatCellValue('1234.5', 'currency', 1234.5, engine)).toBe('$1,234.50');
    expect(formatCellValue('1234.5', 'currency', 1234.5, engine, 'EUR')).toBe('€1,234.50');
    expect(formatCellValue('1234.5', 'currency', 1234.5, engine, 'JPY')).toBe('¥1,235');
  });

  it('leaves text and plain cells alone', () => {
    expect(formatCellValue('hello', 'number', 'hello', engine)).toBe('hello');
    expect(formatCellValue('12', 'plain', 12, engine)).toBe('12');
    expect(formatCellValue('12', undefined, 12, engine)).toBe('12');
  });

  it('renders a serial date as ISO', () => {
    const serial = 46272; // whatever calendar date the engine maps this to, the output is that date in ISO form
    const date = engine.numberToDate(serial);
    expect(date && 'year' in date).toBe(true);
    if (!date || !('year' in date)) return;
    const expected = `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    expect(formatCellValue(String(serial), 'date', serial, engine)).toBe(expected);
  });
});

describe('validation rules', () => {
  it('checks ranges and lists against resolved values, never flagging empty cells', () => {
    const range = { type: 'range' as const, min: 1, max: 10 };
    expect(isCellValueValid(5, range)).toBe(true);
    expect(isCellValueValid('5', range)).toBe(true);
    expect(isCellValueValid(11, range)).toBe(false);
    expect(isCellValueValid('abc', range)).toBe(false);
    expect(isCellValueValid('', range)).toBe(true);
    expect(isCellValueValid(null, range)).toBe(true);
    const list = { type: 'list' as const, values: ['Yes', 'No'] };
    expect(isCellValueValid('yes', list)).toBe(true);
    expect(isCellValueValid('maybe', list)).toBe(false);
  });

  it('describes and compares rules', () => {
    expect(describeValidationRule({ type: 'range', min: 1 })).toBe('At least 1');
    expect(describeValidationRule({ type: 'list', values: ['a', 'b'] })).toBe('One of: a, b');
    expect(validationRulesEqual({ type: 'range', min: 1 }, { type: 'range', min: 1 })).toBe(true);
    expect(validationRulesEqual({ type: 'range', min: 1 }, { type: 'range', min: 2 })).toBe(false);
    expect(validationRulesEqual(undefined, undefined)).toBe(true);
    expect(validationRulesEqual({ type: 'list', values: ['a'] }, undefined)).toBe(false);
  });
});

describe('column widths', () => {
  it('clamps, drops junk keys, omits defaults, and shifts on insert/delete', () => {
    expect(clampColumnWidth(5)).toBe(48);
    expect(clampColumnWidth(10000)).toBe(480);
    expect(parseColumnWidthsJson(JSON.stringify({ '2': 200, abc: 100, '3': 'wide' }))).toEqual({ '2': 200 });
    expect(serializeColumnWidthsJson({ '0': 128, '1': 200 })).toBe(JSON.stringify({ '1': 200 }));
    expect(shiftColumnWidths({ '0': 100, '2': 300 }, 1, 1)).toEqual({ '0': 100, '3': 300 });
    expect(shiftColumnWidths({ '0': 100, '1': 200, '2': 300 }, 1, -1)).toEqual({ '0': 100, '1': 300 });
  });
});

describe('FINANCE helpers', () => {
  it('extracts literal pairs and validates codes', () => {
    expect(extractFinancePairs('=FINANCE("usd","eur")*A1 + FINANCE("GBP", "JPY")')).toEqual([
      { base: 'USD', quote: 'EUR' },
      { base: 'GBP', quote: 'JPY' },
    ]);
    expect(extractFinancePairs('=FINANCE(A1,B1)')).toEqual([]);
    expect(isCurrencyCode('usd')).toBe(true);
    expect(isCurrencyCode('US')).toBe(false);
    expect(pairKey(' usd ', 'eur')).toBe('USD/EUR');
  });
});

describe('normalizeRawInput', () => {
  it('stores plain decimal literals as numbers and leaves everything else to the engine parser', () => {
    expect(normalizeRawInput('7')).toBe(7);
    expect(normalizeRawInput(' -3.5 ')).toBe(-3.5);
    expect(normalizeRawInput('1e3')).toBe(1000);
    expect(normalizeRawInput('')).toBeNull();
    expect(normalizeRawInput('   ')).toBeNull();
    expect(normalizeRawInput('=A1+1')).toBe('=A1+1');
    expect(normalizeRawInput('5%')).toBe('5%');
    expect(normalizeRawInput('2024-01-01')).toBe('2024-01-01');
    expect(normalizeRawInput('007')).toBe(7);
    expect(normalizeRawInput('abc')).toBe('abc');
  });
});
