// Spring physics for the money-flow diagram's nodes.
//
// Every node has a resting place: the computed layout, or where it was pinned
// (dragged). A free node's resting place also moves with its neighbours: it is
// displaced by PULL times the value-weighted average displacement of the nodes
// it exchanges money with, so dragging a node tugs its parents and children
// along, less with every step away. Nodes in a column are kept from
// overlapping. Each node then springs toward its resting place with a little
// overshoot.

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
}

export interface PhysicsWorld {
  nodes: PhysicsNode[];
  links: { from: string; to: string; cents: number }[];
  /** Pinned nodes' top-left corners. */
  pinned: Map<string, { x: number; y: number }>;
  /** Drawing area height, and the gap kept between nodes in a column. */
  height: number;
  gap: number;
}

/** Share of the neighbours' displacement a free node follows. */
export const PULL = 0.7;
const STIFFNESS = 0.14;
const DAMPING = 0.76;
const REST = 0.05;

/** Where each node would rest given where its neighbours are now. */
export function restingPlaces(world: PhysicsWorld, bodies: Map<string, Body>): Map<string, { x: number; y: number }> {
  const base = new Map(world.nodes.map((n) => [n.key, n]));
  const displacement = (key: string) => (bodies.get(key)?.y ?? base.get(key)!.y) - base.get(key)!.y;

  const rest = new Map<string, { x: number; y: number }>();
  for (const n of world.nodes) {
    const pin = world.pinned.get(n.key);
    if (pin) {
      rest.set(n.key, pin);
      continue;
    }
    let weight = 0;
    let sum = 0;
    for (const l of world.links) {
      const other = l.from === n.key ? l.to : l.to === n.key ? l.from : null;
      if (!other || !base.has(other)) continue;
      weight += l.cents;
      sum += l.cents * displacement(other);
    }
    rest.set(n.key, { x: n.x, y: n.y + (weight ? (PULL * sum) / weight : 0) });
  }

  // Keep nodes in a column apart (pinned nodes stay where they were put).
  const columns = new Map<number, PhysicsNode[]>();
  for (const n of world.nodes) columns.set(n.column, [...(columns.get(n.column) ?? []), n]);
  for (const nodes of columns.values()) {
    const sorted = [...nodes].sort((a, b) => rest.get(a.key)!.y - rest.get(b.key)!.y);
    let top = 0;
    for (const n of sorted) {
      const r = rest.get(n.key)!;
      if (!world.pinned.has(n.key)) r.y = Math.max(r.y, top);
      top = r.y + n.height + world.gap;
    }
    let bottom = world.height;
    for (const n of [...sorted].reverse()) {
      const r = rest.get(n.key)!;
      if (!world.pinned.has(n.key)) r.y = Math.max(0, Math.min(r.y, bottom - n.height));
      bottom = r.y - world.gap;
    }
  }
  return rest;
}

/**
 * Advances the simulation one frame. `held` is the node being dragged, which
 * stays where the pointer put it. Returns false once everything is at rest.
 */
export function step(world: PhysicsWorld, bodies: Map<string, Body>, held: string | null): boolean {
  // New nodes start where they are pinned, or at the computed layout.
  for (const n of world.nodes) {
    if (!bodies.has(n.key)) {
      const at = world.pinned.get(n.key) ?? n;
      bodies.set(n.key, { x: at.x, y: at.y, vx: 0, vy: 0 });
    }
  }
  const rest = restingPlaces(world, bodies);
  let moving = false;
  for (const n of world.nodes) {
    const target = rest.get(n.key)!;
    const b = bodies.get(n.key)!;
    if (n.key === held) {
      bodies.set(n.key, { ...b, vx: 0, vy: 0 });
      continue;
    }
    b.vx = (b.vx + STIFFNESS * (target.x - b.x)) * DAMPING;
    b.vy = (b.vy + STIFFNESS * (target.y - b.y)) * DAMPING;
    b.x += b.vx;
    b.y += b.vy;
    if (Math.abs(b.vx) + Math.abs(b.vy) > REST || Math.abs(target.x - b.x) + Math.abs(target.y - b.y) > REST * 4) {
      moving = true;
    } else {
      // Close enough: land exactly.
      Object.assign(b, { x: target.x, y: target.y, vx: 0, vy: 0 });
    }
    bodies.set(n.key, b);
  }
  return moving || held !== null;
}
