import { describe, expect, it } from 'vitest';
import { suggestPattern } from './rulePattern';

describe('suggestPattern', () => {
  it.each([
    ['PUBLIX SUPER MAR 3695 C  ATLANTA      GA', 'PUBLIX SUPER MAR'],
    ['PUBLIX #503                      102526', 'PUBLIX'],
    ['SQ *JUST ADD HONEY T             102426', 'JUST ADD HONEY'],
    ['TST* CARIBOU COFFEE - 2  ATLANTA      GA', 'CARIBOU COFFEE'],
    ['AMAZON.COM*752GY6RQ3             102426', 'AMAZON.COM'],
    ['CHICK-FIL-A #03797       404-696-3300 GA', 'CHICK-FIL-A'],
    ['USAA FUNDS TRANSFER DB', 'USAA FUNDS TRANSFER'],
    ['SQ *CORNER CAFE          Atlanta      GA', 'CORNER CAFE'],
    ['STARBUCKS 08291          ATLANTA      GA', 'STARBUCKS'],
  ])('%s -> %s', (raw, expected) => {
    expect(suggestPattern(raw)).toBe(expected);
  });

  it('falls back to the whole description when the merchant name is too short to be specific', () => {
    expect(suggestPattern('QT 776 NORCROSS GA')).toBe('QT 776 NORCROSS GA');
  });
});
