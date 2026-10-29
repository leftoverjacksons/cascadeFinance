// Desktop dashboard layout: panels on a 12-column snap grid.
// A saved layout lists the visible panels with their positions; panels not
// listed are hidden (and can be added back).

export interface LayoutItem {
  i: string; // panel id
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SavedLayout {
  version: 1;
  items: LayoutItem[];
  /**
   * Panels that existed when the layout was saved. Panels added to the app
   * later are not in it and get appended, while panels the person hid stay
   * hidden. Missing in layouts saved before this field existed.
   */
  seen?: string[];
}

/** The panels that existed before `seen` was recorded. */
const FIRST_PANELS = ['kpis', 'cashflow', 'netWorth', 'spending', 'spendingTable', 'transactions', 'balances'];

export const COLS = 12;
/** Grid rows that fit in one screen height; panels are sized in these units. */
export const ROWS_PER_SCREEN = 12;
export const MIN_W = 3;
export const MIN_H = 2;
const NEW_PANEL = { w: 6, h: 5 };

/** Two panels per row, each half the width; summary tiles across the top. */
export const DEFAULT_LAYOUT: LayoutItem[] = [
  { i: 'kpis', x: 0, y: 0, w: 12, h: 2 },
  { i: 'cashflow', x: 0, y: 2, w: 6, h: 5 },
  { i: 'flows', x: 6, y: 2, w: 6, h: 5 },
  { i: 'spending', x: 0, y: 7, w: 6, h: 5 },
  { i: 'spendingTable', x: 6, y: 7, w: 6, h: 5 },
  { i: 'netWorth', x: 0, y: 12, w: 6, h: 5 },
  { i: 'balances', x: 6, y: 12, w: 6, h: 5 },
  { i: 'transactions', x: 0, y: 17, w: 6, h: 6 },
  { i: 'shared', x: 6, y: 17, w: 6, h: 6 },
  { i: 'recurring', x: 0, y: 23, w: 6, h: 5 },
];

const isInt = (v: unknown): v is number => Number.isInteger(v);

/**
 * Validates a stored layout against the panels that exist now. Unknown panel
 * ids are dropped, sizes are clamped to the grid; anything malformed falls
 * back to the default layout.
 */
export function sanitizeLayout(saved: unknown, known: readonly string[]): LayoutItem[] {
  const fallback = DEFAULT_LAYOUT.filter((it) => known.includes(it.i));
  if (typeof saved !== 'object' || saved === null) return fallback;
  const { version, items, seen: savedSeen } = saved as Partial<SavedLayout>;
  if (version !== 1 || !Array.isArray(items)) return fallback;
  const seenBefore = Array.isArray(savedSeen) ? savedSeen : FIRST_PANELS;

  const seen = new Set<string>();
  const out: LayoutItem[] = [];
  for (const raw of items as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return fallback;
    const { i, x, y, w, h } = raw as Partial<LayoutItem>;
    if (typeof i !== 'string' || !isInt(x) || !isInt(y) || !isInt(w) || !isInt(h)) return fallback;
    if (!known.includes(i) || seen.has(i)) continue;
    seen.add(i);
    const width = Math.min(COLS, Math.max(MIN_W, w));
    out.push({ i, x: Math.min(Math.max(0, x), COLS - width), y: Math.max(0, y), w: width, h: Math.max(MIN_H, h) });
  }
  // Panels new since this layout was saved.
  return known.filter((id) => !seenBefore.includes(id)).reduce(addPanel, out);
}

/** Adds a panel below everything else, half width. */
export function addPanel(items: LayoutItem[], id: string): LayoutItem[] {
  if (items.some((it) => it.i === id)) return items;
  const bottom = items.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  return [...items, { i: id, x: 0, y: bottom, ...NEW_PANEL }];
}

export function removePanel(items: LayoutItem[], id: string): LayoutItem[] {
  return items.filter((it) => it.i !== id);
}

export function hiddenPanels(items: LayoutItem[], known: readonly string[]): string[] {
  const shown = new Set(items.map((it) => it.i));
  return known.filter((id) => !shown.has(id));
}

/** Only the fields we persist (the grid library adds its own), plus the panels known now. */
export function toSaved(items: LayoutItem[], known: readonly string[]): SavedLayout {
  return { version: 1, items: items.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })), seen: [...known] };
}
