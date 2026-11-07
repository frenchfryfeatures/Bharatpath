"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { createPortal } from "react-dom";
import { adminSearchParams } from "@/lib/ui/admin-search";
import { useFloatingPanel } from "@/lib/hooks/use-floating-panel";
import { SelectDropdown } from "@/components/ui/select-dropdown";
import { DatePicker } from "@/components/ui/date-time-picker";
import { useDebouncedSearch } from "@/lib/hooks/use-debounced-value";

const CREATED = ["created_from", "created_to"];
const CONFIG = {
  candidates: { fields: ["city", ...CREATED], sorts: ["created_at", "full_name"] },
  leads: { fields: ["signed_up_from", "signed_up_to"], sorts: ["created_at", "full_name", "last_downloaded_at"] },
  kyb: { fields: [...CREATED], sorts: ["created_at", "submitted_at", "organisation"] },
  integrity: { fields: ["rule_id", ...CREATED], sorts: ["created_at", "severity"] },
  tenants: { fields: [...CREATED], sorts: ["name", "created_at"] },
  disputes: { fields: ["assigned_to", ...CREATED], sorts: ["created_at", "resolved_at"] },
  audit: { fields: [], sorts: [] },
  discounts: { fields: ["audience", "status", ...CREATED], sorts: ["created_at", "code", "valid_until"] },
  redemptions: { fields: ["subscriber_type", "redeemed_from", "redeemed_to"], sorts: ["redeemed_at", "amount_minor"] },
  attributes: { fields: ["featured", "includeInactive"], sorts: ["key", "label", "created_at"] },
} satisfies Record<string, { fields: string[]; sorts: string[] }>;

export type ListKind = keyof typeof CONFIG;
type Values = Record<string, string | string[]>;
const STATUSES = ["ACTIVE", "SCHEDULED", "EXPIRED", "EXHAUSTED", "DISABLED"];
const label = (key: string) => key === "includeInactive" ? "Include inactive" : key === "assigned_to" ? "Assigned staff user ID" : key === "last_downloaded_at" ? "Candidate's last resume download" : key.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());


const compact = (values: Values): Values => Object.fromEntries(Object.entries(values).filter(([, value]) => Array.isArray(value) ? value.length > 0 : value.trim().length > 0));
const SEARCH_LISTS: ListKind[] = ["candidates", "leads", "kyb", "integrity", "tenants", "disputes", "discounts", "redemptions"];
const PLACEHOLDER: Partial<Record<ListKind, string>> = { candidates: "Search name, email or phone", leads: "Search name, email or phone", kyb: "Search organisations", integrity: "Search name, email or phone", tenants: "Search organisation, email or phone", disputes: "Search name, email or phone", discounts: "Search code or label", redemptions: "Search email or phone" };

export function useAdminListFilters(kind: ListKind) {
  const [all, setAll] = useState<Partial<Record<ListKind, Values>>>({});
  const [searches, setSearches] = useState<Partial<Record<ListKind, string>>>({});
  const search = searches[kind] || "";
  const debounced = useDebouncedSearch(search);
  const applied = all[kind] || {};
  const params: Values = { ...applied, ...(SEARCH_LISTS.includes(kind) ? adminSearchParams(debounced) : {}) };
  const renderControls = (actions?: ReactNode) => <ListFilters key={kind} kind={kind} applied={applied} search={search}
    onSearch={(value) => setSearches((old) => ({ ...old, [kind]: value }))}
    onApply={(value) => setAll((old) => ({ ...old, [kind]: value }))} actions={actions} />;
  return {
    params,
    key: JSON.stringify(params),
    searching: Boolean(debounced.trim()),
    controls: renderControls(),
    renderControls,
  };
}

