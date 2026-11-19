export interface Faq {
  q: string;
  a: string;
}

/** Every answer describes what the product does today; nothing here is a promise. */
export const STUDENT_FAQ: Faq[] = [
  {
    q: "Does it cost anything to sign up or build a CV?",
    a: "No. Creating an account, uploading a CV, building one with our four professional templates and downloading it as a PDF are completely free. Scoring, applying to roles and using the job-search assistant are covered by a candidate plan — or by a college seat if your institution has linked you.",
  },
  {
    q: "What is the Readiness Profile and Band?",
    a: "Your Readiness Profile reflects your confirmed CV experience, skills, education and preparation on a three-digit scale. You always check and confirm what we read from your CV before any score is generated. Employers see one of four readiness bands — Entry, Developing, Solid or Strong — rather than your raw score.",
  },
  {
    q: "How often can I update and re-score my CV?",
    a: "You can upload, edit or build new CV drafts whenever you like. Confirming a fresh CV version for scoring is available once every 15 days, and completing the career course or voice interview sessions updates your readiness profile automatically.",
  },
  {
    q: "How do voice mock interviews work?",
    a: "Each mock interview asks spoken questions tailored to your confirmed CV in your chosen language. You record your answers by voice, receive structured feedback on each answer (Strong, Developing, or Focus Area) without any penalty for accent or speaking speed, and completed sessions strengthen your readiness profile.",
  },
  {
    q: "Who can see my phone number, email and CV?",
    a: "Never the public search results. Employers see your name, skills, city, experience and readiness band on a search card. Your phone, email and full CV are shown only when a verified employer opens your profile — and you can see which organisations opened your profile over the last 90 days.",
  },
  {
    q: "Which languages does BharatPath support?",
    a: "English, Hindi, Bengali, Kannada, Marathi and Punjabi throughout the entire experience, with Gujarati, Tamil and Telugu supported on core screens.",
  },
  {
    q: "Do I need a college to join, and how does college sharing work?",
    a: "Anyone looking for work can sign up independently. If your college uses BharatPath, linking with its referral code or invitation gives you access to a college seat and counts you in anonymised batch statistics. Your college sees you by name only if you separately turn on individual sharing.",
  },
  {
    q: "Can I download or delete my account data?",
    a: "Yes. From your privacy settings you can request a complete export archive of your account data or request full account deletion with a 24-hour cooling-off window.",
  },
];

export const EMPLOYER_FAQ: Faq[] = [
  {
    q: "Is BharatPath only for large companies?",
    a: "No. It is built as much for a twelve-person workshop in Rajkot as for a multi-state retail or hospital chain. Most hiring in India happens in MSMEs, and posting a role or searching candidates takes the same few minutes whatever your size.",
  },
  {
    q: "What do I need to get started?",
    a: "A business email, your organisation's details and an active subscription plan. You can set up your organisation profile, invite team members and complete KYB verification before paying; job publishing, candidate search and profile opens activate with your plan.",
  },
  {
    q: "How do masked search and profile opens work?",
    a: "Search cards show a candidate's name, confirmed skills, city, experience and readiness band (Entry, Developing, Solid, Strong). Opening a full profile reveals their phone number, email, display score and confirmed CV within hourly and daily fairness limits.",
  },
  {
    q: "What is a Shortlist Invitation?",
    a: "Once you open a candidate's profile from search, you can save them to your shortlist and send an invitation for a specific role. When the candidate accepts, their application is created and moved straight to Shortlisted on your board.",
  },
  {
    q: "How does BharatPath prevent fake or keyword-stuffed CVs?",
    a: "Candidates must review and confirm extracted facts before scoring, and automated integrity checks scan uploads for hidden white-on-white text and prompt manipulation — suppressing flagged profiles for human review before they ever reach employer search.",
  },
  {
    q: "Can my whole hiring team collaborate?",
    a: "Yes. The organisation owner can invite recruiters (who post roles, search candidates, send messages and move applicants) and viewers (who have read-only access to jobs and pipelines).",
  },
  {
    q: "Can I bulk-export the candidate database to a CSV?",
    a: "No. There is no bulk download or spreadsheet export. Candidates keep their profiles active on BharatPath because they know their phone numbers and emails are not traded in spreadsheets.",
  },
];

export const COLLEGE_FAQ: Faq[] = [
  {
    q: "How do students join through our college?",
    a: "Share your college's unique referral code in class or on your notice board, or upload a student roster CSV to send invitations. Students link from their own accounts in seconds.",
  },
  {
    q: "What are college seats and what do they cover?",
    a: "Your college plan includes a seat allowance for the subscription period. Every linked student assigned to one of your active seats gets full candidate access — CV confirmation, readiness scoring, job applications and assistant search — without paying for an individual plan.",
  },
  {
    q: "What happens if more students link than our current seat allowance?",
    a: "Students up to your seat allowance are seated automatically. Additional students can still link to your college roster and free tools; your institution can increase its seat allocation to cover more students.",
  },
  {
    q: "What can our placement desk see about our students?",
    a: "We use a strict two-stage consent model. Linking via referral code or invitation grants Stage 1 (Roster) consent: the student is counted in your aggregate cohort funnel (linked, applied, shortlisted, interviewed, hired). Stage 2 (Individual) visibility — seeing a student by name, CV, readiness band and employer offers — happens when the student opts in to share with your college.",
  },
  {
    q: "How are small cohorts handled in analytics?",
    a: "To protect student privacy, cohorts with fewer than ten linked students display overall counts only so no metric singles out one person. For cohorts of ten or more, full stage figures and distributions are shown.",
  },
  {
    q: "Can a student revoke sharing later?",
    a: "Yes. A student can turn off individual name-sharing at any time while keeping their roster link, or revoke their college link entirely from their settings.",
  },
];

export const GENERAL_FAQ: Faq[] = [
  STUDENT_FAQ[0],
  STUDENT_FAQ[1],
  STUDENT_FAQ[4],
  EMPLOYER_FAQ[0],
  EMPLOYER_FAQ[2],
  COLLEGE_FAQ[0],
  COLLEGE_FAQ[1],
  COLLEGE_FAQ[3],
];
