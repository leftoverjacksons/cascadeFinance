import type { Database } from '../lib/database.types';

export type Category = Database['public']['Tables']['categories']['Row'];
export type CategoryKind = Database['public']['Enums']['category_kind'];

export interface CategoryGroup {
  group: Category;
  children: Category[];
}

const bySortThenName = (a: Category, b: Category) =>
  a.sort_order - b.sort_order || a.name.localeCompare(b.name);

/** Two-level tree, groups and children each sorted by sort_order then name. */
export function buildTree(categories: Category[], includeArchived = false): CategoryGroup[] {
  const visible = includeArchived ? categories : categories.filter((c) => !c.is_archived);
  return visible
    .filter((c) => c.parent_id === null)
    .sort(bySortThenName)
    .map((group) => ({
      group,
      children: visible.filter((c) => c.parent_id === group.id).sort(bySortThenName),
    }));
}

/** "Group › Category" for a child, or the group name for a group. */
export function categoryLabel(id: string | null, byId: Map<string, Category>): string {
  if (!id) return 'Uncategorized';
  const c = byId.get(id);
  if (!c) return 'Unknown category';
  const parent = c.parent_id ? byId.get(c.parent_id) : undefined;
  return parent ? `${parent.name} › ${c.name}` : c.name;
}

/** Case-insensitive match on either the category or its group name. */
export function filterTree(tree: CategoryGroup[], query: string): CategoryGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  return tree
    .map(({ group, children }) =>
      group.name.toLowerCase().includes(q)
        ? { group, children }
        : { group, children: children.filter((c) => c.name.toLowerCase().includes(q)) },
    )
    .filter((g) => g.children.length > 0 || g.group.name.toLowerCase().includes(q));
}

export const KIND_LABELS: Record<CategoryKind, string> = {
  expense: 'Spending',
  income: 'Income',
  transfer: 'Transfer (excluded from spending)',
};
