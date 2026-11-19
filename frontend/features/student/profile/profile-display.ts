/** Display-only formatting; never invent values for incomplete profiles. */
export function profileValueText(value: unknown, options: readonly {value:string;label:string}[] = []): string {
  if (value == null || (typeof value === "number" && !Number.isFinite(value))) return "N/A";
  if (Array.isArray(value)) return value.map(item => String(item ?? "").trim()).filter(Boolean).join(", ") || "N/A";
  if (typeof value === "string" && !value.trim()) return "N/A";
  return options.find(option => option.value === value)?.label ?? String(value);
}
