const TAB = String.fromCharCode(9);
const BOM = 0xfeff;

/** Quotes a delimited field only when needed (RFC 4180-ish). */
function quoteField(value: string, delimiter: string): string {
  if (value.includes(delimiter) || /["\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function cellsToCsv(rows: string[][]): string {
  return rows.map((row) => row.map((field) => quoteField(field, ',')).join(',')).join('\r\n');
}

/**
 * Tab-separated text for the system clipboard — what Excel/Google Sheets
 * put there on copy, and what they expect back on paste. Tabs and newlines
 * inside a value are quoted the same way CSV quotes them.
 */
export function cellsToTsv(rows: string[][]): string {
  return rows.map((row) => row.map((field) => quoteField(field, TAB)).join(TAB)).join('\n');
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
 * Parses RFC 4180-ish delimited text into rows of string cells — the
 * inverse of `cellsToCsv`/`cellsToTsv`. Handles quoted fields (embedded
 * delimiters/newlines, `""` for a literal quote), `\r\n` / `\n` / bare `\r`
 * line endings, and strips a leading UTF-8 byte-order mark (Excel writes
 * one on every CSV it saves, which otherwise lands as an invisible character
 * in A1). Rows may come back ragged (different field counts) on malformed
 * input; callers normalize.
 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const input = text.charCodeAt(0) === BOM ? text.slice(1) : text;
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

  while (i < input.length) {
    const char = input[i];
    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
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
    if (char === '"' && field === '') {
      inQuotes = true;
      i += 1;
    } else if (char === delimiter) {
      pushField();
      i += 1;
    } else if (char === '\r') {
      pushRow();
      i += input[i + 1] === '\n' ? 2 : 1;
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

export function parseCsv(text: string): string[][] {
  return parseDelimited(text, ',');
}

/**
 * Clipboard text → rows. Tab-separated when any tab is present (a copy from
 * another spreadsheet); otherwise one value per line, so plain text pasted
 * into a cell keeps its commas.
 */
export function parseClipboardText(text: string): string[][] {
  if (text.includes(TAB)) return parseDelimited(text, TAB);
  const normalized = text.charCodeAt(0) === BOM ? text.slice(1) : text;
  const lines = normalized.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => [line]);
}
