/**
 * A college's placement view for one cohort. Figures are an example and add
 * up: every stage is a subset of the one before. One hue, no ramp.
 */
const ROWS = [
  { label: "Linked students", value: 214 },
  { label: "Applied to a role", value: 162 },
  { label: "Shortlisted", value: 71 },
  { label: "Interviewed", value: 44 },
  { label: "Hired", value: 23 },
];

export function CohortPanel() {
  const max = ROWS[0].value;
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[8px] bg-paper p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">B.Com and BBA, final year</p>
          <p className="text-[13px] text-muted">Placement season 2026–27</p>
        </div>
        <span className="rounded-[4px] bg-surface px-2 py-0.5 text-[13px]">Example</span>
      </div>
      <dl className="mt-5 space-y-3">
        {ROWS.map((r) => (
          <div key={r.label}>
            <div className="flex justify-between text-[13px]">
              <dt className="text-muted">{r.label}</dt>
              <dd className="tabular font-medium">{r.value}</dd>
            </div>
            <div className="mt-1 h-2 rounded-full bg-surface" aria-hidden="true">
              <div className="h-2 rounded-full bg-navy" style={{ width: `${(r.value / max) * 100}%` }} />
            </div>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-line pt-3 text-[13px] text-muted">
        Students are named only when they choose to share with you.
      </p>
    </div>
  );
}
