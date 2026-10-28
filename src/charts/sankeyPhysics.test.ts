import { describe, expect, it } from 'vitest';
import {
  initialState,
  linkKey,
  settle,
  stackKey,
  stackOffsets,
  step,
  totalBend,
  type PhysicsLink,
  type PhysicsNode,
  type PhysicsWorld,
} from './sankeyPhysics';

const world = (
  nodes: PhysicsNode[],
  links: Omit<PhysicsLink, 'width'>[],
  pinned: PhysicsWorld['pinned'] = new Map(),
): PhysicsWorld => ({
  nodes,
  links: links.map((l) => ({ ...l, width: l.cents / 10 })),
  pinned,
  height: 600,
  gap: 10,
});
const start = (w: PhysicsWorld) => {
  const s = initialState(w, new Map());
  s.offsets = stackOffsets(w, s.bodies);
  return s;
};

// income -> a -> b, each 100 high.
const chain = (pinned?: PhysicsWorld['pinned']) =>
  world(
    [
      { key: 'income', x: 0, y: 0, height: 100, column: 0 },
      { key: 'a', x: 100, y: 0, height: 100, column: 1 },
      { key: 'b', x: 200, y: 0, height: 100, column: 2 },
    ],
    [
      { from: 'income', to: 'a', cents: 1000 },
      { from: 'a', to: 'b', cents: 1000 },
    ],
    pinned,
  );

