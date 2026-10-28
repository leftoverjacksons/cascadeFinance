import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: {} }));
const { sanitizePositions } = await import('./FlowsPanel');

describe('sanitizePositions', () => {
  it('reads version 2 positions, clamped to the drawing area', () => {
    expect(sanitizePositions({ v: 2, nodes: { a: { x: 0.5, y: 1.4 }, b: { x: 'no', y: 0 } } })).toEqual({
      a: { x: 0.5, y: 1 },
    });
  });

  it('ignores the old offset format and anything malformed', () => {
    expect(sanitizePositions({ a: { x: 0.1, y: -0.2 } })).toEqual({});
    expect(sanitizePositions(null)).toEqual({});
    expect(sanitizePositions({ v: 2, nodes: [1, 2] })).toEqual({});
  });
});
