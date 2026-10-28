import { layoutSankey, type SankeyGraph, type SankeyNode } from '../domain/flows';

export interface PlacedNode extends SankeyNode {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  cents: number;
  /** Destinations (last column) are labelled on their left. */
  labelLeft: boolean;
}

export interface PlacedLink {
  from: string;
  to: string;
  cents: number;
  /** Centre line: leaves the source at (sx, sy), arrives at the target at (tx, ty). */
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  width: number;
}

export interface SankeyLayoutOptions {
  width: number;
  height: number;
  nodeWidth?: number;
  nodePadding?: number;
}

const ITERATIONS = 24;
const SIXTHS = 6;

/**
 * Positions nodes and links for drawing.
 *
 * Columns and the order within each column come from layoutSankey. Heights
 * then settle by relaxation, keeping that order: each account and destination
 * moves toward the value-weighted average height of what feeds it, and money-in
 * sources toward what they feed. So an account fed by two others sits between
 * them.
 *
 * Each node's links are stacked by the height of the node at their other end,
 * except transfers to another account, which leave from the side facing that
 * account (bottom if it sits lower, top if higher).
 */
export function placeSankey(
  graph: SankeyGraph,
  opts: SankeyLayoutOptions,
): { nodes: PlacedNode[]; links: PlacedLink[] } {
  const { width, height, nodeWidth = 8 } = opts;
  if (graph.links.length === 0 || width <= 0 || height <= 0) return { nodes: [], links: [] };

  const { column: rawColumn, priority } = layoutSankey(graph);
  const used = graph.nodes.filter((n) => graph.links.some((l) => l.from === n.key || l.to === n.key));
  const first = Math.min(...used.map((n) => rawColumn[n.key]));
  const column = (k: string) => rawColumn[k] - first;
  const last = Math.max(...used.map((n) => column(n.key)));

  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const l of graph.links) {
    outflow.set(l.from, (outflow.get(l.from) ?? 0) + l.cents);
    inflow.set(l.to, (inflow.get(l.to) ?? 0) + l.cents);
  }
  const value = (k: string) => Math.max(inflow.get(k) ?? 0, outflow.get(k) ?? 0);

  const columns: string[][] = Array.from({ length: last + 1 }, () => []);
  for (const n of used) columns[column(n.key)].push(n.key);
  for (const keys of columns) keys.sort((a, b) => priority[a] - priority[b]);

  // Padding shrinks when a column is crowded, so nodes keep a visible size.
  const crowded = Math.max(...columns.map((c) => c.length));
  const pad = Math.min(opts.nodePadding ?? 14, height / (crowded * 2));
  const ky = Math.min(
    ...columns
      .filter((c) => c.length)
      .map((c) => (height - (c.length - 1) * pad) / c.reduce((t, k) => t + value(k), 0)),
  );

  const y0 = new Map<string, number>();
  const size = (k: string) => value(k) * ky;
  const centre = (k: string) => y0.get(k)! + size(k) / 2;

  // Keep the column's order, push overlaps apart, stay inside [0, height].
  const resolve = (keys: string[]) => {
    let y = 0;
    for (const k of keys) {
      y0.set(k, Math.max(y0.get(k)!, y));
      y = y0.get(k)! + size(k) + pad;
    }
    let bottom = height;
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i];
      y0.set(k, Math.min(y0.get(k)!, bottom - size(k)));
      bottom = y0.get(k)! - pad;
    }
  };
  // Start stacked and centred.
  for (const keys of columns) {
    const total = keys.reduce((t, k) => t + size(k), 0) + (keys.length - 1) * pad;
    let y = (height - total) / 2;
    for (const k of keys) {
      y0.set(k, y);
      y += size(k) + pad;
    }
  }

  const towards = (k: string, ends: { key: string; cents: number }[], alpha: number) => {
    const weight = ends.reduce((t, e) => t + e.cents, 0);
    if (!weight) return;
    const ideal = ends.reduce((t, e) => t + centre(e.key) * e.cents, 0) / weight;
    y0.set(k, y0.get(k)! + (ideal - centre(k)) * alpha);
  };
  const sources = (k: string) => graph.links.filter((l) => l.to === k).map((l) => ({ key: l.from, cents: l.cents }));
  const targets = (k: string) => graph.links.filter((l) => l.from === k).map((l) => ({ key: l.to, cents: l.cents }));

  for (let i = 0; i < ITERATIONS; i++) {
    const alpha = 1 - i / ITERATIONS;
    for (let c = 1; c <= last; c++) {
      for (const k of columns[c]) towards(k, sources(k), alpha);
      resolve(columns[c]);
    }
    for (let c = last - 1; c >= 0; c--) {
      // Nodes nothing flows into (money in) follow what they feed.
      for (const k of columns[c]) if (!inflow.get(k)) towards(k, targets(k), alpha);
      resolve(columns[c]);
    }
  }

  // Columns at fixed sixths of the width: money in at the left edge, accounts at
  // 1/6, 2/6, 3/6…, destinations at the right edge, so flows into the last
  // column have a long, gentle run. (More columns than fit: spread evenly.)
  const step = last <= SIXTHS ? 1 / SIXTHS : 1 / last;
  const x0 = (k: string) => (column(k) === last ? 1 : column(k) * step) * (width - nodeWidth);
  const isAccount = new Set(graph.nodes.filter((n) => n.role === 'account').map((n) => n.key));

  // Stack links within each node.
  const sy = new Map<SankeyLinkKey, number>();
  const ty = new Map<SankeyLinkKey, number>();
  const linkKey = (l: { from: string; to: string }): SankeyLinkKey => `${l.from}>${l.to}`;
  for (const k of used.map((n) => n.key)) {
    const side = (l: { from: string; to: string }) => {
      if (!isAccount.has(k) || !isAccount.has(l.to)) return 0;
      return centre(l.to) > centre(k) ? 1 : -1;
    };
    const out = graph.links
      .filter((l) => l.from === k)
      .sort((a, b) => side(a) - side(b) || centre(a.to) - centre(b.to));
    let y = y0.get(k)!;
    for (const l of out) {
      sy.set(linkKey(l), y + (l.cents * ky) / 2);
      y += l.cents * ky;
    }
    const into = graph.links.filter((l) => l.to === k).sort((a, b) => centre(a.from) - centre(b.from));
    y = y0.get(k)!;
    for (const l of into) {
      ty.set(linkKey(l), y + (l.cents * ky) / 2);
      y += l.cents * ky;
    }
  }

  return {
    nodes: used.map((n) => ({
      ...n,
      x0: x0(n.key),
      x1: x0(n.key) + nodeWidth,
      y0: y0.get(n.key)!,
      y1: y0.get(n.key)! + size(n.key),
      cents: value(n.key),
      labelLeft: column(n.key) === last && last > 0,
    })),
    links: graph.links.map((l) => ({
      ...l,
      sx: x0(l.from) + nodeWidth,
      sy: sy.get(linkKey(l))!,
      tx: x0(l.to),
      ty: ty.get(linkKey(l))!,
      width: l.cents * ky,
    })),
  };
}

type SankeyLinkKey = `${string}>${string}`;
