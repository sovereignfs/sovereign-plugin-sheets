import { describe, expect, it } from 'vitest';
import { cellsToCsv, cellsToTsv, parseClipboardText, parseCsv, parseDelimited } from '../csv';

const TAB = String.fromCharCode(9);

describe('parseCsv', () => {
  it('parses plain rows and quoted fields with embedded delimiters, newlines and quotes', () => {
    expect(parseCsv('a,b,c\n1,2,3')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
    expect(parseCsv('"x, y","line1\nline2","say ""hi"""')).toEqual([['x, y', 'line1\nline2', 'say "hi"']]);
  });

  it('handles CRLF, bare CR, and a trailing newline without a spurious empty row', () => {
    expect(parseCsv('a,b\r\nc,d\r\n')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
    expect(parseCsv('a,b\rc,d')).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('strips a leading UTF-8 byte-order mark', () => {
    expect(parseCsv('﻿Name,Amount\nRent,100')).toEqual([
      ['Name', 'Amount'],
      ['Rent', '100'],
    ]);
  });

  it('treats a quote in the middle of a field as literal text', () => {
    expect(parseCsv('5" screen,ok')).toEqual([['5" screen', 'ok']]);
  });

  it('round-trips through cellsToCsv', () => {
    const rows = [
      ['plain', 'has,comma', 'has "quote"'],
      ['multi\nline', '', '3'],
    ];
    expect(parseCsv(cellsToCsv(rows))).toEqual(rows);
  });
});

describe('tab-separated clipboard text', () => {
  it('round-trips through cellsToTsv/parseDelimited', () => {
    const rows = [
      ['a', 'b c', 'd'],
      ['1', `tab${TAB}inside`, ''],
    ];
    expect(parseDelimited(cellsToTsv(rows), TAB)).toEqual(rows);
  });

  it('parseClipboardText uses tabs when present and one value per line otherwise', () => {
    expect(parseClipboardText(`1${TAB}2\n3${TAB}4\n`)).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
    expect(parseClipboardText('hello, world\nsecond')).toEqual([['hello, world'], ['second']]);
    expect(parseClipboardText('single')).toEqual([['single']]);
  });
});
