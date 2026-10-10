/** "CANDIDATE_MONTHLY" -> "Candidate monthly": a backend code made readable. */
export function humanizeCode(code: string | null | undefined): string {
  if (!code) return "";
  const text = code.replace(/[_-]+/g, " ").replace(/([a-z])(\d+)/g, "$1 $2").trim().toLowerCase()
    .replace(/\b(it|bpo|kpo|ngo|mnc|pan|gstin|cin|llpin|tan|kyb|upi|pin)\b/g, (word) => word.toUpperCase());
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const FIELD_LABELS: Record<string, string> = {
  legal_name: "Registered organisation name",
  employer_type: "Organisation type",
  signatory_name: "Authorised person's name",
  signatory_designation: "Designation",
  work_email: "Official work email",
  work_phone: "Contact number",
  pincode: "PIN code",
  cin: "CIN / LLPIN",
  undertaking_authorised: "Authorised to act for the organisation",
  undertaking_genuine_hiring: "Hiring for genuine jobs",
  undertaking_no_redistribution: "Candidate details will not be redistributed",
  doc_pan: "PAN card",
  doc_gst: "GST certificate",
  doc_registration: "Registration certificate",
  doc_authorisation: "Authorisation letter",
};

/** Display field codes without changing their API keys. */
export function fieldLabel(code: string): string {
  return FIELD_LABELS[code] ?? humanizeCode(code);
}

/** Only use for coded choices, never names, identifiers or other free text. */
export function choiceLabel(value: string): string {
  return /^[A-Z][A-Z0-9_]*$/.test(value) ? humanizeCode(value) : value;
}
