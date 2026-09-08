// @vitest-environment jsdom
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_DELAY_MS, FINANCE_RETRY_MS } from '../../_lib/config';
import { fireKey, fireMouseDown, flush, focusEl, mount, typeValue, type Mounted } from './dom';

const actions = vi.hoisted(() => ({
  saveSheetAction: vi.fn(),
  setActiveSheetAction: vi.fn(async () => {}),
  recordWorkbookOpenedAction: vi.fn(async () => {}),
  getWorkbookSnapshotAction: vi.fn(async () => null),
  getFinanceRatesAction: vi.fn(async () => ({}) as Record<string, unknown>),
  addSheetAction: vi.fn(),
  deleteSheetAction: vi.fn(),
  deleteWorkbookAction: vi.fn(),
  renameSheetAction: vi.fn(async () => ({ ok: true })),
  renameWorkbookAction: vi.fn(async () => ({ ok: true })),
  reorderSheetsAction: vi.fn(async () => ({ ok: true })),
  saveNamedRangesAction: vi.fn(async () => ({ ok: true })),
  importWorkbookAction: vi.fn(async () => ({ ok: true })),
}));

vi.mock('../../actions', () => actions);
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

import { WorkbookView } from '../WorkbookView';

const SHEETS = [
  {
    id: 'sheet-a',
    name: 'Sheet1',
    position: 0,
    rowCount: 50,
    colCount: 10,
    cellsJson: JSON.stringify({ A1: { v: 1 } }),
    colWidthsJson: '{}',
    frozenRows: 0,
    frozenCols: 0,
    revision: 'rev-a',
  },
  {
    id: 'sheet-b',
    name: 'Budget',
    position: 1,
    rowCount: 50,
    colCount: 10,
    cellsJson: '{}',
    colWidthsJson: '{}',
    frozenRows: 0,
    frozenCols: 0,
    revision: 'rev-b',
  },
];

const sharing = {
  listMembersAction: vi.fn(async () => []),
  searchUsersAction: vi.fn(async () => []),
  inviteMemberAction: vi.fn(async () => ({ ok: true as const })),
  updateRoleAction: vi.fn(async () => ({ ok: true as const })),
  removeMemberAction: vi.fn(async () => ({ ok: true as const })),
};

