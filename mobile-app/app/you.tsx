/**
 * BharatPath - You / Profile Route
 *
 * Wires the profile screen to real backend data:
 *   - `GET /candidate/profile`        → full_name, city, state_code
 *   - `GET /candidate/score/me`      → score value + band (PENDING is normal)
 *   - `GET /candidate/applications`  → "Applied" count (walks cursor pages)
 *   - `GET /candidate/courses`       → completed courses (add-ons)
 *   - `GET /candidate/interview/sessions` → completed sessions (add-ons)
 *
 * The profile response carries no phone number (only name + location), so the
 * subtitle is "City, ST" - never a masked phone. The score card shows a dash
 * while PENDING and a real number when READY; it never invents a value.
 */
import { isScreenCacheFresh, readScreenCache, writeScreenCache } from '@/services/cache/screenCache';
import { navigateToTab } from '@/utils/tabNavigation';
import { useScreenRefresh } from '@/hooks/useScreenRefresh';
import { AppAlert } from "@/components/feedback/AppAlert";
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from 'react-native';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { ChangePasswordModal } from '@/screens/profile/ChangePasswordModal';
import { ProfilePhotoModal } from '@/components/profile/ProfilePhotoModal';
import { TabName } from '@/components/navigation/BottomTabBar';
import { useAuthContext } from '@/context/AuthContext';
import { useLogout } from '@/hooks/useLogout';
import {
  getCandidateProfile,
  CandidateProfileResponse,
} from '@/services/api/auth';
import {
  getMyScore,
  CandidateScoreResponse,
  bandLabel,
} from '@/services/api/scoring';
import { resolveCandidateFullName } from '@/services/profile/name';
import { initialsFromName, nameFromEmail } from '@/services/profile/display';
import { countMyApplications } from '@/services/api/applications';
import { countCompletedCourses } from '@/services/api/courses';
import { listInterviewSessions } from '@/services/api/interview';
import {
  getCandidateSubscription,
  SubscriptionResponse,
} from '@/services/api/subscription';

const YOU_CACHE_KEY = 'you:summary';
interface YouSummary {
  locationLabel: string;
  appliedCount: number | null;
  addonsCount: number | null;
  subscription: SubscriptionResponse | null;
}

