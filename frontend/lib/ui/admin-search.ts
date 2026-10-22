/** Map the single search input to the existing backend's supported parameters. */
export function adminSearchParams(kind: string, value: string): Record<string, string> {
  const term = value.trim();
  if (!term) return {};
  if (kind === "kyb") return { organisation: term };
  if (kind === "discounts") return { q: term };
  const phone = /^\+?[\d\s().-]+$/.test(term) && /\d/.test(term);
  if (phone) return { phone: term };
  if (term.includes("@") || kind === "redemptions") return { email: term };
  return { [kind === "tenants" ? "q" : "name"]: term };
}
