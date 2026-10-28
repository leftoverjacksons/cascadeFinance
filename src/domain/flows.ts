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
  /**
   * The money_flows rows behind each drawn link ("from>to"), for listing its
   * transactions. Both directions of a netted transfer belong to the link.
   */
  rowsByLink?: Map<string, FlowRow[]>;
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
  // Each row's link before tidying (transfers: the account pair, either direction).
  const rowLinks: [FlowRow, string, string][] = [];
  const add = (r: FlowRow, from: string, to: string) => {
    addTo(linkTotals, `${from}>${to}`, r.cents);
    rowLinks.push([r, from, to]);
  };

  for (const r of rows) {
    if (r.cents <= 0) continue;
    switch (r.kind) {
      case 'income': {
        const from =
          r.source === UNCATEGORIZED
            ? node('in:uncategorized', 'Other money in', 'income')
            : node(`in:${r.source}`, names.category(r.source), 'income');
        add(r, from, acct(r.target));
        break;
      }
      case 'spend': {
        const group = r.target === UNCATEGORIZED || names.series.includes(r.target) ? r.target : OTHER;
        const label =
          group === UNCATEGORIZED ? 'Uncategorized' : group === OTHER ? 'Other spending' : names.category(group);
        add(r, acct(r.source), node(`spend:${group}`, label, 'spend', group));
        break;
      }
      case 'transfer':
        transfers.push({ from: acct(r.source), to: acct(r.target), cents: r.cents });
        rowLinks.push([r, acct(r.source), acct(r.target)]);
        break;
      case 'out_other':
        add(r, acct(r.source), node(`tout:${r.target}`, names.category(r.target), 'transfer'));
        break;
      case 'in_other':
        add(r, node(`tin:${r.source}`, `${names.category(r.source)} (in)`, 'transfer'), acct(r.target));
        break;
    }
  }

  let links: SankeyLink[] = [...linkTotals].map(([k, cents]) => {
    const [from, to] = k.split('>');
    return { from, to, cents };
  });
  links.push(...breakCycles(netTransfers(transfers)));
  const tidied = tidy(links, nodes);
  links = tidied.links;

  const drawn = new Set(links.map((l) => `${l.from}>${l.to}`));
  const rowsByLink = new Map<string, FlowRow[]>();
  for (const [r, from, to] of rowLinks) {
    const candidates =
      r.kind === 'transfer' ? [`${from}>${to}`, `${to}>${from}`] : [`${tidied.remap(from)}>${tidied.remap(to)}`];
    const key = candidates.find((k) => drawn.has(k));
    if (key) rowsByLink.set(key, [...(rowsByLink.get(key) ?? []), r]);
  }

  const used = new Set(links.flatMap((l) => [l.from, l.to]));
  return { nodes: [...nodes.values()].filter((n) => used.has(n.key)), links, rowsByLink };
}

/** Income sources below this share of all money in are folded into "Other money in". */
export const MIN_INCOME_SHARE = 0.02;
const OTHER_IN = 'in:uncategorized';
const UNLINKED_IN = 'tin:all';

/**
 * Fewer, larger nodes: small income sources fold into "Other money in", and
 * unlinked transfers in (one node per transfer category) become one node.
 */
function tidy(
  links: SankeyLink[],
  nodes: Map<string, SankeyNode>,
): { links: SankeyLink[]; remap: (key: string) => string } {
  const incomeTotal = new Map<string, number>();
  for (const l of links) if (l.from.startsWith('in:')) incomeTotal.set(l.from, (incomeTotal.get(l.from) ?? 0) + l.cents);
  const allIncome = [...incomeTotal.values()].reduce((a, b) => a + b, 0);

  const remap = (key: string) => {
    if (key.startsWith('tin:')) {
      if (!nodes.has(UNLINKED_IN)) nodes.set(UNLINKED_IN, { key: UNLINKED_IN, label: 'Transfers in (not linked)', role: 'transfer' });
      return UNLINKED_IN;
    }
    if (key.startsWith('in:') && key !== OTHER_IN && (incomeTotal.get(key) ?? 0) < allIncome * MIN_INCOME_SHARE) {
      if (!nodes.has(OTHER_IN)) nodes.set(OTHER_IN, { key: OTHER_IN, label: 'Other money in', role: 'income' });
      return OTHER_IN;
    }
    return key;
  };

  const merged = new Map<string, SankeyLink>();
  for (const l of links) {
    const from = remap(l.from);
    const k = `${from}>${l.to}`;
    const existing = merged.get(k);
    if (existing) existing.cents += l.cents;
    else merged.set(k, { from, to: l.to, cents: l.cents });
  }
  return { links: [...merged.values()], remap };
}

export interface SankeyLayout {
  /** Column index per node key (0 = money in). */
  column: Record<string, number>;
  /** Vertical order within a column (lower = higher up). */
  priority: Record<string, number>;
}

