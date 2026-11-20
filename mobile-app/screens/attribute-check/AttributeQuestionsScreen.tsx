import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Check, Info } from 'phosphor-react-native';
import { Radii } from '@/theme/tokens';
import {
  getQuestionnaire,
  questionnaireErrorMessage,
  questionnaireSectionLabel,
  QuestionnaireAnswer,
  QuestionnaireQuestion,
  QuestionnaireView,
  saveQuestionnaireAnswers,
  submitQuestionnaire,
} from '@/services/api/questionnaire';

export interface AttributeQuestionsScreenProps {
  onBack?: () => void;
  onSaveAndExit?: () => void;
  onSubmitted?: () => void;
}

export function AttributeQuestionsScreen({
  onBack,
  onSaveAndExit,
  onSubmitted,
}: AttributeQuestionsScreenProps) {
  const [view, setView] = useState<QuestionnaireView | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, QuestionnaireAnswer>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getQuestionnaire()
      .then((loaded) => {
        setView(loaded);
        setAnswers(loaded.answers);
        const initialDrafts: Record<string, string> = {};
        loaded.sections.flatMap((s) => s.questions).forEach((question) => {
          const value = loaded.answers[question.code];
          if (question.type === 'TEXT' || question.type === 'NUMBER') {
            initialDrafts[question.code] = value == null ? '' : String(value);
          } else if (question.type === 'MULTI' && question.options.length === 0) {
            initialDrafts[question.code] = Array.isArray(value) ? value.join(', ') : '';
          }
        });
        setDrafts(initialDrafts);
      })
      .catch((caught) => setError(questionnaireErrorMessage(caught, 'Could not load your questions.')));
  }, []);

  const section = view?.sections[sectionIndex];
  const totalQuestions = useMemo(
    () => view?.sections.reduce((sum, item) => sum + item.questions.length, 0) ?? 0,
    [view]
  );
  const questionsBefore = view?.sections
    .slice(0, sectionIndex)
    .reduce((sum, item) => sum + item.questions.length, 0) ?? 0;

  const savePatch = async (patch: Record<string, QuestionnaireAnswer>) => {
    setError(null);
    const saved = await saveQuestionnaireAnswers(patch);
    setAnswers(saved.answers);
    setView(saved);
  };

  const choose = async (question: QuestionnaireQuestion, value: QuestionnaireAnswer) => {
    const current = answers[question.code];
    let next = value;
    if (question.type === 'MULTI' && question.options.length > 0) {
      const list = Array.isArray(current) ? current : [];
      const code = String(value);
      next = list.includes(code) ? list.filter((item) => item !== code) : [...list, code];
      if ((next as string[]).length === 0) next = null;
    }
    setAnswers((existing) => ({ ...existing, [question.code]: next }));
    try {
      await savePatch({ [question.code]: next });
    } catch (caught) {
      setError(questionnaireErrorMessage(caught, 'Could not save that answer.'));
    }
  };

  const sectionPatch = (): Record<string, QuestionnaireAnswer> => {
    const patch: Record<string, QuestionnaireAnswer> = {};
    for (const question of section?.questions ?? []) {
      if (question.type === 'NUMBER') {
        const raw = (drafts[question.code] ?? '').trim();
        if (raw !== '' && (!/^\d+$/.test(raw) || Number(raw) > 100_000)) {
          throw new Error('Enter a whole number between 0 and 100,000.');
        }
        patch[question.code] = raw === '' ? null : Number(raw);
      } else if (question.type === 'TEXT') {
        patch[question.code] = (drafts[question.code] ?? '').trim() || null;
      } else if (question.type === 'MULTI' && question.options.length === 0) {
        const places = (drafts[question.code] ?? '').split(',').map((item) => item.trim()).filter(Boolean);
        if (places.length > 5) {
          throw new Error('Choose no more than five locations.');
        }
        if (places.some((place) => !/^[^\d@]{2,80}$/.test(place))) {
          throw new Error('Use place names only, separated by commas.');
        }
        patch[question.code] = places.length > 0 ? places : null;
      } else if (question.code in answers) {
        patch[question.code] = answers[question.code];
      }
    }
    return patch;
  };

  const saveCurrent = async () => {
    setBusy(true);
    setError(null);
    try {
      await savePatch(sectionPatch());
      return true;
    } catch (caught) {
      setError(questionnaireErrorMessage(caught, 'Could not save this section.'));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const next = async () => {
    if (!(await saveCurrent()) || !view) return;
    if (sectionIndex < view.sections.length - 1) {
      setSectionIndex((index) => index + 1);
      return;
    }
    setBusy(true);
    try {
      await submitQuestionnaire();
      onSubmitted?.();
    } catch (caught) {
      setError(questionnaireErrorMessage(caught, 'Could not submit your answers.'));
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    if (sectionIndex > 0) setSectionIndex((index) => index - 1);
    else onBack?.();
  };

  const saveAndExit = async () => {
    if (await saveCurrent()) onSaveAndExit?.();
  };

  if (!view || !section) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" />
        <View style={styles.center}>
          {error ? <Text style={styles.errorText}>{error}</Text> : <ActivityIndicator color="#5F4DB2" />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable style={styles.backButton} onPress={goBack}>
            <ArrowLeft size={18} color="#0A1931" weight="bold" />
          </Pressable>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${((sectionIndex + 1) / view.sections.length) * 100}%` }]} />
          </View>
          <Text style={styles.counter}>{sectionIndex + 1}/{view.sections.length}</Text>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          <Text style={styles.eyebrow}>{questionnaireSectionLabel(section.code).toUpperCase()}</Text>
          <Text style={styles.title}>{questionnaireSectionLabel(section.code)}</Text>
          <Text style={styles.subtitle}>
            Questions {questionsBefore + 1}–{questionsBefore + section.questions.length} of {totalQuestions}. Every answer is optional.
          </Text>

          {section.questions.map((question) => (
            <View key={question.code} style={styles.questionCard}>
              <Text style={styles.prompt}>{question.prompt}</Text>
              {question.help_text && <Text style={styles.help}>{question.help_text}</Text>}
              <QuestionControl
                question={question}
                answer={answers[question.code]}
                draft={drafts[question.code] ?? ''}
                onDraft={(value) => setDrafts((existing) => ({ ...existing, [question.code]: value }))}
                onChoose={(value) => void choose(question, value)}
              />
              {(question.code in answers || (drafts[question.code] ?? '').length > 0) && (
                <Pressable
                  onPress={() => {
                    setDrafts((existing) => ({ ...existing, [question.code]: '' }));
                    void choose(question, null);
                  }}
                >
                  <Text style={styles.clearText}>Clear answer</Text>
                </Pressable>
              )}
            </View>
          ))}

          {error && <View style={styles.errorCard}><Text style={styles.errorText}>{error}</Text></View>}
          <View style={styles.reassurance}>
            <Info size={18} color="#3A4761" />
            <Text style={styles.reassuranceText}>These answers never change your Bharatpath Score.</Text>
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <Pressable style={styles.exitButton} onPress={saveAndExit} disabled={busy}>
            <Text style={styles.exitText}>Save and exit</Text>
          </Pressable>
          <Pressable style={styles.nextButton} onPress={next} disabled={busy}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : (
              <Text style={styles.nextText}>{sectionIndex === view.sections.length - 1 ? 'Submit' : 'Save and continue'}</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function QuestionControl({
  question,
  answer,
  draft,
  onDraft,
  onChoose,
}: {
  question: QuestionnaireQuestion;
  answer: QuestionnaireAnswer | undefined;
  draft: string;
  onDraft: (value: string) => void;
  onChoose: (value: QuestionnaireAnswer) => void;
}) {
  if (question.type === 'TEXT' || question.type === 'NUMBER' || (question.type === 'MULTI' && question.options.length === 0)) {
    return (
      <TextInput
        style={[styles.input, question.type === 'TEXT' && styles.multilineInput]}
        value={draft}
        onChangeText={onDraft}
        placeholder={question.code === 'PREFERRED_LOCATIONS' ? 'For example: Pune, Mumbai' : question.type === 'NUMBER' ? 'Enter a number' : 'Type your answer'}
        placeholderTextColor="#8892A5"
        keyboardType={question.type === 'NUMBER' ? 'number-pad' : 'default'}
        multiline={question.type === 'TEXT'}
        maxLength={question.type === 'TEXT' ? 1000 : 200}
      />
    );
  }

  const options = question.type === 'BOOLEAN'
    ? [{ code: 'true', label: 'Yes', value: true }, { code: 'false', label: 'No', value: false }]
    : question.options.map((option) => ({ ...option, value: option.code }));

  return (
    <View style={styles.options}>
      {options.map((option) => {
        const selected = question.type === 'MULTI'
          ? Array.isArray(answer) && answer.includes(String(option.value))
          : answer === option.value;
        return (
          <Pressable
            key={option.code}
            style={[styles.option, selected && styles.optionSelected]}
            onPress={() => onChoose(option.value)}
            accessibilityRole={question.type === 'MULTI' ? 'checkbox' : 'radio'}
            accessibilityState={{ selected, checked: selected }}
          >
            <View style={[styles.check, selected && styles.checkSelected]}>
              {selected && <Check size={13} color="#FFFFFF" weight="bold" />}
            </View>
            <Text style={[styles.optionText, selected && styles.optionTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFCF7' },
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, gap: 12 },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', alignItems: 'center', justifyContent: 'center' },
  progressTrack: { flex: 1, height: 5, borderRadius: 99, backgroundColor: '#E7E0D4', overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#5F4DB2' },
  counter: { minWidth: 28, fontFamily: 'GeneralSans-Bold', fontSize: 12, color: '#3A4761' },
  scrollContent: { padding: 20, paddingBottom: 30, gap: 14 },
  eyebrow: { fontFamily: 'GeneralSans-Bold', fontSize: 11, letterSpacing: 1.3, color: '#A87C17' },
  title: { fontFamily: 'GeneralSans-Semibold', fontSize: 28, color: '#0A1931' },
  subtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 20, color: '#5F6B80', marginBottom: 8 },
  questionCard: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 20, padding: 17, gap: 10 },
  prompt: { fontFamily: 'GeneralSans-Semibold', fontSize: 17, lineHeight: 23, color: '#0A1931' },
  help: { fontFamily: 'GeneralSans-Regular', fontSize: 12, lineHeight: 17, color: '#5F6B80' },
  options: { gap: 8 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 13, borderRadius: 14, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFCF7' },
  optionSelected: { borderColor: '#5F4DB2', backgroundColor: '#F1EAF7' },
  check: { width: 20, height: 20, borderRadius: 6, borderWidth: 1.5, borderColor: '#B8B0A3', alignItems: 'center', justifyContent: 'center' },
  checkSelected: { backgroundColor: '#5F4DB2', borderColor: '#5F4DB2' },
  optionText: { flex: 1, fontFamily: 'GeneralSans-Medium', fontSize: 14, lineHeight: 19, color: '#3A4761' },
  optionTextSelected: { color: '#0A1931', fontFamily: 'GeneralSans-Semibold' },
  input: { borderWidth: 1, borderColor: '#DDD6C7', borderRadius: 14, padding: 14, fontFamily: 'GeneralSans-Regular', fontSize: 15, color: '#0A1931', backgroundColor: '#FFFCF7' },
  multilineInput: { minHeight: 100, textAlignVertical: 'top' },
  clearText: { alignSelf: 'flex-start', fontFamily: 'GeneralSans-Medium', fontSize: 12, color: '#5F4DB2' },
  errorCard: { padding: 14, borderRadius: 14, backgroundColor: '#FCEDE8' },
  errorText: { fontFamily: 'GeneralSans-Regular', color: '#8C2F1B', lineHeight: 19 },
  reassurance: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#F7EFD6' },
  reassuranceText: { flex: 1, fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#3A4761' },
  footer: { flexDirection: 'row', gap: 10, padding: 16, borderTopWidth: 1, borderTopColor: '#E7E0D4', backgroundColor: '#FFFCF7' },
  exitButton: { flex: 1, paddingVertical: 15, borderRadius: Radii.pill, borderWidth: 1, borderColor: '#DDD6C7', alignItems: 'center' },
  exitText: { fontFamily: 'GeneralSans-Semibold', color: '#0A1931' },
  nextButton: { flex: 1.4, paddingVertical: 15, borderRadius: Radii.pill, backgroundColor: '#5F4DB2', alignItems: 'center' },
  nextText: { fontFamily: 'GeneralSans-Semibold', color: '#FFFFFF' },
});
