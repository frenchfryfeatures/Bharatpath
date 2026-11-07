/** Every searchable admin list accepts the same `q` parameter. */
export function adminSearchParams(value: string): { q?: string } {
  const term = value.trim();
  return term ? { q: term } : {};
}
