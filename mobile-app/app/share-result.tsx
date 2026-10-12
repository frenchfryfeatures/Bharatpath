/**
 * BharatPath - Share Your Result Route
 * Displays the candidate's shareable score card with option to toggle exact score,
 * save the card, or share with external networks.
 */
import { AppAlert } from "@/components/feedback/AppAlert";
import { useCallback, useEffect, useState, useMemo } from 'react';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { Share, Alert } from 'react-native';
import { ShareResultScreen } from '@/screens/onboarding/ShareResultScreen';
import { useAuthContext } from '@/context/AuthContext';
import { getCandidateProfile } from '@/services/api/auth';
import {
  getMyScore,
  CandidateScoreResponse,
  bandLabel,
} from '@/services/api/scoring';
import {
  listResumeVersions,
  getResumeVersionDetails,
  ResumeVersionDetailResponse,
} from '@/services/api/resume';
import { extractCandidateResumeInfo } from '@/services/profile/extractedResume';
import { resolveCandidateFullName } from '@/services/profile/name';

export default function ShareResultRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ score?: string; bandName?: string }>();
  const { candidateFullName, setCandidateFullName, candidateScore, refreshScore } = useAuthContext();

  const [profileName, setProfileName] = useState<string>(candidateFullName || '');
  const [profileCity, setProfileCity] = useState<string>('');
  const [resumeDetails, setResumeDetails] = useState<ResumeVersionDetailResponse | null>(null);

  // Fetch candidate score on focus to ensure consistency across screens
  useFocusEffect(
    useCallback(() => {
      refreshScore();
    }, [refreshScore])
  );

  useEffect(() => {
    let cancelled = false;

    // Fetch candidate profile for name & location
    getCandidateProfile()
      .then((profile) => {
        if (cancelled) return;
        if (profile.full_name?.trim()) {
          setProfileName(profile.full_name.trim());
        }
        if (profile.city?.trim()) {
          setProfileCity(profile.city.trim());
        }
      })
      .catch(() => undefined);

    // Resolve full name if needed
    resolveCandidateFullName(candidateFullName || null)
      .then((name) => {
        if (!cancelled && name) {
          setProfileName(name);
          setCandidateFullName(name);
        }
      })
      .catch(() => undefined);

    // Fetch resume details for field of study & score date
    listResumeVersions()
      .then(async (versions) => {
        if (cancelled || versions.length === 0) return;
        const preferred =
          versions.find((v) => v.confirmed && !v.superseded) ??
          versions.find((v) => !v.superseded) ??
          versions.find((v) => v.confirmed) ??
          versions[0];
        const details = await getResumeVersionDetails(preferred.resume_version_id);
        if (!cancelled) setResumeDetails(details);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  const resumeInfo = useMemo(() => {
    return extractCandidateResumeInfo(
      resumeDetails,
      profileName || candidateFullName || undefined,
      profileCity || undefined
    );
  }, [resumeDetails, profileName, candidateFullName, profileCity]);

  // Determine final score & band (combines live score and query params for instant render)
  const scoreNum =
    candidateScore?.status === 'READY' && candidateScore?.value != null
      ? candidateScore.value
      : params.score && !isNaN(Number(params.score))
      ? Number(params.score)
      : undefined;

  const band =
    bandLabel(candidateScore?.band) ||
    params.bandName ||
    (candidateScore?.status === 'READY' ? 'Emerging' : undefined);

  const displayName = resumeInfo.name || profileName || candidateFullName || undefined;

  const handleBack = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/home');
    }
  };

  const handleShare = async () => {
    try {
      const bandStr = band ? ` (${band})` : '';
      const scoreStr = scoreNum ? `${scoreNum}/990` : 'Verified';
      await Share.share({
        message: `I scored ${scoreStr}${bandStr} on BharatPath! Verify your employability score and get discovered by top employers.`,
      });
    } catch {
      // User cancelled share sheet
    }
  };

  const handleSave = () => {
    AppAlert.alert(
      'Result Saved',
      'Your BharatPath resume score card is saved to your profile.',
      [{ text: 'OK' }]
    );
  };

  return (
    <ShareResultScreen
      score={scoreNum}
      maxScore={990}
      bandName={band}
      candidateName={displayName}
      candidateField={resumeInfo.field || undefined}
      candidateCity={resumeInfo.city || profileCity || undefined}
      scoreDate={resumeInfo.scoreDate}
      onBack={handleBack}
      onSave={handleSave}
      onShare={handleShare}
    />
  );
}
