/**
 * BharatPath - Foundation Preview & Authentication Flow
 * Seamlessly connects Candidate Auth (Cognito-aligned) with the Onboarding & Core App.
 */
import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ActivityIndicator, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';

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
import type {
  UploadedFileMeta,
  ResumeIntakePayload,
} from '@/screens/onboarding/ResumeIntakeScreen';
import { ParsingScreen } from '@/screens/onboarding/ParsingScreen';
import { CareerDetailsScreen } from '@/screens/profile/CareerDetailsScreen';
import { ResumeUploadRequiredScreen } from '@/screens/onboarding/ResumeUploadRequiredScreen';
import { nextAfterProfile } from '@/services/profile/onboarding';
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
import { useScoreChange } from '@/hooks/useScoreChange';
import { getCandidateSubscription } from '@/services/api/subscription';
import { clearPendingResume, getPendingResume, keepPendingResume, updatePendingResume } from '@/services/storage/pendingResume';
import { resumeFileError } from '@/services/profile/resumeFile';
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
  | 'resume-required'
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
  const params = useLocalSearchParams<{ step?: string }>();
  const {
    session,
    candidateFullName,
    candidateScore: authCandidateScore,
    setCandidateScore: setAuthCandidateScore,
    updateCandidateScore,
    refreshScore,
    rememberCandidate,
    isLoading: authLoading,
  } = useAuthContext();
  const [step, setStep] = useState<AppStep>(
    params.step &&
      params.step !== 'review' &&
      params.step !== 'intake' &&
      params.step !== 'splash' &&
      params.step !== 'resume-builder' &&
      params.step !== 'resume-decision'
      ? params.step as AppStep
      : 'splash',
  );
  const [fileMeta, setFileMeta] = useState<UploadedFileMeta | undefined>();
  const [parsingOrigin, setParsingOrigin] = useState<'signup' | 'resume-required'>('signup');
  const [reviewFromParsing, setReviewFromParsing] = useState(false);
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

  const [resumeVersionId, setResumeVersionId] = useState<string | undefined>();
  const [resumeVersionDetails, setResumeVersionDetails] =
    useState<ResumeVersionDetailResponse | null>(null);
  const [localCandidateScore, setLocalCandidateScore] =
    useState<CandidateScoreResponse | null>(null);
  const [confirmedAtTimestamp, setConfirmedAtTimestamp] = useState<
    string | null
  >(null);
  const [subscriptionGateReady, setSubscriptionGateReady] = useState(false);
  const [splashDone, setSplashDone] = useState(false);
  const splashRestoreStarted = useRef(false);
  const appliedStepParam = useRef<string | null>(null);

  // Synchronize score with AuthContext
  const candidateScore = authCandidateScore || localCandidateScore;
  const scoreGain = useScoreChange(session?.userId, candidateScore);

  // Refresh candidate score on screen focus so newly scored resumes are reflected
  useFocusEffect(
    useCallback(() => {
      refreshScore().catch(() => undefined);
    }, [refreshScore]),
  );

  useEffect(() => {
    if (params.step && !authLoading && appliedStepParam.current !== params.step) {
      appliedStepParam.current = params.step;
      if (params.step === 'review' || params.step === 'intake' ||
          params.step === 'resume-required' || params.step === 'resume-builder' ||
          params.step === 'resume-decision') {
        if (!session) {
          setStep('intro');
          return;
        }
      }
      setStep(params.step === 'resume-builder' || params.step === 'resume-decision'
        ? 'resume-required' : params.step as AppStep);
      if (params.step === 'intro' || params.step === 'login' || params.step === 'intake') {
        if (params.step === 'intro' || params.step === 'login') {
          setUserEmail('');
          setUserName('');
        }
        setUserPassword('');
        setResumeVersionId(undefined);
        setResumeVersionDetails(null);
        setLocalCandidateScore(null);
        setFileMeta(undefined);
        setIntakePayload(undefined);
        setOnboardingDraft(null);
      }
    }
  }, [params.step, session, authLoading]);

  // Membership requires a completed profile with an owned uploaded resume.
  useEffect(() => {
    if (step !== 'subscribe') {
      setSubscriptionGateReady(false);
      return;
    }
    let cancelled = false;
    setSubscriptionGateReady(false);
    (async () => {
      const active = session || await getCurrentSession();
      if (cancelled) return;
      if (!active) { setStep('login'); return; }
      const profile = await getCareerProfile();
      if (cancelled) return;
      const destination = nextAfterProfile(profile, false);
      if (destination === 'review') { setOnboardingSection(1); setStep('review'); return; }
      if (destination === 'resume-required') { setStep('resume-required'); return; }
      setResumeVersionId(profile.resume_version_id ?? undefined);
      setSubscriptionGateReady(true);
    })().catch((error) => {
      if (cancelled) return;
      console.warn('Membership gate failed:', error);
      AppAlert.alert('Could not check your profile', 'Please check your connection and try again.');
      setStep('review');
    });
    return () => { cancelled = true; };
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

  const continueAfterProfile = async (profile: Awaited<ReturnType<typeof getCareerProfile>>) => {
    const beforePayment = nextAfterProfile(profile, false);
    if (beforePayment === 'review') {
      setOnboardingSection(1);
      setStep('review');
      return;
    }
    if (beforePayment === 'resume-required') {
      setStep('resume-required');
      return;
    }
    setResumeVersionId(profile.resume_version_id ?? undefined);
    try {
      const subscription = await getCandidateSubscription();
      if (nextAfterProfile(profile, Boolean(subscription?.has_access)) === 'paid-scoring') {
        setStep('paid-scoring');
        return;
      }
    } catch (error) {
      console.warn('Could not check membership; showing payment page:', error);
    }
    setStep(collegeReferralCode ? 'referral' : 'subscribe');
  };

  const restoreOnboarding = async (email?: string) => {
    try {
      const [score, versions, profile, pending] = await Promise.all([
        getMyScore().catch(() => null),
        listResumeVersions(),
        getCareerProfile(),
        getPendingResume(),
      ]);
      const latest = versions.find((version) => !version.superseded);
      const matchingPending = pending && (!pending.email || pending.email === email?.toLowerCase()) ? pending : null;
      const currentVersionId = profile.resume_version_id || latest?.resume_version_id;
      if (matchingPending) {
        const pendingOrigin = matchingPending.origin === 'signup' || !matchingPending.origin
          ? 'signup' : 'resume-required';
        setParsingOrigin(pendingOrigin);
        setFileMeta(matchingPending.file);
        setIntakePayload({ source: 'upload', fileMeta: matchingPending.file });
        setResumeVersionId(matchingPending.versionId);
        if (matchingPending.fullName) setUserName(matchingPending.fullName);
        if (matchingPending.details) setOnboardingDraft(matchingPending.details);
        if (matchingPending.referralCode) setCollegeReferralCode(matchingPending.referralCode);
        if (!matchingPending.versionId) {
          if (matchingPending.details) {
            try {
              await saveCareerProfile(matchingPending.details, null, false, matchingPending.file.fileName);
            } catch (error) {
              console.warn('Could not sync saved signup draft before parsing:', error);
            }
          }
          setStep('parsing');
          return;
        }
        const details = await getResumeVersionDetails(matchingPending.versionId);
        setResumeVersionDetails(details);
        if (details.confirmed_at) {
          setConfirmedAtTimestamp(details.confirmed_at);
          const scoredAt = score?.computed_at ? Date.parse(score.computed_at) : 0;
          if (score?.status === 'READY' && scoredAt >= Date.parse(details.confirmed_at)) {
            await clearPendingResume();
            router.replace('/home');
          } else setStep('scoring');
        } else {
          if (pendingOrigin === 'resume-required') {
            const saved = await saveCareerProfile(
              profile.details, matchingPending.versionId, true, matchingPending.file.fileName,
            );
            await continueAfterProfile(saved);
            return;
          }
          setOnboardingSection(1);
          setReviewFromParsing(true);
          setStep('review');
        }
        return;
      }
      if (!profile.completed) {
        setResumeVersionId(currentVersionId);
        setOnboardingSection(1);
        setStep('review');
        return;
      }
      if (!profile.resume_file_id) {
        setStep('resume-required');
        return;
      }
      if (!score || score.status !== 'READY' || score.value == null) {
        setResumeVersionId(currentVersionId);
        setOnboardingSection(1);
        if (profile.completed && currentVersionId) {
          const details = await getResumeVersionDetails(currentVersionId);
          setResumeVersionDetails(details);
          if (details.confirmed_at) {
            setConfirmedAtTimestamp(details.confirmed_at);
            setStep('scoring');
          } else {
            const subscription = await getCandidateSubscription().catch(() => null);
            setStep(subscription?.has_access ? 'paid-scoring' : 'subscribe');
          }
        } else setStep('review');
        return;
      }
      setOnboardingSection(0);
      setOnboardingDraft(null);
      setIntakePayload(undefined);
      setFileMeta(undefined);
      setResumeVersionId(currentVersionId);
      
      refreshScore().catch(() => undefined);
      router.replace('/home');

      if (currentVersionId) {
        getResumeVersionDetails(currentVersionId)
          .then(setResumeVersionDetails)
          .catch(() => setResumeVersionDetails(null));
      } else {
        setResumeVersionDetails(null);
      }
    } catch {
      setOnboardingSection(1);
      setOnboardingDraft(null);
      setStep('review');
    }
  };

  useEffect(() => {
    if (!splashDone || authLoading || step !== 'splash') return;
    if (splashRestoreStarted.current) return;
    splashRestoreStarted.current = true;
    let cancelled = false;
    (async () => {
      const activeSession = session || (await getCurrentSession());
      if (cancelled) return;
      if (activeSession) {
        await restoreOnboarding(activeSession.email);
        return;
      }
      const pending = await getPendingResume();
      if (cancelled) return;
      if (pending) {
        setParsingOrigin(pending.origin && pending.origin !== 'signup' ? 'resume-required' : 'signup');
        setFileMeta(pending.file);
        setIntakePayload({ source: 'upload', fileMeta: pending.file });
        if (pending.email) setUserEmail(pending.email);
        if (pending.fullName) setUserName(pending.fullName);
        if (pending.details) setOnboardingDraft(pending.details);
        if (pending.referralCode) setCollegeReferralCode(pending.referralCode);
      }
      setStep(pending?.email ? 'login' : 'intro');
    })().catch((error) => {
      console.warn('Could not restore onboarding:', error);
      if (!cancelled) setStep(session ? 'review' : 'intro');
    });
    return () => { cancelled = true; };
  }, [splashDone, authLoading, session, step]);

  if (step === 'splash') {
    return <SplashScreen onFinish={() => setSplashDone(true)} />;
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
        initialFullName={userName}
        initialEmail={userEmail}
        initialPhone={typeof onboardingDraft?.phone === 'string' ? onboardingDraft.phone : ''}
        initialWorkStatus={typeof onboardingDraft?.work_status === 'string' ? onboardingDraft.work_status : ''}
        initialReferralCode={collegeReferralCode}
        initialFileMeta={fileMeta}
        initialCareerDetails={onboardingDraft ?? undefined}
        onResumeSelected={(meta) => {
          setParsingOrigin('signup');
          setFileMeta(meta);
          setIntakePayload({ source: 'upload', fileMeta: meta });
          setResumeVersionId(undefined);
        }}
        onBack={() => setStep('intro')}
        onNavigateToLogin={() => setStep('login')}
        onSubmit={async (data, isUnconfirmed) => {
          await updatePendingResume({
            email: data.email.toLowerCase(),
            fullName: data.fullName,
            details: data.details,
            referralCode: data.referralCode,
          });
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
              setParsingOrigin('signup');
              setStep('parsing');
            } else {
              setOnboardingSection(1);
              setStep('review');
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
        onNavigateToVerification={async (email, pass) => {
          setUserEmail(email);
          if (pass) setUserPassword(pass);
          try {
            await resendConfirmationCode(email);
          } catch (e) {
            console.warn('Could not resend confirmation code on login redirect:', e);
          }
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
          if (onboardingDraft && !fileMeta && data.session.email.toLowerCase() === userEmail.toLowerCase()) {
            if (userName) await updateCandidateName(userName);
            try {
              await saveCareerProfile(onboardingDraft, null, false);
            } catch (err) {
              console.warn('Draft save error:', err);
            }
            setUserPassword('');
            if (fileMeta || intakePayload) {
              setStep('parsing');
            } else {
              setOnboardingSection(1);
              setStep('review');
            }
            return;
          }
          try {
            await restoreOnboarding(data.session.email);
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
            setParsingOrigin('signup');
            setStep('parsing');
          } else {
            setOnboardingSection(1);
            setStep('review');
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
        onGotIt={() => {
          setOnboardingSection(1);
          setStep('review');
        }}
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
          try {
            const saved = await getCareerProfile();
            if (!saved.completed || !saved.resume_file_id || !saved.resume_version_id) {
              setStep(saved.completed ? 'resume-required' : 'review');
              return;
            }
            setResumeVersionId(saved.resume_version_id);
          } catch {
            AppAlert.alert('Could not continue', 'Your profile could not be checked. Please try again.');
            return;
          }
          setStep('paid-scoring');
        }}
        onBack={() => {
          setOnboardingSection(1);
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
        onBack={() => {
          setOnboardingSection(1);
          setStep('review');
        }}
      />
    );
  }

  // 8. Onboarding: Resume Intake (Upload or Structured Input) - redirect to review mode selection
  if (step === 'intake') {
    setOnboardingSection(1);
    setStep('review');
    return null;
  }

  // 9. Onboarding: Resume Parsing
  if (step === 'parsing') {
    return (
      <ParsingScreen
        fileMeta={fileMeta}
        payload={intakePayload}
        initialDetails={fileMeta ? onboardingDraft ?? undefined : undefined}
        existingVersionId={resumeVersionId}
        onBack={() => {
          setStep(parsingOrigin);
        }}
        onReviewFound={async (verId, details) => {
          setResumeVersionId(verId);
          setResumeVersionDetails(details);
          if (parsingOrigin === 'resume-required') {
            const current = await getCareerProfile();
            const saved = await saveCareerProfile(
              current.details, verId, true, fileMeta?.fileName,
            );
            if (!saved.resume_file_id) throw new Error('The uploaded resume was not linked to your profile. Try again.');
            await continueAfterProfile(saved);
            return;
          }
          const extracted = extractCandidateResumeInfo(details);
          if (extracted.name && !userName) {
            setUserName(extracted.name);
          }
          setOnboardingSection(1);
          setReviewFromParsing(true);
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
          setStep(reviewFromParsing ? 'parsing' : 'signup');
        }}
        onDone={async (profile) => {
          const verId = profile.resume_version_id ?? resumeVersionId;
          if (verId) setResumeVersionId(verId);
          setOnboardingSection(1);
          setOnboardingDraft(null);
          await continueAfterProfile(profile);
        }}
      />
    );
  }

  // A completed profile needs a real uploaded resume before membership.
  if (step === 'resume-required') {
    return (
      <ResumeUploadRequiredScreen
        onBack={() => {
          setOnboardingSection(1);
          setStep('review');
        }}
        onUpload={async () => {
          try {
            const result = await DocumentPicker.getDocumentAsync({
              type: [
                'application/pdf',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
              ],
              copyToCacheDirectory: true,
            });
            if (result.canceled || !result.assets?.length) return;
            const asset = result.assets[0];
            const fileError = resumeFileError(asset);
            if (fileError) {
              AppAlert.alert('Cannot use this file', fileError);
              return;
            }
            const pending = await keepPendingResume({
              fileName: asset.name,
              fileUri: asset.uri,
              fileSizeBytes: asset.size,
              fileSize: asset.size ? `${Math.round(asset.size / 1024)} KB` : '',
              mimeType: asset.mimeType,
            });
            await updatePendingResume({ email: session?.email.toLowerCase(), origin: 'resume-required' });
            setParsingOrigin('resume-required');
            setFileMeta(pending.file);
            setIntakePayload({ source: 'upload', fileMeta: pending.file });
            setResumeVersionId(undefined);
            setStep('parsing');
          } catch (error) {
            console.warn('Could not select resume:', error);
            AppAlert.alert('File selection failed', 'Please choose your resume again.');
          }
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
          void getPendingResume()
            .then((pending) => {
              if (pending && pending.versionId === resumeVersionId &&
                  (!pending.email || pending.email === session?.email.toLowerCase())) {
                return clearPendingResume();
              }
            })
            .catch((error) => console.warn('Could not clear completed resume copy:', error));
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
      scoreGain={scoreGain}
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
