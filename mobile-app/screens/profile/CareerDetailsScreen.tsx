import React, { useEffect, useRef, useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Modal,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, FileText, PencilSimple, X } from 'phosphor-react-native';
import { WebView } from 'react-native-webview';
import { useRouter } from 'expo-router';
import { OnboardingProgress } from '@/screens/onboarding/OnboardingProgress';
import { ConversationPrompt } from '@/screens/onboarding/ConversationPrompt';
import { PhoneNumberInput } from '@/components/inputs/PhoneNumberInput';
import {
  conversationQuestion,
  type ConversationAnswer,
} from '@/screens/onboarding/conversationQuestions';
import {
  applyCareerAnswer,
  formatSalaryDisplay,
  parseConversationAnswer,
} from '@/screens/onboarding/conversationValidation';
import { AppAlert } from '@/components/feedback/AppAlert';
import { ChatCircleDots, ListBullets } from 'phosphor-react-native';
import { useAuthContext } from '@/context/AuthContext';
import { updateCandidateName } from '@/services/api/auth';
import { getResumeVersionDetails } from '@/services/api/resume';
import {
  readyStructuredResume,
  structuredResumeCareerDetails,
} from '@/services/profile/structuredResume';
import {
  getCareerFields,
  getCareerProfile,
  intakeCareerResume,
  mergeResumeDetails,
  prefillCareerProfile,
  previewSignupResume,
  saveCareerProfile,
  getResumePreview,
  careerDetailsForSave,
  fieldRequired,
  fieldVisible,
  type CareerField,
  type CareerDetails,
  type CareerProfile,
} from '@/services/api/career';

