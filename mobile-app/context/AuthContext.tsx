import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import {
  AuthSession,
  CandidateProfileResponse,
  getCandidateProfile,
  getCurrentSession,
  signOut as apiSignOut,
  onSessionChange,
} from '@/services/api/auth';
import { bandIndex, CandidateScoreResponse, getMyScore, SCORE_BANDS } from '@/services/api/scoring';
import { UserProfile } from '@/types/user';
import {
  saveStoredSession,
  saveStoredCandidateName,
  getStoredCandidateName,
  saveStoredCandidateScore,
  getStoredCandidateScore,
  clearAllAuthData,
} from '@/services/storage/authStorage';
import { unregisterCurrentPushDevice } from '@/services/notifications/device';

interface AuthContextType {
  session: AuthSession | null;
  profile: UserProfile | null;
  /** `candidate_profiles.full_name`, asked at sign-up. Never a CV guess. */
  candidateFullName: string | null;
  /** Current verified candidate score from GET /candidate/score/me */
  candidateScore: CandidateScoreResponse | null;
  isLoading: boolean;
  setSession: React.Dispatch<React.SetStateAction<AuthSession | null>>;
  setProfile: React.Dispatch<React.SetStateAction<UserProfile | null>>;
  setCandidateFullName: React.Dispatch<React.SetStateAction<string | null>>;
  setCandidateScore: React.Dispatch<React.SetStateAction<CandidateScoreResponse | null>>;
  rememberCandidate: (session: AuthSession, profile?: CandidateProfileResponse | null, fullName?: string | null) => void;
  updateCandidateScore: (score: number, band?: string | number | null, computedAt?: string | null) => void;
  refreshScore: () => Promise<CandidateScoreResponse | null>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [candidateFullName, setCandidateFullName] = useState<string | null>(null);
  const [candidateScore, setCandidateScore] = useState<CandidateScoreResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const scoreRefreshSequence = useRef(0);

