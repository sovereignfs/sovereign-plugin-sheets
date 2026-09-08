// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HyperFormula } from 'hyperformula';
import { SheetGrid } from '../SheetGrid';
import { createEngine } from '../../_lib/formula-engine';
import type { SheetOps } from '../../_lib/sheet-ops';
import {
  blurEl,
  fireDoubleClick,
  fireKey,
  fireMouseDown,
  firePaste,
  focusEl,
  mount,
  typeValue,
  type Mounted,
} from './dom';

const TAB = String.fromCharCode(9);

function makeOps(): SheetOps {
  const ops: SheetOps = {
    commitCell: vi.fn(),
    clearValues: vi.fn(),
    setValues: vi.fn(() => ({ clippedRows: 0, clippedCols: 0 })),
    copyRange: vi.fn(),
    pasteInternal: vi.fn(() => true),
    hasInternalClipboard: vi.fn(() => false),
    fill: vi.fn(),
    insertRows: vi.fn(),
    deleteRows: vi.fn(),
    insertColumns: vi.fn(),
    deleteColumns: vi.fn(),
    appendRows: vi.fn(),
    appendColumns: vi.fn(),
    sortByColumn: vi.fn(),
    setColumnWidth: vi.fn(),
    setFrozen: vi.fn(),
    importCsv: vi.fn(() => ({ clipped: false, importedRows: 0 })),
    setFormat: vi.fn(),
    setCurrency: vi.fn(),
    toggleStyle: vi.fn(),
    setColor: vi.fn(),
    setFontSize: vi.fn(),
    setAlign: vi.fn(),
    setValidation: vi.fn(),
    undo: vi.fn(),
    redo: vi.fn(),
  };
  return ops;
}

