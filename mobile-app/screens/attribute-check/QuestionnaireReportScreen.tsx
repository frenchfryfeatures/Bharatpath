import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, CheckCircle } from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import {
  getQuestionnaireReport,
  questionnaireErrorMessage,
  QuestionnaireReport,
  questionnaireSectionLabel,
} from '@/services/api/questionnaire';

export interface QuestionnaireReportScreenProps {
  onDone?: () => void;
  onUpdateAnswers?: () => void;
}

export function QuestionnaireReportScreen({
  onDone,
  onUpdateAnswers,
}: QuestionnaireReportScreenProps) {
  const [report, setReport] = useState<QuestionnaireReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getQuestionnaireReport()
      .then(setReport)
      .catch((caught) => {
        setError(questionnaireErrorMessage(caught, 'Could not load your answers.'));
      });
  }, []);

  if (!report) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          {error ? (
            <>
              <Text style={styles.errorText}>{error}</Text>
              <Pressable style={styles.primaryButton} onPress={onUpdateAnswers}>
                <Text style={styles.primaryText}>Open questions</Text>
              </Pressable>
              {onDone && (
                <Pressable
                  style={[styles.secondaryButton, { marginTop: 8 }]}
                  onPress={onDone}
                >
                  <Text style={styles.secondaryText}>Back</Text>
                </Pressable>
              )}
            </>
          ) : (
            <ActivityIndicator color="#5F4DB2" />
          )}
        </View>
      </SafeAreaView>
    );
  }

  const submitted = new Date(report.submitted_at).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={onDone}>
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
        </Pressable>
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>Your answers</Text>
          <Text style={styles.headerMeta}>Submitted {submitted}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.notice}>
          <CheckCircle size={21} color="#1F6B45" weight="fill" />
          <View style={styles.noticeCopy}>
            <Text style={styles.noticeTitle}>Answers submitted</Text>
            <Text style={styles.noticeText}>
              This is a read-back of what you shared, not an assessment or score.
            </Text>
          </View>
        </View>

        {report.sections.map((section) => (
          <View key={section.code} style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>{questionnaireSectionLabel(section.code)}</Text>
              <Text style={styles.sectionCount}>{section.answered} of {section.total} answered</Text>
            </View>
            <View style={styles.itemsCard}>
              {section.items.map((item, index) => (
                <View key={item.code} style={[styles.item, index > 0 && styles.itemBorder]}>
                  <Text style={styles.prompt}>{item.prompt}</Text>
                  <Text style={[styles.answer, !item.answered && styles.skipped]}>
                    {item.answered ? item.display.join(', ') : 'Skipped'}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        ))}

        <View style={styles.actions}>
          <Pressable style={styles.primaryButton} onPress={onDone}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
          <Pressable style={styles.secondaryButton} onPress={onUpdateAnswers}>
            <Text style={styles.secondaryText}>Update answers</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFCF7' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  headerTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 17, color: '#0A1931' },
  headerMeta: { fontFamily: 'GeneralSans-Regular', fontSize: 11, color: '#5F6B80', marginTop: 2 },
  scrollContent: { padding: 20, paddingBottom: 40, gap: 22 },
  notice: { flexDirection: 'row', gap: 12, backgroundColor: '#E6F1EA', borderRadius: 18, padding: 16 },
  noticeCopy: { flex: 1, gap: 3 },
  noticeTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#174D34' },
  noticeText: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 18, color: '#315E48' },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 },
  sectionTitle: { flex: 1, fontFamily: 'GeneralSans-Semibold', fontSize: 19, color: '#0A1931' },
  sectionCount: { fontFamily: 'GeneralSans-Regular', fontSize: 11, color: '#5F6B80' },
  itemsCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 20, overflow: 'hidden' },
  item: { padding: 16, gap: 6 },
  itemBorder: { borderTopWidth: 1, borderTopColor: '#EFE9DE' },
  prompt: { fontFamily: 'GeneralSans-Medium', fontSize: 13, lineHeight: 18, color: '#5F6B80' },
  answer: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, lineHeight: 20, color: '#0A1931' },
  skipped: { fontFamily: 'GeneralSans-Regular', color: '#8892A5' },
  actions: { gap: 10 },
  primaryButton: { backgroundColor: '#5F4DB2', borderRadius: Radii.pill, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', width: '100%' },
  primaryText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#FFFFFF' },
  secondaryButton: { borderWidth: 1, borderColor: '#DDD6C7', borderRadius: Radii.pill, paddingVertical: 15, paddingHorizontal: 24, alignItems: 'center', width: '100%' },
  secondaryText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  errorText: { fontFamily: 'GeneralSans-Regular', textAlign: 'center', color: '#8C2F1B', lineHeight: 20 },
});
