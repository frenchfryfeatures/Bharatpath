import AsyncStorage from '@react-native-async-storage/async-storage';

export type OnboardingMode = 'manual' | 'conversation';
const cache = new Map<string, OnboardingMode>();
const keyFor = (account: string) => `@bharatpath:onboarding-mode:${account}`;

export function shouldOfferOnboardingMode({ onboarding, editing, step, restored, mode, basicComplete, completed }: {
  onboarding: boolean; editing: boolean; step: number; restored: boolean;
  mode: OnboardingMode | null; basicComplete: boolean; completed: boolean;
}): boolean {
  return onboarding && editing && step > 0 && restored && mode === null && basicComplete && !completed;
}

export async function getOnboardingMode(account: string): Promise<OnboardingMode | null> {
  if (!account) return null;
  if (cache.has(account)) return cache.get(account)!;
  try {
    const value = await AsyncStorage.getItem(keyFor(account));
    if (value === 'manual' || value === 'conversation') {
      cache.set(account, value);
      return value;
    }
  } catch {
    // Keep onboarding usable if local storage is temporarily unavailable.
  }
  return null;
}

export async function saveOnboardingMode(account: string, mode: OnboardingMode): Promise<void> {
  if (!account) return;
  cache.set(account, mode);
  try {
    await AsyncStorage.setItem(keyFor(account), mode);
  } catch {
    // The in-memory choice still survives screen remounts during this app session.
  }
}
