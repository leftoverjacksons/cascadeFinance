import { describe, expect, it } from 'vitest';
import { PULL, restingPlaces, step, type Body, type PhysicsWorld } from './sankeyPhysics';

// income -> a -> b, plus an unconnected node c in a's column.
const world = (pinned: PhysicsWorld['pinned'] = new Map()): PhysicsWorld => ({
  nodes: [
    { key: 'income', x: 0, y: 0, height: 100, column: 0 },
    { key: 'a', x: 100, y: 0, height: 100, column: 1 },
    { key: 'c', x: 100, y: 300, height: 50, column: 1 },
    { key: 'b', x: 200, y: 0, height: 100, column: 2 },
  ],
  links: [
    { from: 'income', to: 'a', cents: 100 },
    { from: 'a', to: 'b', cents: 100 },
  ],
  pinned,
  height: 500,
  gap: 10,
});

function settle(w: PhysicsWorld, bodies = new Map<string, Body>()) {
  for (let i = 0; i < 2000 && step(w, bodies, null); i++);
  return bodies;
}

describe('sankey physics', () => {
  it('rests at the computed layout when nothing is pinned', () => {
    const bodies = settle(world());
    expect(bodies.get('a')!.y).toBeCloseTo(0, 1);
    expect(bodies.get('b')!.x).toBeCloseTo(200, 1);
  });

  it('pulls neighbours along with a dragged node, less with each step away', () => {
    const bodies = settle(world(new Map([['income', { x: 0, y: 200 }]])));
    const a = bodies.get('a')!.y;
    const b = bodies.get('b')!.y;
    expect(bodies.get('income')!.y).toBeCloseTo(200, 1);
    expect(a).toBeGreaterThan(50);
    expect(a).toBeLessThan(200);
    expect(b).toBeGreaterThan(0);
    expect(b).toBeLessThan(a);
  });

  it('leaves unconnected nodes alone, except to keep a column from overlapping', () => {
    const bodies = settle(world(new Map([['income', { x: 0, y: 200 }]])));
    const a = bodies.get('a')!;
    const c = bodies.get('c')!;
    expect(c.y >= a.y + 100 + 10 - 0.5 || c.y + 50 + 10 <= a.y + 0.5).toBe(true);
  });

  it('overshoots slightly on the way (springy), then settles', () => {
    const w = world();
    const bodies = new Map<string, Body>([['a', { x: 100, y: 200, vx: 0, vy: 0 }]]);
    let lowest = Infinity;
    for (let i = 0; i < 300; i++) {
      step(w, bodies, null);
      lowest = Math.min(lowest, bodies.get('a')!.y);
    }
    expect(lowest).toBeLessThan(-1); // went past 0 before coming back
    expect(bodies.get('a')!.y).toBeCloseTo(0, 1);
  });

  it('keeps a held node where it is', () => {
    const w = world();
    const bodies = new Map<string, Body>([['a', { x: 100, y: 250, vx: 0, vy: 0 }]]);
    for (let i = 0; i < 50; i++) step(w, bodies, 'a');
    expect(bodies.get('a')!.y).toBe(250);
    expect(restingPlaces(w, bodies).get('b')!.y).toBeCloseTo(PULL * 250, 5);
  });
});
