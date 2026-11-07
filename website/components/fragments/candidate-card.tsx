import { Lock, MapPin } from "lucide-react";

const BANDS = ["Entry", "Developing", "Solid", "Strong"] as const;

/**
 * An employer's search card. It carries the band, never the number, and no
 * contact: those cost a profile open (masked search, Day 13 / Day 14).
 * The band is a position on a neutral, single-hue track -- never a gauge.
 */
export function CandidateCard({ band = 2 }: { band?: number }) {
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">Priya S.</p>
          <p className="mt-0.5 flex items-center gap-1 text-[13px] text-muted">
            <MapPin className="h-3.5 w-3.5" aria-hidden="true" /> Nagpur · 2 years experience
          </p>
        </div>
        <span className="rounded-full bg-sand px-2.5 py-1 text-[13px] font-medium text-body">Example</span>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-[13px] text-muted">
          <span>Band</span>
          <span className="font-medium text-ink">{BANDS[band]}</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1" aria-hidden="true">
          {BANDS.map((b, i) => (
            <span key={b} className={`h-1.5 rounded-full ${i === band ? "bg-purple" : "bg-sand"}`} />
          ))}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5">
        {["Patient care", "ICU", "Marathi", "Hindi"].map((s) => (
          <span key={s} className="rounded-full bg-sand px-2.5 py-1 text-[13px] font-medium text-body">
            {s}
          </span>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-line pt-4">
        <span className="flex items-center gap-1.5 text-[13px] text-muted">
          <Lock className="h-3.5 w-3.5" aria-hidden="true" /> Phone, email and CV on open
        </span>
        <span className="rounded-full bg-purple px-3.5 py-1.5 text-[13px] font-medium text-white">Open profile</span>
      </div>
    </div>
  );
}
