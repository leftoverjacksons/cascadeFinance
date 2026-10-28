// Physics for the money-flow diagram.
//
// Tails want to be straight: each free node is pulled toward the height that
// makes its tails as level as possible (the value-weighted average of where
// their other ends are), which minimises the diagram's total bend. A weak
// spring to the computed layout keeps the whole picture from drifting.
// Nodes in a column may pass each other (each column is re-sorted every
// frame) but never overlap. Each node's tails are stacked by where their other
// end is and slide to new places in the stack rather than jumping. Pinned
// (dragged) nodes stay where they were put. Everything moves on damped
// springs, with a little overshoot.

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PhysicsNode {
  key: string;
  /** Computed layout: top-left corner and height. */
  x: number;
  y: number;
  height: number;
  column: number;
  /** Accounts send transfers to other accounts from the side facing them. */
  isAccount?: boolean;
  /**
   * Edge this node's trunk belongs to: -1 top, 1 bottom (e.g. each person's
   * income and accounts on their own side), 0 or undefined none.
   */
  side?: -1 | 0 | 1;
}

export interface PhysicsLink {
  from: string;
  to: string;
  cents: number;
  /** Drawn thickness. */
  width: number;
}

export interface PhysicsWorld {
  nodes: PhysicsNode[];
  links: PhysicsLink[];
  /** Pinned nodes' top-left corners. */
  pinned: Map<string, { x: number; y: number }>;
  /** Drawing area height, and the gap kept between nodes in a column. */
  height: number;
  gap: number;
  /**
   * Tail orders set by hand, top first, per node side: key stackKey(node,
   * 'out' | 'in'). Tails not listed (e.g. new data) go below the listed ones,
   * in the automatic order.
   */
  stacks?: Map<string, string[]>;
}

export const stackKey = (node: string, side: 'out' | 'in') => `${node}|${side}`;

/** Where each tail sits in its nodes' stacks: centre offsets from the node tops. */
export interface Offsets {
  s: number;
  t: number;
}

export interface PhysicsState {
  bodies: Map<string, Body>;
  offsets: Map<string, Offsets>;
}

/** Weight of the spring to the computed layout, relative to a node's tails. */
export const ANCHOR = 0.05;
/** Weight of the pull toward a node's side (see PhysicsNode.side), relative to its tails. */
export const SIDE_PULL = 2;
const STIFFNESS = 0.14;
const DAMPING = 0.76;
/** Share of the remaining distance a tail slides each frame. */
const SLIDE = 0.25;
const REST = 0.05;

export const linkKey = (l: { from: string; to: string }) => `${l.from}>${l.to}`;

/** Initial state: nodes at the computed layout (or their pins), tails as given. */
export function initialState(world: PhysicsWorld, offsets: Map<string, Offsets>): PhysicsState {
  const bodies = new Map<string, Body>();
  for (const n of world.nodes) {
    const at = world.pinned.get(n.key) ?? n;
    bodies.set(n.key, { x: at.x, y: at.y, vx: 0, vy: 0 });
  }
  return { bodies, offsets: new Map(offsets) };
}

/** Where each tail belongs in its nodes' stacks, given where the nodes are now. */
export function stackOffsets(world: PhysicsWorld, bodies: Map<string, Body>): Map<string, Offsets> {
  const node = new Map(world.nodes.map((n) => [n.key, n]));
  const centre = (k: string) => bodies.get(k)!.y + node.get(k)!.height / 2;
  const out = new Map<string, Offsets>();
  for (const l of world.links) out.set(linkKey(l), { s: 0, t: 0 });
  for (const n of world.nodes) {
    // A transfer to another account leaves from the side facing it.
    const side = (l: PhysicsLink) =>
      n.isAccount && node.get(l.to)?.isAccount ? (centre(l.to) > centre(n.key) ? 1 : -1) : 0;
    // Hand-set order first (if any), then the automatic one.
    const rank = (sideKey: 'out' | 'in') => {
      const order = world.stacks?.get(stackKey(n.key, sideKey));
      return (l: PhysicsLink) => {
        const i = order?.indexOf(linkKey(l)) ?? -1;
        return order ? (i >= 0 ? i : order.length) : 0;
      };
    };
    const outRank = rank('out');
    const inRank = rank('in');
    let y = 0;
    for (const l of world.links
      .filter((l) => l.from === n.key)
      .sort((a, b) => outRank(a) - outRank(b) || side(a) - side(b) || centre(a.to) - centre(b.to))) {
      out.get(linkKey(l))!.s = y + l.width / 2;
      y += l.width;
    }
    y = 0;
    for (const l of world.links
      .filter((l) => l.to === n.key)
      .sort((a, b) => inRank(a) - inRank(b) || centre(a.from) - centre(b.from))) {
      out.get(linkKey(l))!.t = y + l.width / 2;
      y += l.width;
    }
  }
  return out;
}

/**
 * Where each node would rest given where everything is now. `held` (the node
 * being dragged) is the only node that cannot be pushed aside; placed nodes
 * rest where they were put unless that would overlap another node.
 */
