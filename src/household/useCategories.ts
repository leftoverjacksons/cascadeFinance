import { useCallback, useEffect, useMemo, useState } from 'react';
import { buildTree, type Category } from '../domain/categories';
import { supabase } from '../lib/supabase';

export function useCategories() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const { data, error } = await supabase.from('categories').select('*');
    if (error) setError(error.message);
    else {
      setCategories(data);
      setError(null);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byId = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const tree = useMemo(() => buildTree(categories), [categories]);

  return { categories, byId, tree, error, refresh };
}
