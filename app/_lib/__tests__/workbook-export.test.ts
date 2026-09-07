import { describe, expect, it } from 'vitest';
import { MAX_IMPORT_SHEET_COUNT, MAX_ROW_COUNT } from '../config';
import { parseWorkbookExportPayload, WORKBOOK_EXPORT_FORMAT_VERSION } from '../workbook-export';

function payload(sheets: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    formatVersion: WORKBOOK_EXPORT_FORMAT_VERSION,
    exportedAt: 1,
    workbook: { name: 'Book', namedRangesJson: '{}', sheets, ...extra },
  });
}

describe('parseWorkbookExportPayload', () => {
  it('rejects non-JSON, the wrong format version, and files with no sheets', () => {
    expect(parseWorkbookExportPayload('nope')).toMatchObject({ ok: false });
    expect(parseWorkbookExportPayload(JSON.stringify({ formatVersion: 99, workbook: { sheets: [{}] } }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('unsupported version'),
    });
    expect(parseWorkbookExportPayload(payload([]))).toMatchObject({ ok: false, error: 'File has no sheets.' });
  });

  it('caps sheet count and sheet size', () => {
    const many = Array.from({ length: MAX_IMPORT_SHEET_COUNT + 1 }, () => ({ rowCount: 1, colCount: 1 }));
    expect(parseWorkbookExportPayload(payload(many))).toMatchObject({ ok: false });
    expect(parseWorkbookExportPayload(payload([{ name: 'Big', rowCount: MAX_ROW_COUNT + 1, colCount: 1 }]))).toMatchObject({
      ok: false,
      error: expect.stringContaining('"Big" is too large'),
    });
  });

  it('makes sheet names unique case-insensitively so the workbook can always load', () => {
    const result = parseWorkbookExportPayload(
      payload([
        { name: 'Sheet1', rowCount: 5, colCount: 5 },
        { name: 'sheet1', rowCount: 5, colCount: 5 },
        { name: '', rowCount: 5, colCount: 5 },
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.workbook.sheets.map((s) => s.name)).toEqual(['Sheet1', 'sheet1 (2)', 'Sheet3']);
  });

  it('sanitizes cells, widths, frozen panes and named ranges on the way in', () => {
    const result = parseWorkbookExportPayload(
      payload(
        [
          {
            name: 'S',
            rowCount: 10,
            colCount: 4,
            cellsJson: JSON.stringify({ A1: { v: 1, style: { color: 'javascript:alert(1)' } }, ZZZZ1: { v: 2 } }),
            colWidthsJson: JSON.stringify({ '0': 99999, x: 10 }),
            frozenRows: 99,
            frozenCols: -1,
          },
        ],
        { namedRangesJson: JSON.stringify({ Good: '=A1', 'bad name': '=A1', B2: '=A1', Num: 5 }) },
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const sheet = result.payload.workbook.sheets[0];
    expect(sheet?.cellsJson).toBe(JSON.stringify({ A1: { v: 1 } }));
    expect(JSON.parse(sheet?.colWidthsJson ?? '{}')).toEqual({ '0': 480 });
    expect(sheet?.frozenRows).toBe(5);
    expect(sheet?.frozenCols).toBe(0);
    expect(JSON.parse(result.payload.workbook.namedRangesJson)).toEqual({ Good: '=A1' });
  });
});
