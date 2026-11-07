export interface Faq {
  q: string;
  a: string;
}

/** Every answer describes what the product does today; nothing here is a promise. */
export const STUDENT_FAQ: Faq[] = [
  { q: "Does it cost anything to sign up?", a: "No. Creating an account, uploading a CV and building one with our templates are free. Scoring, applying and the paid add-ons are part of a plan you choose inside the app, and if your college has linked you to BharatPath you may already be covered." },
  { q: "What is the resume score?", a: "A number worked out from what your CV actually shows: your experience, skills, education and projects. You confirm what we read from your CV before anything is scored, so a parsing mistake never becomes your number. Employers see a band, not the number itself." },
  { q: "Who can see my phone number and email?", a: "Not the search results. Employers see your name, skills, city, experience and band on a search card. Your contact details and your CV are shown only when an employer opens your full profile, and every open is recorded. You can see which organisations opened your profile in the last 90 days." },
  { q: "Which languages does the app speak?", a: "English, Hindi, Bengali, Kannada, Marathi and Punjabi throughout, with Gujarati, Tamil and Telugu for the core screens." },
  { q: "Do I need a college to join?", a: "No. Anyone looking for work can sign up on their own. Linking to your college is optional and is always your choice." },
];

export const EMPLOYER_FAQ: Faq[] = [
  { q: "Is BharatPath only for large companies?", a: "No. It is built as much for a twelve-person workshop as for a national chain. Most of the hiring in India happens in MSMEs, and posting a role or searching candidates takes the same few minutes whatever your size." },
  { q: "What do I need to start?", a: "A business email, your organisation's details and an active plan. You can set up your organisation and team before paying; posting, searching and opening profiles start once your plan is active." },
  { q: "How do I see a candidate's contact details?", a: "Search cards show name, skills, city, experience and band. Opening a full profile shows the phone, email and CV. Every open is logged and there are daily and hourly limits, which keeps candidates willing to be found." },
  { q: "Can my whole team use it?", a: "Yes. The owner can add recruiters, who post roles and move applicants, and viewers, who can only look." },
  { q: "Can I export the candidate list?", a: "No. There is no bulk download or export. Candidates trust the platform because their details are not passed around in spreadsheets." },
];

export const COLLEGE_FAQ: Faq[] = [
  { q: "How do students join through our college?", a: "Share a referral code, or upload a roster and send invitations. A student links to your college only when they accept, from their own account." },
  { q: "What can we see about our students?", a: "Linked students are counted in your placement figures. You see an individual student by name only after that student turns on sharing with your college, and they can turn it off at any time." },
  { q: "What are seats?", a: "Your college plan comes with seats. A linked student on one of your seats gets full access to BharatPath without paying for their own plan." },
  { q: "Do small cohorts show up in the analytics?", a: "Below ten students you see counts only, so no figure points to one person. Above that, numbers are shown exactly." },
];

export const GENERAL_FAQ: Faq[] = [...STUDENT_FAQ.slice(0, 3), EMPLOYER_FAQ[0], EMPLOYER_FAQ[2], COLLEGE_FAQ[0], COLLEGE_FAQ[1]];
