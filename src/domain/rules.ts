import type { Database } from '../lib/database.types';
import { formatCents } from './money';

export type Rule = Database['public']['Tables']['category_rules']['Row'];
export type RuleField = Database['public']['Enums']['rule_field'];
export type RuleMatch = Database['public']['Enums']['rule_match'];

export const FIELD_LABELS: Record<RuleField, string> = {
  description: 'Description',
  bank_category: 'Bank category',
};

export const MATCH_LABELS: Record<RuleMatch, string> = {
  contains: 'contains',
  starts_with: 'starts with',
  equals: 'is exactly',
  regex: 'matches pattern',
};

/** Rules at or above this priority are the seeded bank-category mappings. */
export const BANK_MAPPING_PRIORITY = 1000;

/** e.g. `Description contains "publix" · $10.00–$20.00 · Checking` */
export function describeRule(rule: Rule, accountName?: (id: string) => string): string {
  const parts = [`${FIELD_LABELS[rule.field]} ${MATCH_LABELS[rule.match_type]} "${rule.pattern}"`];
  const { amount_min_cents: min, amount_max_cents: max } = rule;
  if (min !== null && max !== null) parts.push(`${formatCents(min)}–${formatCents(max)}`);
  else if (min !== null) parts.push(`≥ ${formatCents(min)}`);
  else if (max !== null) parts.push(`≤ ${formatCents(max)}`);
  if (rule.account_id && accountName) parts.push(`only ${accountName(rule.account_id)}`);
  return parts.join(' · ');
}
