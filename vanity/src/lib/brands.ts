// Mirrors brand_key in closet/api/taxonomy.py: ignore case, accents, spaces and punctuation.
export function brandKey(brand: string): string {
  return brand
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return prev[b.length];
}

/** Merge brand lists, keeping the first spelling of each brand (by brandKey), sorted. */
export function mergeBrands(...lists: string[][]): string[] {
  const byKey = new Map<string, string>();
  for (const brand of lists.flat()) {
    const key = brandKey(brand);
    if (key && !byKey.has(key)) byKey.set(key, brand);
  }
  return [...byKey.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * A known brand that `brand` is probably a typo of ("Lashkara" -> "Lashkaraa"), or null.
 * Exact matches (by brandKey) return null: the backend already stores those under the known spelling.
 */
export function likelyBrandTypo(brand: string, known: string[]): string | null {
  const key = brandKey(brand);
  if (key.length < 4 || known.some((k) => brandKey(k) === key)) return null;

  const maxDistance = key.length >= 8 ? 2 : 1;
  let best: { brand: string; distance: number } | null = null;
  for (const candidate of known) {
    const candidateKey = brandKey(candidate);
    if (Math.abs(candidateKey.length - key.length) > maxDistance) continue;
    const distance = editDistance(key, candidateKey);
    if (distance <= maxDistance && (!best || distance < best.distance)) best = { brand: candidate, distance };
  }
  return best?.brand ?? null;
}
