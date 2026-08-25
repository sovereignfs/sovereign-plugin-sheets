/** Quotes a CSV field only when needed (RFC 4180-ish, good enough for MVP export). */
function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function cellsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvField).join(',')).join('\r\n');
}

/** Triggers a browser download of `content` as a file named `filename`. */
export function downloadCsv(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Parses RFC 4180-ish CSV text into rows of string cells — the inverse of
 * `cellsToCsv`. Handles quoted fields (embedded commas/newlines, `""` for a
 * literal quote) and both `\r\n` and `\n` line endings. Rows may come back
 * ragged (different field counts) on malformed input; callers normalize.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  function pushField() {
    row.push(field);
    field = '';
  }
  function pushRow() {
    pushField();
    rows.push(row);
    row = [];
  }

  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += char;
        i += 1;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i += 1;
    } else if (char === ',') {
      pushField();
      i += 1;
    } else if (char === '\r') {
      i += 1; // \n (if present) triggers the row end.
    } else if (char === '\n') {
      pushRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  // Trailing field/row when the input has no final newline — but a real
  // trailing newline must not produce a spurious extra empty row.
  if (field !== '' || row.length > 0) pushRow();

  return rows;
}
