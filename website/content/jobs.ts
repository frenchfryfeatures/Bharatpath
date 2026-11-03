/**
 * EXAMPLE roles for the public job board preview.
 *
 * These are not live vacancies and the website says so on every page that
 * shows them. The live board is inside the app, behind a candidate account
 * (the API has no public jobs endpoint). Organisations are described, never
 * named, so nothing here can be mistaken for a real employer's listing.
 *
 * No role carries an age or a gender field, and no filter offers one
 * (invariant 5 / C3 in docs/plan.md).
 */

export type WorkMode = "On-site" | "Hybrid" | "Remote";
export type JobType = "Full-time" | "Internship" | "Part-time" | "Contract" | "Apprenticeship";
export type Experience = "Fresher" | "1–3 years" | "3–5 years" | "5+ years";
export type OrgSize = "MSME" | "Startup" | "Large enterprise" | "Non-profit";

export interface ExampleJob {
  id: string;
  title: string;
  organisation: string;
  orgSize: OrgSize;
  industry: string;
  city: string;
  state: string;
  mode: WorkMode;
  type: JobType;
  experience: Experience;
  /** Monthly, in rupees. */
  payFrom: number;
  payTo: number;
  skills: string[];
  postedDaysAgo: number;
}

export const EXAMPLE_JOBS: ExampleJob[] = [
  { id: "cnc-operator-pune", title: "CNC machine operator", organisation: "Precision auto-parts maker", orgSize: "MSME", industry: "Manufacturing", city: "Pune", state: "Maharashtra", mode: "On-site", type: "Full-time", experience: "1–3 years", payFrom: 18000, payTo: 26000, skills: ["CNC", "Fanuc", "Measuring tools"], postedDaysAgo: 1 },
  { id: "accounts-assistant-ludhiana", title: "Accounts assistant", organisation: "Textile exporter", orgSize: "MSME", industry: "Textiles", city: "Ludhiana", state: "Punjab", mode: "On-site", type: "Full-time", experience: "Fresher", payFrom: 15000, payTo: 20000, skills: ["Tally", "GST filing", "Excel"], postedDaysAgo: 2 },
  { id: "frontend-intern-bengaluru", title: "Front-end developer intern", organisation: "Agritech startup", orgSize: "Startup", industry: "Technology", city: "Bengaluru", state: "Karnataka", mode: "Hybrid", type: "Internship", experience: "Fresher", payFrom: 15000, payTo: 25000, skills: ["React", "TypeScript", "CSS"], postedDaysAgo: 0 },
  { id: "store-supervisor-kolkata", title: "Store supervisor", organisation: "Regional grocery chain", orgSize: "Large enterprise", industry: "Retail", city: "Kolkata", state: "West Bengal", mode: "On-site", type: "Full-time", experience: "3–5 years", payFrom: 25000, payTo: 32000, skills: ["Inventory", "Team handling", "Bengali"], postedDaysAgo: 3 },
  { id: "field-sales-indore", title: "Field sales executive", organisation: "Solar equipment distributor", orgSize: "MSME", industry: "Energy", city: "Indore", state: "Madhya Pradesh", mode: "On-site", type: "Full-time", experience: "1–3 years", payFrom: 20000, payTo: 28000, skills: ["B2B sales", "Hindi", "Two-wheeler"], postedDaysAgo: 4 },
  { id: "data-analyst-hyderabad", title: "Data analyst", organisation: "Healthcare diagnostics network", orgSize: "Large enterprise", industry: "Healthcare", city: "Hyderabad", state: "Telangana", mode: "Hybrid", type: "Full-time", experience: "1–3 years", payFrom: 45000, payTo: 65000, skills: ["SQL", "Power BI", "Python"], postedDaysAgo: 2 },
  { id: "staff-nurse-nagpur", title: "Staff nurse", organisation: "Multi-speciality hospital", orgSize: "Large enterprise", industry: "Healthcare", city: "Nagpur", state: "Maharashtra", mode: "On-site", type: "Full-time", experience: "Fresher", payFrom: 22000, payTo: 30000, skills: ["GNM / B.Sc Nursing", "Patient care", "Marathi"], postedDaysAgo: 5 },
  { id: "content-writer-remote", title: "Content writer, Hindi and English", organisation: "Edtech publisher", orgSize: "Startup", industry: "Education", city: "Noida", state: "Uttar Pradesh", mode: "Remote", type: "Part-time", experience: "Fresher", payFrom: 12000, payTo: 18000, skills: ["Hindi", "English", "SEO basics"], postedDaysAgo: 1 },
  { id: "electrician-apprentice-coimbatore", title: "Electrician apprentice", organisation: "Pump and motor manufacturer", orgSize: "MSME", industry: "Manufacturing", city: "Coimbatore", state: "Tamil Nadu", mode: "On-site", type: "Apprenticeship", experience: "Fresher", payFrom: 10000, payTo: 14000, skills: ["ITI Electrician", "Wiring", "Safety"], postedDaysAgo: 6 },
  { id: "warehouse-lead-gurugram", title: "Warehouse shift lead", organisation: "Third-party logistics firm", orgSize: "Large enterprise", industry: "Logistics", city: "Gurugram", state: "Haryana", mode: "On-site", type: "Full-time", experience: "3–5 years", payFrom: 28000, payTo: 36000, skills: ["WMS", "Shift planning", "Forklift safety"], postedDaysAgo: 3 },
  { id: "backend-engineer-remote", title: "Backend engineer", organisation: "Logistics software startup", orgSize: "Startup", industry: "Technology", city: "Chennai", state: "Tamil Nadu", mode: "Remote", type: "Full-time", experience: "3–5 years", payFrom: 90000, payTo: 140000, skills: ["Python", "PostgreSQL", "AWS"], postedDaysAgo: 2 },
  { id: "quality-inspector-rajkot", title: "Quality inspector", organisation: "Brass components workshop", orgSize: "MSME", industry: "Manufacturing", city: "Rajkot", state: "Gujarat", mode: "On-site", type: "Full-time", experience: "1–3 years", payFrom: 16000, payTo: 22000, skills: ["Vernier", "ISO 9001", "Gujarati"], postedDaysAgo: 7 },
  { id: "customer-support-mysuru", title: "Customer support associate, Kannada", organisation: "Consumer electronics service centre", orgSize: "MSME", industry: "Services", city: "Mysuru", state: "Karnataka", mode: "On-site", type: "Full-time", experience: "Fresher", payFrom: 14000, payTo: 19000, skills: ["Kannada", "English", "CRM"], postedDaysAgo: 1 },
  { id: "programme-associate-bhubaneswar", title: "Programme associate", organisation: "Livelihoods non-profit", orgSize: "Non-profit", industry: "Social sector", city: "Bhubaneswar", state: "Odisha", mode: "Hybrid", type: "Contract", experience: "1–3 years", payFrom: 25000, payTo: 32000, skills: ["Odia", "Field research", "Excel"], postedDaysAgo: 4 },
  { id: "graphic-designer-jaipur", title: "Graphic designer", organisation: "Handicrafts e-commerce brand", orgSize: "MSME", industry: "E-commerce", city: "Jaipur", state: "Rajasthan", mode: "Hybrid", type: "Full-time", experience: "1–3 years", payFrom: 22000, payTo: 30000, skills: ["Figma", "Photoshop", "Product photos"], postedDaysAgo: 2 },
  { id: "hr-intern-kochi", title: "HR intern", organisation: "Seafood processing unit", orgSize: "MSME", industry: "Food processing", city: "Kochi", state: "Kerala", mode: "On-site", type: "Internship", experience: "Fresher", payFrom: 8000, payTo: 12000, skills: ["Recruitment basics", "Malayalam", "Excel"], postedDaysAgo: 0 },
  { id: "site-engineer-lucknow", title: "Civil site engineer", organisation: "Residential construction firm", orgSize: "MSME", industry: "Construction", city: "Lucknow", state: "Uttar Pradesh", mode: "On-site", type: "Full-time", experience: "3–5 years", payFrom: 35000, payTo: 45000, skills: ["AutoCAD", "Site supervision", "BOQ"], postedDaysAgo: 5 },
  { id: "operations-manager-ahmedabad", title: "Operations manager", organisation: "Dairy cooperative supplier", orgSize: "MSME", industry: "Food processing", city: "Ahmedabad", state: "Gujarat", mode: "On-site", type: "Full-time", experience: "5+ years", payFrom: 60000, payTo: 85000, skills: ["Cold chain", "Vendor management", "SAP"], postedDaysAgo: 3 },
  { id: "teacher-math-patna", title: "Mathematics teacher, classes 9–12", organisation: "CBSE school group", orgSize: "Large enterprise", industry: "Education", city: "Patna", state: "Bihar", mode: "On-site", type: "Full-time", experience: "1–3 years", payFrom: 25000, payTo: 35000, skills: ["B.Ed", "Mathematics", "Hindi"], postedDaysAgo: 6 },
  { id: "digital-marketing-remote", title: "Digital marketing executive", organisation: "Ayurvedic wellness brand", orgSize: "Startup", industry: "Consumer goods", city: "Dehradun", state: "Uttarakhand", mode: "Remote", type: "Full-time", experience: "1–3 years", payFrom: 25000, payTo: 38000, skills: ["Meta ads", "Google Ads", "Analytics"], postedDaysAgo: 1 },
];

export const WORK_MODES: WorkMode[] = ["On-site", "Hybrid", "Remote"];
export const JOB_TYPES: JobType[] = ["Full-time", "Internship", "Part-time", "Contract", "Apprenticeship"];
export const EXPERIENCE_LEVELS: Experience[] = ["Fresher", "1–3 years", "3–5 years", "5+ years"];
export const ORG_SIZES: OrgSize[] = ["MSME", "Startup", "Large enterprise", "Non-profit"];

export const formatPay = (from: number, to: number) => {
  const k = (n: number) => (n >= 100000 ? `${(n / 100000).toFixed(n % 100000 ? 1 : 0)}L` : `${Math.round(n / 1000)}k`);
  return `₹${k(from)}–${k(to)} a month`;
};

export const postedLabel = (days: number) =>
  days === 0 ? "Posted today" : days === 1 ? "Posted yesterday" : `Posted ${days} days ago`;
