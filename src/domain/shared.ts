// Member balance from the shared ledger (docs/DESIGN.md §9a).
// Each ledger entry says: `debtor` owes `creditor` `cents` (may be negative,
// e.g. a refund on a shared expense).

export interface LedgerEntry {
  /**
   * expense: shared spending from a personal account; contribution / withdrawal:
   * money into / out of a joint account; payback: between personal accounts;
   * manual: recorded by hand.
   */
  entry_kind: 'expense' | 'contribution' | 'withdrawal' | 'payback' | 'manual';
  entry_date: string; // YYYY-MM-DD
  ref_id: string;
  description: string;
  total_cents: number;
  debtor: string;
  creditor: string;
  cents: number;
}

/** What `b` owes `a` (negative: `a` owes `b`). */
export function balanceBetween(entries: LedgerEntry[], a: string, b: string): number {
  let net = 0;
  for (const e of entries) {
    if (e.debtor === b && e.creditor === a) net += e.cents;
    else if (e.debtor === a && e.creditor === b) net -= e.cents;
  }
  return net;
}

export interface Debt {
  debtor: string;
  creditor: string;
  cents: number;
}

/** The balance between two members as "who owes whom", or null when square. */
export function whoOwes(entries: LedgerEntry[], a: string, b: string): Debt | null {
  const net = balanceBetween(entries, a, b);
  if (net === 0) return null;
  return net > 0 ? { debtor: b, creditor: a, cents: net } : { debtor: a, creditor: b, cents: -net };
}

export interface MonthLine {
  month: string; // YYYY-MM-01
  /** Shared spending each member paid from their own accounts. */
  paidBy: Map<string, number>;
  /** Paybacks (bank transfers and recorded payments) from each member. */
  paidBack: Map<string, number>;
  /** Net money each member put into joint accounts (taken out counts negative). */
  intoJoint: Map<string, number>;
  /** Change in what `b` owes `a` during the month. */
  change: number;
}

/** Month-by-month breakdown between two members, newest first. */
export function monthlyBreakdown(entries: LedgerEntry[], a: string, b: string): MonthLine[] {
  const months = new Map<string, MonthLine>();
  const line = (month: string) => {
    let l = months.get(month);
    if (!l) {
      l = { month, paidBy: new Map(), paidBack: new Map(), intoJoint: new Map(), change: 0 };
      months.set(month, l);
    }
    return l;
  };
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  // Expenses and joint movements appear once per other member; count each total once.
  const counted = new Set<string>();

  for (const e of entries) {
    if (!((e.debtor === a && e.creditor === b) || (e.debtor === b && e.creditor === a))) continue;
    const l = line(`${e.entry_date.slice(0, 7)}-01`);
    l.change += e.debtor === b ? e.cents : -e.cents;
    if (e.entry_kind === 'expense') {
      if (!counted.has(e.ref_id)) {
        counted.add(e.ref_id);
        add(l.paidBy, e.creditor, e.total_cents);
      }
    } else if (e.entry_kind === 'contribution' || e.entry_kind === 'withdrawal') {
      if (!counted.has(e.ref_id)) {
        counted.add(e.ref_id);
        if (e.entry_kind === 'contribution') add(l.intoJoint, e.creditor, e.total_cents);
        else add(l.intoJoint, e.debtor, -e.total_cents);
      }
    } else {
      // A payback from X to Y makes Y the debtor: X (the creditor) paid.
      add(l.paidBack, e.creditor, e.cents);
    }
  }
  return [...months.values()].sort((x, y) => y.month.localeCompare(x.month));
}
