import { describe, expect, it } from 'vitest';
import { buildTree, categoryLabel, filterTree, type Category } from './categories';

function cat(id: string, name: string, parent_id: string | null = null, extra: Partial<Category> = {}): Category {
  return {
    id,
    name,
    parent_id,
    household_id: 'h',
    kind: 'expense',
    is_archived: false,
    sort_order: 0,
    created_at: '',
    ...extra,
  };
}

const cats = [
  cat('g2', 'Shopping', null, { sort_order: 2 }),
  cat('g1', 'Food', null, { sort_order: 1 }),
  cat('c2', 'Restaurants', 'g1', { sort_order: 2 }),
  cat('c1', 'Groceries', 'g1', { sort_order: 1 }),
  cat('c3', 'Clothing', 'g2'),
  cat('c4', 'Old', 'g2', { is_archived: true }),
];
const byId = new Map(cats.map((c) => [c.id, c]));

describe('buildTree', () => {
  it('orders groups and children, hides archived', () => {
    const t = buildTree(cats);
    expect(t.map((g) => g.group.name)).toEqual(['Food', 'Shopping']);
    expect(t[0].children.map((c) => c.name)).toEqual(['Groceries', 'Restaurants']);
    expect(t[1].children.map((c) => c.name)).toEqual(['Clothing']);
  });
  it('can include archived', () => {
    expect(buildTree(cats, true)[1].children).toHaveLength(2);
  });
});

describe('categoryLabel', () => {
  it('labels children with their group', () => {
    expect(categoryLabel('c1', byId)).toBe('Food › Groceries');
    expect(categoryLabel('g1', byId)).toBe('Food');
    expect(categoryLabel(null, byId)).toBe('Uncategorized');
  });
});

describe('filterTree', () => {
  const tree = buildTree(cats);
  it('matches child names', () => {
    expect(filterTree(tree, 'groc')).toEqual([{ group: cats[1], children: [cats[3]] }]);
  });
  it('a group-name match keeps all children', () => {
    expect(filterTree(tree, 'shop')[0].children.map((c) => c.name)).toEqual(['Clothing']);
  });
});
