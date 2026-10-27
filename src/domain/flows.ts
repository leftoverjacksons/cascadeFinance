// Builds a Sankey graph from money_flows rows (docs/DESIGN.md: Sankey).
//
//   money in (income categories) -> accounts -> other accounts (linked transfers)
//                                            -> spending groups / transfers out
//
// Sankey diagrams cannot draw cycles, so transfers in both directions between
// two accounts are netted, and any remaining cycle is broken at its smallest flow.
import { OTHER, UNCATEGORIZED } from './summary';

export interface FlowRow {
  kind: string; // income | spend | transfer | out_other | in_other
  source: string;
  target: string;
  cents: number;
}

export interface SankeyLink {
  from: string;
  to: string;
  cents: number;
}

export type NodeRole = 'income' | 'account' | 'spend' | 'transfer';

export interface SankeyNode {
  key: string;
  label: string;
  role: NodeRole;
  /** Spending group id (or OTHER/UNCATEGORIZED) for colouring spend nodes. */
  group?: string;
}

export interface SankeyGraph {
  nodes: SankeyNode[];
  links: SankeyLink[];
}

export interface FlowNames {
  account: (id: string) => string;
  category: (id: string) => string;
  /** Spending series as on the spending chart; groups not in it fold into OTHER. */
  series: string[];
}

function addTo(map: Map<string, number>, key: string, cents: number) {
  map.set(key, (map.get(key) ?? 0) + cents);
}

/** Nets opposite transfers between the same pair of accounts. */
export function netTransfers(links: SankeyLink[]): SankeyLink[] {
  const net = new Map<string, number>();
  for (const l of links) {
    const [a, b] = l.from < l.to ? [l.from, l.to] : [l.to, l.from];
    addTo(net, `${a}|${b}`, l.from === a ? l.cents : -l.cents);
  }
  const out: SankeyLink[] = [];
  for (const [pair, cents] of net) {
    const [a, b] = pair.split('|');
    if (cents > 0) out.push({ from: a, to: b, cents });
    else if (cents < 0) out.push({ from: b, to: a, cents: -cents });
  }
  return out;
}

/** Removes the smallest link of each cycle until the graph is acyclic. */
export function breakCycles(links: SankeyLink[]): SankeyLink[] {
  let current = [...links];
  for (;;) {
    const cycle = findCycle(current);
    if (!cycle) return current;
    const smallest = cycle.reduce((m, l) => (l.cents < m.cents ? l : m));
    current = current.filter((l) => l !== smallest);
  }
}

function findCycle(links: SankeyLink[]): SankeyLink[] | null {
  const out = new Map<string, SankeyLink[]>();
  for (const l of links) out.set(l.from, [...(out.get(l.from) ?? []), l]);
  const state = new Map<string, 'visiting' | 'done'>();
  const path: SankeyLink[] = [];

  function visit(node: string): SankeyLink[] | null {
    state.set(node, 'visiting');
    for (const l of out.get(node) ?? []) {
      path.push(l);
      const s = state.get(l.to);
      if (s === 'visiting') {
        const start = path.findIndex((p) => p.from === l.to);
        return path.slice(start);
      }
      if (s === undefined) {
        const found = visit(l.to);
        if (found) return found;
      }
      path.pop();
    }
    state.set(node, 'done');
    return null;
  }

  for (const node of out.keys()) {
    if (!state.has(node)) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

export function buildSankey(rows: FlowRow[], names: FlowNames): SankeyGraph {
  const nodes = new Map<string, SankeyNode>();
  const node = (key: string, label: string, role: NodeRole, group?: string) => {
    if (!nodes.has(key)) nodes.set(key, { key, label, role, group });
    return key;
  };
  const acct = (id: string) => node(`acct:${id}`, names.account(id), 'account');
  const linkTotals = new Map<string, number>();
  const transfers: SankeyLink[] = [];

  for (const r of rows) {
    if (r.cents <= 0) continue;
    switch (r.kind) {
      case 'income': {
        const from =
          r.source === UNCATEGORIZED
            ? node('in:uncategorized', 'Other money in', 'income')
            : node(`in:${r.source}`, names.category(r.source), 'income');
        addTo(linkTotals, `${from}>${acct(r.target)}`, r.cents);
        break;
      }
      case 'spend': {
        const group = r.target === UNCATEGORIZED || names.series.includes(r.target) ? r.target : OTHER;
        const label =
          group === UNCATEGORIZED ? 'Uncategorized' : group === OTHER ? 'Other spending' : names.category(group);
        addTo(linkTotals, `${acct(r.source)}>${node(`spend:${group}`, label, 'spend', group)}`, r.cents);
        break;
      }
      case 'transfer':
        transfers.push({ from: acct(r.source), to: acct(r.target), cents: r.cents });
        break;
      case 'out_other':
        addTo(linkTotals, `${acct(r.source)}>${node(`tout:${r.target}`, names.category(r.target), 'transfer')}`, r.cents);
        break;
      case 'in_other':
        addTo(
          linkTotals,
          `${node(`tin:${r.source}`, `${names.category(r.source)} (in)`, 'transfer')}>${acct(r.target)}`,
          r.cents,
        );
        break;
    }
  }

  const links: SankeyLink[] = [...linkTotals].map(([k, cents]) => {
    const [from, to] = k.split('>');
    return { from, to, cents };
  });
  links.push(...breakCycles(netTransfers(transfers)));

  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  return { nodes: [...nodes.values()].filter((n) => used.has(n.key)), links };
}