export default function YouRoute() {
  const router = useRouter();
  const logout = useLogout();
  const {
    session,
    candidateFullName,
    setCandidateFullName,
    candidateScore,
    refreshScore,
    candidatePhotoUrl,
    setCandidatePhotoUrl,
    refreshPhoto,
  } = useAuthContext();
  const [activeTab, setActiveTab] = useState<TabName>('you');
  const [changePasswordVisible, setChangePasswordVisible] = useState(false);
  const [photoModalVisible, setPhotoModalVisible] = useState(false);

  // Automatically refresh photo and score when navigating to You tab
  useFocusEffect(
    useCallback(() => {
      refreshPhoto().catch(() => undefined);
      refreshScore().catch(() => undefined);
    }, [refreshPhoto, refreshScore])
  );

  // Seed the name with the email's local part so the header is never blank
  // while the real profile name is still being fetched or filled in.
  const emailName = nameFromEmail(session?.email);
  const [profileName, setProfileName] = useState<string | null>(
    candidateFullName || emailName || null,
  );
  // Last visit's header and counts, drawn at once and refreshed behind
  // (2026-11-23). A visit within a minute of the last skips the recount.
  const cachedYou = readScreenCache<YouSummary>(YOU_CACHE_KEY);
  const youFresh = isScreenCacheFresh(YOU_CACHE_KEY, 60_000);
  const [locationLabel, setLocationLabel] = useState<string>(cachedYou?.locationLabel ?? '');
  const score = candidateScore;
  const [appliedCount, setAppliedCount] = useState<number | null>(cachedYou?.appliedCount ?? null);
  const [addonsCount, setAddonsCount] = useState<number | null>(cachedYou?.addonsCount ?? null);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(cachedYou?.subscription ?? null);
  useEffect(() => {
    if (appliedCount == null && addonsCount == null && !subscription && !locationLabel) return;
    writeScreenCache(YOU_CACHE_KEY, { locationLabel, appliedCount, addonsCount, subscription });
  }, [locationLabel, appliedCount, addonsCount, subscription]);

  // Profile name + location. The name is resolved (and saved for an account
  // that has none) via `resolveCandidateFullName`; the location comes straight
  // from `GET /candidate/profile`. When neither is available, the email's
  // local part is used so the header is never blank.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const profile = await getCandidateProfile();
        if (cancelled) return;
        if (profile.full_name?.trim()) {
          setProfileName(profile.full_name.trim());
        } else {
          setProfileName(emailName || null);
        }
        setLocationLabel(formatLocation(profile));
      } catch {
        // A 402 (lapsed subscription) or network error leaves the seed name.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Resolve + persist the name for an account whose profile row is empty.
  // Falls back to the email's local part if no name can be resolved at all.
  useEffect(() => {
    let cancelled = false;
    resolveCandidateFullName(candidateFullName || null)
      .then((name) => {
        if (cancelled) return;
        const resolved = name || emailName || null;
        if (resolved) {
          setProfileName(resolved);
          if (name) setCandidateFullName(name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscription. Fetches current membership status.
  const refreshSubscription = useCallback(() => {
    getCandidateSubscription()
      .then((sub) => setSubscription(sub))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshSubscription();
  }, [refreshSubscription]);

  // Counts and header details, re-read on every return and on pull
  // (2026-11-23): they used to load once, so a new application or a finished
  // course did not show until the app restarted.
  const loadExtras = useCallback(async () => {
    const [profile, applied, courses, sessions] = await Promise.all([
      getCandidateProfile().catch(() => null),
      countMyApplications().catch(() => null),
      countCompletedCourses().catch(() => null),
      listInterviewSessions()
        .then((rows) => rows.filter((s) => s.state === 'COMPLETED' || s.state === 'EVALUATED').length)
        .catch(() => 0),
    ]);
    if (profile) {
      if (profile.full_name?.trim()) setProfileName(profile.full_name.trim());
      setLocationLabel(formatLocation(profile));
    }
    if (applied != null) setAppliedCount(applied);
    if (courses != null) setAddonsCount(courses + sessions);
  }, []);
  const { refreshing: pulling, onRefresh: pullToRefresh } = useScreenRefresh(() =>
    Promise.all([
      refreshScore().catch(() => undefined),
      refreshPhoto().catch(() => undefined),
      Promise.resolve(refreshSubscription()),
      loadExtras(),
    ]),
  );

  // Re-fetches on focus so edits, recalculated score and subscriptions immediately reflect.
  useFocusEffect(
    useCallback(() => {
      refreshScore();
      refreshSubscription();
    }, [refreshScore, refreshSubscription])
  );

  // Applied count. Walks cursor pages; 0 on any error (incl. 402).
  useEffect(() => {
    if (youFresh && cachedYou?.appliedCount != null) return;
    let cancelled = false;
    countMyApplications()
      .then((n) => {
        if (!cancelled) setAppliedCount(n);
      })
      .catch(() => {
        if (!cancelled) setAppliedCount(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Add-ons count = completed courses + completed interview sessions.
  // Both contribute to the score, so "completed" is the achievement count.
  useEffect(() => {
    if (youFresh && cachedYou?.addonsCount != null) return;
    let cancelled = false;
    (async () => {
      const [courses, sessions] = await Promise.all([
        countCompletedCourses(),
        listInterviewSessions()
          .then(
            (rows) =>
              rows.filter(
                (s) => s.state === 'COMPLETED' || s.state === 'EVALUATED',
              ).length,
          )
          .catch(() => 0),
      ]);
      if (!cancelled) setAddonsCount(courses + sessions);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTabPress = (tab: TabName, href: string) => {
    navigateToTab(router, 'you', tab, href);
  };

  const scoreValue =
    score?.status === 'READY' && score.value != null ? score.value : undefined;
  const bandName = bandLabel(score?.band) || undefined;

  return (
    <>
      <ProfileScreen
        refreshing={pulling}
        onRefresh={pullToRefresh}
        onJobPreferencesPress={() => router.push('/job-preferences' as any)}
      name={profileName || undefined}
      initials={initialsFromName(profileName) || undefined}
      photoUrl={candidatePhotoUrl}
      onEditPhotoPress={() => setPhotoModalVisible(true)}
      locationLabel={locationLabel || undefined}
      bandName={bandName}
      score={scoreValue}
      scorePending={score == null || score.status !== 'READY'}
      appliedCount={appliedCount ?? undefined}
      addonsCount={addonsCount ?? undefined}
      subscriptionState={subscription?.state}
      hasSubscriptionAccess={!!subscription?.has_access}
      activeTab="you"
      onTabPress={handleTabPress}
      onScorePress={() =>
        router.push({
          pathname: '/share-result',
          params: {
            score: scoreValue != null ? String(scoreValue) : '',
            bandName: bandName || '',
          },
        } as any)
      }
      onAppliedPress={() => router.push('/board' as any)}
      onAddonsPress={() => router.push('/addons' as any)}
      onResumeDetailsPress={() => router.push('/profile-details' as any)}
      onResumeReviewPress={() => router.push('/resume-details' as any)}
      onSubscriptionPress={() => router.push('/subscription' as any)}
      onAttributeReportPress={() => router.push('/attribute-report' as any)}
      onInterviewReportPress={() => router.push('/interview-sessions' as any)}
      onCoursesPress={() => router.push('/courses' as any)}
      onCollegePress={() => router.push('/college' as any)}
      onLanguagePress={() => {
        AppAlert.alert(
          'Language Settings',
          'Currently active: English. Hindi and regional languages available soon.',
          [{ text: 'OK' }],
        );
      }}
      onChangePasswordPress={() => setChangePasswordVisible(true)}
      onWhoHasSeenMePress={() => router.push('/who-has-seen-me' as any)}
      onDownloadDataPress={() => router.push({ pathname: '/privacy-policy', params: { section: 'your-data' } } as any)}
      onPrivacyPolicyPress={() => router.push('/privacy-policy' as any)}
      onLogoutPress={() => {
        AppAlert.alert(
          'Logout',
          'Are you sure you want to log out of your BharatPath account?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Log out',
              style: 'destructive',
              onPress: () => { void logout(); },
            },
          ],
        );
      }}
    />
    <ProfilePhotoModal
      visible={photoModalVisible}
      onClose={() => setPhotoModalVisible(false)}
      currentPhotoUrl={candidatePhotoUrl}
      candidateName={profileName || 'Candidate'}
      initials={initialsFromName(profileName) || 'C'}
      onPhotoUpdated={(newUrl) => {
        setCandidatePhotoUrl(newUrl);
      }}
    />
    <ChangePasswordModal
      visible={changePasswordVisible}
      onClose={() => setChangePasswordVisible(false)}
    />
    </>
  );
}

/**
 * Build the location subtitle from the profile response.
 *
 * The profile carries no phone number - only `city` and `state_code` - so the
 * subtitle is "City, ST" (or just one half if the other is missing). Returns
 * an empty string when neither is set, and the caller hides the line.
 */
function formatLocation(profile: CandidateProfileResponse): string {
  const city = profile.city?.trim();
  const state = profile.state_code?.trim();
  if (city && state) return `${city}, ${state}`;
  if (city) return city;
  if (state) return state;
  return '';
}
