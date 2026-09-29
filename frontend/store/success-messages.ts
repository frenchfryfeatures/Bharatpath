/*
 * The success popup's words, one entry per RTK Query mutation.
 *
 * `null` means the mutation never shows a popup of its own: either it is one
 * step of a larger action whose caller announces the whole thing (resume
 * upload tickets, the create-then-publish job flow), or its page already shows
 * a message with more context than the arguments carry (admin decisions,
 * employer company/member removal, the import count). A mutation missing
 * from this map shows nothing, so a new endpoint must be added here.
 */
export type SuccessMessage = string | null | ((args: unknown) => string | null);

export function argField(args: unknown, key: string): unknown {
  return args && typeof args === "object" && key in args
    ? (args as Record<string, unknown>)[key]
    : undefined;
}

const APPLICATION_STAGE_MESSAGES: Record<string, string> = {
  VIEWED: "Application marked as viewed.",
  SHORTLISTED: "Candidate shortlisted.",
  INTERVIEW: "Application moved to Interview.",
  DECISION: "Application moved to Decision.",
  REJECTED: "Application rejected.",
};

const COLLEGE_ROLE_LABELS: Record<string, string> = {
  COLLEGE_ADMIN: "Admin",
  COLLEGE_STAFF: "Staff",
};

function notificationPreferenceMessage(args: unknown): string {
  const labels: Array<[string, string]> = [
    ["push_enabled", "Push notifications"],
    ["email_enabled", "Email notifications"],
    ["sms_enabled", "SMS notifications"],
    ["nudges_enabled", "Reminders"],
  ];
  const changed = labels.filter(
    ([key]) => typeof argField(args, key) === "boolean",
  );

  if (changed.length === 1) {
    const [key, label] = changed[0];
    return `${label} turned ${argField(args, key) ? "on" : "off"}.`;
  }
  return "Notification preferences updated.";
}

export const SUCCESS_MESSAGES: Record<string, SuccessMessage> = {
  /* Admin — each page reports the decision it made. */
  createAdminSearchFilter: null,
  importAdminSearchFilters: null,
  updateAdminSearchFilter: null,
  decideAdminKyb: null,
  resolveAdminIntegritySignal: null,
  suspendAdminTenant: null,
  reinstateAdminTenant: null,
  allocateAdminCollegeSeats: null,
  assignAdminDispute: null,
  resolveAdminDispute: null,
  suppressAdminNotifications: "Notifications suppressed for this user.",

  /* Notifications — reading is not an action worth announcing. */
  markNotificationRead: null,
  updateNotificationPreferences: notificationPreferenceMessage,

  /* College billing */
  createCollegeCheckout: "Redirecting you to payment…",
  cancelCollegeSubscription: "Subscription cancelled.",
  createCollegeMandate: "Redirecting you to set up UPI AutoPay…",

  /* College settings */
  updateCollegeOrganisation: "College profile saved.",
  addCollegeTeamMember: "User added.",
  changeCollegeTeamMemberRole: (args) => {
    const role = COLLEGE_ROLE_LABELS[String(argField(args, "role"))];
    return role ? `Role changed to ${role}.` : "Role updated.";
  },
  removeCollegeTeamMember: "User removed.",
  saveCollegeOnboarding: "Onboarding draft saved.",
  submitCollegeOnboarding: "Onboarding submitted for review.",

  /* College students */
  issueReferralCode: "Referral code issued.",
  revokeReferralCode: "Referral code revoked.",
  uploadRosterImport: "Roster uploaded. Review the preview before committing.",
  commitRosterImport: "Roster committed.",
  discardRosterImport: "Roster import discarded.",
  sendRosterInvitations: "Invitations sent.",

  /* Employer applications */
  moveEmployerApplication: (args) =>
    APPLICATION_STAGE_MESSAGES[String(argField(args, "stage"))] ??
    "Application updated.",
  proposeEmployerHire:
    "Hire confirmed from your side. Waiting for the candidate.",
  scheduleEmployerInterview: "Interview scheduled.",

  /* Employer billing */
  checkoutEmployerSubscription: "Redirecting you to payment…",
  cancelEmployerSubscription:
    "Renewal cancelled. Access continues until the period ends.",
  createEmployerMandate: "Redirecting you to set up UPI AutoPay…",

  /* Employer jobs — the job form announces draft and publish itself. */
  createEmployerJob: null,
  updateEmployerJob: null,
  publishEmployerJob: null,
  pauseEmployerJob: "Job paused.",
  closeEmployerJob: "Job closed.",

  /* Employer KYB */
  saveEmployerKybAnswers: "Progress saved.",
  createEmployerKybDocumentTicket: null,
  uploadEmployerKybDocument: null,
  completeEmployerKybDocument: "Document uploaded.",
  submitEmployerKyb: "Business verification submitted for review.",

  /* Employer settings — company save and member removal toast from the slice. */
  createEmployerOrganisation: "Organisation created.",
  addEmployerTeamMember: "Invite sent.",
  updateEmployerTeamMember: (args) => {
    const role = argField(args, "role");
    return typeof role === "string"
      ? `Role changed to ${role}.`
      : "Role updated.";
  },
  removeEmployerTeamMember: null,
  updateEmployerOrganisation: null,

  /* Candidate resume — ticket and byte upload are steps of one upload. */
  createResumeUpload: null,
  uploadResumeFile: null,
  completeResumeUpload: "Resume uploaded. We're reading it now.",
  submitResumeText: "Resume text submitted.",
  submitManualResume: "Resume details saved.",
  editResumeVersion: "Resume changes saved.",
  confirmResumeVersion: "Resume confirmed.",

  /* Candidate — name and location are saved together; callers announce them. */
  updateStudentName: null,
  updateStudentLocation: null,
  checkInStudentStreak: null,
  applyToStudentJob: "Application submitted.",
  withdrawStudentApplication: "Application withdrawn.",
  confirmStudentHire: "Hire confirmed.",
  disputeStudentHire: "Hire disputed. Our team will review it.",
  saveQuestionnaireAnswers: "Answers saved.",
  submitQuestionnaire: "Attribute check submitted.",
};
