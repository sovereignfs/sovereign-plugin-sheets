import { describe, expect, it } from 'vitest';
import {
  extractCellMetadata,
  mergeCellMetadata,
  parseCellsJson,
  permuteMetadataRows,
  sanitizeCellData,
  serializeCellsJson,
  shiftMetadata,
} from '../cells';

describe('sanitizeCellData', () => {
  it('keeps well-formed fields and drops everything else', () => {
    expect(
      sanitizeCellData({
        v: '=SUM(A1:A3)',
        fmt: 'currency',
        currency: 'eur',
        style: { bold: true, color: '#FF0000', bg: 'red', fontSize: 16, align: 'center', weird: 1 },
        validation: { type: 'range', min: 1, max: 10 },
        extra: 'nope',
      }),
    ).toEqual({
      v: '=SUM(A1:A3)',
      fmt: 'currency',
      currency: 'EUR',
      style: { bold: true, color: '#ff0000', fontSize: 16, align: 'center' },
      validation: { type: 'range', min: 1, max: 10 },
    });
  });

  it('rejects an unknown format, a font size outside the curated list, an inverted range, and a non-finite value', () => {
    expect(sanitizeCellData({ fmt: 'hex' })).toBeUndefined();
    expect(sanitizeCellData({ style: { fontSize: 13 } })).toBeUndefined();
    expect(sanitizeCellData({ validation: { type: 'range', min: 10, max: 1 } })).toBeUndefined();
    expect(sanitizeCellData({ v: Number.POSITIVE_INFINITY })).toBeUndefined();
  });

  it('caps list validation values and drops currency without the currency format', () => {
    const values = Array.from({ length: 150 }, (_, i) => `v${String(i)}`);
    const cell = sanitizeCellData({ validation: { type: 'list', values }, fmt: 'number', currency: 'USD' });
    expect(cell?.validation?.type === 'list' && cell.validation.values.length).toBe(100);
    expect(cell?.currency).toBeUndefined();
  });
});

describe('parseCellsJson / serializeCellsJson', () => {
  it('drops cells with keys that are not A1 references and empty cells', () => {
    const cells = parseCellsJson(
      JSON.stringify({ A1: { v: 1 }, 'Sheet1!B2': { v: 2 }, $C$3: { v: 3 }, D4: { v: '' }, E5: {} }),
    );
    expect(Object.keys(cells)).toEqual(['A1']);
  });

  it('returns an empty map for malformed JSON', () => {
    expect(parseCellsJson('{not json')).toEqual({});
    expect(parseCellsJson('[1,2]')).toEqual({});
  });

  it('keeps a value-less cell that carries formatting', () => {
    const json = serializeCellsJson({ A1: { style: { bold: true } }, A2: { fmt: 'plain' }, A3: { v: 'x' } });
    expect(Object.keys(JSON.parse(json) as object)).toEqual(['A1', 'A3']);
  });
});

describe('metadata helpers', () => {
  it('merge and extract are inverses', () => {
    const metadata = { B2: { fmt: 'number' as const, style: { italic: true } } };
    const merged = mergeCellMetadata({ B2: { v: 1 }, C3: { v: 2 } }, metadata);
    expect(merged.B2).toEqual({ v: 1, fmt: 'number', style: { italic: true } });
    expect(extractCellMetadata(merged)).toEqual(metadata);
  });

  it('shiftMetadata moves keys below an inserted row and drops keys in a deleted band', () => {
    const meta = { A1: { fmt: 'number' as const }, A3: { fmt: 'date' as const }, A5: { fmt: 'percent' as const } };
    expect(Object.keys(shiftMetadata(meta, 'row', 1, 2)).sort()).toEqual(['A1', 'A5', 'A7']);
    expect(Object.keys(shiftMetadata(meta, 'row', 2, -2)).sort()).toEqual(['A1', 'A3']);
    expect(Object.keys(shiftMetadata({ B1: { fmt: 'number' as const } }, 'col', 0, 1))).toEqual(['C1']);
  });

  it('permuteMetadataRows follows a row reorder', () => {
    const meta = { A1: { fmt: 'number' as const }, A3: { fmt: 'date' as const } };
    // new order: old row 2 first, then old row 0, then old row 1
    expect(permuteMetadataRows(meta, [2, 0, 1])).toEqual({ A2: { fmt: 'number' }, A1: { fmt: 'date' } });
  });
});
