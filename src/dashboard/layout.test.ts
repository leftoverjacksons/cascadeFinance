import { describe, expect, it } from 'vitest';
import { addPanel, COLS, DEFAULT_LAYOUT, hiddenPanels, removePanel, sanitizeLayout, toSaved } from './layout';

const known = DEFAULT_LAYOUT.map((it) => it.i);

describe('DEFAULT_LAYOUT', () => {
  it('puts half-width panels, at most two per row, below the summary', () => {
    const rows = new Map<number, number[]>();
    for (const it of DEFAULT_LAYOUT.filter((it) => it.i !== 'kpis')) {
      expect(it.w).toBe(COLS / 2);
      rows.set(it.y, [...(rows.get(it.y) ?? []), it.x]);
    }
    for (const xs of rows.values()) expect([[0, 6], [0]]).toContainEqual(xs.sort());
  });
});

describe('sanitizeLayout', () => {
  it('falls back to the default for missing or malformed data', () => {
    expect(sanitizeLayout(null, known)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ version: 2, items: [] }, known)).toEqual(DEFAULT_LAYOUT);
    expect(sanitizeLayout({ version: 1, items: [{ i: 'kpis', x: 'a' }] }, known)).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps an empty layout (every panel hidden)', () => {
    expect(sanitizeLayout({ version: 1, items: [], seen: known }, known)).toEqual([]);
  });

  it('drops unknown and duplicate panels and clamps sizes', () => {
    const out = sanitizeLayout(
      {
        version: 1,
        items: [
          { i: 'gone', x: 0, y: 0, w: 6, h: 4 },
          { i: 'cashflow', x: 10, y: -3, w: 6, h: 1 },
          { i: 'cashflow', x: 0, y: 0, w: 6, h: 4 },
          { i: 'kpis', x: 0, y: 9, w: 40, h: 2 },
        ],
        seen: known,
      },
      known,
    );
    expect(out).toEqual([
      { i: 'cashflow', x: 6, y: 0, w: 6, h: 2 },
      { i: 'kpis', x: 0, y: 9, w: 12, h: 2 },
    ]);
  });

  it('round-trips through toSaved, ignoring extra fields', () => {
    const withExtras = DEFAULT_LAYOUT.map((it) => ({ ...it, moved: false, static: false }));
    expect(sanitizeLayout(toSaved(withExtras, known), known)).toEqual(DEFAULT_LAYOUT);
  });

  it('appends panels added to the app since the layout was saved, but keeps hidden ones hidden', () => {
    const saved = toSaved(removePanel(DEFAULT_LAYOUT, 'balances'), known.filter((id) => id !== 'flows'));
    saved.items = saved.items.filter((it) => it.i !== 'flows');
    const out = sanitizeLayout(saved, known);
    expect(out.map((it) => it.i)).toContain('flows');
    expect(out.map((it) => it.i)).not.toContain('balances');
  });

  it('treats layouts saved before `seen` existed as knowing only the first seven panels', () => {
    const old = { version: 1, items: [{ i: 'kpis', x: 0, y: 0, w: 12, h: 2 }] };
    expect(sanitizeLayout(old, known).map((it) => it.i)).toEqual(['kpis', 'flows', 'shared', 'recurring']);
  });
});

describe('add/remove/hidden', () => {
  it('removes and re-adds a panel at the bottom, half width', () => {
    const without = removePanel(DEFAULT_LAYOUT, 'netWorth');
    expect(hiddenPanels(without, known)).toEqual(['netWorth']);
    const back = addPanel(without, 'netWorth');
    expect(back[back.length - 1]).toEqual({ i: 'netWorth', x: 0, y: 28, w: 6, h: 5 });
    expect(addPanel(back, 'netWorth')).toBe(back);
  });
});
