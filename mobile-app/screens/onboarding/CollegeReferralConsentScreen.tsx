import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Check } from 'phosphor-react-native';
import { apiRequest } from '@/services/api/client';
import { OnboardingProgress } from './OnboardingProgress';

export function CollegeReferralConsentScreen({ code, onDone }: { code: string; onDone: () => void }) {
  const [terms, setTerms] = useState<{ consent_version: string; text: string } | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loadTerms = async () => {
    setBusy(true);
    setError('');
    try { setTerms(await apiRequest<{ consent_version: string; text: string }>('/candidate/colleges/consent-terms?scope=ROSTER')); }
    catch { setError('College consent terms could not be loaded. Please try again.'); }
    finally { setBusy(false); }
  };
  useEffect(() => { void loadTerms(); }, []);
  const link = async () => {
    if (!terms || !agreed) return;
    setBusy(true);
    setError('');
    try {
      await apiRequest('/candidate/colleges/link', { method: 'POST', body: { code, consent_version: terms.consent_version } });
      onDone();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Your college could not be linked.'); }
    finally { setBusy(false); }
  };
  return <SafeAreaView style={{ flex: 1, backgroundColor: '#FFFCF7' }}>
    <ScrollView contentContainerStyle={{ padding: 20, gap: 20 }} keyboardShouldPersistTaps="handled">
      <OnboardingProgress step={0} />
      <Text style={{ fontFamily: 'GeneralSans-Bold', fontSize: 26, color: '#0A1931' }}>Link your college</Text>
      <Text style={{ fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 22, color: '#5F6B80' }}>Referral code: {code}</Text>
      {busy && <ActivityIndicator color="#5F4DB2" />}
      {!!error && <Text accessibilityRole="alert" style={{ fontFamily: 'GeneralSans-Medium', color: '#A33A2B' }}>{error}</Text>}
      {terms && <>
        <Text style={{ fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 22, color: '#0A1931' }}>{terms.text}</Text>
        <Pressable disabled={busy} accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed(!agreed)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 24, height: 24, borderWidth: 1, borderColor: '#5F4DB2', borderRadius: 6, backgroundColor: agreed ? '#5F4DB2' : '#fff' }}>{agreed && <Check size={22} color="#fff" />}</View>
          <Text style={{ fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#0A1931' }}>I agree to these terms</Text>
        </Pressable>
      </>}
      {!terms && !busy && <Pressable onPress={() => void loadTerms()}><Text style={{ fontFamily: 'GeneralSans-Medium', color: '#5F4DB2' }}>Try again</Text></Pressable>}
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable disabled={busy} onPress={onDone} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderRadius: 28, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DDD6C7' }}><ArrowLeft size={18} /><Text style={{ fontFamily: 'GeneralSans-Medium' }}>Skip</Text></Pressable>
        <Pressable disabled={busy || !agreed || !terms} onPress={() => void link()} style={{ flex: 1, padding: 16, borderRadius: 28, backgroundColor: '#5F4DB2', opacity: busy || !agreed || !terms ? 0.5 : 1, alignItems: 'center' }}><Text style={{ fontFamily: 'GeneralSans-Semibold', color: '#fff' }}>Link and continue</Text></Pressable>
      </View>
    </ScrollView>
  </SafeAreaView>;
}
