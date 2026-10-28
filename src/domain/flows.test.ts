import { describe, expect, it } from 'vitest';
import { breakCycles, buildSankey, layoutSankey, netTransfers, type FlowRow } from './flows';
import { OTHER } from './summary';

const names = {
  account: (id: string) => ({ chk: 'Checking', jnt: 'Joint', sav: 'Savings' })[id] ?? id,
  category: (id: string) => ({ pay: 'Paycheck', food: 'Food & Dining', shop: 'Shopping', loan: 'Loan Payments' })[id] ?? id,
  series: ['food'],
};

describe('netTransfers', () => {
  it('nets opposite directions and drops zero', () => {
    expect(
      netTransfers([
        { from: 'a', to: 'b', cents: 500 },
        { from: 'b', to: 'a', cents: 200 },
        { from: 'c', to: 'd', cents: 100 },
        { from: 'd', to: 'c', cents: 100 },
      ]),
    ).toEqual([{ from: 'a', to: 'b', cents: 300 }]);
  });
});

describe('breakCycles', () => {
  it('removes the smallest link of a cycle', () => {
    const out = breakCycles([
      { from: 'a', to: 'b', cents: 500 },
      { from: 'b', to: 'c', cents: 400 },
      { from: 'c', to: 'a', cents: 100 },
      { from: 'c', to: 'd', cents: 50 },
    ]);
    expect(out).toHaveLength(3);
    expect(out.find((l) => l.from === 'c' && l.to === 'a')).toBeUndefined();
  });
  it('leaves acyclic graphs alone', () => {
    const links = [
      { from: 'a', to: 'b', cents: 1 },
      { from: 'a', to: 'c', cents: 1 },
      { from: 'b', to: 'c', cents: 1 },
    ];
    expect(breakCycles(links)).toEqual(links);
  });
});

describe('buildSankey', () => {
  const rows: FlowRow[] = [
    { kind: 'income', source: 'pay', target: 'chk', cents: 600000 },
    { kind: 'income', source: 'uncategorized', target: 'chk', cents: 1000 },
    { kind: 'transfer', source: 'chk', target: 'jnt', cents: 100000 },
    { kind: 'transfer', source: 'jnt', target: 'chk', cents: 20000 },
    { kind: 'spend', source: 'chk', target: 'food', cents: 50000 },
    { kind: 'spend', source: 'chk', target: 'shop', cents: 30000 },
    { kind: 'spend', source: 'jnt', target: 'shop', cents: 5000 },
    { kind: 'out_other', source: 'chk', target: 'loan', cents: 40000 },
    { kind: 'spend', source: 'sav', target: 'food', cents: 0 },
  ];
  const g = buildSankey(rows, names);
  const link = (from: string, to: string) => g.links.find((l) => l.from === from && l.to === to)?.cents;

  it('flows income into accounts', () => {
    expect(link('in:pay', 'acct:chk')).toBe(600000);
    expect(g.nodes.find((n) => n.key === 'in:uncategorized')?.label).toBe('Other money in');
  });
  it('nets transfers between accounts', () => {
    expect(link('acct:chk', 'acct:jnt')).toBe(80000);
    expect(link('acct:jnt', 'acct:chk')).toBeUndefined();
  });
  it('folds groups outside the spending series into Other, per account', () => {
    expect(link('acct:chk', 'spend:food')).toBe(50000);
    expect(link('acct:chk', `spend:${OTHER}`)).toBe(30000);
    expect(link('acct:jnt', `spend:${OTHER}`)).toBe(5000);
  });
  it('shows unlinked transfers out as their own nodes', () => {
    expect(link('acct:chk', 'tout:loan')).toBe(40000);
  });
  it('omits zero flows and unused nodes', () => {
    expect(g.nodes.some((n) => n.key === 'acct:sav')).toBe(false);
  });
});

