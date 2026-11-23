import { Check, Flame, MessageSquare, Mic, Plus, ShieldCheck, Sparkles, Users } from "lucide-react";

export function InterviewFragment() {
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-muted">Practice interview · question 3 of 6</p>
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
      <p className="mt-3 text-[13px] text-muted">Completed sessions strengthen your readiness profile and unlock structured feedback on every answer.</p>
    </div>
  );
}

export function ReadinessProfileFragment() {
  const bands = ["Entry", "Developing", "Solid", "Strong"] as const;
  const pillars = [
    { label: "Confirmed CV", status: "Confirmed" },
    { label: "Career readiness course", status: "Completed" },
    { label: "Voice interview practice", status: "2 sessions completed" },
  ];
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[13px] font-medium text-muted">Your readiness profile</p>
          <p className="mt-0.5 text-[18px] font-bold tracking-[-0.02em]">Single-hue band view</p>
        </div>
        <span className="rounded-full bg-lavender px-3 py-1 text-[13px] font-semibold text-purple-deep">Solid band</span>
      </div>

      <div className="mt-4 rounded-2xl bg-sand p-3.5">
        <div className="flex justify-between text-[13px]">
          <span className="text-muted">What employers see on search</span>
          <span className="font-semibold text-ink">Solid</span>
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
          {bands.map((b, i) => (
            <span key={b} className={`h-2 rounded-full ${i === 2 ? "bg-purple" : "bg-paper"}`} />
          ))}
        </div>
        <div className="mt-1.5 flex justify-between text-[11px] text-muted">
          {bands.map((b, i) => (
            <span key={b} className={i === 2 ? "font-semibold text-purple-deep" : ""}>
              {b}
            </span>
          ))}
        </div>
      </div>

      <ul className="mt-4 space-y-2">
        {pillars.map((p) => (
          <li key={p.label} className="flex flex-wrap items-center justify-between gap-1 rounded-xl border border-line px-3 py-2 text-[13px]">
            <span className="flex items-center gap-2 font-medium text-ink">
              <Check className="h-4 w-4 shrink-0 text-green" aria-hidden="true" />
              {p.label}
            </span>
            <span className="text-muted">{p.status}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3.5 text-[12px] text-muted">
        Your exact Bharatpath Score stays private to you. Employers browse by readiness band and skills first.
      </p>
    </div>
  );
}

export function AssistantFragment() {
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-center justify-between border-b border-line pb-3">
        <span className="flex items-center gap-2 text-[14px] font-semibold">
          <Sparkles className="h-4 w-4 text-purple" aria-hidden="true" /> Job search assistant
        </span>
        <span className="rounded-full bg-sand px-2.5 py-0.5 text-[12px] text-muted">मराठी · हिन्दी · EN</span>
      </div>
      <div className="mt-3.5 space-y-2.5 text-[13px]">
        <div className="ml-auto max-w-[82%] rounded-2xl rounded-br-sm bg-purple px-3.5 py-2 text-white">
          Find quality inspector or CNC roles in Pune with day shift
        </div>
        <div className="max-w-[90%] rounded-2xl rounded-bl-sm bg-sand px-3.5 py-2.5 text-ink">
          <p className="font-medium">Found 3 open roles in Pune matching your skills:</p>
          <div className="mt-2 rounded-xl border border-line bg-paper p-2.5">
            <p className="text-[13px] font-semibold">Quality Inspector · Chakan MIDC</p>
            <p className="text-[12px] text-muted">Auto-components unit · ₹18,000–23,000/mo · Open to you</p>
          </div>
        </div>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <MessageSquare className="h-3.5 w-3.5 text-purple" aria-hidden="true" /> Suggests roles and checks eligibility; you confirm every application.
      </p>
    </div>
  );
}

export function StreakFragment() {
  const days = ["M", "T", "W", "T", "F", "S", "S"];
  return (
    <div data-ui className="w-full max-w-[420px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <Flame className="h-4 w-4 text-gold-ink" aria-hidden="true" /> Daily career streak
        </span>
        <span className="rounded-full bg-gold-soft px-2.5 py-1 text-[13px] font-semibold text-gold-ink">14 days active</span>
      </div>
      <div className="mt-4 grid grid-cols-7 gap-1.5 text-center text-[12px]">
        {days.map((d, i) => (
          <div key={i} className="rounded-xl bg-sand py-2">
            <p className="text-muted">{d}</p>
            <span className={`mx-auto mt-1.5 grid h-6 w-6 place-items-center rounded-full ${i < 6 ? "bg-purple text-white" : "border border-line bg-paper"}`}>
              {i < 6 && <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between rounded-xl bg-lavender px-3 py-2 text-[13px]">
        <span className="font-medium text-purple-deep">Next milestone: 30-day streak</span>
        <span className="font-semibold text-purple-deep">+10 streak pts</span>
      </div>
      <p className="mt-2.5 text-[12px] text-muted">Streak points track your daily consistency and stay separate from your Bharatpath Score.</p>
    </div>
  );
}

export function ShortlistInviteFragment() {
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[15px] font-semibold">Priya S. · Nagpur</p>
          <p className="text-[13px] text-muted">Profile opened · 2 years experience · Solid band</p>
        </div>
        <span className="rounded-full bg-green-soft px-2.5 py-1 text-[12px] font-semibold text-green">Verified CV</span>
      </div>
      <div className="mt-3.5 rounded-2xl bg-sand p-3 text-[13px]">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:justify-between">
          <span className="text-muted">Phone</span>
          <span className="tabular font-medium">+91 98230 •••••</span>
        </div>
        <div className="mt-2 flex flex-col gap-0.5 sm:mt-1.5 sm:flex-row sm:justify-between">
          <span className="text-muted">Confirmed skills</span>
          <span className="font-medium sm:text-right">Patient care, ICU, Marathi, Hindi</span>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <span className="rounded-full bg-purple px-3.5 py-2 text-[13px] font-semibold text-white">Invite to Shortlist</span>
        <span className="rounded-full border border-line px-3.5 py-2 text-[13px] font-medium text-body">Download CV PDF</span>
      </div>
      <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted">
        <ShieldCheck className="h-3.5 w-3.5 text-purple" aria-hidden="true" /> Every profile open is logged. Accepted invites move straight to Shortlisted.
      </p>
    </div>
  );
}

export function StudentSeatDetailFragment() {
  const items = [
    { k: "Student", v: "Ananya Deshmukh · B.Com Final Year" },
    { k: "Seat status", v: "Active college seat · Full platform access" },
    { k: "Readiness band", v: "Solid · CV confirmed & 2 mock interviews done" },
    { k: "Active applications", v: "3 applied · 1 interview scheduled (Ludhiana)" },
  ];
  return (
    <div data-ui className="w-full max-w-[440px] rounded-[20px] border border-line bg-paper shadow-card p-5 text-ink">
      <div className="flex items-center justify-between">
        <p className="text-[15px] font-semibold">Consented student view</p>
        <span className="rounded-full bg-green-soft px-2.5 py-1 text-[12px] font-semibold text-green">Sharing enabled</span>
      </div>
      <dl className="mt-3.5 divide-y divide-line">
        {items.map((it) => (
          <div key={it.k} className="py-2 text-[13px]">
            <dt className="text-muted">{it.k}</dt>
            <dd className="mt-0.5 font-medium text-ink">{it.v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-[12px] text-muted">
        Visible only because the student turned on individual sharing with your placement desk.
      </p>
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
    <div data-ui className="grid w-full max-w-[540px] gap-2 sm:grid-cols-3">
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
      <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl bg-sand px-3.5 py-3 sm:px-4">
        <span className="tabular text-[18px] font-semibold tracking-[0.12em] sm:text-[22px]">GCK-7Q4M</span>
        <span className="shrink-0 rounded-full bg-purple px-3.5 py-1.5 text-[13px] font-medium text-white">Copy</span>
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
