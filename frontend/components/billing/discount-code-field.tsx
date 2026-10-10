"use client";

import { useState } from "react";
import { Check, Tag, X } from "lucide-react";

import { getApiErrorMessage } from "@/lib/api/error-message";

export type DiscountPreview = { list_amount_minor: number; discount_minor: number; amount_minor: number };

export function DiscountCodeField({ planCode, preview, onChange, tone = "default" }: {
  /** `student` uses the student portal's cream and purple palette. */
  tone?: "default" | "student";
  planCode: string;
  preview: (args: { planCode: string; discountCode: string }) => Promise<DiscountPreview>;
  onChange: (code: string | null, price: DiscountPreview | null) => void | Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [applied, setApplied] = useState<string | null>(null);
  const [price, setPrice] = useState<DiscountPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const student = tone === "student";
  const money = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(amount / 100);

  async function apply() {
    const code = value.trim().toUpperCase();
    if (!code) { setError("Enter a discount code."); return; }
    setLoading(true); setError(null);
    try {
      const result = await preview({ planCode, discountCode: code });
      await onChange(code, result);
      setApplied(code); setPrice(result);
    } catch (e) {
      setApplied(null); setPrice(null);
      try { await onChange(null, null); } catch { /* Keep the original apply error. */ }
      setError(getApiErrorMessage(e, "This discount code could not be applied."));
    } finally { setLoading(false); }
  }
  async function clear() {
    setLoading(true); setError(null);
    try {
      await onChange(null, null);
      setValue(""); setApplied(null); setPrice(null);
    } catch (e) {
      setError(getApiErrorMessage(e, "The discount code could not be removed."));
    } finally { setLoading(false); }
  }

  return <div className={`mt-4 rounded-lg border p-3 text-[#0A1931] ${student ? "border-[#E7E0D4] bg-[#FDFAF4]" : "border-[#dfe3e9] bg-[#fafbfc]"}`}>
    <label className="flex items-center gap-2 text-xs font-semibold text-[#0A1931]"><Tag size={14} /> Discount code</label>
    <div className="mt-2 flex gap-2"><input aria-label="Discount code" value={value} disabled={Boolean(applied)} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(); } }} placeholder="Enter code" className={`min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-sm uppercase text-[#0A1931] outline-none placeholder:text-[#98a0ae] disabled:bg-[#f4f1ea] ${student ? "border-[#E7E0D4] focus:border-[#5F4DB2]" : "border-[#dfe3e9] focus:border-[#5b4ed0]"}`} />{applied ? <button type="button" onClick={clear} aria-label="Remove discount code" className="rounded-lg border border-[#E7E0D4] bg-white px-3 text-[#5F6B80]"><X size={16} /></button> : <button type="button" disabled={loading} onClick={() => void apply()} className={`rounded-lg px-4 text-xs font-semibold text-white disabled:opacity-60 ${student ? "bg-[#5F4DB2] hover:bg-[#4A3E8F]" : "bg-[#18243a]"}`}>{loading ? "Checking…" : "Apply"}</button>}</div>
    {price && <div className="mt-2 flex items-center gap-2 text-xs text-[#13875e]"><Check size={14} /><strong>{applied}</strong> saves {money(price.discount_minor)}. Total: <strong>{price.amount_minor === 0 ? "Free" : money(price.amount_minor)}</strong></div>}
    {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
  </div>;
}
