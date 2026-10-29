import { describe, expect, it } from 'vitest';
import {
  breakCycles,
  buildSankey,
  buildZoom,
  canZoom,
  buildMerchants,
  layoutSankey,
  MAX_MERCHANTS,
  merchantKey,
  netTransfers,
  zoomPath,
  type FlowRow,
} from './flows';
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

describe('accountGroup (people view)', () => {
  const owner: Record<string, string> = { chk: 'travis', sav: 'travis', cc: 'caitlin', jnt: 'joint' };
  const rows: FlowRow[] = [
    { kind: 'income', source: 'pay', target: 'chk', cents: 500000 },
    { kind: 'transfer', source: 'chk', target: 'sav', cents: 100000 },
    { kind: 'transfer', source: 'chk', target: 'jnt', cents: 50000 },
    { kind: 'spend', source: 'sav', target: 'food', cents: 30000 },
    { kind: 'spend', source: 'chk', target: 'food', cents: 20000 },
  ];
  const g = buildSankey(rows, { ...names, account: (id) => id, accountGroup: (id) => owner[id] ?? id });

  it('merges accounts into one node per group', () => {
    expect(g.nodes.filter((n) => n.role === 'account').map((n) => n.key).sort()).toEqual(['acct:joint', 'acct:travis']);
    expect(g.links.find((l) => l.from === 'acct:travis' && l.to === 'spend:food')?.cents).toBe(50000);
  });

  it('leaves out transfers within a group, keeps those between groups', () => {
    expect(g.links.some((l) => l.from === 'acct:travis' && l.to === 'acct:travis')).toBe(false);
    expect(g.links.find((l) => l.to === 'acct:joint')?.cents).toBe(50000);
  });

  it('still lists the original rows behind a merged flow', () => {
    expect(g.rowsByLink!.get('acct:travis>spend:food')).toEqual([rows[3], rows[4]]);
  });
});


describe('buildZoom', () => {
  const categories = new Map([
    ['food', { name: 'Food & Dining', parent_id: null }],
    ['groc', { name: 'Groceries', parent_id: 'food' }],
    ['rest', { name: 'Restaurants', parent_id: 'food' }],
    ['pets', { name: 'Pets', parent_id: null }],
    ['vet', { name: 'Vet', parent_id: 'pets' }],
  ]);

  it('splits a spending group into its categories, refunds netted', () => {
    const { graph, categoryIds } = buildZoom(
      { key: 'spend:food', label: 'Food & Dining', role: 'spend', group: 'food' },
      [
        { category_id: 'groc', amount_cents: -6000 },
        { category_id: 'groc', amount_cents: 1000 },
        { category_id: 'rest', amount_cents: -3000 },
        { category_id: 'food', amount_cents: -500 },
      ],
      categories,
    );
    expect(graph.links.map((l) => [l.to, l.cents])).toEqual([
      ['sub:groc', 5000],
      ['sub:rest', 3000],
      ['sub:food', 500],
    ]);
    expect(graph.nodes.find((n) => n.key === 'sub:food')?.label).toBe('Food & Dining (general)');
    expect(categoryIds.get('sub:groc')).toEqual(['groc']);
    // Adds up to the node it zooms into.
    expect(graph.links.reduce((t, l) => t + l.cents, 0)).toBe(8500);
  });

  it('splits "Other spending" into the groups folded into it', () => {
    const { graph, categoryIds } = buildZoom(
      { key: 'spend:other', label: 'Other spending', role: 'spend', group: OTHER },
      [
        { category_id: 'vet', amount_cents: -2000 },
        { category_id: 'pets', amount_cents: -100 },
      ],
      categories,
    );
    expect(graph.links.map((l) => [l.to, l.cents])).toEqual([['sub:pets', 2100]]);
    expect(categoryIds.get('sub:pets')?.sort()).toEqual(['pets', 'vet']);
  });

  it('leaves out parts that come to nothing', () => {
    const { graph } = buildZoom(
      { key: 'spend:food', label: 'Food & Dining', role: 'spend', group: 'food' },
      [
        { category_id: 'groc', amount_cents: -1000 },
        { category_id: 'groc', amount_cents: 1000 },
      ],
      categories,
    );
    expect(graph.links).toEqual([]);
  });
});

