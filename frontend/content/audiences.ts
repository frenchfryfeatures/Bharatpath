import type { Audience } from "@/lib/site";

export interface AudienceCopy {
  slug: Audience;
  /** Plural noun for menus: "Students". */
  name: string;
  /** How the person is addressed on their own sign-in page. */
  signInTitle: string;
  signInLead: string;
  signUpTitle: string;
  signUpLead: string;
  /** What they get, said plainly. Every line is something the product does today. */
  points: string[];
  landing: string;
  emailPlaceholder: string;
}

export const AUDIENCE_COPY: Record<Audience, AudienceCopy> = {
  student: {
    slug: "student",
    name: "Students and job seekers",
    signInTitle: "Sign in to find your next role",
    signInLead: "Pick up where you left off: your applications, your resume and the roles open to you.",
    signUpTitle: "Create your candidate account",
    signUpLead: "Sign up with your email. Upload a CV or build one with us, strengthen your readiness profile, and apply to roles across India.",
    points: [
      "Upload a CV or build one from four clean templates",
      "Confirm what we read before your readiness profile is scored",
      "Practise spoken interviews and search roles with your assistant",
      "See which organisations opened your profile in the last 90 days",
    ],
    landing: "/students/",
    emailPlaceholder: "you@example.com",
  },
  employer: {
    slug: "employer",
    name: "Employers and MSMEs",
    signInTitle: "Sign in to your hiring workspace",
    signInLead: "Your jobs, your applicants and your shortlist, right where your team left them.",
    signUpTitle: "Start hiring on BharatPath",
    signUpLead: "Create a business account, add your organisation, and post your first role.",
    points: [
      "Post roles with custom screening questions in minutes",
      "Search candidates by skill, city, experience and readiness band",
      "Open verified profiles or send direct Shortlist Invitations",
      "Move applicants to mutually confirmed hires with your team",
    ],
    landing: "/employers/",
    emailPlaceholder: "you@yourbusiness.in",
  },
  college: {
    slug: "college",
    name: "Colleges and institutions",
    signInTitle: "Sign in to your placement desk",
    signInLead: "Your student roster, referral codes and placement figures in one place.",
    signUpTitle: "Bring your college on board",
    signUpLead: "Create an institution account, set up your college and invite your students.",
    points: [
      "Invite students with a referral code or a roster CSV upload",
      "Cover linked students with seats from your institution plan",
      "Follow placement outcomes across your whole cohort",
      "View individual student CVs and offers when they choose to share",
    ],
    landing: "/colleges/",
    emailPlaceholder: "placements@yourcollege.edu.in",
  },
};
