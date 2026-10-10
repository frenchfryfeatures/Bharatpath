/**
 * BharatPath - JobDetailScreen
 *
 * Implements S18 (Job detail) from `docs/screen-flows.md`, wired to the real
 * backend `GET /candidate/jobs/{id}` and `POST /candidate/applications`.
 *
 * ONE state-driven screen keyed on `eligibility` + `alreadyApplied`. The top
 * panel and bottom CTA vary by eligibility; everything else is shared.
 *
 * Key rules enforced here (R11 / invariants):
 *  - NO score benchmark slider, NO "+26"/"−14" delta pills, NO "ONE FIX
 *    CLOSES THE GAP" card. The score is never explained.
 *  - ELIGIBLE → "You can apply to this job" + "Apply with my profile" CTA.
 *  - BELOW_THRESHOLD → "Not eligible for this job yet" (neutral, not red) +
 *    "Keep looking" CTA (no apply).
 *  - SCORE_PENDING → "We're still reading your resume" + disabled CTA.
 *  - Already applied → "You've applied" state, no second apply.
 *  - Apply sheet → POST /candidate/applications with full error handling:
 *      403 → re-render as not eligible
 *      409 score_pending → "We're still reading your resume"
 *      409 application_unavailable → "This job isn't open to applications"
 *      404 → back to feed
 *      402 → paywall (subscription required)
 */
import React, { useState, useCallback } from 'react';
import { AppAlert } from "@/components/feedback/AppAlert";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
  ActivityIndicator,
  Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  SealCheck,
  CheckCircle,
  CurrencyInr,
  Clock,
  MapPin,
  Check,
  EyeSlash,
  XCircle,
  SpinnerGap,
  Briefcase,
  Sparkle,
  Bell,
  ArrowSquareOut,
  GraduationCap,
  Gift,
  Translate,
  Users,
  CalendarBlank,
} from 'phosphor-react-native';
import { Colors } from '@/theme/tokens';
import { BoardJobDetail, EligibilityStatus } from '@/types/job';
import {
  formatSalaryRangePaise,
  formatExperienceMonths,
  workModeLabel,
  getInitials,
} from '@/utils/helpers';
import {
  applyToJob,
  applyErrorMessage,
  isEligibilityError,
  isJobGoneError,
} from '@/services/api/jobs';
import { ApiError } from '@/services/api/client';

// Label constants for structured job details from backend
const JOB_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: 'Full-time',
  PART_TIME: 'Part-time',
  CONTRACT: 'Contract',
  INTERNSHIP: 'Internship',
  FREELANCE: 'Freelance',
};

const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  PERMANENT: 'Permanent',
  TEMPORARY: 'Temporary',
  FIXED_TERM: 'Fixed term',
  APPRENTICESHIP: 'Apprenticeship',
};

const EDUCATION_LABELS: Record<string, string> = {
  NONE: 'No formal requirement',
  CLASS_10: '10th pass',
  CLASS_12: '12th pass',
  DIPLOMA: 'Diploma',
  GRADUATE: 'Graduate / Bachelor’s',
  POST_GRADUATE: 'Post Graduate / Master’s',
  DOCTORATE: 'Doctorate / PhD',
};

const NOTICE_PERIOD_LABELS: Record<string, string> = {
  IMMEDIATE: 'Immediate joiner',
  '15_DAYS': '15 days or less',
  '30_DAYS': '30 days or less',
  '60_DAYS': '60 days or less',
  '90_DAYS': '90 days or less',
  ANY: 'Flexible notice period',
};

const RELOCATION_LABELS: Record<string, string> = {
  REQUIRED: 'Relocation required',
  PREFERRED: 'Relocation preferred',
  NOT_REQUIRED: 'No relocation',
};

function formatDeadline(dateStr?: string | null): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// Text strings extracted as constants so the JSX contains no literal
// apostrophes (react/no-unescaped-entities).
const TXT_APPLIED_TITLE = "You've applied to this job";
const TXT_APPLIED_SUB =
  "The employer will see your profile. You'll hear back on the Application Board.";
