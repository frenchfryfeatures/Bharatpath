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
import { AppAlert } from "@/components/feedback/AppAlert";
import { useEffect, useState, useCallback } from 'react';
import { useRouter, useFocusEffect } from 'expo-router';
import { Alert } from 'react-native';
import { ProfileScreen } from '@/screens/profile/ProfileScreen';
import { TabName } from '@/components/navigation/BottomTabBar';
import { useAuthContext } from '@/context/AuthContext';
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

export default function YouRoute() {
  const router = useRouter();
  const { session, candidateFullName, setCandidateFullName, signOut, candidateScore, refreshScore } = useAuthContext();
  const [activeTab, setActiveTab] = useState<TabName>('you');

  // Seed the name with the email's local part so the header is never blank
  // while the real profile name is still being fetched or filled in.
  const emailName = nameFromEmail(session?.email);
  const [profileName, setProfileName] = useState<string | null>(
    candidateFullName || emailName || null,
  );
  const [locationLabel, setLocationLabel] = useState<string>('');
  const score = candidateScore;
  const [appliedCount, setAppliedCount] = useState<number | null>(null);
  const [addonsCount, setAddonsCount] = useState<number | null>(null);

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

  // Score. Re-fetches on focus so edits/recalculated score immediately reflect.
  useFocusEffect(
    useCallback(() => {
      refreshScore();
    }, [refreshScore])
  );

  // Applied count. Walks cursor pages; 0 on any error (incl. 402).
  useEffect(() => {
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
    setActiveTab(tab);
    if (tab === 'home') {
      router.replace('/home');
    } else if (tab !== 'you') {
      router.push(href as any);
    }
  };

  const scoreValue =
    score?.status === 'READY' && score.value != null ? score.value : undefined;
  const bandName = bandLabel(score?.band) || undefined;

  return (
    <ProfileScreen
      name={profileName || undefined}
      initials={initialsFromName(profileName) || undefined}
      locationLabel={locationLabel || undefined}
      bandName={bandName}
      score={scoreValue}
      scorePending={score == null || score.status !== 'READY'}
      appliedCount={appliedCount ?? undefined}
      addonsCount={addonsCount ?? undefined}
      activeTab={activeTab}
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
      onAddonsPress={() => router.push('/courses' as any)}
      onResumeDetailsPress={() => router.push('/profile-details' as any)}
      onAttributeReportPress={() => router.push('/attribute-report' as any)}
      onInterviewReportPress={() => router.push('/interview-sessions' as any)}
      onCoursesPress={() => router.push('/courses' as any)}
      onLanguagePress={() => {
        AppAlert.alert(
          'Language Settings',
          'Currently active: English. Hindi and regional languages available soon.',
          [{ text: 'OK' }],
        );
      }}
      onWhoHasSeenMePress={() => router.push('/who-has-seen-me' as any)}
      onDownloadDataPress={() => {
        AppAlert.alert(
          'Download Data',
          'Your data archive is being prepared. It will be ready by 15 Aug.',
          [{ text: 'Got it' }],
        );
      }}
      onLogoutPress={() => {
        AppAlert.alert(
          'Logout',
          'Are you sure you want to log out of your BharatPath account?',
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Log out',
              style: 'destructive',
              onPress: async () => {
                try {
                  await signOut();
                } catch (err) {
                  console.warn('[Profile] Error signing out:', err);
                }
                router.replace({ pathname: '/', params: { step: 'intro' } } as any);
              },
            },
          ],
        );
      }}
    />
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
