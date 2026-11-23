const normalizeCompanyName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export function filterVendors<T extends { name: string }>(vendors: readonly T[], query: string): readonly T[] {
  const term = normalizeCompanyName(query);
  return term ? vendors.filter(({ name }) => normalizeCompanyName(name).includes(term)) : vendors;
}
