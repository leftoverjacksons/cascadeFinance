import { describe, expect, it } from 'vitest';
import { describeRule, type Rule } from './rules';

const base: Rule = {
  id: 'r',
  household_id: 'h',
  priority: 100,
  field: 'description',
  match_type: 'contains',
  pattern: 'publix',
  account_id: null,
  amount_min_cents: null,
  amount_max_cents: null,
  set_category_id: 'c',
  created_at: '',
};

describe('describeRule', () => {
  it('plain', () => {
    expect(describeRule(base)).toBe('Description contains "publix"');
  });
  it('with range and account', () => {
    expect(
      describeRule({ ...base, amount_min_cents: 1000, amount_max_cents: 2000, account_id: 'a' }, () => 'Checking'),
    ).toBe('Description contains "publix" · $10.00–$20.00 · only Checking');
  });
  it('one-sided range', () => {
    expect(describeRule({ ...base, field: 'bank_category', match_type: 'equals', amount_min_cents: 500 })).toBe(
      'Bank category is exactly "publix" · ≥ $5.00',
    );
  });
});
