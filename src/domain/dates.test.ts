import { describe, expect, it } from 'vitest';
import { formatDay, todayLocal } from './dates';

describe('dates', () => {
  it('todayLocal uses local calendar fields', () => {
    expect(todayLocal(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
  it('formatDay does not shift the date', () => {
    expect(formatDay('2026-10-23')).toBe('Fri, Oct 23, 2026');
  });
});
