import type { Database } from '../lib/database.types';

export type AccountType = Database['public']['Enums']['account_type'];
export type Account = Database['public']['Tables']['accounts']['Row'];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  checking: 'Checking',
  savings: 'Savings',
  credit_card: 'Credit card',
  mortgage: 'Mortgage',
  auto_loan: 'Auto loan',
  other_loan: 'Other loan',
  other: 'Other',
};

export type AccountGroup = 'cash' | 'credit' | 'loans' | 'other';

export const ACCOUNT_GROUP_LABELS: Record<AccountGroup, string> = {
  cash: 'Cash',
  credit: 'Credit cards',
  loans: 'Loans',
  other: 'Other',
};

const GROUP_ORDER: AccountGroup[] = ['cash', 'credit', 'loans', 'other'];

export function accountGroup(type: AccountType): AccountGroup {
  switch (type) {
    case 'checking':
    case 'savings':
      return 'cash';
    case 'credit_card':
      return 'credit';
    case 'mortgage':
    case 'auto_loan':
    case 'other_loan':
      return 'loans';
    case 'other':
      return 'other';
  }
}

/** Groups accounts for display, in a fixed group order, omitting empty groups. */
export function groupAccounts<T extends Pick<Account, 'type' | 'name' | 'sort_order'>>(
  accounts: T[],
): { group: AccountGroup; accounts: T[] }[] {
  return GROUP_ORDER.map((group) => ({
    group,
    accounts: accounts
      .filter((a) => accountGroup(a.type) === group)
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
  })).filter((g) => g.accounts.length > 0);
}