describe('sankey physics', () => {
  it('rests with level tails where nothing pulls', () => {
    const w = chain();
    const s = start(w);
    settle(w, s);
    expect(totalBend(w, s)).toBeCloseTo(0, 0);
  });

  it('a dragged node pulls the chain along until its tails are (almost) level', () => {
    const w = chain(new Map([['income', { x: 0, y: 300 }]]));
    const s = start(w);
    settle(w, s, 2000);
    // The weak spring to the computed layout keeps it a little short of 300.
    expect(s.bodies.get('a')!.y).toBeGreaterThan(250);
    expect(s.bodies.get('b')!.y).toBeGreaterThan(200);
    expect(s.bodies.get('b')!.y).toBeLessThan(s.bodies.get('a')!.y);
  });

  it('lets nodes pass each other in a column to untangle', () => {
    // top -> low, bottom -> high: crossed. low and high should swap places.
    const w = world(
      [
        { key: 'top', x: 0, y: 0, height: 100, column: 0 },
        { key: 'bottom', x: 0, y: 400, height: 100, column: 0 },
        { key: 'high', x: 200, y: 0, height: 100, column: 1 },
        { key: 'low', x: 200, y: 400, height: 100, column: 1 },
      ],
      [
        { from: 'top', to: 'low', cents: 1000 },
        { from: 'bottom', to: 'high', cents: 1000 },
      ],
      new Map([
        ['top', { x: 0, y: 0 }],
        ['bottom', { x: 0, y: 400 }],
      ]),
    );
    const s = start(w);
    settle(w, s, 3000);
    expect(s.bodies.get('low')!.y).toBeLessThan(s.bodies.get('high')!.y);
  });

  it('never overlaps nodes in a column', () => {
    const w = world(
      [
        { key: 'src', x: 0, y: 200, height: 100, column: 0 },
        { key: 'p', x: 200, y: 0, height: 100, column: 1 },
        { key: 'q', x: 200, y: 300, height: 100, column: 1 },
      ],
      [
        { from: 'src', to: 'p', cents: 1000 },
        { from: 'src', to: 'q', cents: 1000 },
      ],
      new Map([['src', { x: 0, y: 200 }]]),
    );
    const s = start(w);
    settle(w, s, 2000);
    const [p, q] = [s.bodies.get('p')!.y, s.bodies.get('q')!.y].sort((x, y) => x - y);
    expect(q - p).toBeGreaterThanOrEqual(100 + 10 - 0.5);
  });

  it('stacks tails by where their other end is, and slides them there', () => {
    const w = world(
      [
        { key: 'src', x: 0, y: 0, height: 200, column: 0 },
        { key: 'up', x: 200, y: 0, height: 100, column: 1 },
        { key: 'down', x: 200, y: 400, height: 100, column: 1 },
      ],
      [
        { from: 'src', to: 'down', cents: 1000 },
        { from: 'src', to: 'up', cents: 1000 },
      ],
      new Map([
        ['up', { x: 200, y: 0 }],
        ['down', { x: 200, y: 400 }],
      ]),
    );
    const s = start(w);
    expect(s.offsets.get(linkKey({ from: 'src', to: 'up' }))!.s).toBe(50);
    // Swap the targets: the tails slide (not jump) to swapped places.
    w.pinned.set('up', { x: 200, y: 400 });
    w.pinned.set('down', { x: 200, y: 0 });
    s.bodies.get('up')!.y = 400;
    s.bodies.get('down')!.y = 0;
    step(w, s, null);
    const mid = s.offsets.get(linkKey({ from: 'src', to: 'up' }))!.s;
    expect(mid).toBeGreaterThan(50);
    expect(mid).toBeLessThan(150);
    settle(w, s);
    expect(s.offsets.get(linkKey({ from: 'src', to: 'up' }))!.s).toBe(150);
  });

  it('springs with a little overshoot, then lands exactly', () => {
    const w = chain(new Map([['income', { x: 0, y: 0 }]]));
    const s = start(w);
    s.bodies.get('a')!.y = 200;
    let lowest = Infinity;
    for (let i = 0; i < 400; i++) {
      step(w, s, null);
      lowest = Math.min(lowest, s.bodies.get('a')!.y);
    }
    expect(lowest).toBeLessThan(-0.5);
    expect(s.bodies.get('a')!.y).toBeCloseTo(0, 1);
  });

  it('keeps a held node where it is', () => {
    const w = chain();
    const s = start(w);
    s.bodies.get('a')!.y = 250;
    for (let i = 0; i < 50; i++) step(w, s, 'a');
    expect(s.bodies.get('a')!.y).toBe(250);
  });

  it('centres the settled picture vertically', () => {
    const w = chain();
    const s = start(w);
    settle(w, s);
    // A 100-high chain in a 600-high area: centred at 250.
    expect(s.bodies.get('a')!.y).toBeCloseTo(250, 0);
  });

  it('pushes placed nodes apart too: they never overlap', () => {
    const w = world(
      [
        { key: 'src', x: 0, y: 0, height: 100, column: 0 },
        { key: 'p', x: 200, y: 0, height: 100, column: 1 },
        { key: 'q', x: 200, y: 300, height: 100, column: 1 },
      ],
      [
        { from: 'src', to: 'p', cents: 1000 },
        { from: 'src', to: 'q', cents: 1000 },
      ],
      // Both placed at the same spot.
      new Map([
        ['p', { x: 200, y: 200 }],
        ['q', { x: 200, y: 200 }],
      ]),
    );
    const s = start(w);
    settle(w, s, 2000);
    const [p, q] = [s.bodies.get('p')!.y, s.bodies.get('q')!.y].sort((x, y) => x - y);
    expect(q - p).toBeGreaterThanOrEqual(100 + 10 - 0.5);
  });

  it('a held node cannot be pushed; the others make room around it', () => {
    const w = world(
      [
        { key: 'p', x: 200, y: 0, height: 100, column: 1 },
        { key: 'q', x: 200, y: 300, height: 100, column: 1 },
      ],
      [],
    );
    const s = start(w);
    s.bodies.get('q')!.y = 20; // dragged onto p
    for (let i = 0; i < 300; i++) step(w, s, 'q');
    expect(s.bodies.get('q')!.y).toBe(20);
    expect(s.bodies.get('p')!.y).toBeGreaterThanOrEqual(20 + 100 + 10 - 0.5);
  });

  it("pulls each side's trunk toward its own edge", () => {
    const w = world(
      [
        { key: 'payA', x: 0, y: 250, height: 50, column: 0, side: -1 },
        { key: 'payB', x: 0, y: 320, height: 50, column: 0, side: 1 },
        { key: 'food', x: 200, y: 260, height: 100, column: 1 },
      ],
      [
        { from: 'payA', to: 'food', cents: 500 },
        { from: 'payB', to: 'food', cents: 500 },
      ],
    );
    const s = start(w);
    settle(w, s, 2000);
    const a = s.bodies.get('payA')!.y;
    const b = s.bodies.get('payB')!.y;
    expect(b - a).toBeGreaterThan(300); // far apart: well beyond their computed 70
  });

  it('follows a hand-set tail order, with unlisted tails below in the automatic order', () => {
    const w = world(
      [
        { key: 'src', x: 0, y: 0, height: 300, column: 0 },
        { key: 'a', x: 200, y: 0, height: 100, column: 1 },
        { key: 'b', x: 200, y: 200, height: 100, column: 1 },
        { key: 'c', x: 200, y: 400, height: 100, column: 1 },
      ],
      [
        { from: 'src', to: 'a', cents: 1000 },
        { from: 'src', to: 'b', cents: 1000 },
        { from: 'src', to: 'c', cents: 1000 },
      ],
    );
    const s = start(w);
    const offset = (to: string) => stackOffsets(w, s.bodies).get(linkKey({ from: 'src', to }))!.s;
    expect([offset('a'), offset('b'), offset('c')]).toEqual([50, 150, 250]); // automatic: by where they go
    w.stacks = new Map([[stackKey('src', 'out'), ['src>c']]]);
    expect([offset('c'), offset('a'), offset('b')]).toEqual([50, 150, 250]); // c moved to the top
  });
});

