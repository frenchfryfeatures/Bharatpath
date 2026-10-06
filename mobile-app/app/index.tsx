/**
 * BharatPath - Foundation Preview & Authentication Flow
 * Seamlessly connects Candidate Auth (Cognito-aligned) with the Onboarding & Core App.
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';

import { SplashScreen } from '@/screens/splash/SplashScreen';
import { IntroScreen } from '@/screens/onboarding/IntroScreen';
import {
  SignUpScreen,
  LoginScreen,
  EmailVerificationScreen,
  ForgotPasswordScreen,
} from '@/screens/auth';
import { SubscribeScreen } from '@/screens/subscription/SubscribeScreen';
import { LanguageSelectScreen } from '@/screens/onboarding/LanguageSelectScreen';
import { HowItWorksScreen } from '@/screens/onboarding/HowItWorksScreen';
import {
  ResumeIntakeScreen,
  UploadedFileMeta,
  ResumeIntakePayload,
} from '@/screens/onboarding/ResumeIntakeScreen';
import { ParsingScreen } from '@/screens/onboarding/ParsingScreen';
import { CareerDetailsScreen } from '@/screens/profile/CareerDetailsScreen';
import {
  getCareerProfile,
  saveCareerProfile,
  type CareerDetails,
} from '@/services/api/career';
import { AppAlert } from '@/components/feedback/AppAlert';
import { ScoringScreen } from '@/screens/onboarding/ScoringScreen';
import { ScoreRevealScreen } from '@/screens/onboarding/ScoreRevealScreen';
import { NotificationPermissionScreen } from '@/screens/onboarding/NotificationPermissionScreen';
import { ShareResultScreen } from '@/screens/onboarding/ShareResultScreen';
import {
  ResumeVersionDetailResponse,
  confirmResumeVersion,
  getResumeVersionDetails,
  listResumeVersions,
} from '@/services/api/resume';
import { extractCandidateResumeInfo } from '@/services/profile/extractedResume';
import {
  CandidateScoreResponse,
  bandIndex,
  bandLabel,
  nextBandLabel,
  pointsToNextBand,
  getMyScore,
} from '@/services/api/scoring';
import { HomeScreen } from '@/screens/home/HomeScreen';
import { useAuthContext } from '@/context/AuthContext';
import {
  confirmSignUpWithCode,
  signInWithEmail,
  updateCandidateName,
  resendConfirmationCode,
  getCurrentSession,
} from '@/services/api/auth';

type AppStep =
  | 'splash'
  | 'intro'
  | 'signup'
  | 'login'
  | 'forgot-password'
  | 'verify-email'
  | 'language'
  | 'howItWorks'
  | 'subscribe'
  | 'intake'
  | 'parsing'
  | 'review'
  | 'scoring'
  | 'score'
  | 'breakdown'
  | 'suggestions'
  | 'recalculated'
  | 'notifications'
  | 'share'
  | 'preview';

export default function FoundationPreview() {
  const router = useRouter();
  const params = useLocalSearchParams<{ step?: AppStep }>();
  const {
    session,
    candidateFullName,
    candidateScore: authCandidateScore,
    setCandidateScore: setAuthCandidateScore,
    updateCandidateScore,
    refreshScore,
    rememberCandidate,
  } = useAuthContext();
  const [step, setStep] = useState<AppStep>(params.step || 'splash');
  const [fileMeta, setFileMeta] = useState<UploadedFileMeta | undefined>();
  const [intakePayload, setIntakePayload] = useState<
    ResumeIntakePayload | undefined
  >();
  const [userEmail, setUserEmail] = useState<string>('');
  const [userName, setUserName] = useState<string>('');
  const [userPassword, setUserPassword] = useState<string>('');
  const [onboardingDraft, setOnboardingDraft] = useState<CareerDetails | null>(
    null,
  );
  const [onboardingSection, setOnboardingSection] = useState(0);
  const [activeTab, setActiveTab] = useState<
    'preview' | 'home' | 'jobs' | 'board' | 'you'
  >('home');

  const [resumeVersionId, setResumeVersionId] = useState<string | undefined>();
  const [resumeVersionDetails, setResumeVersionDetails] =
    useState<ResumeVersionDetailResponse | null>(null);
  const [localCandidateScore, setLocalCandidateScore] =
    useState<CandidateScoreResponse | null>(null);
  const [confirmedAtTimestamp, setConfirmedAtTimestamp] = useState<
    string | null
  >(null);

  // Synchronize score with AuthContext
  const candidateScore = authCandidateScore || localCandidateScore;

  // Refresh candidate score on screen focus so newly scored resumes are reflected
  useFocusEffect(
    useCallback(() => {
      refreshScore().catch(() => undefined);
    }, [refreshScore]),
  );

  useEffect(() => {
    if (params.step) {
      setStep(params.step);
      if (params.step === 'intro' || params.step === 'login') {
        setUserEmail('');
        setUserName('');
        setUserPassword('');
        setResumeVersionId(undefined);
        setResumeVersionDetails(null);
        setLocalCandidateScore(null);
      }
    }
  }, [params.step]);

  const resumeInfo = useMemo(() => {
    return extractCandidateResumeInfo(
      resumeVersionDetails,
      userName || candidateFullName || undefined,
    );
  }, [resumeVersionDetails, userName, candidateFullName]);

  const handleTabPress = (tab: string, href: string) => {
    setActiveTab(tab as typeof activeTab);
    if (tab !== 'home' && tab !== 'preview') {
      router.push(href as any);
    }
  };

  if (step === 'splash') {
    return (
      <SplashScreen
        onFinish={async () => {
          const activeSession = session || (await getCurrentSession());
          if (activeSession) {
            try {
              const versions = await listResumeVersions();
              const confirmed =
                versions.find((v) => v.confirmed && !v.superseded) ||
                versions.find((v) => v.confirmed);
              if (confirmed) {
                refreshScore().catch(() => undefined);
                router.replace('/home');
                return;
              }
              const unconfirmed = versions.find(
                (v) => !v.confirmed && !v.superseded,
              );
              if (unconfirmed) {
                const verDetails = await getResumeVersionDetails(
                  unconfirmed.resume_version_id,
                );
                setResumeVersionId(unconfirmed.resume_version_id);
                setResumeVersionDetails(verDetails);
                setStep('review');
                return;
              }
              // Active session without resume -> move to payment / intake
              setStep('intake');
              return;
            } catch {
              refreshScore().catch(() => undefined);
              router.replace('/home');
              return;
            }
          }
          setStep('intro');
        }}
      />
    );
  }

  // 1. Initial Intro Screen with "Get started free" & "I already have an account"
  if (step === 'intro') {
    return (
      <IntroScreen
        onGetStarted={() => setStep('signup')}
        onAlreadyHaveAccount={() => setStep('login')}
      />
    );
  }

  // 2. Candidate Sign Up Screen (Full Name, Email, Password, Confirm Password)
  if (step === 'signup') {
    return (
      <SignUpScreen
        onResumeSelected={(meta) => {
          setFileMeta(meta);
          setIntakePayload({ source: 'upload', fileMeta: meta });
        }}
        onBack={() => setStep('intro')}
        onNavigateToLogin={() => setStep('login')}
        onSubmit={async (data, isUnconfirmed) => {
          setOnboardingDraft(data.details);
          setOnboardingSection(1);
          setUserEmail(data.email);
          setUserName(data.fullName);
          setUserPassword(data.password);
          if (isUnconfirmed) {
            setStep('verify-email');
          } else {
            // Account created: parse the selected resume before profile review and payment.
            await saveCareerProfile(
              data.details,
              null,
              false,
              fileMeta?.fileName,
            );
            setStep(intakePayload ? 'parsing' : 'review');
          }
        }}
      />
    );
  }

  // 3. Candidate Login Screen (Email, Password, Forgot Password)
  if (step === 'login') {
    return (
      <LoginScreen
        initialEmail={userEmail}
        onBack={() => setStep('intro')}
        onNavigateToSignUp={() => setStep('signup')}
        onNavigateToVerification={(email, pass) => {
          setUserEmail(email);
          if (pass) setUserPassword(pass);
          setStep('verify-email');
        }}
        onForgotPassword={(typedEmail) => {
          if (typedEmail) setUserEmail(typedEmail);
          setStep('forgot-password');
        }}
        onSubmit={async (data) => {
          setUserEmail(data.session.email);
          const name = data.profile?.full_name?.trim();
          if (name) {
            setUserName(name);
          }
          try {
            const versions = await listResumeVersions();
            const confirmed =
              versions.find((v) => v.confirmed && !v.superseded) ||
              versions.find((v) => v.confirmed);

            // If user resume is already submitted/confirmed:
            // Move directly to the Home page! Editing is handled in the Profile section.
            if (confirmed) {
              const verDetails = await getResumeVersionDetails(
                confirmed.resume_version_id,
              ).catch(() => null);
              setResumeVersionId(confirmed.resume_version_id);
              if (verDetails) setResumeVersionDetails(verDetails);

              refreshScore().catch(() => undefined);
              router.replace('/home');
              return;
            }

            // Only if user has never confirmed any resume, check for an unconfirmed draft
            const unconfirmed = versions.find(
              (v) => !v.confirmed && !v.superseded,
            );
            if (unconfirmed) {
              const verDetails = await getResumeVersionDetails(
                unconfirmed.resume_version_id,
              );
              setResumeVersionId(unconfirmed.resume_version_id);
              setResumeVersionDetails(verDetails);
              setStep('review');
              return;
            }
          } catch (e) {
            console.warn('Could not check existing resume versions:', e);
          }

          // Without a resume, collect it before profile review and payment.
          setStep('intake');
        }}
      />
    );
  }

  // 3b. Forgot Password Screen (Reset password with email verification code)
  if (step === 'forgot-password') {
    return (
      <ForgotPasswordScreen
        initialEmail={userEmail}
        onBack={() => setStep('login')}
        onSuccess={(resetEmail) => {
          if (resetEmail) setUserEmail(resetEmail);
          setStep('login');
        }}
      />
    );
  }

  // 4. Email Verification Screen (6-digit code sent by Cognito)
  if (step === 'verify-email') {
    return (
      <EmailVerificationScreen
        email={userEmail}
        onBack={() => setStep('signup')}
        onVerify={async (code) => {
          // 1. Confirm code in AWS Cognito Candidate User Pool
          await confirmSignUpWithCode(userEmail, code);

          // 2. Sign in with candidate credentials
          if (userPassword) {
            try {
              const { session, profile } = await signInWithEmail({
                email: userEmail,
                password: userPassword,
              });
              rememberCandidate(session, profile, userName);
            } catch (authErr) {
              console.warn('Auto sign-in after verification failed:', authErr);
            }
          }

          // 3. Save candidate full name if available
          if (userName) {
            try {
              await updateCandidateName(userName);
            } catch (e) {
              console.warn(
                'Could not update candidate name after verification:',
                e,
              );
            }
          }

          if (onboardingDraft)
            await saveCareerProfile(
              onboardingDraft,
              null,
              false,
              fileMeta?.fileName,
            );
          setStep(intakePayload ? 'parsing' : 'review');
        }}
        onResendCode={async () => {
          await resendConfirmationCode(userEmail);
        }}
      />
    );
  }

  // 5. Onboarding: Language Selection
  if (step === 'language') {
    return (
      <LanguageSelectScreen onSelectLanguage={() => setStep('howItWorks')} />
    );
  }

  // 6. Onboarding: How It Works
  if (step === 'howItWorks') {
    return (
      <HowItWorksScreen
        onBack={() => setStep('language')}
        onGotIt={() => setStep('intake')}
      />
    );
  }

  // 7. Membership follows a saved profile; confirmation starts paid scoring.
  if (step === 'subscribe') {
    return (
      <SubscribeScreen
        candidateName={userName}
        onSubscribed={async () => {
          try {
            const saved = await getCareerProfile();
            const id = saved.resume_version_id ?? resumeVersionId;
            if (!id || !saved.completed) {
              setStep('review');
              return;
            }
            const confirmed = await confirmResumeVersion(id);
            setConfirmedAtTimestamp(confirmed.confirmed_at);
            setStep('scoring');
          } catch {
            AppAlert.alert(
              'Scoring could not start',
              'Please confirm membership access and try again.',
            );
          }
        }}
        onSkip={() => router.replace('/you')}
        onBack={() => setStep('review')}
      />
    );
  }

  // 8. Onboarding: Resume Intake (Upload or Structured Input)
  if (step === 'intake') {
    return (
      <ResumeIntakeScreen
        userName={userName}
        onBack={() => setStep('signup')}
        onSelectOption={(_option, meta, payload) => {
          if (meta) {
            setFileMeta(meta);
          }
          if (payload) {
            setIntakePayload(payload);
          }
          setStep('parsing');
        }}
      />
    );
  }

  // 9. Onboarding: Resume Parsing
  if (step === 'parsing') {
    return (
      <ParsingScreen
        fileMeta={fileMeta}
        payload={intakePayload}
        onReviewFound={async (verId, details) => {
          if (onboardingDraft)
            await saveCareerProfile(
              onboardingDraft,
              verId,
              false,
              fileMeta?.fileName,
            );
          setResumeVersionId(verId);
          setResumeVersionDetails(details);
          const extracted = extractCandidateResumeInfo(details);
          if (extracted.name && !userName) {
            setUserName(extracted.name);
          }
          setStep('review');
        }}
      />
    );
  }

  // 10. Onboarding: Review Parsed Details (The confirm gate before scoring)
  if (step === 'review') {
    return (
      <CareerDetailsScreen
        onboarding
        initialSection={onboardingSection}
        resumeFilename={fileMeta?.fileName}
        versionId={resumeVersionId}
        onBack={() => setStep('intake')}
        onDone={(profile) => {
          setResumeVersionId(profile.resume_version_id ?? undefined);
          setStep('subscribe');
        }}
      />
    );
  }

  // 11. Scoring - polls GET /candidate/score/me for a real number.
  // Shows a pending state, never a stand-in score. See ScoringScreen.tsx for
  // the worker and Layer 1 configuration this needs to produce one.
  if (step === 'scoring') {
    return (
      <ScoringScreen
        minComputedAt={confirmedAtTimestamp}
        onReady={(score) => {
          setLocalCandidateScore(score);
          setAuthCandidateScore(score);
          if (score.value != null) {
            updateCandidateScore(score.value, score.band, score.computed_at);
          }
          setStep('score');
        }}
        onContinueWithoutScore={() => setStep('score')}
      />
    );
  }

  // 12. Score Reveal
  if (step === 'score') {
    return (
      <ScoreRevealScreen
        mode="initial"
        score={candidateScore?.value ?? undefined}
        band={candidateScore?.band}
        onSave={() => setStep('notifications')}
        onShare={() => setStep('share')}
      />
    );
  }

  // 16. Notification Permissions
  if (step === 'notifications') {
    return (
      <NotificationPermissionScreen
        onAllow={() => setStep('share')}
        onNotNow={() => setStep('share')}
      />
    );
  }

  // 17. Share Result Screen
  if (step === 'share') {
    return (
      <ShareResultScreen
        score={candidateScore?.value ?? undefined}
        maxScore={990}
        bandName={bandLabel(candidateScore?.band) || undefined}
        candidateName={resumeInfo.name || userName || undefined}
        candidateField={resumeInfo.field || undefined}
        candidateCity={resumeInfo.city || undefined}
        scoreDate={resumeInfo.scoreDate}
        onBack={() => {
          refreshScore().catch(() => undefined);
          router.replace('/home');
        }}
        onSave={() => {
          refreshScore().catch(() => undefined);
          router.replace('/home');
        }}
        onShare={() => {
          refreshScore().catch(() => undefined);
          router.replace('/home');
        }}
      />
    );
  }

  // 18. Authenticated Home Screen
  return (
    <HomeScreen
      candidateName={
        resumeInfo.name || candidateFullName || userName || undefined
      }
      score={candidateScore?.value ?? undefined}
      maxScore={990}
      bandName={bandLabel(candidateScore?.band) || undefined}
      bandNumber={bandIndex(candidateScore?.band)}
      bandTotal={4}
      scoreGain={26}
      fixesLeft={2}
      fixesWorth={32}
      pointsToNextBand={
        pointsToNextBand(
          candidateScore?.value ?? null,
          candidateScore?.band ?? null,
        ) ?? 0
      }
      nextBandName={nextBandLabel(candidateScore?.band ?? null) || 'Solid'}
      activeTab="home"
      onTabPress={(tab, href) => {
        if (tab === 'home') {
          router.replace('/home');
        } else {
          router.push(href as any);
        }
      }}
      onExploreJobs={() => router.push('/jobs')}
      onAllJobsPress={() => router.push('/jobs')}
      onJobPress={(jobId) =>
        router.push({ pathname: '/job-detail', params: { id: jobId } } as any)
      }
      onScorePress={() => setStep('share')}
      onAttributeCheckPress={() => router.push('/attribute-check' as any)}
      onMockInterviewPress={() => router.push('/mock-interview' as any)}
      onNotificationsPress={() => router.push('/notifications' as any)}
      onProfilePress={() => router.push('/you' as any)}
      onStreakPress={() => router.push('/streak' as any)}
      onCoursesPress={() => router.push('/courses' as any)}
    />
  );
}