describe('zoomPath', () => {
  const categories = new Map([
    ['pets', { name: 'Pets', parent_id: null }],
    ['vet', { name: 'Vet', parent_id: 'pets' }],
    ['food', { name: 'Pet Food', parent_id: 'pets' }],
    ['gifts', { name: 'Gifts', parent_id: null }],
  ]);
  const transactions = [
    { category_id: 'vet', amount_cents: -20000 },
    { category_id: 'food', amount_cents: -5000 },
    { category_id: 'gifts', amount_cents: -3000 },
  ];
  const other = { key: 'spend:other', label: 'Other spending', role: 'spend' as const, group: OTHER };

  it('zooms again: Other spending -> Pets -> its categories', () => {
    const first = zoomPath([{ node: other }], transactions, categories);
    expect(first.graph.links.map((l) => [l.to, l.cents])).toEqual([
      ['sub:pets', 25000],
      ['sub:gifts', 3000],
    ]);
    const pets = first.graph.nodes.find((n) => n.key === 'sub:pets')!;
    const second = zoomPath(
      [{ node: other }, { node: { ...pets, group: 'pets' }, categoryIds: first.categoryIds.get('sub:pets') }],
      transactions,
      categories,
    );
    expect(second.graph.links.map((l) => [l.to, l.cents])).toEqual([
      ['sub:vet', 20000],
      ['sub:food', 5000],
    ]);
  });

  it('knows which parts can be zoomed into', () => {
    expect(canZoom('pets', categories)).toBe(true);
    expect(canZoom('gifts', categories)).toBe(false);
    expect(canZoom('vet', categories)).toBe(false);
  });
});

describe('merchant level', () => {
  const groceries = { key: 'sub:groc', label: 'Groceries', role: 'spend' as const, group: 'food' };

  it('treats spellings and store numbers of one merchant as the same merchant', () => {
    expect(merchantKey('Kroger #123')).toBe('kroger');
    expect(merchantKey('KROGER')).toBe('kroger');
    expect(merchantKey('  Kroger   Store 456 ')).toBe('kroger');
    expect(merchantKey("Trader Joe's 0123")).toBe("trader joe's");
    expect(merchantKey('H-E-B')).toBe('h e b');
    // Website endings and words like "subscription" are not part of the name.
    expect(merchantKey('Acme.com')).toBe(merchantKey('Acme'));
    expect(merchantKey('Widget.ai Subscription')).toBe('widget');
    expect(merchantKey('NETFLIX.COM')).toBe('netflix');
  });

  it('splits a category by merchant, refunds netted, labelled by the commonest spelling', () => {
    const { graph, merchants } = buildMerchants(
      groceries,
      [
        { category_id: 'groc', amount_cents: -6000, display_description: 'Kroger' },
        { category_id: 'groc', amount_cents: -2000, display_description: 'KROGER #12' },
        { category_id: 'groc', amount_cents: 1000, display_description: 'Kroger' },
        { category_id: 'groc', amount_cents: -3000, display_description: 'Publix' },
        { category_id: 'groc', amount_cents: -500, display_description: 'Aldi' },
        { category_id: 'groc', amount_cents: 500, display_description: 'Aldi' },
      ],
      ['groc'],
    );
    expect(graph.links.map((l) => [graph.nodes.find((n) => n.key === l.to)!.label, l.cents])).toEqual([
      ['Kroger', 7000],
      ['Publix', 3000],
    ]);
    expect(merchants!.get('merchant:kroger')).toEqual(['kroger']);
  });

  it(`shows the largest ${MAX_MERCHANTS} merchants and combines the rest`, () => {
    const many = Array.from({ length: MAX_MERCHANTS + 3 }, (_, i) => ({
      category_id: 'groc',
      amount_cents: -(1000 + i),
      display_description: `Shop ${String.fromCharCode(65 + i)}`,
    }));
    const { graph, merchants } = buildMerchants(groceries, many, ['groc']);
    expect(graph.links).toHaveLength(MAX_MERCHANTS + 1);
    const other = graph.nodes.find((n) => n.key === 'merchant:*')!;
    expect(other.label).toBe('Other merchants (3)');
    expect(merchants!.get('merchant:*')!.sort()).toEqual(['shop a', 'shop b', 'shop c']); // the three smallest
    expect(graph.links.reduce((t, l) => t + l.cents, 0)).toBe(many.reduce((t, x) => t - x.amount_cents, 0));
  });

  it('is reached through a zoom path step marked byMerchant', () => {
    const z = zoomPath(
      [
        { node: { key: 'spend:food', label: 'Food & Dining', role: 'spend', group: 'food' } },
        { node: groceries, categoryIds: ['groc'], byMerchant: true },
      ],
      [
        { category_id: 'groc', amount_cents: -6000, display_description: 'Kroger' },
        { category_id: 'rest', amount_cents: -4000, display_description: 'Diner' },
      ],
      new Map(),
    );
    expect(z.graph.links.map((l) => l.to)).toEqual(['merchant:kroger']);
  });
});

