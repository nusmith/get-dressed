import { useEffect, useState } from 'react';

import { request } from './http';

// The values live in the backend (closet/api/taxonomy.py); this is only their shape.
export type TaxonomyCategory = {
  name: string;
  subcategories: string[];
  sizes: string[];
};

export type Taxonomy = {
  categories: TaxonomyCategory[];
  brands: string[];
};

export type ItemDetails = {
  brand?: string | null;
  category?: string | null;
  subcategory?: string | null;
  size?: string | null;
};

let cached: Promise<Taxonomy> | null = null;

export function fetchTaxonomy(): Promise<Taxonomy> {
  if (!cached) {
    cached = request<Taxonomy>('/closet/taxonomy', {}, 'Could not load categories').catch((err) => {
      cached = null; // allow a retry next time
      throw err;
    });
  }
  return cached;
}

export function useTaxonomy() {
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetchTaxonomy()
      .then((t) => active && setTaxonomy(t))
      .catch((err) => active && setError(err instanceof Error ? err.message : 'Could not load categories'));
    return () => {
      active = false;
    };
  }, []);

  return { taxonomy, error };
}
