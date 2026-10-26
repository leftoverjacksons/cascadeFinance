import { describe, expect, it } from 'vitest';
import { groupAccounts } from './accounts';

describe('groupAccounts', () => {
  it('orders groups and sorts within a group', () => {
    const result = groupAccounts([
      { name: 'Mortgage', type: 'mortgage', sort_order: 0 },
      { name: 'Savings', type: 'savings', sort_order: 0 },
      { name: 'Amex', type: 'credit_card', sort_order: 0 },
      { name: 'Checking', type: 'checking', sort_order: 0 },
    ]);
    expect(result.map((g) => g.group)).toEqual(['cash', 'credit', 'loans']);
    expect(result[0].accounts.map((a) => a.name)).toEqual(['Checking', 'Savings']);
  });
});