describe('SheetGrid', () => {
  let engine: HyperFormula;
  let ops: SheetOps;
  let mounted: Mounted;

  async function render(overrides: Partial<Parameters<typeof SheetGrid>[0]> = {}) {
    engine = createEngine();
    engine.addSheet('Sheet1');
    engine.setSheetContent(0, [
      [1, 2, '=FOO(1)', '5%', '9/8/2026'],
      [3, '=A1+A2', '=TODAY()', '=IF(A1>0,TRUE,FALSE)', '$1,234.5'],
    ]);
    ops = makeOps();
    mounted = await mount(
      <SheetGrid
        engine={engine}
        hfSheetId={0}
        sheetName="Sheet1"
        rowCount={100}
        colCount={20}
        frozenRows={0}
        frozenCols={0}
        version={0}
        cellMetadata={{}}
        columnWidths={{}}
        ops={ops}
        canUndo
        canRedo={false}
        namedRanges={[]}
        onAddNamedRange={() => undefined}
        onRemoveNamedRange={() => {}}
        onSwitchSheet={() => {}}
        canEdit
        {...overrides}
      />,
    );
  }

  beforeEach(async () => {
    await render();
  });

  afterEach(async () => {
    if (mounted) await mounted.unmount();
  });

  it('virtualizes rows: only the rows in view (plus overscan) are mounted', () => {
    const bodyRows = mounted.$$('tbody tr:not(.spacer)');
    expect(bodyRows.length).toBeGreaterThan(10);
    expect(bodyRows.length).toBeLessThan(60);
    expect(mounted.container.querySelector('input[aria-label="A1"]')).not.toBeNull();
    expect(mounted.container.querySelector('input[aria-label="A100"]')).toBeNull();
    // The spacer accounts for the rows that aren't mounted.
    expect(mounted.container.querySelector('tbody tr.spacer')).not.toBeNull();
  });

  it('shows computed values, and formula source only while editing', async () => {
    const b2 = mounted.$<HTMLInputElement>('input[aria-label="B2"]');
    expect(b2.value).toBe('4');
    expect(b2.readOnly).toBe(true);
    await fireMouseDown(b2);
    await focusEl(b2);
    await fireDoubleClick(b2);
    expect(mounted.$<HTMLInputElement>('input[aria-label="B2"]').readOnly).toBe(false);
    expect(mounted.$<HTMLInputElement>('input[aria-label="B2"]').value).toBe('=A1+A2');
  });

  it('typing onto a selected cell edits a draft and commits once on Enter', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'x');
    const editing = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    expect(editing.readOnly).toBe(false);
    expect(editing.value).toBe('x');
    await typeValue(editing, 'xyz');
    expect(ops.commitCell).not.toHaveBeenCalled();
    await fireKey(editing, 'Enter');
    expect(ops.commitCell).toHaveBeenCalledTimes(1);
    expect(ops.commitCell).toHaveBeenCalledWith(0, 0, 'xyz');
    // Enter moved the active cell down.
    expect(document.activeElement?.getAttribute('aria-label')).toBe('A2');
  });

  it('Escape discards the draft without touching the engine', async () => {
    const a2 = mounted.$<HTMLInputElement>('input[aria-label="A2"]');
    await fireMouseDown(a2);
    await focusEl(a2);
    await fireKey(a2, 'q');
    await fireKey(mounted.$('input[aria-label="A2"]'), 'Escape');
    expect(ops.commitCell).not.toHaveBeenCalled();
    expect(mounted.$<HTMLInputElement>('input[aria-label="A2"]').value).toBe('3');
  });

  it('Delete clears the selection and Ctrl+Z undoes', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'Delete');
    expect(ops.clearValues).toHaveBeenCalledWith({ minRow: 0, maxRow: 0, minCol: 0, maxCol: 0 });
    await fireKey(a1, 'z', { ctrlKey: true });
    expect(ops.undo).toHaveBeenCalledTimes(1);
    await fireKey(a1, 'z', { ctrlKey: true, shiftKey: true });
    expect(ops.redo).toHaveBeenCalledTimes(1);
  });

  it('pastes tab-separated text from the OS clipboard at the active cell', async () => {
    const b1 = mounted.$<HTMLInputElement>('input[aria-label="B1"]');
    await fireMouseDown(b1);
    await focusEl(b1);
    await firePaste(b1, `10${TAB}20\n30${TAB}40\n`);
    expect(ops.setValues).toHaveBeenCalledWith(0, 1, [
      ['10', '20'],
      ['30', '40'],
    ]);
    expect(ops.pasteInternal).not.toHaveBeenCalled();
  });

  it('lets a native paste through while a cell is being edited', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'a');
    await firePaste(mounted.$('input[aria-label="A1"]'), 'text');
    expect(ops.setValues).not.toHaveBeenCalled();
  });

  it('formula bar commits to the cell it was opened on, even after another cell is clicked', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    const bar = mounted.$<HTMLTextAreaElement>('textarea[aria-label="Formula bar"]');
    await focusEl(bar);
    await typeValue(bar, '=1+1');
    // Click another cell — the selection moves *before* the bar blurs.
    const c3 = mounted.$<HTMLInputElement>('input[aria-label="C3"]');
    await fireMouseDown(c3);
    await focusEl(c3);
    await blurEl(bar);
    expect(ops.commitCell).toHaveBeenCalledTimes(1);
    expect(ops.commitCell).toHaveBeenCalledWith(0, 0, '=1+1');
  });

  it('shows error cells with a plain-language tooltip, and auto-formats dates, percents and booleans', () => {
    const c1 = mounted.$<HTMLInputElement>('input[aria-label="C1"]');
    expect(c1.value).toBe('#NAME?');
    expect(c1.title).toContain("FOO isn't a function");
    expect(mounted.$<HTMLInputElement>('input[aria-label="D1"]').value).toBe('5%');
    expect(mounted.$<HTMLInputElement>('input[aria-label="C2"]').value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mounted.$<HTMLInputElement>('input[aria-label="D2"]').value).toBe('TRUE');
    // A typed date keeps the pattern it was typed in (month-first), not a reformatted ISO date.
    expect(mounted.$<HTMLInputElement>('input[aria-label="E1"]').value).toBe('09/08/2026');
  });

  it('Shift+Arrow while editing selects text instead of leaving the cell', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'x');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'ArrowLeft', { shiftKey: true });
    expect(ops.commitCell).not.toHaveBeenCalled();
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').readOnly).toBe(false);
  });

  it('point mode: clicking a column or row header inserts a whole-column or whole-row reference', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, '=');
    await typeValue(mounted.$<HTMLInputElement>('input[aria-label="A1"]'), '=SUM(');
    const headers = mounted.$$('thead th');
    const colB = headers.find((th) => th.textContent?.startsWith('B'));
    if (!colB) throw new Error('column header B not rendered');
    await fireMouseDown(colB);
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=SUM(B:B');
    await typeValue(mounted.$<HTMLInputElement>('input[aria-label="A1"]'), '=SUM(B:B)+SUM(');
    const row3 = mounted.$$('tbody th').find((th) => th.textContent === '3');
    if (!row3) throw new Error('row header 3 not rendered');
    await fireMouseDown(row3);
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=SUM(B:B)+SUM(3:3');
    expect(ops.commitCell).not.toHaveBeenCalled();
  });

  it('Ctrl+Z inside an edit is the input\'s own undo, not the sheet\'s', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'x');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'z', { ctrlKey: true });
    expect(ops.undo).not.toHaveBeenCalled();
  });

  it('point mode: clicking a cell while typing a formula inserts its reference instead of committing', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, '=');
    await fireMouseDown(mounted.$('input[aria-label="B2"]'));
    expect(ops.commitCell).not.toHaveBeenCalled();
    const editing = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    expect(editing.readOnly).toBe(false);
    expect(editing.value).toBe('=B2');
    // A second click replaces the reference; typing an operator then clicking appends a new one.
    await fireMouseDown(mounted.$('input[aria-label="C3"]'));
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=C3');
    await typeValue(mounted.$<HTMLInputElement>('input[aria-label="A1"]'), '=C3*');
    await fireMouseDown(mounted.$('input[aria-label="B1"]'));
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=C3*B1');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'Enter');
    expect(ops.commitCell).toHaveBeenCalledWith(0, 0, '=C3*B1');
  });

  it('point mode: arrow keys move the reference while a formula is being typed', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, '=');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'ArrowDown');
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=A2');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'ArrowRight');
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=B2');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'ArrowDown', { shiftKey: true });
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=B2:B3');
    expect(ops.commitCell).not.toHaveBeenCalled();
  });

  it('point mode works from the formula bar, and Enter there hands focus back to the cell', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    const bar = mounted.$<HTMLTextAreaElement>('textarea[aria-label="Formula bar"]');
    await focusEl(bar);
    await typeValue(bar, '=SUM(');
    await fireMouseDown(mounted.$('input[aria-label="A2"]'));
    expect(ops.commitCell).not.toHaveBeenCalled();
    expect(mounted.$<HTMLTextAreaElement>('textarea[aria-label="Formula bar"]').value).toBe('=SUM(A2');
    await typeValue(mounted.$<HTMLTextAreaElement>('textarea[aria-label="Formula bar"]'), '=SUM(A2)');
    await fireKey(mounted.$('textarea[aria-label="Formula bar"]'), 'Enter');
    expect(ops.commitCell).toHaveBeenCalledTimes(1);
    expect(ops.commitCell).toHaveBeenCalledWith(0, 0, '=SUM(A2)');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('A1');
  });

  it('autocomplete: typing a partial function name lists matches and Tab completes it', async () => {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, '=');
    await typeValue(mounted.$<HTMLInputElement>('input[aria-label="A1"]'), '=su');
    const options = mounted.$$('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    expect(options[0]?.textContent).toContain('SUM');
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
    await fireKey(mounted.$('input[aria-label="A1"]'), 'Tab');
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('=SUM(');
    expect(ops.commitCell).not.toHaveBeenCalled();
    // Inside the call, the argument hint takes over.
    expect(mounted.container.textContent).toContain('Adds up numbers or ranges');
  });

  it('read-only: no editing affordances, typing does nothing', async () => {
    await mounted.unmount();
    await render({ canEdit: false });
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, 'x');
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').readOnly).toBe(true);
    expect(ops.commitCell).not.toHaveBeenCalled();
    expect(mounted.container.querySelector('[aria-label="Undo"]')).toBeNull();
  });
});