/**
 * Column and vertical order for each node, to keep the diagram readable:
 *   column 0      money in
 *   columns 1..n  accounts, in the order money moves between them
 *   last column   where money went (spending, then transfers out)
 * Within each column, nodes are ordered by the weighted average position of
 * what they connect to (barycentre heuristic), alternating sweeps left and
 * right; the ordering with the fewest size-weighted crossings is kept.
 */
export function layoutSankey(graph: SankeyGraph): SankeyLayout {
  const { nodes, links } = graph;
  const role = new Map(nodes.map((n) => [n.key, n.role]));
  const isAccount = (k: string) => role.get(k) === 'account';
  const isSource = (k: string) => !isAccount(k) && links.some((l) => l.from === k);

  // Account depth: longest chain of account -> account transfers into it.
  const depth = new Map<string, number>();
  const depthOf = (k: string): number => {
    if (depth.has(k)) return depth.get(k)!;
    depth.set(k, 1); // guards against cycles (none after breakCycles)
    const fromAccounts = links.filter((l) => l.to === k && isAccount(l.from)).map((l) => depthOf(l.from) + 1);
    const d = Math.max(1, ...fromAccounts);
    depth.set(k, d);
    return d;
  };
  const accounts = nodes.filter((n) => n.role === 'account').map((n) => n.key);
  accounts.forEach(depthOf);
  const last = Math.max(1, ...accounts.map((k) => depth.get(k)!)) + 1;

  const column: Record<string, number> = {};
  for (const n of nodes) column[n.key] = isAccount(n.key) ? depth.get(n.key)! : isSource(n.key) ? 0 : last;

  const size = new Map<string, number>();
  for (const l of links) {
    size.set(l.from, (size.get(l.from) ?? 0) + l.cents);
    size.set(l.to, (size.get(l.to) ?? 0) + l.cents);
  }
  const columns: string[][] = Array.from({ length: last + 1 }, () => []);
  for (const n of nodes) columns[column[n.key]].push(n.key);
  const bySize = (a: string, b: string) => (size.get(b) ?? 0) - (size.get(a) ?? 0) || a.localeCompare(b);
  // Destinations: spending above transfers out, always.
  const band = (k: string) => (column[k] === last && role.get(k) === 'transfer' ? 1 : 0);
  for (const keys of columns) keys.sort((a, b) => band(a) - band(b) || bySize(a, b));

  // Centre of each node within its column, as a fraction of the column's total size.
  const centre = new Map<string, number>();
  const measure = (c: number) => {
    const total = columns[c].reduce((t, k) => t + (size.get(k) ?? 0), 0) || 1;
    let acc = 0;
    for (const k of columns[c]) {
      const s = size.get(k) ?? 0;
      centre.set(k, (acc + s / 2) / total);
      acc += s;
    }
  };
  columns.forEach((_, c) => measure(c));

  const barycentre = (k: string, dir: 'out' | 'in') => {
    let weight = 0;
    let sum = 0;
    for (const l of links) {
      const other = dir === 'out' ? (l.from === k ? l.to : null) : l.to === k ? l.from : null;
      if (other === null) continue;
      weight += l.cents;
      sum += l.cents * (centre.get(other) ?? 0.5);
    }
    return weight ? sum / weight : (centre.get(k) ?? 0.5);
  };
  const reorder = (c: number, dir: 'out' | 'in') => {
    const bc = new Map(columns[c].map((k) => [k, barycentre(k, dir)]));
    columns[c].sort((a, b) => band(a) - band(b) || bc.get(a)! - bc.get(b)! || bySize(a, b));
    measure(c);
  };
  // Size-weighted count of crossing links, treating each link as a straight
  // line from (column, centre) to (column, centre).
  const crossings = () => {
    const at = (l: SankeyLink, x: number) => {
      const x0 = column[l.from];
      const x1 = column[l.to];
      return centre.get(l.from)! + ((centre.get(l.to)! - centre.get(l.from)!) * (x - x0)) / (x1 - x0);
    };
    let total = 0;
    for (let i = 0; i < links.length; i++) {
      for (let j = i + 1; j < links.length; j++) {
        const a = links[i];
        const b = links[j];
        if (a.from === b.from || a.to === b.to) continue;
        const x0 = Math.max(column[a.from], column[b.from]);
        const x1 = Math.min(column[a.to], column[b.to]);
        if (x0 >= x1) continue;
        if ((at(a, x0) - at(b, x0)) * (at(a, x1) - at(b, x1)) < 0) total += Math.sqrt(a.cents * b.cents);
      }
    }
    return total;
  };

  let best = { score: crossings(), order: columns.map((k) => [...k]) };
  for (let pass = 0; pass < 8; pass++) {
    for (let c = 1; c <= last; c++) reorder(c, 'in'); // align with sources
    for (let c = last - 1; c >= 0; c--) reorder(c, 'out'); // align with destinations
    const score = crossings();
    if (score < best.score) best = { score, order: columns.map((k) => [...k]) };
  }
  best.order.forEach((keys, c) => (columns[c] = keys));

  const priority: Record<string, number> = {};
  columns.forEach((keys) => keys.forEach((k, i) => (priority[k] = i)));
  return { column, priority };
}