describe('WorkbookView', () => {
  let mounted: Mounted;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    actions.saveSheetAction.mockReset();
    actions.getFinanceRatesAction.mockClear();
  });

  afterEach(async () => {
    if (mounted) await mounted.unmount();
    vi.useRealTimers();
  });

  async function render(activeSheetId: string | null = 'sheet-b') {
    mounted = await mount(
      <WorkbookView
        workbookId="wb-1"
        name="Quarterly"
        sheets={SHEETS}
        activeSheetId={activeSheetId}
        namedRangesJson="{}"
        canEdit
        isOwner
        onRemoteChange={() => {}}
        {...sharing}
      />,
    );
  }

  async function editA1(value: string) {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, value);
    await fireKey(mounted.$('input[aria-label="A1"]'), 'Enter');
  }

  async function enterFormulaA1(formula: string) {
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    await fireMouseDown(a1);
    await focusEl(a1);
    await fireKey(a1, '=');
    await typeValue(mounted.$<HTMLInputElement>('input[aria-label="A1"]'), formula);
    await fireKey(mounted.$('input[aria-label="A1"]'), 'Enter');
    await flush();
    await flush();
  }

  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
    await flush();
    await flush();
  }

  it('opens on the stored active sheet and records the open', async () => {
    await render('sheet-b');
    const selected = mounted.$('[role="tab"][aria-selected="true"]');
    expect(selected.textContent).toBe('Budget');
    expect(actions.recordWorkbookOpenedAction).toHaveBeenCalledWith('wb-1');
  });

  it('autosaves the edited sheet once with its revision, then shows Saved', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: true, revision: 'rev-b2' });
    await render('sheet-b');
    await editA1('7');
    expect(mounted.container.textContent).toContain('Saving…');
    await advance(AUTOSAVE_DELAY_MS + 50);
    expect(actions.saveSheetAction).toHaveBeenCalledTimes(1);
    const [workbookId, sheetId, payload, expectedRevision] = actions.saveSheetAction.mock.calls[0] as [
      string,
      string,
      { cellsJson: string; rowCount: number },
      string,
    ];
    expect(workbookId).toBe('wb-1');
    expect(sheetId).toBe('sheet-b');
    expect(expectedRevision).toBe('rev-b');
    expect(JSON.parse(payload.cellsJson)).toEqual({ A1: { v: 7 } });
    expect(payload.rowCount).toBe(50);
    expect(mounted.container.textContent).toContain('Saved');

    // The next save carries the revision the server handed back.
    await editA1('8');
    await advance(AUTOSAVE_DELAY_MS + 50);
    expect(actions.saveSheetAction).toHaveBeenCalledTimes(2);
    expect(actions.saveSheetAction.mock.calls[1]?.[3]).toBe('rev-b2');
  });

  it('a conflict stops autosave for that sheet and shows the conflict banner', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: false, conflict: true, error: 'changed' });
    await render('sheet-b');
    await editA1('7');
    await advance(AUTOSAVE_DELAY_MS + 50);
    expect(actions.saveSheetAction).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toContain('Budget was changed by someone else');
    expect(mounted.container.textContent).toContain('Changed elsewhere');
    await editA1('9');
    await advance(AUTOSAVE_DELAY_MS + 50);
    expect(actions.saveSheetAction).toHaveBeenCalledTimes(1);
  });

  it('FINANCE() fetches its rate, shows it, and keeps undo history intact', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: true, revision: 'rev-b2' });
    actions.getFinanceRatesAction.mockResolvedValueOnce({ 'USD/EUR': { rate: 0.9, asOf: 1_700_000_000 } });
    await render('sheet-b');
    await enterFormulaA1('=FINANCE("USD","EUR")*2');
    expect(actions.getFinanceRatesAction).toHaveBeenCalledWith([{ base: 'USD', quote: 'EUR' }]);
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('1.8');
    expect(mounted.$<HTMLButtonElement>('[aria-label="Undo"]').disabled).toBe(false);
  });

  it('FINANCE() says when a currency pair is not offered by the provider', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: true, revision: 'rev-b2' });
    actions.getFinanceRatesAction.mockResolvedValueOnce({ 'USD/XXX': { error: 'unsupported' } });
    await render('sheet-b');
    await enterFormulaA1('=FINANCE("USD","XXX")');
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    expect(a1.value).toBe('#N/A');
    expect(a1.title).toContain("USD/XXX isn't available");
  });

  it('FINANCE() retries on its own after the provider could not be reached', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: true, revision: 'rev-b2' });
    actions.getFinanceRatesAction
      .mockResolvedValueOnce({ 'USD/JPY': { error: 'unavailable' } })
      .mockResolvedValueOnce({ 'USD/JPY': { rate: 0.5, asOf: 1_700_000_000 } });
    await render('sheet-b');
    await enterFormulaA1('=FINANCE("USD","JPY")');
    expect(actions.getFinanceRatesAction).toHaveBeenCalledTimes(1);
    const a1 = mounted.$<HTMLInputElement>('input[aria-label="A1"]');
    expect(a1.value).toBe('#N/A');
    expect(a1.title).toContain('Fetching the exchange rate');
    await advance(FINANCE_RETRY_MS + 50);
    await flush();
    expect(actions.getFinanceRatesAction).toHaveBeenCalledTimes(2);
    expect(mounted.$<HTMLInputElement>('input[aria-label="A1"]').value).toBe('0.5');
  });

  it('a denied save shows the access-lost banner instead of "Saved"', async () => {
    actions.saveSheetAction.mockResolvedValue({ ok: false, denied: true, error: 'no' });
    await render('sheet-b');
    await editA1('7');
    await advance(AUTOSAVE_DELAY_MS + 50);
    expect(mounted.container.textContent).toContain("You can't edit this workbook anymore");
    expect(mounted.container.textContent).toContain('Not saved');
    expect(mounted.container.textContent).not.toContain('Saved');
  });
});
