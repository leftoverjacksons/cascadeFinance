import { describe, expect, it } from 'vitest';
import { breakCycles, buildSankey, netTransfers, type FlowRow } from './flows';
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