const groups = [
  { key: 'basic', title: 'Basic details' },
  { key: 'employment', title: 'Employment details' },
  { key: 'education', title: 'Education details' },
  { key: 'preferences', title: 'Headline and preferences' },
];
const escapeHtml = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function CareerDetailsScreen({
  versionId,
  resumeFilename,
  onboarding = false,
  onBack,
  onDone,
  onUpdateResume,
  initialSection = 0,
}: {
  versionId?: string;
  resumeFilename?: string;
  onboarding?: boolean;
  onBack: () => void;
  onDone: (profile: CareerProfile) => void | Promise<void>;
  onUpdateResume?: () => void;
  initialSection?: number;
}) {
  const router = useRouter();
  const { candidateFullName, session, rememberCandidate } = useAuthContext();
  const [fullName, setFullName] = useState(candidateFullName ?? '');
  const [fields, setFields] = useState<CareerField[]>([]);
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(
    versionId ?? null,
  );
  const [draft, setDraft] = useState<CareerDetails>({});
  const [editing, setEditing] = useState(onboarding);
  const [step, setStep] = useState(initialSection);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string>>({});
  const [documentHtml, setDocumentHtml] = useState<string | null>(null);
  const [selectedFilename, setSelectedFilename] = useState(resumeFilename);
  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Record<string, number>>({});
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Conversational Onboarding Mode State
  const [onboardingMode, setOnboardingMode] = useState<'manual' | 'conversation' | null>(null);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationAnswer[]>([]);
  const [conversationInput, setConversationInput] = useState<string>('');
  const [conversationError, setConversationError] = useState('');
  const [attempts, setAttempts] = useState<{ answer: string; message: string }[]>([]);

  const activeFieldKey = useRef<string | null>(null);

  useEffect(() => {
    fieldOffsets.current = {};
  }, [step, editing]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const height = e.endCoordinates?.height || 280;
        setKeyboardHeight(height);
        if (activeFieldKey.current) {
          scrollToField(activeFieldKey.current);
        }
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        activeFieldKey.current = null;
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const onFieldLayout = (key: string, event: LayoutChangeEvent) => {
    fieldOffsets.current[key] = event.nativeEvent.layout.y;
  };

  const scrollToField = (key: string) => {
    activeFieldKey.current = key;
    const performScroll = () => {
      const y = fieldOffsets.current[key];
      if (y !== undefined && scrollRef.current) {
        scrollRef.current.scrollTo({ y: Math.max(0, y - 70), animated: true });
      }
    };
    performScroll();
    setTimeout(performScroll, 80);
    setTimeout(performScroll, 200);
    setTimeout(performScroll, 350);
  };

  const prefillRequest = useRef<{
    id: string;
    promise: Promise<CareerProfile>;
  } | null>(null);

  const goBack = () => {
    if (onboarding && step > 0 && onboardingMode === 'conversation') {
      if (stepDone) {
        setStepDone(false);
        return;
      }
      if (questionIndex > 0) {
        setQuestionIndex(questionIndex - 1);
        setConversationInput('');
        setConversationError('');
        return;
      }
      if (step > 1) {
        setStep(step - 1);
        setQuestionIndex(0);
        setStepDone(false);
        setConversationInput('');
        setConversationError('');
        return;
      }
      setStep(0);
      setOnboardingMode(null);
      return;
    }
    if (editing && step > 0) setStep(step - 1);
    else if (onboarding || !editing) onBack();
    else setEditing(false);
  };

  // Conversational questions for current step (evaluates visible branching)
  const currentStepFields = fields.filter(
    (field) =>
      field.section === groups[step].key && fieldVisible(field, draft),
  );
  const currentQuestionIdx = Math.min(
    questionIndex,
    Math.max(0, currentStepFields.length - 1),
  );
  const currentField = currentStepFields[currentQuestionIdx];

  const handleSendConversationAnswer = async (
    answerVal?: string,
    skip = false,
  ) => {
    if (!currentField || thinking) return;
    const rawAnswer = answerVal !== undefined ? answerVal : conversationInput;

    if (skip) {
      const updatedHistory: ConversationAnswer = {
        key: currentField.key,
        step,
        questionIndex: currentQuestionIdx,
        question: conversationQuestion(currentField),
        answer: 'Skipped for now',
      };
      setConversationHistory((prev) => [
        ...prev.filter((i) => i.key !== currentField.key),
        updatedHistory,
      ]);
      setConversationInput('');
      setConversationError('');
      setAttempts([]);

      const nextIdx = currentQuestionIdx + 1;
      if (nextIdx >= currentStepFields.length) {
        setThinking(true);
        setTimeout(() => {
          setStepDone(true);
          setThinking(false);
        }, 500);
      } else {
        setThinking(true);
        setTimeout(() => {
          setQuestionIndex(nextIdx);
          setThinking(false);
        }, 500);
      }
      return;
    }

    const isReq = fieldRequired(currentField, draft);
    const parsed = parseConversationAnswer(
      currentField,
      rawAnswer,
      isReq,
      draft,
    );
    if (parsed.error || parsed.value === undefined) {
      setConversationError(parsed.error || 'Invalid answer');
      setAttempts((prev) => [
        ...prev,
        { answer: rawAnswer, message: `Sorry, ${parsed.error || 'Invalid answer'}` },
      ]);
      setConversationInput('');
      return;
    }

    const updatedDraft = applyCareerAnswer(
      draft,
      currentField.key,
      parsed.value,
    );
    setDraft(updatedDraft);

    const displayAnswer =
      currentField.options?.find((o) => o.value === parsed.value)?.label ??
      (currentField.key === 'annual_salary' || currentField.key === 'preferred_salary'
        ? formatSalaryDisplay(typeof parsed.value === 'number' ? parsed.value : null)
        : Array.isArray(parsed.value)
          ? parsed.value.join(', ')
          : String(parsed.value ?? ''));

    const updatedHistory: ConversationAnswer = {
      key: currentField.key,
      step,
      questionIndex: currentQuestionIdx,
      question: conversationQuestion(currentField),
      answer: displayAnswer || 'Provided',
    };
    setConversationHistory((prev) => [
      ...prev.filter((i) => i.key !== currentField.key),
      updatedHistory,
    ]);
    setConversationInput('');
    setConversationError('');
    setAttempts([]);

    // Check branching on next fields using the updated draft
    const nextFields = fields.filter(
      (f) => f.section === groups[step].key && fieldVisible(f, updatedDraft),
    );
    const nextIdx =
      nextFields.findIndex((f) => f.key === currentField.key) + 1;
    if (nextIdx >= nextFields.length) {
      setThinking(true);
      setTimeout(() => {
        setStepDone(true);
        setThinking(false);
      }, 500);
    } else {
      setThinking(true);
      setTimeout(() => {
        setQuestionIndex(nextIdx);
        setThinking(false);
      }, 500);
    }
  };

  const handleEditConversationAnswer = (answer: ConversationAnswer) => {
    setStep(answer.step);
    setStepDone(false);
    const stepFields = fields.filter(
      (f) => f.section === groups[answer.step].key && fieldVisible(f, draft),
    );
    const targetIdx = Math.max(
      0,
      stepFields.findIndex((f) => f.key === answer.key),
    );
    setQuestionIndex(targetIdx);
    setConversationHistory((prev) => {
      const idx = prev.findIndex((i) => i.key === answer.key);
      return idx >= 0 ? prev.slice(0, idx) : prev;
    });
    setAttempts([]);
    setConversationError('');
    setConversationInput('');
  };

  const handleContinueConversationStep = async () => {
    setBusy(true);
    setError('');
    try {
      const isLastStep = step === groups.length - 1;
      const saved = await saveCareerProfile(
        careerDetailsForSave(draft),
        activeVersionId,
        isLastStep,
        selectedFilename,
      );
      setProfile(saved);
      setActiveVersionId(saved.resume_version_id);
      if (isLastStep) {
        if (!onboarding) {
          setEditing(false);
          setStep(0);
        }
        await onDone(saved);
      } else {
        setStep(step + 1);
        setQuestionIndex(0);
        setStepDone(false);
        setAttempts([]);
        setConversationError('');
        setConversationInput('');
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Check your details and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const uploadResume = async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return;
    const file = picked.assets[0];
    if (file.size && file.size > 10 * 1024 * 1024) {
      setError('Choose a PDF or DOCX up to 10 MB.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const selected = {
        fileName: file.name,
        fileUri: file.uri,
        mimeType: file.mimeType,
        fileSize: '',
      };
      const uploaded = await intakeCareerResume(selected);
      const version = await getResumeVersionDetails(uploaded.resume_version_id);
      const structured = readyStructuredResume(version);
      let parsedName = structured?.full_name || '';
      let filled: CareerDetails;
      if (structured) {
        filled = structuredResumeCareerDetails(structured, draft);
      } else if (
        !version.structured_status &&
        !version.parsed?.structured_status
      ) {
        // Compatibility with servers that predate structured_resume.
        try {
          const preview = await previewSignupResume(selected);
          filled = mergeResumeDetails(draft, preview.details);
          parsedName = preview.full_name;
        } catch {
          filled = draft;
        }
      } else {
        // A terminal FAILED/UNAVAILABLE status still links the uploaded file;
        // the candidate can correct the preserved profile fields below.
        filled = draft;
      }
      const saved = await saveCareerProfile(
        filled,
        uploaded.resume_version_id,
        false,
        file.name,
      );
      setProfile(saved);
      setDraft(saved.details);
      setLists({});
      setActiveVersionId(saved.resume_version_id);
      setSelectedFilename(file.name);
      if (!fullName && parsedName) setFullName(parsedName);
      if (onboarding) {
        setStep(0);
        setEditing(true);
      } else {
        AppAlert.alert(
          'Resume Uploaded',
          'Your new resume has been uploaded and details extracted.',
          [
            {
              text: 'Review & edit details',
              style: 'default',
              onPress: () => {
                setStep(0);
                setEditing(true);
              },
            },
            {
              text: 'OK',
              style: 'secondary',
            },
          ]
        );
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Your resume could not be read. Try again or enter your details.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    setBusy(true);
    Promise.all([getCareerFields(), getCareerProfile()])
      .then(async ([specs, saved]) => {
        const shouldPrefill =
          !!versionId &&
          (onboarding
            ? saved.resume_version_id !== versionId
            : !saved.resume_version_id);
        if (shouldPrefill) {
          try {
            // React development remounts effects. Reuse the mutation so a
            // single resume is never prefetched twice concurrently.
            if (prefillRequest.current?.id !== versionId)
              prefillRequest.current = {
                id: versionId,
                promise: prefillCareerProfile(versionId),
              };
            saved = await prefillRequest.current.promise;
          } catch {
            if (alive)
              setError(
                'Resume prefill could not finish. Please enter or correct your details below.',
              );
          }
        }
        if (alive) {
          setFields(specs);
          setProfile(saved);
          setDraft(saved.details);
          setActiveVersionId(versionId ?? saved.resume_version_id);
        }
      })
      .catch(() => {
        if (alive)
          setError(
            'Profile details could not be loaded. Please try again when the updated backend is available.',
          );
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [versionId, onboarding]);

  const update = (key: string, value: CareerDetails[string]) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'work_status' && value === 'FRESHER')
        Object.assign(next, {
          experience_years: 0,
          experience_months: 0,
          currently_employed: 'NO',
          company_name: '',
          job_title: '',
          employment_start: '',
          employment_end: '',
          annual_salary: null,
          notice_period: '',
          job_role: '',
        });
      if (key === 'currently_employed' && value === 'YES')
        next.employment_end = '';
      if (key === 'currently_employed' && value === 'NO')
        Object.assign(next, {
          company_name: '',
          job_title: '',
          employment_start: '',
          employment_end: '',
          annual_salary: null,
          notice_period: '',
          job_role: '',
        });
      return next;
    });
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const save = async (finishNow: boolean = false) => {
    const nextErrors: Record<string, string> = {};
    for (const field of fields.filter(
      (f) => f.section === groups[step].key && fieldVisible(f, draft),
    )) {
      if (
        fieldRequired(field, draft) &&
        (!draft[field.key] ||
          (Array.isArray(draft[field.key]) &&
            !(draft[field.key] as string[]).length))
      )
        nextErrors[field.key] = 'This field is required.';
    }
    if (
      groups[step].key === 'basic' &&
      draft.phone &&
      !/^\+[1-9]\d{7,14}$/.test(String(draft.phone))
    )
      nextErrors.phone = 'Use international format, for example +919876543210.';
    if (groups[step].key === 'basic' && !fullName.trim())
      nextErrors.full_name = 'Enter your full name.';
    if (
      groups[step].key === 'employment' &&
      draft.work_status === 'EXPERIENCED' &&
      !Number(draft.experience_years) &&
      !Number(draft.experience_months)
    )
      nextErrors.experience_years =
        'Enter at least one month of experience, or choose fresher.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    setBusy(true);
    setError('');
    try {
      if (step === 0) {
        const identity = await updateCandidateName(fullName.trim());
        if (session) rememberCandidate(session, identity, fullName.trim());
      }
      const isLastStep = step === groups.length - 1;
      const shouldFinish = finishNow || isLastStep;
      const saved = await saveCareerProfile(
        careerDetailsForSave(draft),
        activeVersionId,
        isLastStep,
        selectedFilename,
      );
      setProfile(saved);
      setActiveVersionId(saved.resume_version_id);
      if (shouldFinish) {
        if (!onboarding) {
          setEditing(false);
          setStep(0);
        }
        await onDone(saved);
      } else {
        setStep(step + 1);
        scrollRef.current?.scrollTo({ y: 0, animated: true });
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Check your details and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const openDocument = async () => {
    if (!profile?.resume_version_id) return;
    setBusy(true);
    setError('');
    try {
      const preview = await getResumePreview(profile.resume_version_id);
      setDocumentHtml(
        `<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /></head><body style="margin:0;background:#f7f4ec">${preview.pages.length ? preview.pages.map((page) => `<img style="width:100%;display:block;margin-bottom:8px" src="data:image/png;base64,${page}" />`).join('') : `<pre style="white-space:pre-wrap;padding:20px;font:16px sans-serif">${escapeHtml(preview.text)}</pre>`}${preview.truncated ? '<p>Showing the first 20 pages.</p>' : ''}</body></html>`,
      );
    } catch {
      setError('Your resume could not be opened. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (fields.length === 0 && busy) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            disabled={true}
            onPress={goBack}
            style={[styles.back, styles.backDisabled]}
          >
            <ArrowLeft size={22} color="#9AA1AE" />
          </Pressable>
          <Text style={styles.title}>
            {onboarding ? 'Create your profile' : 'Profile details'}
          </Text>
        </View>
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.centerLoadingText}>Loading profile details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (onboarding && step > 0 && onboardingMode === null) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            disabled={busy}
            onPress={() => setStep(0)}
            style={styles.back}
          >
            <ArrowLeft size={22} color="#0A1931" />
          </Pressable>
          <Text style={styles.title}>Create your profile</Text>
        </View>
        <ScrollView
          contentContainerStyle={styles.modeSelectContent}
          showsVerticalScrollIndicator={false}
        >
          <OnboardingProgress step={step} />
          <Text style={styles.modeSelectTitle}>
            How would you like to complete your profile?
          </Text>
          <Text style={styles.modeSelectSubtitle}>
            Choose a familiar form or an interactive conversation for the remaining steps.
          </Text>

          <View style={styles.modeOptionsWrap}>
            <Pressable
              onPress={() => {
                setOnboardingMode('conversation');
                setQuestionIndex(0);
                setStepDone(false);
              }}
              style={({ pressed }) => [
                styles.modeOptionCard,
                styles.modeOptionFeatured,
                pressed && styles.cardPressed,
              ]}
            >
              <View style={styles.modeIconRow}>
                <View style={[styles.modeIconBox, styles.modeIconBoxFeatured]}>
                  <ChatCircleDots size={24} color="#FFFFFF" weight="fill" />
                </View>
                <View style={styles.modeBadge}>
                  <Text style={styles.modeBadgeText}>Interactive & Fast</Text>
                </View>
              </View>
              <Text style={styles.modeCardTitle}>Conversational Mode</Text>
              <Text style={styles.modeCardDesc}>
                Answer one question at a time. Tap suggested quick answers or type your responses with live guided guidance.
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setOnboardingMode('manual')}
              style={({ pressed }) => [
                styles.modeOptionCard,
                pressed && styles.cardPressed,
              ]}
            >
              <View style={styles.modeIconRow}>
                <View style={styles.modeIconBox}>
                  <ListBullets size={24} color="#0A1931" weight="bold" />
                </View>
              </View>
              <Text style={styles.modeCardTitle}>Manual Form</Text>
              <Text style={styles.modeCardDesc}>
                Fill in all your details in the familiar step-by-step form view.
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          disabled={busy}
          onPress={goBack}
          style={[styles.back, busy && styles.backDisabled]}
        >
          <ArrowLeft size={22} color={busy ? '#9AA1AE' : '#0A1931'} />
        </Pressable>
        <Text style={styles.title}>
          {onboarding ? 'Create your profile' : 'Profile details'}
        </Text>
        {editing && !onboarding && (
          <Pressable
            disabled={busy}
            onPress={() => void save(true)}
            style={[styles.headerSaveButton, busy && styles.primaryDisabled]}
            accessibilityRole="button"
            accessibilityLabel="Save profile"
          >
            {busy ? (
              <ActivityIndicator size="small" color="#FFFFFF" />
            ) : (
              <Text style={styles.headerSaveText}>Save</Text>
            )}
          </Pressable>
        )}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        <ScrollView
          ref={scrollRef}
          key={`${editing}-${step}`}
          pointerEvents={busy ? 'none' : 'auto'}
          contentContainerStyle={[
            styles.content,
            { paddingBottom: keyboardHeight > 0 ? keyboardHeight + 120 : 60 },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
        {!!error && (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        {!editing && profile && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>{fullName}</Text>
            <Text style={styles.help}>{session?.email}</Text>
            <View style={styles.row}>
              <FileText size={24} color="#5F4DB2" />
              <Text style={styles.sectionTitle}>Your resume</Text>
            </View>
            <Pressable
              disabled={busy}
              onPress={() => void openDocument()}
              style={styles.primary}
            >
              <Text style={styles.primaryText}>Open resume</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => {
                if (onUpdateResume) {
                  onUpdateResume();
                } else {
                  router.push('/resume-details' as any);
                }
              }}
              style={styles.back}
            >
              <Text style={styles.label}>Update resume</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setEditing(true);
                setStep(0);
              }}
              style={styles.back}
            >
              <PencilSimple size={18} color="#5F4DB2" />
              <Text style={styles.label}>Edit profile details</Text>
            </Pressable>
          </View>
        )}
        {editing ? (
          <>
            {onboarding && <OnboardingProgress step={step} />}
            {!onboarding && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.sectionTabs}
              >
                {groups.map((g, idx) => (
                  <Pressable
                    key={g.key}
                    disabled={busy}
                    onPress={() => {
                      setStep(idx);
                      scrollRef.current?.scrollTo({ y: 0, animated: true });
                    }}
                    style={[
                      styles.sectionTab,
                      step === idx && styles.sectionTabActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sectionTabText,
                        step === idx && styles.sectionTabActiveText,
                      ]}
                    >
                      {g.title}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            )}
            {onboarding && step > 0 && (
              <View style={styles.modeToggleRow}>
                <Pressable
                  onPress={() => setOnboardingMode('manual')}
                  style={[
                    styles.modeToggleTab,
                    onboardingMode === 'manual' && styles.modeToggleTabActive,
                  ]}
                >
                  <ListBullets
                    size={14}
                    color={onboardingMode === 'manual' ? '#FFFFFF' : '#5F4DB2'}
                    weight="bold"
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      onboardingMode === 'manual' && styles.modeToggleTextActive,
                    ]}
                  >
                    Manual Form
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setOnboardingMode('conversation');
                    setQuestionIndex(0);
                    setStepDone(false);
                  }}
                  style={[
                    styles.modeToggleTab,
                    onboardingMode === 'conversation' &&
                      styles.modeToggleTabActive,
                  ]}
                >
                  <ChatCircleDots
                    size={14}
                    color={
                      onboardingMode === 'conversation' ? '#FFFFFF' : '#5F4DB2'
                    }
                    weight="bold"
                  />
                  <Text
                    style={[
                      styles.modeToggleText,
                      onboardingMode === 'conversation' &&
                        styles.modeToggleTextActive,
                    ]}
                  >
                    Conversational Mode
                  </Text>
                </Pressable>
              </View>
            )}

            {onboarding && step > 0 && onboardingMode === 'conversation' ? (
              <ConversationPrompt
                thinking={thinking || busy}
                question={conversationQuestion(currentField)}
                progress={`Step ${step + 1} of 4`}
                closing={
                  stepDone
                    ? `Thanks! That covers ${groups[step].title.toLowerCase()}. Ready for the next step?`
                    : undefined
                }
                history={conversationHistory}
                stepTitles={groups.map((g) => g.title)}
                disabled={busy || thinking}
                retryMessage={conversationError}
                attempts={attempts}
                onEdit={handleEditConversationAnswer}
              >
                {stepDone ? (
                  <View style={styles.convActionRow}>
                    <Pressable
                      disabled={busy}
                      onPress={() => {
                        setStepDone(false);
                        setConversationError('');
                      }}
                      style={styles.convBackBtn}
                    >
                      <Text style={styles.convBackText}>Back</Text>
                    </Pressable>
                    <Pressable
                      disabled={busy}
                      onPress={handleContinueConversationStep}
                      style={styles.convContinueBtn}
                    >
                      {busy ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text style={styles.convContinueText}>
                          {step === groups.length - 1
                            ? 'Save & Continue'
                            : 'Continue to Next Step'}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                ) : currentField ? (
                  <View style={styles.convInputWrap}>
                    {/* Option Chips for select fields */}
                    {currentField.options && currentField.options.length > 0 && (
                      <View style={styles.convChipsRow}>
                        {currentField.options.map((opt) => (
                          <Pressable
                            key={opt.value}
                            onPress={() => {
                              setConversationInput(opt.label);
                              setConversationError('');
                              void handleSendConversationAnswer(opt.label);
                            }}
                            style={[
                              styles.convChip,
                              conversationInput === opt.label &&
                                styles.convChipActive,
                            ]}
                          >
                            <Text
                              style={[
                                styles.convChipText,
                                conversationInput === opt.label &&
                                  styles.convChipTextActive,
                              ]}
                            >
                              {opt.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    )}

                    {/* Text Input */}
                    {currentField.type === 'tel' ? (
                      <PhoneNumberInput
                        value={conversationInput}
                        onChange={(next) => {
                          setConversationInput(next);
                          setConversationError('');
                        }}
                        error={conversationError}
                        hint="Select your country code, then enter your mobile number."
                      />
                    ) : (
                      <TextInput
                        style={[
                          styles.convTextInput,
                          !!conversationError && styles.convTextInputError,
                        ]}
                        value={conversationInput}
                        onChangeText={(t) => {
                          setConversationInput(t);
                          setConversationError('');
                        }}
                        placeholder={
                          currentField.key === 'annual_salary' || currentField.key === 'preferred_salary'
                            ? 'e.g. 12 LPA, 50k/month, or ₹6,00,000'
                            : currentField.type === 'month'
                              ? 'Type a month, e.g. 2024-06'
                              : currentField.type === 'list'
                                ? 'Type skills separated by commas'
                                : 'Type your answer here…'
                        }
                        placeholderTextColor="#9AA1AE"
                        keyboardType={
                          currentField.key === 'annual_salary' || currentField.key === 'preferred_salary'
                            ? 'default'
                            : currentField.type === 'number'
                              ? 'numeric'
                              : 'default'
                        }
                        returnKeyType="send"
                        onSubmitEditing={() =>
                          void handleSendConversationAnswer()
                        }
                      />
                    )}

                    {/* Skip button for non-required fields */}
                    {!fieldRequired(currentField, draft) && (
                      <Pressable
                        disabled={busy || thinking}
                        onPress={() =>
                          void handleSendConversationAnswer(undefined, true)
                        }
                        style={styles.convSkipBtn}
                      >
                        <Text style={styles.convSkipText}>
                          Skip this question
                        </Text>
                      </Pressable>
                    )}

                    {/* Action Buttons */}
                    <View style={styles.convActionRow}>
                      <Pressable
                        disabled={busy || thinking}
                        onPress={goBack}
                        style={styles.convBackBtn}
                      >
                        <Text style={styles.convBackText}>Back</Text>
                      </Pressable>
                      <Pressable
                        disabled={busy || thinking}
                        onPress={() => void handleSendConversationAnswer()}
                        style={styles.convContinueBtn}
                      >
                        <Text style={styles.convContinueText}>Send answer</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </ConversationPrompt>
            ) : (
              <>
                <Text
                  style={
                    onboarding
                      ? {
                          fontFamily: 'GeneralSans-Bold',
                          fontSize: 26,
                          lineHeight: 32,
                          letterSpacing: -0.4,
                          color: '#0A1931',
                        }
                      : styles.sectionTitle
                  }
                >
                  {groups[step].title}
                </Text>
                <Text style={styles.help}>
                  Required fields are marked *. Salary and gender are optional.
                </Text>
                {step === 0 && (
                  <>
                    {onboarding && (
                      <View style={styles.field}>
                        <Text style={styles.label}>Start with your resume</Text>
                        <Pressable
                          disabled={busy}
                          onPress={() =>
                            void uploadResume().catch(() =>
                              setError(
                                'The file picker could not open. Please try again.',
                              ),
                            )
                          }
                          style={styles.back}
                        >
                          <FileText size={20} color="#5F4DB2" />
                          <Text style={styles.label}>
                            {selectedFilename ||
                              profile?.resume_filename ||
                              'Choose PDF or DOCX'}
                          </Text>
                        </Pressable>
                        <Text style={styles.help}>
                          We fill your details from your resume. Review them below. Scoring starts after payment.
                        </Text>
                      </View>
                    )}
                    <View
                      style={styles.field}
                      onLayout={(e) => onFieldLayout('fullName', e)}
                    >
                      <Text style={styles.label}>Full name *</Text>
                      <TextInput
                        style={styles.input}
                        accessibilityLabel="Full name"
                        value={fullName}
                        onChangeText={setFullName}
                        onFocus={() => scrollToField('fullName')}
                        autoComplete="name"
                      />
                      {!!errors.full_name && (
                        <Text style={styles.error}>{errors.full_name}</Text>
                      )}
                    </View>
                    <View style={styles.field}>
                      <Text style={styles.label}>Email ID</Text>
                      <Text style={styles.help}>{session?.email}</Text>
                      <Text style={styles.help}>Your verified account email</Text>
                    </View>
                  </>
                )}
                {fields
                  .filter(
                    (field) =>
                      field.section === groups[step].key &&
                      fieldVisible(field, draft),
                  )
                  .map((field) => {
                    const value = draft[field.key];
                    return (
                      <View
                        key={field.key}
                        style={styles.field}
                        onLayout={(e) => onFieldLayout(field.key, e)}
                      >
                        <Text style={styles.label}>
                          {field.label}
                          {fieldRequired(field, draft) ? ' *' : ' (optional)'}
                        </Text>
                        {field.type === 'select' ? (
                          <View style={styles.options}>
                            {field.options.map((option) => (
                              <Pressable
                                key={option.value}
                                accessibilityRole="radio"
                                accessibilityState={{
                                  checked: value === option.value,
                                }}
                                onPress={() =>
                                  update(
                                    field.key,
                                    value === option.value ? '' : option.value,
                                  )
                                }
                                style={[
                                  styles.option,
                                  value === option.value && styles.selected,
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.optionText,
                                    value === option.value &&
                                      styles.selectedText,
                                  ]}
                                >
                                  {option.label}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : field.key === 'phone' ? (
                          <PhoneNumberInput
                            value={String(value ?? '')}
                            onChange={(next) => update(field.key, next)}
                            onFocus={() => scrollToField(field.key)}
                            error={errors[field.key]}
                            hint="Select your country code, then enter your mobile number."
                          />
                        ) : (
                          <TextInput
                            accessibilityLabel={field.label}
                            onFocus={() => scrollToField(field.key)}
                            value={
                              field.type === 'list'
                                ? lists[field.key] ??
                                  (Array.isArray(value) ? value.join(', ') : '')
                                : String(value ?? '')
                            }
                            placeholder={
                              field.type === 'month'
                                ? 'YYYY-MM'
                                : field.type === 'list'
                                  ? 'Separate with commas'
                                  : field.label
                            }
                            placeholderTextColor="#9AA1AE"
                            keyboardType={
                              field.type === 'number'
                                ? 'numeric'
                                : 'default'
                            }
                            style={[
                              styles.input,
                              !!errors[field.key] && styles.invalid,
                            ]}
                            onChangeText={(raw) => {
                              if (field.type === 'list') {
                                setLists((current) => ({
                                  ...current,
                                  [field.key]: raw,
                                }));
                                update(
                                  field.key,
                                  raw
                                    .split(',')
                                    .map((part) => part.trim())
                                    .filter(Boolean),
                                );
                              } else
                                update(
                                  field.key,
                                  field.type === 'number'
                                    ? raw === ''
                                      ? field.key.startsWith('experience_')
                                        ? 0
                                        : null
                                      : Number(raw)
                                    : raw,
                                );
                            }}
                          />
                        )}
                        {field.key !== 'phone' && !!errors[field.key] && (
                          <Text style={styles.error}>{errors[field.key]}</Text>
                        )}
                      </View>
                    );
                  })}
                <View style={styles.row}>
                  <Pressable
                    disabled={busy}
                    onPress={goBack}
                    style={[styles.back, busy && styles.backDisabled]}
                  >
                    <ArrowLeft size={18} color={busy ? '#9AA1AE' : '#0A1931'} />
                    <Text style={[styles.label, busy && styles.labelDisabled]}>
                      Back
                    </Text>
                  </Pressable>
                  <Pressable
                    disabled={busy}
                    onPress={() => void save()}
                    style={[
                      styles.primary,
                      { flex: 1 },
                      busy && styles.primaryDisabled,
                    ]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy, busy }}
                  >
                    {busy ? (
                      <View style={styles.buttonLoadingRow}>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.primaryText}>
                          {step === groups.length - 1
                            ? onboarding
                              ? 'Saving profile…'
                              : 'Saving…'
                            : 'Saving…'}
                        </Text>
                      </View>
                    ) : (
                      <Text style={styles.primaryText}>
                        {step === groups.length - 1
                          ? onboarding
                            ? 'Save and continue to membership'
                            : 'Save'
                          : 'Save and continue'}
                      </Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </>
        ) : (
          groups.map((group, groupIdx) => (
            <View key={group.key} style={styles.card}>
              <View style={styles.cardHeaderRow}>
                <Text style={styles.sectionTitle}>{group.title}</Text>
                <Pressable
                  hitSlop={8}
                  onPress={() => {
                    setStep(groupIdx);
                    setEditing(true);
                  }}
                  style={styles.cardEditButton}
                  accessibilityLabel={`Edit ${group.title}`}
                >
                  <PencilSimple size={14} color="#5F4DB2" weight="bold" />
                  <Text style={styles.cardEditText}>Edit</Text>
                </Pressable>
              </View>
              {fields
                .filter(
                  (field) =>
                    field.section === group.key && fieldVisible(field, draft),
                )
                .map((field) => {
                  const value = draft[field.key];
                  const display =
                    field.options.find((option) => option.value === value)
                      ?.label ??
                    (Array.isArray(value)
                      ? value.join(', ')
                      : value == null || value === ''
                        ? 'Not added'
                        : String(value));
                  return (
                    <View key={field.key} style={styles.field}>
                      <Text style={styles.help}>{field.label}</Text>
                      <Text style={styles.label}>{display || 'Not added'}</Text>
                    </View>
                  );
                })}
            </View>
          ))
        )}
      </ScrollView>
      </KeyboardAvoidingView>
      <Modal
        visible={documentHtml !== null}
        onRequestClose={() => setDocumentHtml(null)}
        animationType="slide"
      >
        <SafeAreaView style={styles.screen}>
          <View style={styles.header}>
            <Text style={[styles.title, { flex: 1 }]}>Resume</Text>
            <Pressable
              accessibilityLabel="Close resume"
              onPress={() => setDocumentHtml(null)}
            >
              <X size={24} />
            </Pressable>
          </View>
          <WebView
            originWhitelist={['about:blank']}
            source={{ html: documentHtml ?? '' }}
            javaScriptEnabled={false}
          />
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E0D4',
  },
  title: { fontFamily: 'GeneralSans-Bold', fontSize: 20, color: '#0A1931' },
  content: { padding: 20, gap: 20, paddingBottom: 48 },
  loading: { gap: 12, alignItems: 'center', padding: 16 },
  card: {
    padding: 16,
    gap: 16,
    borderRadius: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  sectionTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
  },
  field: { gap: 7 },
  label: { fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#0A1931' },
  help: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#5F6B80',
    lineHeight: 20,
  },
  input: {
    minHeight: 52,
    padding: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#fff',
    fontFamily: 'GeneralSans-Medium',
    fontSize: 16,
    color: '#0A1931',
  },
  invalid: { borderColor: '#A33A2B' },
  error: {
    fontFamily: 'GeneralSans-Medium',
    color: '#A33A2B',
    fontSize: 13,
    lineHeight: 20,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#fff',
    paddingHorizontal: 18,
    paddingVertical: 15,
  },
  primary: {
    borderRadius: 28,
    padding: 16,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
  },
  primaryText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#fff',
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  option: {
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#fff',
  },
  selected: { backgroundColor: '#F1EAF7', borderColor: '#5F4DB2' },
  optionText: {
    fontFamily: 'GeneralSans-Medium',
    color: '#5F6B80',
    fontSize: 13,
  },
  selectedText: { color: '#5F4DB2' },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryDisabled: {
    opacity: 0.75,
  },
  backDisabled: {
    opacity: 0.5,
    borderColor: '#E7E0D4',
  },
  labelDisabled: {
    color: '#9AA1AE',
  },
  centerLoading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
  },
  centerLoadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 15,
    color: '#5F6B80',
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 14,
    backgroundColor: '#F1EAF7',
  },
  cardEditText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#5F4DB2',
  },
  headerSaveButton: {
    marginLeft: 'auto',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: '#5F4DB2',
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSaveText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  sectionTabs: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
    marginBottom: 4,
  },
  sectionTab: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
  },
  sectionTabActive: {
    backgroundColor: '#5F4DB2',
    borderColor: '#5F4DB2',
  },
  sectionTabText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#5F6B80',
  },
  sectionTabActiveText: {
    color: '#FFFFFF',
    fontFamily: 'GeneralSans-Semibold',
  },
  // Mode Selection Screen
  modeSelectContent: {
    padding: 24,
    paddingTop: 12,
  },
  modeSelectTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0A1931',
    lineHeight: 32,
    letterSpacing: -0.4,
    marginTop: 16,
    marginBottom: 8,
  },
  modeSelectSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
    marginBottom: 24,
  },
  modeOptionsWrap: {
    gap: 16,
  },
  modeOptionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E7DFD5',
    padding: 20,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },
  modeOptionFeatured: {
    borderColor: '#C9BEEB',
    backgroundColor: '#FDFBFF',
    shadowColor: '#5F4DB2',
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  cardPressed: {
    transform: [{ scale: 0.99 }],
    opacity: 0.95,
  },
  modeIconRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  modeIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeIconBoxFeatured: {
    backgroundColor: '#5F4DB2',
  },
  modeBadge: {
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  modeBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  modeCardTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#0A1931',
    marginBottom: 6,
  },
  modeCardDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  // Mode Switcher Toggle Pill
  modeToggleRow: {
    flexDirection: 'row',
    backgroundColor: '#EDE8F8',
    borderRadius: 24,
    padding: 4,
    marginBottom: 12,
    gap: 4,
  },
  modeToggleTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 20,
    gap: 6,
  },
  modeToggleTabActive: {
    backgroundColor: '#5F4DB2',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  modeToggleText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  modeToggleTextActive: {
    color: '#FFFFFF',
  },
  // Conversational controls inside prompt
  convActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 10,
  },
  convBackBtn: {
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#C9BEEB',
    backgroundColor: '#FFFFFF',
  },
  convBackText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  convContinueBtn: {
    flex: 1,
    backgroundColor: '#5F4DB2',
    borderRadius: 24,
    paddingVertical: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  convContinueText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  convInputWrap: {
    gap: 10,
  },
  convChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 4,
  },
  convChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9BEEB',
  },
  convChipActive: {
    backgroundColor: '#EDE8F8',
    borderColor: '#5F4DB2',
  },
  convChipText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3A4761',
  },
  convChipTextActive: {
    color: '#5F4DB2',
    fontWeight: '700',
  },
  convTextInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#C9BEEB',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    color: '#0A1931',
  },
  convTextInputError: {
    borderColor: '#C93B2B',
  },
  convSkipBtn: {
    alignSelf: 'flex-end',
    paddingVertical: 2,
  },
  convSkipText: {
    fontSize: 12,
    color: '#5F6B80',
    textDecorationLine: 'underline',
  },
});
