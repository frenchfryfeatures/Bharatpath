import { Check, Mic, Plus, Users } from "lucide-react";

export function InterviewFragment() {
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">Practice interview · question 3 of 5</p>
        <span className="rounded-full bg-sand px-2.5 py-1 text-[13px] font-medium text-body">हिन्दी</span>
      </div>
      <p className="mt-3 text-[16px] font-medium leading-snug">Tell me about a time a machine broke down during your shift. What did you do first?</p>
      <div className="mt-5 flex items-center gap-3 rounded-2xl bg-sand p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-purple text-white">
          <Mic className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="flex h-6 flex-1 items-center gap-[3px]" aria-hidden="true">
          {[6, 14, 9, 18, 12, 22, 8, 16, 11, 20, 7, 13, 17, 9, 15, 6, 12, 19, 10, 14].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-purple/70" style={{ height: `${h}px` }} />
          ))}
        </span>
        <span className="tabular text-[13px] text-muted">0:42</span>
      </div>
      <p className="mt-3 text-[13px] text-muted">Feedback after the session. Practice never changes your score.</p>
    </div>
  );
}

export function PostJobFragment() {
  return (
    <div data-ui className="w-full max-w-[460px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <p className="text-[15px] font-semibold">Post a role</p>
      <div className="mt-4 space-y-3">
        <div>
          <p className="text-[13px] text-muted">Job title</p>
          <p className="mt-1 rounded-2xl border border-line px-3 py-2 text-[14px]">Quality inspector</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-[13px] text-muted">City</p>
            <p className="mt-1 rounded-2xl border border-line px-3 py-2 text-[14px]">Rajkot</p>
          </div>
          <div>
            <p className="text-[13px] text-muted">Pay a month</p>
            <p className="tabular mt-1 rounded-2xl border border-line px-3 py-2 text-[14px]">₹16,000–22,000</p>
          </div>
        </div>
        <div>
          <p className="text-[13px] text-muted">Screening question</p>
          <p className="mt-1 rounded-2xl border border-purple px-3 py-2 text-[14px]">Have you used a vernier caliper at work?</p>
        </div>
        <p className="inline-flex items-center gap-1.5 text-[13px] font-medium text-purple">
          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add another question
        </p>
      </div>
    </div>
  );
}

export function PipelineFragment() {
  const cols = [
    { name: "Viewed", people: ["Arjun M.", "Fatima B."] },
    { name: "Shortlisted", people: ["Ravi K."] },
    { name: "Interview", people: ["Sneha P.", "Imran Q."] },
  ];
  return (
    <div data-ui className="grid w-full max-w-[540px] grid-cols-3 gap-2">
      {cols.map((c, ci) => (
        <div key={c.name} className="rounded-[20px] border border-line bg-paper shadow-card p-3 text-ink">
          <p className="flex justify-between text-[13px] font-semibold">
            {c.name} <span className="tabular font-normal text-muted">{c.people.length}</span>
          </p>
          <ul className="mt-2 space-y-1.5">
            {c.people.map((p, pi) => (
              <li key={p} className={`rounded-2xl px-2 py-2 text-[13px] ${ci === 1 && pi === 0 ? "bg-gold-soft" : "bg-sand"}`}>
                {p}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function TeamFragment() {
  const rows = [
    ["Meera Shah", "Owner"],
    ["Karan Patel", "Recruiter"],
    ["Divya Rao", "Viewer"],
  ];
  return (
    <div data-ui className="w-full max-w-[380px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <p className="flex items-center gap-2 text-[15px] font-semibold">
        <Users className="h-4 w-4" aria-hidden="true" /> Team
      </p>
      <ul className="mt-3 divide-y divide-line">
        {rows.map(([n, r]) => (
          <li key={n} className="flex items-center justify-between py-2.5 text-[14px]">
            {n}
            <span className="rounded-full bg-sand px-2.5 py-1 text-[13px] font-medium text-body">{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ReferralFragment() {
  return (
    <div data-ui className="w-full max-w-[400px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <p className="text-[15px] font-semibold">Invite students</p>
      <p className="text-[13px] text-muted">Share this code, or upload your roster.</p>
      <div className="mt-4 flex items-center justify-between rounded-2xl bg-sand px-4 py-3">
        <span className="tabular text-[22px] font-semibold tracking-[0.12em]">GCK-7Q4M</span>
        <span className="rounded-full bg-purple px-3.5 py-1.5 text-[13px] font-medium text-white">Copy</span>
      </div>
      <div className="mt-3 flex justify-between text-[13px]">
        <span className="text-muted">Seats in use</span>
        <span className="tabular font-medium">186 of 250</span>
      </div>
      <div className="mt-1.5 h-2 rounded-full bg-sand" aria-hidden="true">
        <div className="h-2 w-[74.4%] rounded-full bg-purple" />
      </div>
    </div>
  );
}

export function ConsentFragment() {
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <p className="text-[15px] font-semibold">Share with your college?</p>
      <p className="mt-1 text-[13px] text-muted">Government College of Commerce will see your name, contact, CV and application stages.</p>
      <div className="mt-4 space-y-2 text-[14px]">
        <p className="flex items-center gap-2">
          <Check className="h-4 w-4 text-green" aria-hidden="true" /> Counted in placement figures
        </p>
        <p className="flex items-center gap-2 text-muted">
          <span className="h-4 w-4 rounded-full border border-line" aria-hidden="true" /> Seen by name
        </p>
      </div>
      <div className="mt-4 flex gap-2">
        <span className="flex-1 rounded-full bg-purple py-2 text-center text-[14px] font-medium text-white">Share</span>
        <span className="flex-1 rounded-full bg-sand py-2 text-center text-[14px]">Not now</span>
      </div>
    </div>
  );
}
