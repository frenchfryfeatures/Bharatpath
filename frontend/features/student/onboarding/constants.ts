/*
 * Static content for the candidate sign-up flow. Anything that is a product
 * decision (locales, states) mirrors the backend's own list.
 */

export interface SignupLocale {
  code: "en" | "hi" | "bn" | "mr" | "pa" | "te" | "ta" | "gu" | "kn";
  native: string;
  english: string;
}

/**
 * The nine locales `notifications.LocaleCode` accepts. The first three are
 * shown up front as in the design; the rest sit behind "more languages".
 * The client's six priority locales (en, hi, bn, kn, mr, pa) come first.
 */
export const SIGNUP_LOCALES: readonly SignupLocale[] = [
  { code: "en", native: "English", english: "English" },
  { code: "hi", native: "हिंदी", english: "Hindi" },
  { code: "mr", native: "मराठी", english: "Marathi" },
  { code: "bn", native: "বাংলা", english: "Bengali" },
  { code: "kn", native: "ಕನ್ನಡ", english: "Kannada" },
  { code: "pa", native: "ਪੰਜਾਬੀ", english: "Punjabi" },
  { code: "gu", native: "ગુજરાતી", english: "Gujarati" },
  { code: "ta", native: "தமிழ்", english: "Tamil" },
  { code: "te", native: "తెలుగు", english: "Telugu" },
];

export const FEATURED_LOCALE_COUNT = 3;

/** `app/core/reference.py` INDIAN_STATES, the codes location accepts. */
export const INDIAN_STATES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "AN", name: "Andaman and Nicobar Islands" },
  { code: "AP", name: "Andhra Pradesh" },
  { code: "AR", name: "Arunachal Pradesh" },
  { code: "AS", name: "Assam" },
  { code: "BR", name: "Bihar" },
  { code: "CH", name: "Chandigarh" },
  { code: "CG", name: "Chhattisgarh" },
  { code: "DH", name: "Dadra and Nagar Haveli and Daman and Diu" },
  { code: "DL", name: "Delhi" },
  { code: "GA", name: "Goa" },
  { code: "GJ", name: "Gujarat" },
  { code: "HR", name: "Haryana" },
  { code: "HP", name: "Himachal Pradesh" },
  { code: "JK", name: "Jammu and Kashmir" },
  { code: "JH", name: "Jharkhand" },
  { code: "KA", name: "Karnataka" },
  { code: "KL", name: "Kerala" },
  { code: "LA", name: "Ladakh" },
  { code: "LD", name: "Lakshadweep" },
  { code: "MP", name: "Madhya Pradesh" },
  { code: "MH", name: "Maharashtra" },
  { code: "MN", name: "Manipur" },
  { code: "ML", name: "Meghalaya" },
  { code: "MZ", name: "Mizoram" },
  { code: "NL", name: "Nagaland" },
  { code: "OD", name: "Odisha" },
  { code: "PY", name: "Puducherry" },
  { code: "PB", name: "Punjab" },
  { code: "RJ", name: "Rajasthan" },
  { code: "SK", name: "Sikkim" },
  { code: "TN", name: "Tamil Nadu" },
  { code: "TS", name: "Telangana" },
  { code: "TR", name: "Tripura" },
  { code: "UP", name: "Uttar Pradesh" },
  { code: "UK", name: "Uttarakhand" },
  { code: "WB", name: "West Bengal" },
];

/** The rotating lines on the scoring screen, from the design. */
export const COMPUTE_STATUS = [
  "Reading your projects",
  "Measuring real impact",
  "Matching skills to roles",
  "Checking how it reads",
  "Comparing with peers",
] as const;

/** The five categories every resume is scored on. */
export const SCORE_CATEGORIES = [
  "Education",
  "Skills",
  "Experience",
  "Projects",
  "Presentation",
] as const;

/** Steps that carry the "STEP n OF N" header, in order. */
export const COUNTED_STEPS = [
  "account",
  "employment",
  "education",
  "preferences",
] as const;

export type CountedStep = (typeof COUNTED_STEPS)[number];

/** Parse failure codes (`parse_error_code`) the candidate can act on. */
export function parseFailureMessage(code: string | null): string {
  switch (code) {
    case "resume_document_encrypted":
      return "This file is password-protected. Save a copy without a password and upload that.";
    case "resume_legacy_doc_unsupported":
    case "upload_legacy_doc_unsupported":
      return "Old .doc files cannot be read. Save it as a PDF or .docx and try again.";
    case "resume_unsupported_document":
    case "upload_unsupported_type":
    case "upload_unrecognised_type":
      return "We can only read PDF and .docx files.";
    case "resume_unreadable_document":
      return "We could not read any text in this file. If it is a photo or scan, try pasting the text instead.";
    default:
      return "We could not read this file. Try another file, or paste the text instead.";
  }
}
