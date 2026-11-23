import { useScreenRefresh } from '@/hooks/useScreenRefresh';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Clock, EyeSlash, LockSimple } from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import {
  getQuestionnaire,
  questionnaireErrorMessage,
  QuestionnaireView,
} from '@/services/api/questionnaire';

export interface AttributeCheckScreenProps {
  onBack?: () => void;
  onStartQuiz?: () => void;
  onViewReport?: () => void;
}

export function AttributeCheckScreen({ onBack, onStartQuiz, onViewReport }: AttributeCheckScreenProps) {
  const [questionnaire, setQuestionnaire] = useState<QuestionnaireView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setQuestionnaire(await getQuestionnaire());
    } catch (caught) {
      setError(questionnaireErrorMessage(caught, 'Could not load the questionnaire.'));
    }
  }, []);
  // Pull-to-refresh, and a quiet refetch on every return (2026-11-23).
  const { refreshing: pulling, onRefresh: pullToRefresh } = useScreenRefresh(load);

  useEffect(() => { void load(); }, [load]);

  const total = questionnaire?.sections.reduce((sum, section) => sum + section.questions.length, 0) ?? 12;
  const answered = questionnaire ? Object.keys(questionnaire.answers).length : 0;

  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.headerBar}>
        <Pressable style={styles.backButton} onPress={onBack} accessibilityRole="button">
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
        </Pressable>
        <Text style={styles.headerTitle}>How you like to work</Text>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={pullToRefresh} />}
      >
        <View style={styles.heroCard}>
          <Image source={require('../../assets/icons/card-attr.png')} style={styles.heroImage} resizeMode="contain" />
        </View>
        <View style={styles.titleSection}>
          <Text style={styles.screenTitle}>Your work preferences</Text>
          <Text style={styles.screenSubtitle}>
            About {total} optional questions about availability, locations, languages and work context.
          </Text>
        </View>
        <View style={styles.infoCard}>
          <InfoRow icon={<Clock size={20} color="#5F4DB2" />} text="Four short sections. Save and return whenever you like." />
          <InfoRow icon={<EyeSlash size={20} color="#0A1931" />} text="Your answers stay private for now." />
          <InfoRow icon={<LockSimple size={20} color="#0A1931" />} text="Your Bharatpath Score does not change." />
        </View>

        {error && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
            <Pressable onPress={load}><Text style={styles.retryText}>Try again</Text></Pressable>
          </View>
        )}
        {!questionnaire && !error ? <ActivityIndicator color="#5F4DB2" /> : null}
        {questionnaire ? (
          <View style={styles.actions}>
            <Pressable style={styles.primaryButton} onPress={questionnaire.submitted ? onViewReport : onStartQuiz}>
              <Text style={styles.primaryButtonText}>
                {questionnaire.submitted
                  ? 'View your answers'
                  : answered > 0
                    ? `Continue · ${answered} of ${total} answered`
                    : 'Start questions'}
              </Text>
            </Pressable>
            {questionnaire.submitted && (
              <Pressable style={styles.secondaryButton} onPress={onStartQuiz}>
                <Text style={styles.secondaryButtonText}>Update answers</Text>
              </Pressable>
            )}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoRow({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.iconContainer}>{icon}</View>
      <Text style={styles.infoRowText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFCF7' },
  headerBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#0A1931' },
  headerSpacer: { width: 40 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 36, gap: 24 },
  heroCard: { height: 180, borderRadius: 24, backgroundColor: '#DDD6F2', alignItems: 'center', justifyContent: 'center', marginTop: 12 },
  heroImage: { width: '68%', height: '68%' },
  titleSection: { gap: 8 },
  screenTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 28, lineHeight: 34, color: '#0A1931' },
  screenSubtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 15, lineHeight: 22, color: '#5F6B80' },
  infoCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 20, overflow: 'hidden' },
  infoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderBottomWidth: 1, borderBottomColor: '#EFE9DE' },
  iconContainer: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#F1EAF7', alignItems: 'center', justifyContent: 'center' },
  infoRowText: { flex: 1, fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 19, color: '#3A4761' },
  actions: { gap: 10 },
  primaryButton: { backgroundColor: '#5F4DB2', borderRadius: Radii.pill, paddingVertical: 16, alignItems: 'center' },
  primaryButtonText: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, color: '#FFFFFF' },
  secondaryButton: { borderWidth: 1, borderColor: '#DDD6C7', borderRadius: Radii.pill, paddingVertical: 15, alignItems: 'center' },
  secondaryButtonText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  errorCard: { padding: 16, borderRadius: 16, backgroundColor: '#FCEDE8', gap: 8 },
  errorText: { fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#8C2F1B' },
  retryText: { fontFamily: 'GeneralSans-Semibold', color: '#5F4DB2' },
});