describe('tidying', () => {
  it('folds income sources under 2% into "Other money in" and merges unlinked transfers in', () => {
    const g = buildSankey(
      [
        { kind: 'income', source: 'pay', target: 'chk', cents: 1000000 },
        { kind: 'income', source: 'int', target: 'chk', cents: 100 },
        { kind: 'in_other', source: 'loan', target: 'chk', cents: 5000 },
        { kind: 'in_other', source: 'cc', target: 'jnt', cents: 7000 },
        { kind: 'spend', source: 'chk', target: 'food', cents: 900000 },
      ],
      names,
    );
    const froms = new Set(g.links.map((l) => l.from));
    expect(froms.has('in:int')).toBe(false);
    expect(g.links.find((l) => l.from === 'in:uncategorized')?.cents).toBe(100);
    expect(g.links.filter((l) => l.from === 'tin:all').map((l) => l.cents).sort()).toEqual([5000, 7000]);
    expect(g.nodes.find((n) => n.key === 'tin:all')?.label).toBe('Transfers in (not linked)');
  });
});

describe('layoutSankey', () => {
  // Two earners, each paid into their own checking; checking -> joint -> savings.
  const g = buildSankey(
    [
      { kind: 'income', source: 'pay', target: 'chk', cents: 500000 },
      { kind: 'income', source: 'shop', target: 'jnt', cents: 400000 },
      { kind: 'transfer', source: 'chk', target: 'jnt', cents: 200000 },
      { kind: 'transfer', source: 'jnt', target: 'sav', cents: 150000 },
      { kind: 'spend', source: 'chk', target: 'food', cents: 250000 },
      { kind: 'spend', source: 'jnt', target: 'shop', cents: 300000 },
      { kind: 'spend', source: 'sav', target: 'food', cents: 100000 },
      { kind: 'out_other', source: 'chk', target: 'loan', cents: 900000 },
    ],
    names,
  );
  const { column, priority } = layoutSankey(g);

  it('puts money in first, accounts in transfer order, destinations last', () => {
    expect(column['in:pay']).toBe(0);
    expect(column['acct:chk']).toBe(1);
    expect(column['acct:jnt']).toBe(2);
    expect(column['acct:sav']).toBe(3);
    expect(column['spend:food']).toBe(4);
    expect(column['tout:loan']).toBe(4);
  });

  it('lists spending before transfers out, whatever their size', () => {
    expect(priority['spend:food']).toBeLessThan(priority['tout:loan']);
    expect(priority['spend:other']).toBeLessThan(priority['tout:loan']);
  });

  it('gives every node a priority within its column', () => {
    for (const n of g.nodes) expect(priority[n.key]).toBeGreaterThanOrEqual(0);
  });
});

describe('rowsByLink', () => {
  const rows: FlowRow[] = [
    { kind: 'income', source: 'pay', target: 'chk', cents: 1000000 },
    { kind: 'income', source: 'int', target: 'chk', cents: 100 },
    { kind: 'in_other', source: 'loan', target: 'chk', cents: 5000 },
    { kind: 'in_other', source: 'cc', target: 'chk', cents: 7000 },
    { kind: 'transfer', source: 'chk', target: 'jnt', cents: 30000 },
    { kind: 'transfer', source: 'jnt', target: 'chk', cents: 10000 },
    { kind: 'spend', source: 'chk', target: 'food', cents: 900000 },
  ];
  const g = buildSankey(rows, names);

  it('lists the rows behind each drawn link, including folded and merged ones', () => {
    for (const l of g.links.filter((l) => !l.from.startsWith('acct:') || !l.to.startsWith('acct:'))) {
      const total = (g.rowsByLink!.get(`${l.from}>${l.to}`) ?? []).reduce((t, r) => t + r.cents, 0);
      expect(total).toBe(l.cents);
    }
    expect(g.rowsByLink!.get('in:uncategorized>acct:chk')).toEqual([rows[1]]);
    expect(g.rowsByLink!.get('tin:all>acct:chk')).toHaveLength(2);
  });

  it('gives both directions of a netted transfer to its link', () => {
    expect(g.rowsByLink!.get('acct:chk>acct:jnt')).toEqual([rows[4], rows[5]]);
  });
});
