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
  UI_SCORE_MAX,
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

  // The card says the band unless the candidate turned on the exact
  // Bharatpath Score; what leaves the phone must say no more than the card.
  const resultText = (showExact: boolean) => {
    const bandStr = band ? `${band} band` : 'a verified Bharatpath Score';
    const scoreStr = showExact && scoreNum ? `${scoreNum}/${UI_SCORE_MAX} (${band ?? 'verified'})` : bandStr;
    return `I reached ${scoreStr} on BharatPath! Verify your Bharatpath Score and get discovered by top employers.`;
  };

  const handleShare = async (showExact: boolean) => {
    try {
      await Share.share({ message: resultText(showExact) });
    } catch {
      // User cancelled share sheet
    }
  };

  // Saving the card as an image needs a screen-capture module this build
  // does not include. Until then Save hands the same result to the phone's
  // own sheet ("Save to Files", "Copy", Notes...) instead of claiming a save
  // that never happened.
  const handleSave = async (showExact: boolean) => {
    try {
      await Share.share({ message: resultText(showExact), title: 'My Bharatpath Score' });
    } catch {
      AppAlert.alert('Could not save', 'Please try again.', [{ text: 'OK' }]);
    }
  };

  return (
    <ShareResultScreen
      score={scoreNum}
      maxScore={UI_SCORE_MAX}
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
