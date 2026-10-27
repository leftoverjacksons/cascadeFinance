import { describe, expect, it } from 'vitest';
import { archivePath } from './importFile';

describe('archivePath', () => {
  it('places files under household/account so storage RLS can scope them', () => {
    expect(archivePath('h1', 'a1', '2026-10-26', 'abcdef0123456789ffff')).toBe(
      'h1/a1/2026-10-26_abcdef0123456789.csv',
    );
  });
});