const TXT_ELIGIBLE_TITLE = 'You can apply to this job';
const TXT_ELIGIBLE_SUB =
  'One tap with your profile - no forms, no cover letter.';
const TXT_BELOW_TITLE = 'Not eligible for this job yet';
const TXT_BELOW_SUB =
  'Keep building your profile and check back. You can still see the details.';
const TXT_PENDING_TITLE = "We're still reading your resume";
const TXT_PENDING_SUB =
  "Once your score is ready we'll tell you whether you can apply.";
const TXT_APPLIED_CTA_SUB = 'See it on your Application Board';
const TXT_BELOW_CTA_SUB = 'There are other jobs that fit your profile';
const TXT_PENDING_CTA_SUB = "We'll notify you";
const TXT_APPLY_CTA_SUB = 'One tap · no forms, no cover letter';
const TXT_EXTERNAL_CTA_SUB = 'Opens employer application in your browser';
const TXT_PRIVACY =
  'Your name and number stay hidden until this employer unlocks your profile. You get told when they do.';

export interface JobDetailScreenProps {
  /** Full job detail from GET /candidate/jobs/{id}. */
  job: BoardJobDetail;
  /** True if the candidate already has an application for this job. */
  alreadyApplied?: boolean;
  onBack?: () => void;
  /** Called after a successful apply, with the employer name. */
  onApplied?: (employerName: string) => void;
  /** Called when the job is gone (404) - usually navigate back. */
  onJobGone?: () => void;
  /** Called when subscription is required (402). */
  onSubscriptionRequired?: () => void;
}

type ApplyState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

