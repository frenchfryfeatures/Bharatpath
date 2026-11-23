import { clearScreenCache } from '@/services/cache/screenCache';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { CareerScoreData, ResumeMetadata } from '@/types/user';
import { mockCareerScore } from '@/mocks/mockData';

interface AppContextType {
  preferredLanguage: string;
  setPreferredLanguage: (lang: string) => void;
  fileMeta: ResumeMetadata | null;
  setFileMeta: (meta: ResumeMetadata | null) => void;
  careerScore: CareerScoreData;
  setCareerScore: React.Dispatch<React.SetStateAction<CareerScoreData>>;
  activeTab: 'preview' | 'home' | 'jobs' | 'board' | 'you';
  setActiveTab: (tab: 'preview' | 'home' | 'jobs' | 'board' | 'you') => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [preferredLanguage, setPreferredLanguage] = useState<string>('en');
  const [fileMeta, setFileMeta] = useState<ResumeMetadata | null>(null);
  const [careerScore, setCareerScore] = useState<CareerScoreData>({
    current: mockCareerScore.current,
    max: mockCareerScore.max,
    label: mockCareerScore.label,
    delta: mockCareerScore.delta,
    band: 1,
    breakdown: {
      education: 72,
      skills: 48,
      experience: 15,
      projects: 55,
      presentation: 66,
    },
  });
  const [activeTab, setActiveTab] = useState<'preview' | 'home' | 'jobs' | 'board' | 'you'>('preview');

  // A different account (or none) must not inherit the last one's state.
  const { session } = useAuthContext();
  const userId = session?.userId ?? null;
  const previousUser = useRef(userId);
  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    clearScreenCache();
    setFileMeta(null);
    setActiveTab('preview');
  }, [userId]);

  return (
    <AppContext.Provider
      value={{
        preferredLanguage,
        setPreferredLanguage,
        fileMeta,
        setFileMeta,
        careerScore,
        setCareerScore,
        activeTab,
        setActiveTab,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within an AppProvider');
  }
  return context;
}