function ListFilters({ kind, applied, search, onSearch, onApply, actions }: {
  actions?: ReactNode; kind: ListKind; applied: Values; search: string; onSearch: (value: string) => void; onApply: (value: Values) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Values>(applied);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLFormElement>(null);
  const panelId = useId();
  const panelStyle = useFloatingPanel(open, trigger, panel, { width: 600, align: "right" });
  const config = CONFIG[kind];
  const fields = config.fields;
  const active = Object.entries(compact(applied));
  const count = active.length;
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const set = (key: string, value: string | string[]) => setDraft((old) => ({ ...old, [key]: value }));

  useEffect(() => {
    if (!open) return;
    if (panelStyle.visibility === "visible") panel.current?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest<HTMLElement>("[data-overlay-owner]")?.dataset.overlayOwner === panelId) return;
      if (target.closest<HTMLElement>("[data-overlay-parent]")?.dataset.overlayParent === panelId) return;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open, panelId, panelStyle.visibility]);

  const inputClass = "h-10 w-full rounded-xl border border-[#dfe2e8] bg-white px-3 text-[13px] text-[#172033] outline-none focus:border-[#5b4fcf] focus:ring-2 focus:ring-[#5b4fcf]/15";
  return <div className="relative my-4">
    <div className="flex flex-wrap items-center gap-3">
      {SEARCH_LISTS.includes(kind) ? <label className="flex h-11 min-w-[min(240px,100%)] flex-1 max-w-[460px] items-center gap-2.5 rounded-xl border border-[#dfe2e8] bg-white px-3.5 focus-within:border-[#5b4fcf] focus-within:ring-2 focus-within:ring-[#5b4fcf]/15">
        <Search className="h-[18px] w-[18px] shrink-0 text-[#7b8494]" aria-hidden="true" />
        <input type="search" aria-label="Search all records" value={search} onChange={(event) => onSearch(event.target.value)}
          placeholder={PLACEHOLDER[kind]} maxLength={100} className="min-w-0 flex-1 bg-transparent text-[13px] text-[#172033] outline-none placeholder:text-[#8b94a5]" />
      </label> : <span />}
      <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={panelId} aria-haspopup="dialog"
        onClick={() => { if (open) close(); else { setDraft(applied); setOpen(true); } }}
        className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-xl border px-4 text-[13px] font-semibold transition-colors ${open || count ? "border-[#315c9f] bg-[#eef3fb] text-[#315c9f]" : "border-[#dfe2e8] bg-white text-[#344054] hover:bg-[#f8f9fc]"}`}>
        <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filters
        {count > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-[#315c9f] px-1 text-[10px] text-white">{count}</span>}
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
      </button>
      {actions}
      </div>
    </div>
    {active.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-2" aria-label="Active filters">
      {active.map(([key, value]) => <button type="button" key={key} onClick={() => { const next = { ...applied }; delete next[key]; onApply(next); }}
        className="inline-flex max-w-full items-center gap-1.5 break-all rounded-lg border border-[#dfe7f3] bg-[#eef3fb] px-2.5 py-1.5 text-[11px] text-[#315c9f]" aria-label={`Remove ${label(key)} filter`}>
        {label(key)}: {Array.isArray(value) ? value.map((item) => label(item.toLowerCase())).join(", ") : label(value)}<X className="h-3 w-3" aria-hidden="true" />
      </button>)}
      <button type="button" onClick={() => onApply({})} className="px-1 text-xs font-medium text-[#687182] hover:text-[#172033]">Clear filters</button>
    </div>}
    {open && createPortal(<form style={panelStyle} data-overlay-owner={panelId} ref={panel} id={panelId} role="dialog" aria-label="Filter records" onSubmit={(event) => { event.preventDefault(); onApply(compact(draft)); close(); }}
      className="z-[1000] flex min-h-0 flex-col overflow-y-auto rounded-2xl border border-[#e2e5eb] bg-white shadow-[0_12px_40px_-8px_rgba(23,32,51,0.2)]">
      <div className="flex shrink-0 items-start justify-between border-b border-[#eef0f4] px-5 py-4">
        <div><h3 className="text-sm font-semibold text-[#172033]">Filters & sorting</h3><p className="mt-1 text-xs text-[#7b8494]">Narrow the results and choose their order.</p></div>
        <button type="button" onClick={close} aria-label="Close filters" className="rounded-lg p-1.5 text-[#7b8494] hover:bg-[#f3f5f8]"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid min-h-0 grid-cols-1 gap-4 overflow-y-auto overscroll-contain p-5 sm:grid-cols-2">
        {fields.map((field) => {
          const value = draft[field] ?? "";
          const from = field.endsWith("_from");
          const to = field.endsWith("_to");
          const options = field === "audience" ? [{ value: "CANDIDATE", label: "Candidates" }, { value: "EMPLOYER", label: "Employers" }, { value: "COLLEGE", label: "Colleges" }] : field === "includeInactive" ? [{ value: "true", label: "Include inactive" }, { value: "false", label: "Active only" }] : field === "featured" ? [{ value: "true", label: "Featured" }, { value: "false", label: "Not featured" }] : field === "subscriber_type" ? [{ value: "USER", label: "User" }, { value: "TENANT", label: "Organisation" }] : null;
          if (field === "status") return <fieldset key={field} className="sm:col-span-2"><legend className="mb-2 text-xs font-medium text-[#344054]">Status</legend>
            <div className="flex flex-wrap gap-2">{STATUSES.map((status) => {
              const checked = Array.isArray(value) && value.includes(status);
              return <label key={status} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-xs ${checked ? "border-[#315c9f] bg-[#eef3fb] text-[#315c9f]" : "border-[#e2e5eb] text-[#687182]"}`}>
                <input type="checkbox" checked={checked} className="accent-[#315c9f]" onChange={() => set(field, checked ? (value as string[]).filter((item) => item !== status) : [...(Array.isArray(value) ? value : []), status])} />{label(status.toLowerCase())}
              </label>;
            })}</div></fieldset>;
          return <div key={field} className="flex min-w-0 flex-col gap-1.5"><label htmlFor={`${panelId}-${field}`} className="text-xs font-medium text-[#344054]">{label(field)}</label>
            {options ? <SelectDropdown id={`${panelId}-${field}`} ariaLabel={label(field)} value={String(value)} onChange={(next) => set(field, next)} options={[{ value: "", label: "All" }, ...options]} />
              : from || to ? <DatePicker id={`${panelId}-${field}`} ariaLabel={label(field)} value={String(value)} onChange={(next) => set(field, next)} className={inputClass}
                min={to ? String(draft[field.replace(/_to$/, "_from")] || "") : undefined} max={from ? String(draft[field.replace(/_from$/, "_to")] || "") : undefined} />
              : <input id={`${panelId}-${field}`} className={inputClass} type="text" value={String(value)} maxLength={100}
              pattern={field === "assigned_to" ? "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}" : undefined}
              onChange={(event) => set(field, event.target.value)} />}
          </div>;
        })}
        {config.sorts.length > 0 && <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-[#344054]">Sort by</span>
          <SelectDropdown ariaLabel="Sort by" value={draft.sort === config.sorts[0] ? "" : String(draft.sort || "")} onChange={(value) => set("sort", value)} options={[{ value: "", label: label(config.sorts[0]) }, ...config.sorts.slice(1).map((sort) => ({ value: sort, label: label(sort) }))]} />
          {kind === "leads" && draft.sort === "last_downloaded_at" && <p className="text-[11px] leading-4 text-[#8b94a5]">When the candidate last downloaded their built resume. Candidates who never downloaded one appear last.</p>}
        </div>}
        <div className="flex min-w-0 flex-col gap-1.5"><span className="text-xs font-medium text-[#344054]">Order</span>
          <SelectDropdown ariaLabel="Order" value={String(draft.order || "")} onChange={(value) => set("order", value)} options={[{ value: "", label: "Default" }, { value: "asc", label: "Ascending" }, { value: "desc", label: "Descending" }]} />
        </div>
        {fields.some((field) => field.endsWith("_from")) && <p className="text-[11px] leading-5 text-[#8b94a5] sm:col-span-2">Date ranges include both days in India Standard Time.</p>}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 rounded-b-2xl border-t border-[#eef0f4] bg-[#fafbfc] px-5 py-3.5">
        <button type="button" onClick={() => { setDraft({}); onApply({}); }} className="text-xs font-semibold text-[#687182] hover:text-[#172033]">Reset filters</button>
        <div className="flex items-center gap-2"><button type="button" onClick={close} className="h-9 rounded-lg border border-[#dfe2e8] bg-white px-3 text-xs font-semibold text-[#344054]">Cancel</button>
          <button type="submit" className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#172033] px-3 text-xs font-semibold text-white hover:bg-[#29344a]"><Check className="h-3.5 w-3.5" />Apply filters</button></div>
      </div>
    </form>, document.body)}
  </div>;
}
