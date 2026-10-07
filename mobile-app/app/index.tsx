/**
 * BharatPath - Foundation Preview & Authentication Flow
 * Seamlessly connects Candidate Auth (Cognito-aligned) with the Onboarding & Core App.
 */
import { useState, useMemo, useEffect, useCallback } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';

import { SplashScreen } from '@/screens/splash/SplashScreen';
import { IntroScreen } from '@/screens/onboarding/IntroScreen';
import { CollegeReferralConsentScreen } from '@/screens/onboarding/CollegeReferralConsentScreen';
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
  membershipResumeVersion,
  onboardingDestination,
} from '@/services/profile/onboarding';
import {
  getCareerProfile,
  saveCareerProfile,
  type CareerDetails,
} from '@/services/api/career';
import { AppAlert } from '@/components/feedback/AppAlert';
import { ScoringScreen } from '@/screens/onboarding/ScoringScreen';
import { PaidScoringScreen } from '@/screens/onboarding/PaidScoringScreen';
import { ScoreRevealScreen } from '@/screens/onboarding/ScoreRevealScreen';
import { NotificationPermissionScreen } from '@/screens/onboarding/NotificationPermissionScreen';
import { ShareResultScreen } from '@/screens/onboarding/ShareResultScreen';
import {
  ResumeVersionDetailResponse,
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
import { getCandidateSubscription } from '@/services/api/subscription';
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
  | 'referral'
  | 'language'
  | 'howItWorks'
  | 'subscribe'
  | 'paid-scoring'
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
  const [collegeReferralCode, setCollegeReferralCode] = useState('');
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
  const [subscriptionGateReady, setSubscriptionGateReady] = useState(false);

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

  // Membership screen is shown directly after signup so candidate can pay before parsing, matching the web flow.
  useEffect(() => {
    if (step !== 'subscribe') {
      setSubscriptionGateReady(false);
      return;
    }
    if (!session) {
      setStep('login');
      return;
    }
    setSubscriptionGateReady(true);
  }, [session, step]);

  useEffect(() => {
    if (step === 'paid-scoring' && !resumeVersionId) setStep('review');
  }, [resumeVersionId, step]);

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

  const restoreOnboarding = async () => {
    const [versions, profile] = await Promise.all([listResumeVersions(), getCareerProfile()]);
    const latest = versions.find((version) => !version.superseded);
    setOnboardingSection(0);
    setOnboardingDraft(null);
    setIntakePayload(undefined);
    setFileMeta(undefined);
    setResumeVersionId(latest?.resume_version_id);
    const destination = onboardingDestination(profile, latest);
    if (destination === 'home') {
      refreshScore().catch(() => undefined);
      router.replace('/home');
    } else {
      setStep(destination);
    }
    // Resume detail rendering is helpful later, but it must never block an
    // existing confirmed candidate from reaching Home.
    if (latest) {
      getResumeVersionDetails(latest.resume_version_id)
        .then(setResumeVersionDetails)
        .catch(() => setResumeVersionDetails(null));
    } else {
      setResumeVersionDetails(null);
    }
  };

  if (step === 'splash') {
    return (
      <SplashScreen
        onFinish={async () => {
          const activeSession = session || (await getCurrentSession());
          if (activeSession) {
            try {
              await restoreOnboarding();
            } catch {
              setStep('review');
            }
            return;
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
          setCollegeReferralCode(data.referralCode ?? '');
          setOnboardingDraft(data.details);
          setOnboardingSection(1);
          setUserEmail(data.email);
          setUserName(data.fullName);
          setUserPassword(data.password);
          if (isUnconfirmed) {
            setStep('verify-email');
          } else {
            // Account created: proceed to resume intake/parsing -> review (steps 1,2,3,4) -> payment!
            try {
              if (data.details) {
                await saveCareerProfile(
                  data.details,
                  null,
                  false,
                  fileMeta?.fileName,
                );
              }
            } catch (err) {
              console.warn('Initial profile draft save error:', err);
            }
            if (fileMeta || intakePayload) {
              setStep('parsing');
            } else {
              setStep('intake');
            }
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
          // Recover the pending resume draft after verification required a manual login.
          if (onboardingDraft && data.session.email.toLowerCase() === userEmail.toLowerCase()) {
            if (userName) await updateCandidateName(userName);
            try {
              await saveCareerProfile(onboardingDraft, null, false, fileMeta?.fileName);
            } catch (err) {
              console.warn('Draft save error:', err);
            }
            setUserPassword('');
            if (fileMeta || intakePayload) {
              setStep('parsing');
            } else {
              setStep('intake');
            }
            return;
          }
          try {
            await restoreOnboarding();
          } catch (e) {
            console.warn('Could not check existing resume versions:', e);
            setOnboardingSection(0);
            setStep('review');
          }
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
              setUserPassword('');
            } catch (authErr) {
              console.warn('Auto sign-in after verification failed:', authErr);
              setUserPassword('');
              setStep('login');
              return;
            }
          } else {
            setStep('login');
            return;
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

          if (onboardingDraft) {
            try {
              await saveCareerProfile(
                onboardingDraft,
                null,
                false,
                fileMeta?.fileName,
              );
            } catch (err) {
              console.warn('Draft save error:', err);
            }
          }
          if (fileMeta || intakePayload) {
            setStep('parsing');
          } else {
            setStep('intake');
          }
        }}
        onResendCode={async () => {
          await resendConfirmationCode(userEmail);
        }}
      />
    );
  }

  // 5. Onboarding: Referral Consent
  if (step === 'referral') {
    return (
      <CollegeReferralConsentScreen
        code={collegeReferralCode}
        onDone={() => {
          setCollegeReferralCode('');
          setStep('subscribe');
        }}
      />
    );
  }
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

  // 7. Membership / Payment Screen (after completing Step 1, 2, 3, 4)
  if (step === 'subscribe') {
    if (!subscriptionGateReady) {
      return (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator size="large" color="#5F4DB2" />
        </View>
      );
    }
    return (
      <SubscribeScreen
        candidateName={userName}
        onSubscribed={async () => {
          // After payment is successful: Proceed to Paid Scoring confirmation!
          try {
            const saved = await getCareerProfile();
            if (saved.resume_version_id) {
              setResumeVersionId(saved.resume_version_id);
            }
          } catch {}
          setStep('paid-scoring');
        }}
        onSkip={() => {
          setStep('paid-scoring');
        }}
        onBack={() => {
          setOnboardingSection(3);
          setStep('review');
        }}
      />
    );
  }

  // Payment is complete. As on the website, confirmation is its own stage;
  // this is the first action that is allowed to start score computation.
  if (step === 'paid-scoring') {
    if (!resumeVersionId) {
      return (
        <View
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <ActivityIndicator size="large" color="#5F4DB2" />
        </View>
      );
    }
    return (
      <PaidScoringScreen
        versionId={resumeVersionId}
        onConfirmed={(confirmedAt) => {
          setConfirmedAtTimestamp(confirmedAt);
          setStep('scoring');
        }}
        onBack={() => setStep('subscribe')}
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
        initialDetails={fileMeta ? onboardingDraft ?? undefined : undefined}
        onBack={() => {
          setOnboardingSection(0);
          setStep('review');
        }}
        onReviewFound={async (verId, details) => {
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

  // 10. Onboarding: Review Parsed Details (The confirm gate before payment & scoring)
  if (step === 'review') {
    return (
      <CareerDetailsScreen
        onboarding
        initialSection={onboardingSection}
        resumeFilename={fileMeta?.fileName}
        versionId={resumeVersionId}
        onBack={() => {
          if (fileMeta || intakePayload) {
            setStep('intake');
          } else {
            router.replace('/you');
          }
        }}
        onDone={async (profile) => {
          const verId = profile.resume_version_id ?? resumeVersionId;
          if (verId) setResumeVersionId(verId);
          setOnboardingSection(3);
          setOnboardingDraft(null);

          // Step 1, 2, 3, 4 completed!
          // Check if candidate already has an active subscription
          try {
            const sub = await getCandidateSubscription();
            if (sub?.has_access) {
              setStep('paid-scoring');
              return;
            }
          } catch {}

          // If not subscribed: proceed to Payment!
          setStep(collegeReferralCode ? 'referral' : 'subscribe');
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