export function JobDetailScreen({
  job,
  alreadyApplied = false,
  onBack,
  onApplied,
  onJobGone,
  onSubscriptionRequired,
}: JobDetailScreenProps) {
  // Local eligibility can flip to BELOW_THRESHOLD if the apply returns 403.
  const [eligibility, setEligibility] = useState<EligibilityStatus>(
    job.eligibility,
  );
  const [applied, setApplied] = useState<boolean>(alreadyApplied);
  const [applyState, setApplyState] = useState<ApplyState>({ kind: 'idle' });

  const employerName = job.employer_name || 'Employer';
  const initials = getInitials(employerName);

  const isSalaryDisclosed =
    job.salary_disclosed !== false &&
    job.details?.compensation?.disclosed !== false;

  const isExternalApply = Boolean(
    job.can_apply_externally && job.details?.application?.external_url,
  );

  const jobTypeLabel = job.details?.basics?.job_type
    ? JOB_TYPE_LABELS[job.details.basics.job_type] || job.details.basics.job_type
    : null;

  const employmentTypeLabel = job.details?.basics?.employment_type
    ? EMPLOYMENT_TYPE_LABELS[job.details.basics.employment_type] || job.details.basics.employment_type
    : null;

  const preferredSkills = [
    ...(job.details?.content?.nice_to_have_skills || []),
    ...(job.details?.skills?.preferred || []),
    ...(job.details?.skills?.tools || []),
  ].filter(
    (s, idx, arr) => Boolean(s) && arr.indexOf(s) === idx && !job.skills.includes(s),
  );

  const responsibilities = job.details?.content?.responsibilities || [];
  const reqQualifications = job.details?.content?.required_qualifications || [];
  const prefQualifications = job.details?.content?.preferred_qualifications || [];
  const benefits = job.details?.content?.benefits || [];
  const eduMinimum = job.details?.education?.minimum
    ? EDUCATION_LABELS[job.details.education.minimum] || job.details.education.minimum
    : null;
  const ugInfo = job.details?.education?.ug_qualification
    ? `${job.details.education.ug_qualification}${
        job.details.education.ug_specialization
          ? ` (${job.details.education.ug_specialization})`
          : ''
      }`
    : null;
  const pgInfo = job.details?.education?.pg_qualification
    ? `${job.details.education.pg_qualification}${
        job.details.education.pg_specialization
          ? ` (${job.details.education.pg_specialization})`
          : ''
      }`
    : null;
  const certs = job.details?.education?.certifications || [];
  const hasEducation = Boolean(eduMinimum || ugInfo || pgInfo || certs.length > 0);

  const noticePeriod = job.details?.requirements?.notice_period
    ? NOTICE_PERIOD_LABELS[job.details.requirements.notice_period] ||
      job.details.requirements.notice_period
    : null;
  const relocation = job.details?.requirements?.relocation
    ? RELOCATION_LABELS[job.details.requirements.relocation] ||
      job.details.requirements.relocation
    : null;
  const languages = job.details?.requirements?.languages || [];
  const workAuth = job.details?.requirements?.work_authorization || null;
  const hasRequirements = Boolean(
    noticePeriod || relocation || languages.length > 0 || workAuth,
  );

  const deadline = formatDeadline(job.details?.application?.deadline);

  const handleApply = useCallback(async () => {
    if (isExternalApply && job.details?.application?.external_url) {
      try {
        const canOpen = await Linking.canOpenURL(job.details.application.external_url);
        if (canOpen) {
          await Linking.openURL(job.details.application.external_url);
        } else {
          AppAlert.alert('External Link', 'Could not open the application link.');
        }
      } catch {
        AppAlert.alert('External Link', 'Could not open the application link.');
      }
      return;
    }
    if (applyState.kind === 'submitting' || applied) return;
    setApplyState({ kind: 'submitting' });
    try {
      await applyToJob(job.id);
      setApplied(true);
      setApplyState({ kind: 'done' });
      onApplied?.(employerName);
    } catch (err) {
      if (isJobGoneError(err)) {
        setApplyState({
          kind: 'error',
          message: 'This job is no longer open.',
        });
        onJobGone?.();
        return;
      }
      if (err instanceof ApiError && err.status === 402) {
        setApplyState({
          kind: 'error',
          message: 'A membership is required to apply.',
        });
        onSubscriptionRequired?.();
        return;
      }
      if (isEligibilityError(err)) {
        // 403 → re-render as not eligible.
        setEligibility('BELOW_THRESHOLD');
        setApplyState({ kind: 'idle' });
        return;
      }
      const message = applyErrorMessage(
        err,
        'We could not submit your application. Try again.',
      );
      setApplyState({ kind: 'error', message });
    }
  }, [
    isExternalApply,
    job.details?.application?.external_url,
    applyState.kind,
    applied,
    job.id,
    onApplied,
    employerName,
    onJobGone,
    onSubscriptionRequired,
  ]);

  return (
    <View style={styles.root}>
      <StatusBar style="light" animated />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Dark Navy Hero Section */}
        <View style={styles.navyHero}>
          <SafeAreaView edges={['top']} style={styles.heroSafeArea}>
            {/* Top Bar Actions */}
            <View style={styles.topNavRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.navCircleBtn,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onBack}
                accessibilityRole="button"
                accessibilityLabel="Back to jobs"
              >
                <ArrowLeft size={16} color="#FFFFFF" weight="bold" />
              </Pressable>
            </View>

            {/* Role & Company Header */}
            <View style={styles.roleHeaderRow}>
              <View style={styles.companyBadge}>
                <Text style={styles.companyBadgeText}>{initials}</Text>
              </View>
              <View style={styles.roleInfo}>
                <Text style={styles.roleTitleText}>{job.title}</Text>
                <View style={styles.companySubRow}>
                  <Text style={styles.companyNameText}>{employerName}</Text>
                  <SealCheck size={14} color="#FFFCF7" weight="fill" />
                  <Text style={styles.verifiedLabelText}>Verified</Text>
                </View>
                {jobTypeLabel || employmentTypeLabel || job.details?.basics?.department ? (
                  <View style={styles.heroTagsRow}>
                    {jobTypeLabel ? (
                      <View style={styles.heroTag}>
                        <Text style={styles.heroTagText}>{jobTypeLabel}</Text>
                      </View>
                    ) : null}
                    {employmentTypeLabel ? (
                      <View style={styles.heroTag}>
                        <Text style={styles.heroTagText}>{employmentTypeLabel}</Text>
                      </View>
                    ) : null}
                    {job.details?.basics?.department ? (
                      <View style={styles.heroTag}>
                        <Text style={styles.heroTagText}>
                          {job.details.basics.department}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}
              </View>
            </View>

            {/* Eligibility panel - varies by eligibility */}
            <EligibilityPanel eligibility={eligibility} applied={applied} />
          </SafeAreaView>
        </View>

        {/* White / Off-White Details Section */}
        <View style={styles.detailsBody}>
          {/* Metric cards */}
          <View style={styles.metricsRow}>
            {/* MONTHLY / SALARY */}
            <View style={styles.metricCard}>
              <CurrencyInr size={17} color="#5E4DB2" weight="duotone" />
              <Text style={styles.metricLabel}>
                {job.details?.compensation?.period &&
                job.details.compensation.period !== 'MONTHLY'
                  ? `SALARY (${job.details.compensation.period.replace('_', ' ')})`
                  : 'MONTHLY'}
              </Text>
              <Text
                style={isSalaryDisclosed ? styles.metricValueMono : styles.metricValueSans}
                numberOfLines={2}
              >
                {isSalaryDisclosed
                  ? formatSalaryRangePaise(
                      job.salary_min_minor,
                      job.salary_max_minor,
                    )
                  : 'Not disclosed'}
              </Text>
              {isSalaryDisclosed && job.details?.compensation?.negotiable ? (
                <Text style={styles.metricSubLabel}>Negotiable</Text>
              ) : null}
            </View>

            {/* WORK MODE */}
            {job.work_mode ? (
              <View style={styles.metricCard}>
                <Briefcase size={17} color="#5F6B80" weight="duotone" />
                <Text style={styles.metricLabel}>WORK MODE</Text>
                <Text style={styles.metricValueSans} numberOfLines={2}>
                  {workModeLabel(job.work_mode)}
                </Text>
              </View>
            ) : null}

            {/* EXPERIENCE */}
            {job.experience_min_months ? (
              <View style={styles.metricCard}>
                <Clock size={17} color="#5F6B80" weight="duotone" />
                <Text style={styles.metricLabel}>EXPERIENCE</Text>
                <Text style={styles.metricValueSans} numberOfLines={2}>
                  {formatExperienceMonths(job.experience_min_months)}
                  {job.details?.compensation?.experience_max_months
                    ? ` – ${formatExperienceMonths(
                        job.details.compensation.experience_max_months,
                      )}`
                    : ''}
                </Text>
              </View>
            ) : null}

            {/* LOCATION */}
            {job.location ? (
              <View
                style={[
                  styles.metricCard,
                  !job.experience_min_months &&
                    !job.details?.basics?.openings &&
                    styles.metricCardWide,
                ]}
              >
                <MapPin size={17} color="#5F6B80" weight="duotone" />
                <Text style={styles.metricLabel}>LOCATION</Text>
                <Text style={styles.metricValueSans} numberOfLines={2}>
                  {job.location}
                  {job.details?.location?.additional_locations &&
                  job.details.location.additional_locations.length > 0
                    ? ` (+${job.details.location.additional_locations.length})`
                    : ''}
                </Text>
              </View>
            ) : null}

            {/* OPENINGS */}
            {job.details?.basics?.openings ? (
              <View style={styles.metricCard}>
                <Users size={17} color="#5F6B80" weight="duotone" />
                <Text style={styles.metricLabel}>OPENINGS</Text>
                <Text style={styles.metricValueSans} numberOfLines={2}>
                  {job.details.basics.openings}{' '}
                  {job.details.basics.openings === 1 ? 'position' : 'positions'}
                </Text>
              </View>
            ) : null}
          </View>

          {/* APPLICATION DEADLINE (if set) */}
          {deadline ? (
            <View style={styles.deadlineContainer}>
              <CalendarBlank size={16} color="#5F4DB2" weight="bold" />
              <Text style={styles.deadlineText}>
                Application deadline:{' '}
                <Text style={styles.deadlineBold}>{deadline}</Text>
              </Text>
            </View>
          ) : null}

          {/* WHAT YOU WOULD DO */}
          {job.description ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>WHAT YOU WOULD DO</Text>
              <Text style={styles.bodyDescription}>{job.description}</Text>
            </View>
          ) : null}

          {/* KEY RESPONSIBILITIES */}
          {responsibilities.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>KEY RESPONSIBILITIES</Text>
              <View style={styles.bulletList}>
                {responsibilities.map((resp, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{resp}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* SKILLS THEY ASKED FOR */}
          {job.skills.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.skillsEyebrowRow}>
                <Text style={styles.sectionEyebrow}>SKILLS THEY ASKED FOR</Text>
              </View>
              <View style={styles.skillsChipsWrap}>
                {job.skills.map((skill) => (
                  <View key={skill} style={styles.skillChip}>
                    <Sparkle size={11} color="#5F6B80" weight="bold" />
                    <Text style={styles.skillChipText}>{skill}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* PREFERRED & NICE-TO-HAVE SKILLS */}
          {preferredSkills.length > 0 ? (
            <View style={styles.sectionBlock}>
              <View style={styles.skillsEyebrowRow}>
                <Text style={styles.sectionEyebrow}>PREFERRED & ADDITIONAL SKILLS</Text>
              </View>
              <View style={styles.skillsChipsWrap}>
                {preferredSkills.map((skill) => (
                  <View key={skill} style={styles.skillChipSecondary}>
                    <Sparkle size={11} color="#5F4DB2" weight="bold" />
                    <Text style={styles.skillChipSecondaryText}>{skill}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* REQUIRED QUALIFICATIONS */}
          {reqQualifications.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>REQUIRED QUALIFICATIONS</Text>
              <View style={styles.bulletList}>
                {reqQualifications.map((item, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* PREFERRED QUALIFICATIONS */}
          {prefQualifications.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>PREFERRED QUALIFICATIONS</Text>
              <View style={styles.bulletList}>
                {prefQualifications.map((item, idx) => (
                  <View key={idx} style={styles.bulletRow}>
                    <View style={styles.bulletDot} />
                    <Text style={styles.bulletText}>{item}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* EDUCATION & CERTIFICATIONS */}
          {hasEducation ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>EDUCATION & CERTIFICATIONS</Text>
              <View style={styles.cardBlock}>
                {eduMinimum ? (
                  <View style={styles.factRow}>
                    <GraduationCap size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Minimum Education:</Text>
                    <Text style={styles.factValue}>{eduMinimum}</Text>
                  </View>
                ) : null}
                {ugInfo ? (
                  <View style={styles.factRow}>
                    <GraduationCap size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Undergraduate:</Text>
                    <Text style={styles.factValue}>{ugInfo}</Text>
                  </View>
                ) : null}
                {pgInfo ? (
                  <View style={styles.factRow}>
                    <GraduationCap size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Postgraduate:</Text>
                    <Text style={styles.factValue}>{pgInfo}</Text>
                  </View>
                ) : null}
                {certs.length > 0 ? (
                  <View style={styles.certRow}>
                    <Text style={styles.factLabel}>Certifications:</Text>
                    <View style={styles.skillsChipsWrap}>
                      {certs.map((c) => (
                        <View key={c} style={styles.certChip}>
                          <Text style={styles.certChipText}>{c}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* CANDIDATE REQUIREMENTS */}
          {hasRequirements ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>CANDIDATE REQUIREMENTS</Text>
              <View style={styles.cardBlock}>
                {noticePeriod ? (
                  <View style={styles.factRow}>
                    <Clock size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Notice Period:</Text>
                    <Text style={styles.factValue}>{noticePeriod}</Text>
                  </View>
                ) : null}
                {languages.length > 0 ? (
                  <View style={styles.factRow}>
                    <Translate size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Languages:</Text>
                    <Text style={styles.factValue}>{languages.join(', ')}</Text>
                  </View>
                ) : null}
                {relocation ? (
                  <View style={styles.factRow}>
                    <MapPin size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Relocation:</Text>
                    <Text style={styles.factValue}>{relocation}</Text>
                  </View>
                ) : null}
                {workAuth ? (
                  <View style={styles.factRow}>
                    <Briefcase size={16} color="#5F6B80" weight="duotone" />
                    <Text style={styles.factLabel}>Work Authorization:</Text>
                    <Text style={styles.factValue}>{workAuth}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* BENEFITS & PERKS */}
          {benefits.length > 0 ? (
            <View style={styles.sectionBlock}>
              <Text style={styles.sectionEyebrow}>BENEFITS & PERKS</Text>
              <View style={styles.skillsChipsWrap}>
                {benefits.map((benefit, idx) => (
                  <View key={idx} style={styles.benefitChip}>
                    <Gift size={13} color="#1F6B45" weight="duotone" />
                    <Text style={styles.benefitChipText}>{benefit}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {/* Privacy Protection Notice */}
          <View style={styles.privacyNoticeBox}>
            <EyeSlash size={17} color="#5F6B80" weight="bold" />
            <Text style={styles.privacyNoticeText}>{TXT_PRIVACY}</Text>
          </View>

          {/* Sticky Bottom CTA - varies by eligibility + applied */}
          <View style={styles.bottomCtaContainer}>
            <BottomCTA
              eligibility={eligibility}
              applied={applied}
              applyState={applyState}
              isExternal={isExternalApply}
              onApply={handleApply}
              onBack={onBack}
            />
            {applyState.kind === 'error' && (
              <Text style={styles.applyErrorText}>{applyState.message}</Text>
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// ─── Eligibility Panel (top, inside navy hero) ─────────────────

interface EligibilityPanelProps {
  eligibility: EligibilityStatus;
  applied: boolean;
}

function EligibilityPanel({ eligibility, applied }: EligibilityPanelProps) {
  if (applied) {
    return (
      <View style={styles.scoreClearanceCard}>
        <View style={styles.clearanceHeaderRow}>
          <View style={styles.clearanceCheckCircle}>
            <Check size={8} color="#5F4DB2" weight="bold" />
          </View>
          <Text style={styles.clearanceTitleText}>{TXT_APPLIED_TITLE}</Text>
        </View>
        <Text style={styles.clearanceSubtext}>{TXT_APPLIED_SUB}</Text>
      </View>
    );
  }

  switch (eligibility) {
    case 'ELIGIBLE':
      return (
        <View style={styles.scoreClearanceCard}>
          <View style={styles.clearanceHeaderRow}>
            <View style={styles.clearanceCheckCircle}>
              <Check size={8} color="#5F4DB2" weight="bold" />
            </View>
            <Text style={styles.clearanceTitleText}>{TXT_ELIGIBLE_TITLE}</Text>
          </View>
          <Text style={styles.clearanceSubtext}>{TXT_ELIGIBLE_SUB}</Text>
        </View>
      );
    case 'BELOW_THRESHOLD':
      // Neutral, not red (R11 - never shame the score).
      return (
        <View style={styles.scoreClearanceCard}>
          <View style={styles.clearanceHeaderRow}>
            <View style={styles.clearanceCheckCircle}>
              <XCircle size={10} color="#9DA9BE" weight="bold" />
            </View>
            <Text style={styles.clearanceTitleText}>{TXT_BELOW_TITLE}</Text>
          </View>
          <Text style={styles.clearanceSubtext}>{TXT_BELOW_SUB}</Text>
        </View>
      );
    case 'SCORE_PENDING':
      return (
        <View style={styles.scoreClearanceCard}>
          <View style={styles.clearanceHeaderRow}>
            <View style={styles.clearanceCheckCircle}>
              <SpinnerGap size={10} color="#9DA9BE" weight="bold" />
            </View>
            <Text style={styles.clearanceTitleText}>{TXT_PENDING_TITLE}</Text>
          </View>
          <Text style={styles.clearanceSubtext}>{TXT_PENDING_SUB}</Text>
        </View>
      );
    default:
      return null;
  }
}

// ─── Bottom CTA (varies by eligibility + applied) ───────────────

interface BottomCTAProps {
  eligibility: EligibilityStatus;
  applied: boolean;
  applyState: ApplyState;
  isExternal?: boolean;
  onApply: () => void;
  onBack?: () => void;
}

function BottomCTA({
  eligibility,
  applied,
  applyState,
  isExternal,
  onApply,
  onBack,
}: BottomCTAProps) {
  if (applied) {
    return (
      <>
        <View style={styles.appliedBtn}>
          <CheckCircle size={18} color="#FFFFFF" weight="fill" />
          <Text style={styles.applyBtnText}>Applied</Text>
        </View>
        <Text style={styles.applySubtext}>{TXT_APPLIED_CTA_SUB}</Text>
      </>
    );
  }

  if (eligibility === 'BELOW_THRESHOLD') {
    return (
      <>
        <Pressable
          style={({ pressed }) => [
            styles.keepLookingBtn,
            pressed && styles.buttonPressed,
          ]}
          onPress={onBack}
          accessibilityRole="button"
        >
          <Text style={styles.keepLookingBtnText}>Keep looking</Text>
        </Pressable>
        <Text style={styles.applySubtext}>{TXT_BELOW_CTA_SUB}</Text>
      </>
    );
  }

  if (eligibility === 'SCORE_PENDING') {
    return (
      <>
        <View style={styles.disabledBtn}>
          <Bell size={17} color="#9DA9BE" weight="bold" />
          <Text style={styles.disabledBtnText}>
            Apply opens when score is ready
          </Text>
        </View>
        <Text style={styles.applySubtext}>{TXT_PENDING_CTA_SUB}</Text>
      </>
    );
  }

  // ELIGIBLE
  const submitting = applyState.kind === 'submitting';

  if (isExternal) {
    return (
      <>
        <Pressable
          style={({ pressed }) => [
            styles.applyBtn,
            pressed && styles.buttonPressed,
          ]}
          onPress={onApply}
          accessibilityRole="button"
          accessibilityLabel="Apply on company site"
        >
          <Text style={styles.applyBtnText}>Apply on company site</Text>
          <ArrowSquareOut size={16} color="#FFFFFF" weight="bold" />
        </Pressable>
        <Text style={styles.applySubtext}>{TXT_EXTERNAL_CTA_SUB}</Text>
      </>
    );
  }

  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.applyBtn,
          pressed && styles.buttonPressed,
          submitting && styles.applyBtnSubmitting,
        ]}
        onPress={onApply}
        disabled={submitting}
        accessibilityRole="button"
        accessibilityLabel="Apply now"
      >
        {submitting ? (
          <ActivityIndicator size="small" color="#FFFFFF" />
        ) : (
          <Text style={styles.applyBtnText}>Apply now</Text>
        )}
      </Pressable>
      <Text style={styles.applySubtext}>{TXT_APPLY_CTA_SUB}</Text>
    </>
  );
}

// ─── Styles ────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  scrollContent: {
    flexGrow: 1,
  },
  navyHero: {
    backgroundColor: '#5F4DB2',
    paddingBottom: 24,
  },
  heroSafeArea: {
    paddingHorizontal: 20,
    gap: 20,
  },
  topNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 10,
  },
  navRightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  navCircleBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 252, 247, 0.26)',
    backgroundColor: 'rgba(255, 252, 247, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  roleHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  companyBadge: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 252, 247, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 252, 247, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  companyBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    lineHeight: 20,
    color: '#FFFCF7',
  },
  roleInfo: {
    flex: 1,
    minWidth: 0,
    gap: 6,
  },
  roleTitleText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 23,
    lineHeight: 29,
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  companySubRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap',
  },
  companyNameText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#9DA9BE',
  },
  verifiedLabelText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#9DA9BE',
  },
  scoreClearanceCard: {
    padding: 18,
    borderRadius: 16,
    backgroundColor: 'rgba(255, 252, 247, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255, 252, 247, 0.18)',
    gap: 8,
  },
  clearanceHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  clearanceCheckCircle: {
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#FFFCF7',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  clearanceTitleText: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: '#FFFFFF',
  },
  clearanceSubtext: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: 'rgba(255, 252, 247, 0.78)',
  },
  detailsBody: {
    paddingHorizontal: 20,
    paddingTop: 28,
    paddingBottom: 48,
    gap: 28,
  },
  metricsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 12,
  },
  metricCard: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 118,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: 16,
    padding: 16,
    gap: 8,
    justifyContent: 'flex-start',
  },
  metricCardWide: {
    flexBasis: '100%',
  },
  metricLabel: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 10,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: '#5F6B80',
    fontWeight: '700',
  },
  metricValueMono: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 16,
    lineHeight: 21,
    color: Colors.navy,
    fontWeight: '700',
  },
  metricValueSans: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 21,
    color: Colors.navy,
  },
  sectionBlock: {
    gap: 12,
  },
  sectionEyebrow: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: '#5F6B80',
    fontWeight: '700',
  },
  bodyDescription: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 23,
    color: Colors.text.primary,
  },
  skillsEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  skillsChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.hairline,
  },
  skillChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 16,
    color: Colors.text.primary,
  },
  privacyNoticeBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    padding: 16,
    borderRadius: 16,
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.hairline,
  },
  privacyNoticeText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5F6B80',
  },
  heroTagsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  heroTag: {
    backgroundColor: 'rgba(255, 252, 247, 0.14)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  heroTagText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#FFFCF7',
  },
  metricSubLabel: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 14,
    color: '#5F6B80',
    marginTop: 2,
  },
  bulletList: {
    gap: 10,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#5F4DB2',
    marginTop: 8,
  },
  bulletText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: Colors.text.primary,
  },
  skillChipSecondary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#EFEBFA',
    borderWidth: 1,
    borderColor: 'rgba(95, 77, 178, 0.2)',
  },
  skillChipSecondaryText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F4DB2',
  },
  cardBlock: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  factRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  factLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  factValue: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
  },
  certRow: {
    gap: 8,
  },
  certChip: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.hairline,
  },
  certChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.navy,
  },
  benefitChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#E6F1EA',
    borderWidth: 1,
    borderColor: 'rgba(31, 107, 69, 0.2)',
  },
  benefitChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 16,
    color: '#1F6B45',
  },
  deadlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#EFEBFA',
    borderWidth: 1,
    borderColor: 'rgba(95, 77, 178, 0.2)',
  },
  deadlineText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F4DB2',
  },
  deadlineBold: {
    fontFamily: 'GeneralSans-Bold',
    color: '#5F4DB2',
  },
  bottomCtaContainer: {
    gap: 8,
    paddingTop: 8,
  },
  applyBtn: {
    backgroundColor: '#5F4DB2',
    borderRadius: 999,
    paddingVertical: 18,
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  applyBtnSubmitting: {
    opacity: 0.7,
  },
  applyBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  appliedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#1F6B45',
    borderRadius: 999,
    paddingVertical: 18,
  },
  keepLookingBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: Colors.surface.borderSecondary,
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepLookingBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
  },
  disabledBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F0EBDF',
    borderWidth: 1,
    borderColor: Colors.surface.hairline,
    borderRadius: 999,
    paddingVertical: 18,
  },
  disabledBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#5F6B80',
  },
  applySubtext: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    textAlign: 'center',
  },
  applyErrorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
    textAlign: 'center',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
