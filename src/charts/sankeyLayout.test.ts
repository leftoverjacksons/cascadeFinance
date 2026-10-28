import { describe, expect, it } from 'vitest';
import { buildSankey, type FlowRow } from '../domain/flows';
import { placeSankey } from './sankeyLayout';

const names = {
  account: (id: string) => id,
  category: (id: string) => id,
  series: ['food', 'house'],
};

// Two checking accounts both paying into one savings account (the household's pattern).
const rows: FlowRow[] = [
  { kind: 'income', source: 'pay', target: 'cc', cents: 420000 },
  { kind: 'income', source: 'pay', target: 'tc', cents: 480000 },
  { kind: 'transfer', source: 'cc', target: 'cs', cents: 90000 },
  { kind: 'transfer', source: 'tc', target: 'cs', cents: 120000 },
  { kind: 'spend', source: 'cc', target: 'food', cents: 150000 },
  { kind: 'spend', source: 'tc', target: 'food', cents: 160000 },
  { kind: 'out_other', source: 'cc', target: 'ccp', cents: 180000 },
  { kind: 'out_other', source: 'tc', target: 'ccp', cents: 200000 },
  { kind: 'spend', source: 'cs', target: 'house', cents: 210000 },
];

describe('placeSankey', () => {
  const { nodes, links } = placeSankey(buildSankey(rows, names), {
    width: 1000,
    height: 500,
  });
  const node = (k: string) => nodes.find((n) => n.key === k)!;
  const mid = (k: string) => (node(k).y0 + node(k).y1) / 2;

  it('places an account fed by two others between them', () => {
    const [upper, lower] = ['acct:cc', 'acct:tc'].sort((a, b) => mid(a) - mid(b));
    expect(mid('acct:cs')).toBeGreaterThan(mid(upper));
    expect(mid('acct:cs')).toBeLessThan(mid(lower));
  });

  it("stacks each feeder's link to it on the side facing it", () => {
    const [upper, lower] = ['acct:cc', 'acct:tc'].sort((a, b) => mid(a) - mid(b));
    const out = (k: string) => links.filter((l) => l.from === k).sort((a, b) => a.sy - b.sy);
    expect(out(upper).at(-1)!.to).toBe('acct:cs'); // lowest tail of the upper account
    expect(out(lower)[0].to).toBe('acct:cs'); // highest tail of the lower account
  });

  it('keeps everything inside the drawing area', () => {
    for (const n of nodes) {
      expect(n.y0).toBeGreaterThanOrEqual(0);
      expect(n.y1).toBeLessThanOrEqual(500);
      expect(n.x1).toBeLessThanOrEqual(1000);
    }
  });

  it('returns nothing for an empty graph', () => {
    expect(placeSankey({ nodes: [], links: [] }, { width: 100, height: 100 })).toEqual({ nodes: [], links: [] });
  });
});
