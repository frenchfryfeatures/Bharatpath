import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Sparkle, WarningCircle } from 'phosphor-react-native';
import { confirmResumeVersion } from '@/services/api/resume';

export function PaidScoringScreen({
  versionId,
  onConfirmed,
  onBack,
}: {
  versionId: string;
  onConfirmed: (confirmedAt: string) => void;
  onBack: () => void;
}) {
  const started = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await confirmResumeVersion(versionId);
      onConfirmed(result.confirmed_at);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Scoring could not start. Confirm your membership is active and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void start();
  }, []); // The version is fixed for this mounted stage.

  return (
    <SafeAreaView style={styles.screen}>
      <StatusBar style="dark" animated />
      <View style={styles.content}>
        <View style={styles.icon}>
          <Sparkle size={30} color="#5F4DB2" weight="fill" />
        </View>
        <Text style={styles.title}>Start your resume score</Text>
        <Text style={styles.subtitle}>
          Membership is active. We are confirming your reviewed resume and
          starting score computation now.
        </Text>
        {busy ? <ActivityIndicator size="large" color="#5F4DB2" /> : null}
        {error ? (
          <View style={styles.error}>
            <WarningCircle size={18} color="#993A22" weight="fill" />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}
        {!busy && error ? (
          <Pressable style={styles.primary} onPress={() => void start()}>
            <Text style={styles.primaryText}>Try again</Text>
          </Pressable>
        ) : null}
        <Pressable
          style={styles.back}
          onPress={onBack}
          disabled={busy}
          accessibilityRole="button"
        >
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
          <Text style={styles.backText}>Back to membership</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' },
  content: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 18,
  },
  icon: {
    width: 64,
    height: 64,
    borderRadius: 20,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 34,
    color: '#0A1931',
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 23,
    color: '#3A4761',
  },
  error: {
    flexDirection: 'row',
    gap: 10,
    borderRadius: 14,
    backgroundColor: '#FCEDE9',
    padding: 14,
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#8F3B3B',
  },
  primary: {
    minHeight: 54,
    borderRadius: 28,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  back: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  backText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: '#0A1931',
  },
});