export function restingPlaces(
  world: PhysicsWorld,
  state: PhysicsState,
  held: string | null = null,
): Map<string, { x: number; y: number }> {
  const { bodies, offsets } = state;
  const rest = new Map<string, { x: number; y: number }>();
  for (const n of world.nodes) {
    if (n.key === held) {
      const b = bodies.get(n.key)!;
      rest.set(n.key, { x: b.x, y: b.y });
      continue;
    }
    const pin = world.pinned.get(n.key);
    if (pin) {
      rest.set(n.key, { ...pin });
      continue;
    }
    // Level tails: this node's top such that each tail's two ends are at the same height.
    let weight = 0;
    let sum = 0;
    for (const l of world.links) {
      const o = offsets.get(linkKey(l));
      if (!o) continue;
      if (l.from === n.key) sum += l.cents * (bodies.get(l.to)!.y + o.t - o.s);
      else if (l.to === n.key) sum += l.cents * (bodies.get(l.from)!.y + o.s - o.t);
      else continue;
      weight += l.cents;
    }
    const anchor = ANCHOR * (weight || 1);
    sum += anchor * n.y;
    weight += anchor;
    if (n.side) {
      const pull = SIDE_PULL * (weight - anchor || 1);
      sum += pull * (n.side < 0 ? 0 : world.height - n.height);
      weight += pull;
    }
    rest.set(n.key, { x: n.x, y: sum / weight });
  }

  // Keep nodes in a column apart and inside the area (they repel each other,
  // placed ones included); they may change order.
  const fixed = (key: string) => key === held;
  const columns = new Map<number, PhysicsNode[]>();
  for (const n of world.nodes) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
  for (const nodes of columns.values()) {
    const centre = (n: PhysicsNode) => rest.get(n.key)!.y + n.height / 2;
    let sorted = [...nodes].sort((a, b) => centre(a) - centre(b));
    const h = nodes.find((n) => fixed(n.key));
    if (h) {
      // Around the held node: whatever doesn't fit on one side goes to the other.
      const above = sorted.filter((n) => n !== h && centre(n) < centre(h));
      const below = sorted.filter((n) => n !== h && centre(n) >= centre(h));
      const room = (list: PhysicsNode[]) => list.reduce((t, n) => t + n.height + world.gap, 0);
      const hy = rest.get(h.key)!.y;
      while (above.length && room(above) > hy) below.unshift(above.pop()!);
      while (below.length && room(below) > world.height - hy - h.height) above.push(below.shift()!);
      sorted = [...above, h, ...below];
    }
    let top = 0;
    for (const n of sorted) {
      const r = rest.get(n.key)!;
      if (!fixed(n.key)) r.y = Math.max(r.y, top);
      top = r.y + n.height + world.gap;
    }
    let bottom = world.height;
    for (const n of [...sorted].reverse()) {
      const r = rest.get(n.key)!;
      if (!fixed(n.key)) r.y = Math.max(0, Math.min(r.y, bottom - n.height));
      bottom = r.y - world.gap;
    }
  }

  // Levelling tails is indifferent to shifting everything up or down, so the
  // picture can drift to an edge. Unless pins hold it, keep it centred.
  if (world.pinned.size === 0 && !held && world.nodes.length) {
    const top = Math.min(...world.nodes.map((n) => rest.get(n.key)!.y));
    const bottom = Math.max(...world.nodes.map((n) => rest.get(n.key)!.y + n.height));
    const shift = (world.height - top - bottom) / 2;
    for (const r of rest.values()) r.y += shift;
  }
  return rest;
}

/**
 * Advances the simulation one frame. `held` is the node being dragged, which
 * stays where the pointer put it. Returns false once everything is at rest.
 */
export function step(world: PhysicsWorld, state: PhysicsState, held: string | null): boolean {
  const { bodies, offsets } = state;
  for (const n of world.nodes) {
    if (!bodies.has(n.key)) {
      const at = world.pinned.get(n.key) ?? n;
      bodies.set(n.key, { x: at.x, y: at.y, vx: 0, vy: 0 });
    }
  }
  let moving = false;

  // Tails slide toward their places in the stacks.
  for (const [key, target] of stackOffsets(world, bodies)) {
    const o = offsets.get(key) ?? { ...target };
    o.s += (target.s - o.s) * SLIDE;
    o.t += (target.t - o.t) * SLIDE;
    if (Math.abs(target.s - o.s) + Math.abs(target.t - o.t) > REST) moving = true;
    else Object.assign(o, target);
    offsets.set(key, o);
  }

  const rest = restingPlaces(world, state, held);
  for (const n of world.nodes) {
    const target = rest.get(n.key)!;
    const b = bodies.get(n.key)!;
    if (n.key === held) {
      Object.assign(b, { vx: 0, vy: 0 });
      continue;
    }
    b.vx = (b.vx + STIFFNESS * (target.x - b.x)) * DAMPING;
    b.vy = (b.vy + STIFFNESS * (target.y - b.y)) * DAMPING;
    b.x += b.vx;
    b.y += b.vy;
    if (Math.abs(b.vx) + Math.abs(b.vy) > REST || Math.abs(target.x - b.x) + Math.abs(target.y - b.y) > REST * 4) {
      moving = true;
    } else {
      Object.assign(b, { x: target.x, y: target.y, vx: 0, vy: 0 }); // close enough: land exactly
    }
  }
  return moving || held !== null;
}

/** Runs the simulation to rest without drawing (e.g. before the first frame). */
export function settle(world: PhysicsWorld, state: PhysicsState, maxSteps = 600): void {
  for (let i = 0; i < maxSteps && step(world, state, null); i++);
}

/** Size-weighted bend of all tails: the sum of cents × (vertical drop)². What the physics lowers. */
export function totalBend(world: PhysicsWorld, state: PhysicsState): number {
  let total = 0;
  for (const l of world.links) {
    const o = state.offsets.get(linkKey(l))!;
    const drop = state.bodies.get(l.from)!.y + o.s - (state.bodies.get(l.to)!.y + o.t);
    total += l.cents * drop * drop;
  }
  return total;
}
