import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
const { sanitizeLayout } = await import('./FlowsPanel');

describe('sanitizeLayout', () => {
  it('reads version 2 positions, clamped to the drawing area', () => {
    expect(sanitizeLayout({ v: 2, nodes: { a: { x: 0.5, y: 1.4 }, b: { x: 'no', y: 0 } } }).nodes).toEqual({
      a: { x: 0.5, y: 1 },
    });
  });

  it('reads hand-set tail orders', () => {
    expect(sanitizeLayout({ v: 2, nodes: {}, stacks: { 'n|out': ['n>a', 'n>b'], bad: [1] } }).stacks).toEqual({
      'n|out': ['n>a', 'n>b'],
    });
  });

  it('ignores the old offset format and anything malformed', () => {
    const empty = { nodes: {}, stacks: {} };
    expect(sanitizeLayout({ a: { x: 0.1, y: -0.2 } })).toEqual(empty);
    expect(sanitizeLayout(null)).toEqual(empty);
    expect(sanitizeLayout({ v: 2, nodes: [1, 2] })).toEqual(empty);
  });
});
