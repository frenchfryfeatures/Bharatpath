import { Eye, Lock } from "lucide-react";

export function MaskedContactDemo() {
  return (
    <div data-ui className="w-full rounded-2xl bg-paper p-3">
      <p className="text-[14px] font-semibold">Ravi K. · Pune</p>
      <div className="mt-2 flex flex-wrap gap-1.5 text-[13px]">
        <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 text-muted">
          <Lock className="h-3 w-3" aria-hidden="true" /> +91 ••••• •••••
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 text-muted">
          <Lock className="h-3 w-3" aria-hidden="true" /> ••••@••••.com
        </span>
      </div>
    </div>
  );
}

export function ViewedByDemo() {
  const rows = [
    ["Multi-speciality hospital", "2 days ago"],
    ["Healthcare diagnostics network", "5 days ago"],
  ];
  return (
    <ul data-ui className="w-full space-y-1.5">
      {rows.map(([org, when]) => (
        <li key={org} className="flex items-center justify-between gap-3 rounded-2xl bg-paper px-3 py-2 text-[13px]">
          <span className="flex min-w-0 items-center gap-2">
            <Eye className="h-3.5 w-3.5 shrink-0 text-purple" aria-hidden="true" />
            <span className="truncate">{org}</span>
          </span>
          <span className="shrink-0 text-muted">{when}</span>
        </li>
      ))}
    </ul>
  );
}

export function LanguagesDemo() {
  const langs = ["English", "हिन्दी", "বাংলা", "ಕನ್ನಡ", "मराठी", "ਪੰਜਾਬੀ", "ગુજરાતી", "தமிழ்", "తెలుగు"];
  return (
    <div data-ui className="flex flex-wrap gap-1.5" lang="mul">
      {langs.map((l, i) => (
        <span key={l} className={`rounded-full px-2 py-1 text-[14px] ${i === 1 ? "bg-purple text-white" : "bg-paper"}`}>
          {l}
        </span>
      ))}
    </div>
  );
}

export function BandDemo() {
  const bands = ["Entry", "Developing", "Solid", "Strong"];
  return (
    <div data-ui className="w-full rounded-2xl bg-paper p-3">
      <div className="flex justify-between text-[13px]">
        <span className="text-muted">What an employer sees</span>
        <span className="font-medium">Developing</span>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
        {bands.map((b, i) => (
          <span key={b} className={`h-1.5 rounded-full ${i === 1 ? "bg-purple" : "bg-sand"}`} />
        ))}
      </div>
    </div>
  );
}

export function NoExportDemo() {
  return (
    <div data-ui className="w-full rounded-2xl bg-paper p-3 text-[13px]">
      <div className="flex items-center justify-between">
        <span className="font-medium">Search results</span>
        <span className="rounded-full bg-sand px-2 py-0.5 text-muted line-through decoration-muted">Export CSV</span>
      </div>
      <p className="mt-2 text-muted">Opened today: 12 profiles · each one recorded</p>
    </div>
  );
}