  const refreshScore = useCallback(async (): Promise<CandidateScoreResponse | null> => {
    const requestSequence = ++scoreRefreshSequence.current;
    try {
      const res = await getMyScore();
      if (!res) return null;

      // Several focused routes can refresh concurrently. Only the most recent
      // request may update state; a slower earlier response must not restore a
      // stale score after a newer response has already been applied.
      if (requestSequence !== scoreRefreshSequence.current) return res;

      setCandidateScore(res);
      // Persist PENDING as well as READY. Otherwise the old READY row remains
      // on the device and can reappear after an app restart while the newly
      // confirmed resume is still being scored.
      saveStoredCandidateScore(res);

      if (res.status === 'READY' && res.value != null) {
        const numericBand = res.band ? bandIndex(res.band) : 1;
        setProfile((current) => {
          if (!current) return current;
          if (current.readinessScore === res.value && current.readinessBand === numericBand) {
            return current;
          }
          return {
            ...current,
            readinessScore: res.value!,
            readinessBand: numericBand,
          };
        });
      }
      return res;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    async function initAuth() {
      try {
        const [sess, storedName, storedScore] = await Promise.all([
          getCurrentSession(),
          getStoredCandidateName(),
          getStoredCandidateScore(),
        ]);
        if (!isMounted) return;

        if (storedName) {
          setCandidateFullName(storedName);
        }
        if (storedScore) {
          setCandidateScore(storedScore);
        }
        if (sess) {
          setSession(sess);
          setProfile((current) => ({
            id: sess.userId,
            fullName: storedName || 'Candidate',
            email: sess.email,
            city: current?.city,
            state: current?.state,
            preferredLanguage: current?.preferredLanguage || 'en',
            education: current?.education || [],
            skills: current?.skills || [],
            experience: current?.experience || [],
            readinessScore: storedScore?.value ?? current?.readinessScore ?? 0,
            readinessBand: storedScore?.band ? bandIndex(storedScore.band) : current?.readinessBand ?? 1,
          }));

          // Background sync candidate profile name if not yet cached
          getCandidateProfile()
            .then((cand) => {
              if (!isMounted || !cand) return;
              if (cand.full_name?.trim()) {
                const freshName = cand.full_name.trim();
                setCandidateFullName(freshName);
                saveStoredCandidateName(freshName);
                setProfile((curr) => (curr ? { ...curr, fullName: freshName } : curr));
              }
            })
            .catch(() => undefined);

          refreshScore();
        }
      } catch (err) {
        console.warn('[AuthContext] initAuth failed:', err);
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initAuth();
    return () => {
      isMounted = false;
    };
  }, [refreshScore]);

  useEffect(() => {
    const unsubscribe = onSessionChange((newSession) => {
      if (!newSession) {
        setSession(null);
        setProfile(null);
        setCandidateFullName(null);
        setCandidateScore(null);
      } else {
        setSession(newSession);
      }
    });
    return unsubscribe;
  }, []);

  const rememberCandidate = useCallback((
    nextSession: AuthSession,
    candidateProfile?: CandidateProfileResponse | null,
    fullName?: string | null
  ) => {
    const resolved =
      (fullName && fullName.trim()) ||
      (candidateProfile?.full_name && candidateProfile.full_name.trim()) ||
      null;
    const mergedSession: AuthSession = {
      ...session,
      ...nextSession,
      refreshToken: nextSession.refreshToken || session?.refreshToken,
      idToken: nextSession.idToken || session?.idToken,
      expiresAt: nextSession.expiresAt || session?.expiresAt,
    };
    setSession(mergedSession);
    saveStoredSession(mergedSession);
    if (resolved) {
      setCandidateFullName(resolved);
      saveStoredCandidateName(resolved);
      setProfile((current) => ({
        id: mergedSession.userId,
        fullName: resolved,
        email: mergedSession.email,
        city: candidateProfile?.city || current?.city,
        state: candidateProfile?.state_code || current?.state,
        preferredLanguage: current?.preferredLanguage || 'en',
        education: current?.education || [],
        skills: current?.skills || [],
        experience: current?.experience || [],
        readinessScore: current?.readinessScore ?? 0,
        readinessBand: current?.readinessBand ?? 1,
      }));
    }
  }, [session]);

  const updateCandidateScore = useCallback((score: number, band?: string | number | null, computedAt?: string | null) => {
    let numericBand = 1;
    let bandStr = 'ENTRY';
    if (typeof band === 'number') {
      numericBand = band;
      bandStr = SCORE_BANDS[band - 1]?.code || 'ENTRY';
    } else if (band) {
      numericBand = bandIndex(band);
      bandStr = String(band);
    }
    const finalComputedAt = computedAt || new Date().toISOString();
    const scoreObj: CandidateScoreResponse = {
      status: 'READY',
      value: score,
      band: bandStr,
      computed_at: finalComputedAt,
    };
    saveStoredCandidateScore(scoreObj);
    setCandidateScore((prev) => {
      if (
        prev &&
        prev.status === 'READY' &&
        prev.value === score &&
        prev.band === bandStr &&
        prev.computed_at === finalComputedAt
      ) {
        return prev;
      }
      return scoreObj;
    });
    setProfile((current) => {
      if (!current) {
        return {
          id: session?.userId || '',
          fullName: candidateFullName || 'Candidate',
          email: session?.email || '',
          preferredLanguage: 'en',
          education: [],
          skills: [],
          experience: [],
          readinessScore: score,
          readinessBand: numericBand,
        };
      }
      if (current.readinessScore === score && current.readinessBand === numericBand) {
        return current;
      }
      return {
        ...current,
        readinessScore: score,
        readinessBand: numericBand,
      };
    });
  }, [candidateFullName, session]);

  const handleSignOut = useCallback(async () => {
    await unregisterCurrentPushDevice().catch((error) =>
      console.warn('[Notifications] could not unregister on sign out', error));
    await apiSignOut();
    setSession(null);
    setProfile(null);
    setCandidateFullName(null);
    setCandidateScore(null);
    await clearAllAuthData();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        session,
        profile,
        candidateFullName,
        candidateScore,
        isLoading,
        setSession,
        setProfile,
        setCandidateFullName,
        setCandidateScore,
        rememberCandidate,
        updateCandidateScore,
        refreshScore,
        signOut: handleSignOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuthContext must be used within an AuthProvider');
  }
  return context;
}
