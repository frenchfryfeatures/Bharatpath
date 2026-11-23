import { useLogout } from '@/hooks/useLogout';
import { CitySuggestions } from '@/components/inputs/CitySuggestions';
import { IndianCityDropdown } from '@/components/inputs/IndianCityDropdown';
import { profileValueText } from "@/services/profile/profileDisplay";
import { formatSalaryInput } from '@/utils/salaryInput';
import { ResumePickerLabel } from '@/components/inputs/ResumePickerLabel';
import { EducationField, useEducationAutoNA } from "@/components/inputs/EducationField";
import { isEducationKey, educationErrors } from "@/services/api/educationState";
import { TaxonomyField } from "@/components/inputs/TaxonomyField";
import { isTaxonomyKey, taxonomyErrors } from "@/services/api/taxonomyState";
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
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  BackHandler,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, EnvelopeSimple, PencilSimple, Wallet, X } from 'phosphor-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { OnboardingProgress } from '@/screens/onboarding/OnboardingProgress';
import { ConversationPrompt } from '@/screens/onboarding/ConversationPrompt';
import { PhoneNumberInput } from '@/components/inputs/PhoneNumberInput';
import { DropdownSelect } from '@/components/inputs/DropdownSelect';
import { MonthYearPicker, YearDropdownPicker } from '@/components/inputs/MonthYearPicker';
import { clearPendingResume } from '@/services/storage/pendingResume';
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
import { ListChecks, MessageCircle, LogOut } from 'lucide-react-native';
import { getOnboardingMode, saveOnboardingMode, shouldOfferOnboardingMode, type OnboardingMode } from '@/services/storage/onboardingMode';
import { useAuthContext } from '@/context/AuthContext';
import { updateCandidateName } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { getResumeVersionDetails } from '@/services/api/resume';
import {
  readyStructuredResume,
  structuredResumeCareerDetails,
} from '@/services/profile/structuredResume';
import {
  conversationFieldsForSection,
  conversationStartStep,
} from '@/services/profile/onboarding';
import {
  getCareerFields,
  getCareerProfile,
  intakeCareerResume,
  mergeResumeDetails,
  prefillCareerProfile,
  previewSignupResume,
  saveCareerProfile,
  careerDetailsForSave,
  missingRequiredCareerFields,
  fieldRequired as baseFieldRequired,
  fieldVisible,
  type CareerField,
  type CareerDetails,
  type CareerProfile,
} from '@/services/api/career';
import { logger } from '@/utils/logger';

const groups = [
  { key: 'basic', title: 'Basic details' },
  { key: 'employment', title: 'Employment details' },
  { key: 'education', title: 'Education details' },
  { key: 'preferences', title: 'Headline and preferences' },
];
export function CareerDetailsScreen({
  versionId,
  resumeFilename,
  onboarding = false,
  onBack,
  onDone,
  initialSection = 0,
}: {
  versionId?: string;
  resumeFilename?: string;
  onboarding?: boolean;
  onBack: () => void;
  onDone: (profile: CareerProfile) => void | Promise<void>;
  initialSection?: number;
}) {
  const { candidateFullName, session, rememberCandidate } = useAuthContext();
  const logout = useLogout();
  const [fullName, setFullName] = useState(candidateFullName ?? '');
  useEffect(() => {
    if (candidateFullName) setFullName((current) => current || candidateFullName);
  }, [candidateFullName]);
  const [fields, setFields] = useState<CareerField[]>([]);
  const educationYearSpan = fields.find((field) => field.key === "passing_year")?.rules?.education_max_years ?? 7;
  const [profile, setProfile] = useState<CareerProfile | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(
    versionId ?? null,
  );
  const [draft, setDraft] = useState<CareerDetails>({});
  const hideEducationSpecialization = useEducationAutoNA(draft, setDraft);
  const [editing, setEditing] = useState(onboarding);
  const [step, setStep] = useState(initialSection);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [lists, setLists] = useState<Record<string, string>>({});
  const [selectedFilename, setSelectedFilename] = useState(resumeFilename);
  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Record<string, number>>({});
  const fieldViews = useRef<Record<string, View | null>>({});
  const scrollOffset = useRef(0);
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const phoneRef = useRef<TextInput>(null);
  const [invalidTarget, setInvalidTarget] = useState<{ key: string } | null>(null);
  useEffect(() => {
    if (!invalidTarget) return;
    const frame = requestAnimationFrame(() => {
      if (invalidTarget.key === 'phone') phoneRef.current?.focus();
      else inputRefs.current[invalidTarget.key]?.focus();
      scrollToField(invalidTarget.key);
    });
    return () => cancelAnimationFrame(frame);
  }, [invalidTarget, step, editing]);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Conversational Onboarding Mode State (defaults to 'manual'; toggled in top header bar)
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode | null>(null);
  const [modeRestored, setModeRestored] = useState(false);
  const modeAccount = session?.userId || session?.subject || session?.email?.toLowerCase() || '';
  useEffect(() => {
    let active = true;
    setModeRestored(false);
    setOnboardingMode(null);
    void getOnboardingMode(modeAccount).then((savedMode) => {
      if (!active) return;
      setOnboardingMode(savedMode);
      setModeRestored(true);
    });
    return () => { active = false; };
  }, [modeAccount]);
  const chooseMode = (mode: OnboardingMode) => {
    setOnboardingMode(mode);
    void saveOnboardingMode(modeAccount, mode);
  };
  useEffect(() => {
    if (!onboarding || !modeRestored || !profile) return;
    const details = profile.details;
    if (!fullName.trim() || !details.phone || !details.current_city || !details.work_status) {
      setStep(0);
    } else if (profile.completed && onboardingMode === null) {
      setOnboardingMode('manual');
    }
  }, [onboarding, modeRestored, profile, fullName, onboardingMode]);

  const [questionIndex, setQuestionIndex] = useState(0);
  const [thinking, setThinking] = useState(false);
  const [stepDone, setStepDone] = useState(false);
  const [conversationHistory, setConversationHistory] = useState<ConversationAnswer[]>([]);
  const [conversationInput, setConversationInput] = useState<string>('');
  const [conversationError, setConversationError] = useState('');
  const [attempts, setAttempts] = useState<{ answer: string; message: string }[]>([]);
  const [serverRequiresSkills, setServerRequiresSkills] = useState(false);

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
      const target = fieldViews.current[key];
      if (target && scrollRef.current) {
        target.measureInWindow((_x, fieldY, _width, height) => {
          if (!height) return;
          scrollRef.current?.getNativeScrollRef()?.measureInWindow((_scrollX, viewportY) => {
            scrollRef.current?.scrollTo({
              y: Math.max(0, scrollOffset.current + fieldY - viewportY - 70), animated: true,
            });
          });
        });
        return;
      }
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
    if (onboarding && step === 0) return;
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
      return;
    }
    if (editing && step > 0) {
      setStep(step - 1);
    } else if (onboarding || !editing) {
      onBack();
    } else {
      setEditing(false);
    }
  };

  useEffect(() => {
    if (!onboarding) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!busy) goBack();
      return true;
    });
    return () => subscription.remove();
  });

  const fieldRequired = (field: CareerField, details: CareerDetails) =>
    baseFieldRequired(field, details) ||
    (serverRequiresSkills && field.key === 'key_skills') ||
    (onboardingMode === 'conversation' &&
      details.work_status === 'EXPERIENCED' &&
      (field.key === 'experience_years' || field.key === 'experience_months'));

  const conversationalFieldVisible = (
    field: CareerField,
    details: CareerDetails,
  ): boolean => {
    if (field.key === 'specialization' && hideEducationSpecialization) return false;
    if (!fieldVisible(field, details) && !(serverRequiresSkills && field.key === 'key_skills')) return false;
    return true;
  };

  // Basic contact details belong to the first form section, but the API still
  // requires them. Ask any missing ones inside conversational Step 2 so mode
  // selection never sends the candidate back to the Basic details screen.
  const conversationFieldsForStep = (
    stepIndex: number,
    details: CareerDetails,
  ): CareerField[] => conversationFieldsForSection(
    fields,
    groups[stepIndex]?.key,
    stepIndex,
    (field) => conversationalFieldVisible(field, details),
  );

  const manualFieldsForStep = (
    stepIndex: number,
    details: CareerDetails,
  ): CareerField[] =>
    fields.filter(
      (field) =>
        (field.section === groups[stepIndex]?.key ||
          (onboarding &&
            stepIndex === 1 &&
            (field.key === 'phone' || field.key === 'current_city'))) &&
        (fieldVisible(field, details) || (!onboarding && field.key === "key_skills")) && !(field.key === "specialization" && hideEducationSpecialization),
    );

  // Conversational questions for current step (evaluates visible branching)
  const careerLabel = (key: string, label: string) => {
    const previous = draft.work_status === 'EXPERIENCED' && draft.currently_employed === 'NO';
    if (previous && key === 'industry') return 'Previous Industry';
    if (previous && key === 'department') return 'Previous Department';
    if (previous && key === 'role_category') return 'Previous Role Category';
    if (previous && key === 'job_role') return 'Previous Job Role';
    if (key === 'notice_period') return 'Notice Period';
    if (key === 'company_name') return previous ? 'Previous Company' : 'Current Company';
    if (key === 'job_title') return previous ? 'Previous Job Title' : 'Current Job Title';
    if (key === 'annual_salary') return previous ? 'Previous Annual Salary' : 'Annual Salary';
    if (previous && key === 'employment_start') return 'Previous employment starting month';
    if (previous && key === 'employment_end') return 'Previous employment ending month';
    return label;
  };
  const currentStepFields = onboardingMode === 'conversation'
    ? conversationFieldsForStep(step, draft)
    : manualFieldsForStep(step, draft);
  const currentQuestionIdx = Math.min(
    questionIndex,
    Math.max(0, currentStepFields.length - 1),
  );
  const currentField = currentStepFields[currentQuestionIdx];

  const formatFieldAnswer = (
    field: CareerField,
    value: unknown,
    details: CareerDetails,
    history: ConversationAnswer[],
  ): string => {
    const skipped = history.find(
      (item) => item.key === field.key && item.answer === 'Skipped for now',
    );
    if (skipped && !fieldRequired(field, details)) {
      return skipped.answer;
    }
    if (field.key === 'annual_salary' || field.key === 'preferred_salary') {
      return formatSalaryDisplay(typeof value === 'number' ? value : null, draft[field.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency']);
    }
    if (field.options && field.options.length > 0) {
      const match = field.options.find(
        (opt) =>
          opt.value === value ||
          String(opt.value).toLowerCase() === String(value ?? '').toLowerCase(),
      );
      if (match) return match.label;
    }
    if (Array.isArray(value)) {
      return value.join(', ');
    }
    return String(value ?? '');
  };

  const isFieldUnanswered = (
    field: CareerField,
    details: CareerDetails,
    history: ConversationAnswer[],
  ): boolean => {
    const value = details[field.key];
    const skipped = history.some(
      (item) => item.key === field.key && item.answer === 'Skipped for now',
    );
    if (skipped && !fieldRequired(field, details)) return false;
    if (
      value === null ||
      value === undefined ||
      value === '' ||
      (Array.isArray(value) && !value.length)
    ) {
      return true;
    }
    const answer =
      field.key === 'annual_salary' || field.key === 'preferred_salary'
        ? typeof value === 'number'
          ? formatSalaryDisplay(value, draft[field.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency'])
          : String(value)
        : Array.isArray(value)
          ? value.join(', ')
          : String(value);

    return Boolean(
      parseConversationAnswer(
        field,
        answer,
        fieldRequired(field, details),
        details,
      ).error,
    );
  };

  /** Open the first unanswered question, carrying prefills through completed sections. */
  const startConversationStep = (
    target: number,
    base: ConversationAnswer[],
    details: CareerDetails = draft,
  ): { step: number; questionIndex: number; readyToFinish: boolean } | null => {
    if (!fields || fields.length === 0) return null;
    target = conversationStartStep(target, missingRequiredCareerFields(details));
    let history = [...base];

    // Seed any prior completed steps (>= 1) that are not yet in history
    for (let priorStep = 1; priorStep < target; priorStep++) {
      const priorAsked = conversationFieldsForStep(priorStep, details).filter(
        (field) => !isFieldUnanswered(field, details, history),
      );
      const priorSeeded: ConversationAnswer[] = priorAsked.map((field, pos) => {
        const val = details[field.key];
        return {
          key: field.key,
          step: priorStep,
          questionIndex: pos,
          question: conversationQuestion(field, draft),
          answer: formatFieldAnswer(field, val, details, history) || 'Provided',
        };
      });
      history = [
        ...history.filter(
          (item) => !priorSeeded.some((answer) => answer.key === item.key),
        ),
        ...priorSeeded,
      ];
    }

    for (let nextStep = target; nextStep < groups.length; nextStep++) {
      const asked = conversationFieldsForStep(nextStep, details);
      if (asked.length === 0) {
        if (nextStep === groups.length - 1) {
          setConversationHistory(history);
          setStep(nextStep);
          setStepDone(true);
          return { step: nextStep, questionIndex: 0, readyToFinish: true };
        }
        continue;
      }

      const firstOpen = asked.findIndex((field) =>
        !history.some((item) => item.key === field.key &&
          (item.answer !== 'Skipped for now' || !fieldRequired(field, details))) &&
        isFieldUnanswered(field, details, history),
      );

      const lastStep = nextStep === groups.length - 1;
      const shown =
        firstOpen < 0 && lastStep
          ? Math.max(0, asked.length - 1)
          : firstOpen < 0
            ? asked.length
            : firstOpen;

      const seeded: ConversationAnswer[] = asked
        .slice(0, shown)
        .map((field, position) => {
          const value = details[field.key];
          return {
            key: field.key,
            step: nextStep,
            questionIndex: position,
            question: conversationQuestion(field, draft),
            answer:
              formatFieldAnswer(field, value, details, history) || 'Provided',
          };
        });

      history = [
        ...history.filter(
          (item) => !seeded.some((answer) => answer.key === item.key),
        ),
        ...seeded,
      ].sort(
        (left, right) =>
          left.step - right.step || left.questionIndex - right.questionIndex,
      );

      if (firstOpen >= 0 || lastStep) {
        const index = firstOpen < 0 ? Math.max(0, asked.length - 1) : firstOpen;
        setConversationHistory(history);
        setStep(nextStep);
        setQuestionIndex(index);
        setConversationInput('');
        setAttempts([]);
        setConversationError('');
        setStepDone(firstOpen < 0 && lastStep);
        return {
          step: nextStep,
          questionIndex: index,
          readyToFinish: lastStep && firstOpen < 0,
        };
      }
    }
    return null;
  };

  const handleSendConversationAnswer = async (
    answerVal?: string,
    skip = false,
  ) => {
    if (!currentField || thinking) return;
    if (isTaxonomyKey(currentField.key) && taxonomyErrors(draft)[currentField.key]) {
      setConversationError(taxonomyErrors(draft)[currentField.key]); return;
    }
    if (isEducationKey(currentField.key) && educationErrors(draft)[currentField.key]) {setConversationError(educationErrors(draft)[currentField.key]); return;}
    const rawAnswer = answerVal !== undefined ? answerVal : conversationInput;

    if (skip) {
      const updatedHistory: ConversationAnswer = {
        key: currentField.key,
        step,
        questionIndex: currentQuestionIdx,
        question: conversationQuestion(currentField, draft),
        answer: 'Skipped for now',
      };
      const nextHistory = [
        ...conversationHistory.filter((i) => i.key !== currentField.key),
        updatedHistory,
      ].sort(
        (left, right) =>
          left.step - right.step || left.questionIndex - right.questionIndex,
      );
      setConversationHistory(nextHistory);
      setConversationInput('');
      setConversationError('');
      setAttempts([]);

      setThinking(true);
      setTimeout(() => {
        startConversationStep(step, nextHistory, draft);
        setThinking(false);
      }, 500);
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
      setInvalidTarget({ key: 'conversation-answer' });
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
        ? formatSalaryDisplay(typeof parsed.value === 'number' ? parsed.value : null, draft[currentField.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency'])
        : Array.isArray(parsed.value)
          ? parsed.value.join(', ')
          : String(parsed.value ?? ''));

    const updatedHistory: ConversationAnswer = {
      key: currentField.key,
      step,
      questionIndex: currentQuestionIdx,
      question: conversationQuestion(currentField, draft),
      answer: displayAnswer || 'Provided',
    };
    const nextHistory = [
      ...conversationHistory.filter((i) => i.key !== currentField.key),
      updatedHistory,
    ].sort(
      (left, right) =>
        left.step - right.step || left.questionIndex - right.questionIndex,
    );
    setConversationHistory(nextHistory);
    setConversationInput('');
    setConversationError('');
    setAttempts([]);

    setThinking(true);
    setTimeout(() => {
      startConversationStep(step, nextHistory, updatedDraft);
      setThinking(false);
    }, 500);
  };

  const handleEditConversationAnswer = (answer: ConversationAnswer) => {
    setStep(answer.step);
    setStepDone(false);
    const stepFields = conversationFieldsForStep(answer.step, draft);
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

  const focusMissingFields = (missing: string[]): boolean => {
    if (!missing.length) return false;
    if (missing.includes('key_skills')) setServerRequiresSkills(true);

    const first = missing.find(
      (key) =>
        key === 'full_name' ||
        fields.some((field) => field.key === key &&
          (fieldVisible(field, draft) || key === 'key_skills')),
    );
    if (!first) return false;

    const sectionKey =
      first === 'full_name'
        ? 'basic'
        : fields.find((f) => f.key === first)?.section;
    const sectionStep = groups.findIndex((g) => g.key === sectionKey);
    const targetStep =
      onboarding &&
      sectionStep === 0 &&
      (first === 'phone' || first === 'current_city')
        ? 1
        : sectionStep;

    setErrors(
      Object.fromEntries(
        missing.map((key) => [key, 'This field is required.']),
      ),
    );
    const fieldObj = fields.find((f) => f.key === first);
    const fieldName =
      fieldObj?.label ||
      (first === 'full_name' ? 'Full name' : first.replace(/_/g, ' '));
    setError(`Please complete the required field: ${fieldName}.`);

    if (targetStep >= 0 && targetStep !== step) {
      setStep(targetStep);
    }
    setInvalidTarget({ key: onboardingMode === 'conversation' && targetStep > 0 ? 'conversation-answer' : first === 'full_name' ? 'fullName' : first });
    setStepDone(false);
    if (onboardingMode === 'conversation' && targetStep >= 0) {
      const asked = conversationFieldsForStep(targetStep, draft);
      const index = asked.findIndex((field) => field.key === first);
      setQuestionIndex(Math.max(0, index));
      setConversationHistory((previous) => previous.filter((item) => item.key !== first));
      setConversationInput('');
      setAttempts([]);
      setConversationError('Please correct this answer before finishing your profile.');
    }
    return true;
  };

  const handleIncompleteError = (err: unknown): boolean => {
    if (!(err instanceof ApiError)) return false;
    const params = err.problem?.params || (err as any).params;
    return focusMissingFields(Array.isArray(params?.fields) ? params.fields : []);
  };

  const handleContinueConversationStep = async () => {
    const isLastStep = step === groups.length - 1;
    if (isLastStep) {
      const missing = missingRequiredCareerFields(careerDetailsForSave(draft));
      if (!fullName.trim()) missing.push('full_name');
      if (focusMissingFields(missing)) return;
    }
    setBusy(true);
    setError('');
    try {
      if (fullName.trim()) {
        try {
          const identity = await updateCandidateName(fullName.trim());
          if (session) rememberCandidate(session, identity, fullName.trim());
        } catch (nameErr) {
          console.warn('[Profile Save] Could not update candidate name:', nameErr);
          if (isLastStep) throw nameErr;
        }
      }
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
        const nextStep = step + 1;
        setStep(nextStep);
        setStepDone(false);
        setAttempts([]);
        setConversationError('');
        setConversationInput('');
        startConversationStep(nextStep, conversationHistory, draft);
      }
    } catch (failure) {
      logger.error('CareerDetailsScreen', `Save failed on section "${groups[step].key}"`, failure);
      if (handleIncompleteError(failure)) return;
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
    logger.step('CareerDetailsScreen', 'Loading career fields & profile', { versionId, onboarding });
    Promise.all([getCareerFields(), getCareerProfile()])
      .then(async ([specs, saved]) => {
        const shouldPrefill =
          !!versionId &&
          (onboarding
            ? saved.resume_version_id !== versionId
            : !saved.resume_version_id);
        if (shouldPrefill) {
          logger.step('CareerDetailsScreen', `Prefilling career profile from resume version: ${versionId}`);
          try {
            // React development remounts effects. Reuse the mutation so a
            // single resume is never prefetched twice concurrently.
            if (prefillRequest.current?.id !== versionId)
              prefillRequest.current = {
                id: versionId,
                promise: prefillCareerProfile(versionId),
              };
            saved = await prefillRequest.current.promise;
          } catch (prefillErr) {
            logger.error('CareerDetailsScreen', `Resume prefill failed for version ${versionId}`, prefillErr);
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
      .catch((loadErr) => {
        logger.error('CareerDetailsScreen', 'Failed to load career fields or profile', loadErr);
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
      if (key === "employment_start" && (!value || (next.employment_end && String(next.employment_end) <= String(value)))) next.employment_end = "";
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
          notice_period: 'IMMEDIATE',
          job_role: '',
        });
      if (key === 'currently_employed' && value === 'YES') {
        next.employment_end = '';
        if (next.work_status !== 'EXPERIENCED') next.work_status = 'EXPERIENCED';
      }
      if (key === 'currently_employed' && value === 'NO') next.notice_period = 'IMMEDIATE';
      return next;
    });
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const save = async (finishNow: boolean = false) => {
    const nextErrors: Record<string, string> = {...taxonomyErrors(draft), ...educationErrors(draft)};
    const stepFields = manualFieldsForStep(step, draft);
    for (const field of stepFields) {
      if (
        fieldRequired(field, draft) &&
        ((field.key === 'annual_salary' ? draft[field.key] == null || draft[field.key] === '' : !draft[field.key]) ||
          (Array.isArray(draft[field.key]) &&
            !(draft[field.key] as string[]).length))
      )
        nextErrors[field.key] = 'This field is required.';
    }
    let phoneVal =
      typeof draft.phone === 'string'
        ? draft.phone.trim().replace(/[\s-]/g, '')
        : '';
    if (!phoneVal.startsWith('+') && /^\d{10}$/.test(phoneVal)) {
      phoneVal = `+91${phoneVal}`;
      setDraft((prev) => ({ ...prev, phone: phoneVal }));
    }
    if (
      (groups[step].key === 'basic' || (onboarding && step === 1)) &&
      phoneVal &&
      !/^\+[1-9]\d{7,14}$/.test(phoneVal)
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
    if (
      groups[step].key === 'education' &&
      draft.starting_year &&
      draft.passing_year &&
      Number(draft.passing_year) < Number(draft.starting_year)
    ) {
      nextErrors.passing_year =
        'Passing year cannot be earlier than starting year.';
    }
    if (
      groups[step].key === 'employment' &&
      draft.currently_employed === 'NO' &&
      draft.employment_start &&
      draft.employment_end &&
      String(draft.employment_end) <= String(draft.employment_start)
    ) {
      nextErrors.employment_end =
        'The ending month must be after the starting month.';
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const first = (nextErrors.full_name ? 'full_name' : manualFieldsForStep(step, draft).find((field) => nextErrors[field.key])?.key) ?? Object.keys(nextErrors)[0];
      setInvalidTarget({ key: first === 'full_name' ? 'fullName' : first });
      logger.warn('CareerDetailsScreen', `Validation failed on section "${groups[step].key}"`, nextErrors);
      return;
    }
    const isLastStep = step === groups.length - 1;
    if (isLastStep) {
      const missing = missingRequiredCareerFields(
        careerDetailsForSave({ ...draft, ...(phoneVal ? { phone: phoneVal } : {}) }),
      );
      if (!fullName.trim()) missing.push('full_name');
      if (focusMissingFields(missing)) {
        logger.warn('CareerDetailsScreen', 'Missing required fields across earlier steps before final save', missing);
        return;
      }
    }
    logger.step('CareerDetailsScreen', `Saving section "${groups[step].key}" (step ${step + 1}/${groups.length})`, {
      finishNow,
      activeVersionId,
      selectedFilename,
    });
    setBusy(true);
    setError('');
    try {
      if (fullName.trim()) {
        try {
          const identity = await updateCandidateName(fullName.trim());
          if (session) rememberCandidate(session, identity, fullName.trim());
        } catch (nameErr) {
          console.warn('[Profile Save] Could not update candidate name:', nameErr);
        }
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
      logger.error('CareerDetailsScreen', `Save failed on section "${groups[step].key}"`, failure);
      if (handleIncompleteError(failure)) return;
      setError(
        failure instanceof Error
          ? failure.message
          : 'Check your details and try again.',
      );
    } finally {
      setBusy(false);
    }
  };


  if ((fields.length === 0 && busy) || (onboarding && !modeRestored)) {
    return (
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
        <View style={styles.header}>
          <Pressable
            accessibilityLabel="Back"
            disabled={true}
            onPress={goBack}
            style={[styles.headerBackBtn, styles.backDisabled]}
          >
            <ArrowLeft size={18} color="#9AA1AE" weight="bold" />
          </Pressable>
          <Text style={[styles.title, { flex: 1 }, onboarding && styles.onboardingTitle, onboarding && step === 0 && styles.completeProfileTitle]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header">
            {onboarding ? (step === 0 ? 'Complete your profile' : 'Profile') : 'Profile details'}
          </Text>
          <View style={styles.headerRightPlaceholder} />
        </View>
        <View style={styles.centerLoading}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.centerLoadingText}>Loading profile details…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (shouldOfferOnboardingMode({ onboarding, editing, step, restored: modeRestored, mode: onboardingMode,
    basicComplete: Boolean(fullName.trim() && draft.phone && draft.current_city && draft.work_status),
    completed: Boolean(profile?.completed) })) {
    return <SafeAreaView edges={['top', 'left', 'right']} style={styles.screen}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back to basic details"
          style={styles.headerBackBtn} onPress={() => setStep(0)}>
          <ArrowLeft size={18} color="#0A1931" />
        </Pressable>
        <Text style={[styles.title, styles.onboardingTitle, { flex: 1 }]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header" accessibilityLabel="Profile">Profile</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => void logout()} style={styles.headerSignOutBtn}><LogOut size={20} color="#0A1931" strokeWidth={1.8} /></Pressable>
      </View>
      <View style={styles.modeContent}>
        <OnboardingProgress step={1} />
        <Text accessibilityRole="header" style={styles.modeHeading}>How would you like to complete your profile?</Text>
        <Text style={styles.modeDescription}>Choose a form or a guided conversation for the remaining steps.</Text>
        {(['manual', 'conversation'] as const).map((option) => {
          const Icon = option === 'manual' ? ListChecks : MessageCircle;
          return <Pressable key={option} accessibilityRole="button"
            style={({ pressed }) => [styles.modeCard, pressed && { backgroundColor: '#F8F5FF' }]}
            onPress={() => {
              chooseMode(option);
              if (option === 'conversation') startConversationStep(step, conversationHistory, draft);
            }}>
            <Icon size={24} color="#5F4DB2" strokeWidth={1.8} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text style={styles.modeLabel}>{option === 'manual' ? 'Manual Form' : 'Conversational Mode'}</Text>
              <Text style={styles.modeDescription}>{option === 'manual'
                ? 'Fill in your details in the familiar form.'
                : 'Answer one question at a time. Type or choose a suggestion.'}</Text>
            </View>
          </Pressable>;
        })}
      </View>
    </SafeAreaView>;
  }
  const isConversation = editing && onboarding && step > 0 && onboardingMode === 'conversation';
  const conversationScreen = <View style={styles.chatScreen}>
    {!!error && <Text accessibilityRole="alert" style={[styles.error, {margin: 16}]}>{error}</Text>}
    <ConversationPrompt
      thinking={thinking || busy}
      question={currentField ? conversationQuestion(currentField, draft) : ''}
      closing={stepDone ? 'Thanks! That covers your profile details. Ready to save and continue?' : undefined}
      history={conversationHistory}
      disabled={busy || thinking}
      retryMessage={conversationError}
      attempts={attempts}
      onEdit={handleEditConversationAnswer}
      footer={<View style={styles.convActionRow}>
        <Pressable accessibilityRole="button" disabled={busy || thinking}
          onPress={() => {if (stepDone) {setStepDone(false); setConversationError('');} else goBack();}}
          style={[styles.convBackBtn, (busy || thinking) && styles.primaryDisabled]}>
          <Text style={styles.convBackText}>Back</Text>
        </Pressable>
        <Pressable accessibilityRole="button" disabled={busy || thinking}
          onPress={() => stepDone ? void handleContinueConversationStep() : void handleSendConversationAnswer()}
          style={[styles.convContinueBtn, (busy || thinking) && styles.primaryDisabled]}>
          <LinearGradient colors={['#643AC5', '#5131A7']} start={{x: 0, y: 0}} end={{x: 1, y: 0}} style={styles.convContinueFill}>
            {busy || thinking ? <ActivityIndicator size="small" color="#FFFFFF" /> : <>
              <Text style={styles.convContinueText}>{stepDone ? 'Save & Continue' : 'Send answer'}</Text>
              <ArrowRight size={22} color="#FFFFFF" />
            </>}
          </LinearGradient>
        </Pressable>
      </View>}
    >
      {!stepDone && currentField ? <>
                  {currentField && ['annual_salary', 'preferred_salary'].includes(currentField.key) &&
                    <View style={styles.convChipsRow}>{['INR', 'USD'].map((currency) => {
                      const key = currentField.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency';
                      return <Pressable key={currency} accessibilityRole="button" accessibilityLabel={`Salary currency ${currency}`}
                        accessibilityState={{ selected: (draft[key] ?? 'INR') === currency }}
                        style={[styles.convChip, (draft[key] ?? 'INR') === currency && styles.convChipActive]}
                        onPress={() => update(key, currency)}><Text style={[styles.convChipText, (draft[key] ?? 'INR') === currency && styles.convChipTextActive]}>{currency === 'INR' ? '₹ INR' : '$ USD'}</Text></Pressable>;
                    })}</View>}
                  <View ref={(view) => { fieldViews.current['conversation-answer'] = view; }} collapsable={false} style={styles.convInputWrap} onLayout={(event) => onFieldLayout('conversation-answer', event)}>
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

                    {/* Input for conversation mode */}
                    {isEducationKey(currentField.key) ? (
                      <EducationField fieldKey={currentField.key} label={currentField.label} details={draft} invalid={!!conversationError} onChange={(next) => {setDraft(next); setConversationInput(String(next[currentField.key] || '')); setConversationError('');}} />
                    ) : isTaxonomyKey(currentField.key) ? (
                      <TaxonomyField fieldKey={currentField.key} label={currentField.label} details={draft} invalid={!!conversationError}
                        onChange={(next) => {setDraft(next); setConversationInput(String(next[currentField.key] || '')); setConversationError('');}} />
                    ) : currentField.type === 'tel' ? (
                      <PhoneNumberInput
                        value={conversationInput}
                        onChange={(next) => {
                          setConversationInput(next);
                          setConversationError('');
                        }}
                        error={conversationError}
                        hint="Select your country code, then enter your mobile number."
                      />
                    ) : currentField.type === 'month' ? (
                      <MonthYearPicker
                        key={currentField.key}
                        dateKind={currentField.key === "employment_end" ? "ending" : "starting"}
                        after={currentField.key === "employment_end" ? String(draft.employment_start || "") : undefined}
                        disabled={currentField.key === "employment_end" && !draft.employment_start}
                        value={conversationInput}
                        invalid={!!conversationError}
                        onChange={(next) => {
                          setConversationInput(next);
                          setConversationError('');
                        }}
                      />
                    ) : currentField.key === 'starting_year' ? (
                      <YearDropdownPicker
                        value={conversationInput || null}
                        pastYears={100}
                        invalid={!!conversationError}
                        onChange={(yr) => {
                          const str = yr ? String(yr) : '';
                          setConversationInput(str);
                          setConversationError('');
                        }}
                      />
                    ) : currentField.key === 'passing_year' ? (
                      <YearDropdownPicker
                        value={conversationInput || null}
                        minYear={
                          draft.starting_year
                            ? Number(draft.starting_year)
                            : new Date().getFullYear() - 100
                        }
                        maxYear={
                          draft.starting_year
                            ? Math.min(
                                new Date().getFullYear() + 7,
                                Number(draft.starting_year) + educationYearSpan,
                              )
                            : new Date().getFullYear() + 7
                        }
                        modalTitle="Select passing year"
                        invalid={!!conversationError}
                        onChange={(yr) => {
                          const str = yr ? String(yr) : '';
                          setConversationInput(str);
                          setConversationError('');
                        }}
                      />
                    ) : (
                      <View style={[styles.convAmountWrap, ['annual_salary', 'preferred_salary'].includes(currentField.key) && styles.convSalaryWrap, !!conversationError && styles.convTextInputError]}>
                      {['annual_salary', 'preferred_salary'].includes(currentField.key) && <Wallet size={21} color="#5F6B80" />}
                      <TextInput
                        ref={(input) => { inputRefs.current['conversation-answer'] = input; }}
                        style={[
                          styles.convTextInput,
                          ['annual_salary', 'preferred_salary'].includes(currentField.key) && styles.convAmountInput,
                          !!conversationError && styles.convTextInputError,
                        ]}
                        value={currentField.key === "annual_salary" || currentField.key === "preferred_salary" ? formatSalaryInput(conversationInput, draft[currentField.key === "annual_salary" ? "annual_salary_currency" : "preferred_salary_currency"]) : conversationInput}
                        onChangeText={(t) => {
                          setConversationInput(currentField.key === "annual_salary" || currentField.key === "preferred_salary" ? formatSalaryInput(t, draft[currentField.key === "annual_salary" ? "annual_salary_currency" : "preferred_salary_currency"]) : t);
                          setConversationError('');
                        }}
                        placeholder={
                          currentField.key === 'annual_salary' || currentField.key === 'preferred_salary'
                            ? 'Enter the full annual amount'
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
                      </View>
                    )}
                    {(currentField.key === 'current_city' || currentField.key === 'preferred_locations') && (
                      <CitySuggestions
                        list={currentField.key === 'preferred_locations'}
                        value={conversationInput}
                        onPick={(picked) => { setConversationInput(picked); setConversationError(''); }}
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

                  </View>
      </> : null}
    </ConversationPrompt>
  </View>;
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={[styles.screen, isConversation && styles.chatScreen]}>
      <View style={[styles.header, isConversation && styles.chatHeader]}>
        {!(onboarding && step === 0) && (
          <Pressable
            accessibilityLabel="Back"
            disabled={busy}
            onPress={goBack}
            style={[styles.headerBackBtn, isConversation && styles.chatBackBtn, busy && styles.backDisabled]}
          >
            <ArrowLeft size={18} color={busy ? '#9AA1AE' : '#0A1931'} weight="bold" />
          </Pressable>
        )}
        <Text style={[styles.title, { flex: 1 }, onboarding && styles.onboardingTitle, onboarding && step === 0 && styles.completeProfileTitle]} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header" accessibilityLabel={onboarding ? (step === 0 ? "Complete your profile" : "Profile") : "Profile details"}>
          {onboarding ? (step === 0 ? 'Complete your profile' : 'Profile') : 'Profile details'}
        </Text>
        {onboarding && step > 0 ? (
          <><View style={styles.headerModeToggle}>
            <Pressable
              onPress={() => chooseMode('manual')}
              accessibilityRole="button"
              accessibilityLabel="Manual Form"
              style={[
                styles.headerModeSegment,
                onboardingMode === 'manual' && styles.headerModeSegmentActive,
              ]}
            >
              <ListChecks
                size={16}
                color={onboardingMode === 'manual' ? '#FFFFFF' : '#5F4DB2'} strokeWidth={1.8}
              />
            </Pressable>
            <Pressable
              onPress={() => {
                chooseMode('conversation');
                startConversationStep(step > 0 ? step : 1, conversationHistory, draft);
              }}
              accessibilityRole="button"
              accessibilityLabel="Conversational Mode"
              style={[
                styles.headerModeSegment,
                onboardingMode === 'conversation' && styles.headerModeSegmentActive,
              ]}
            >
              <MessageCircle
                size={16}
                color={onboardingMode === 'conversation' ? '#FFFFFF' : '#5F4DB2'} strokeWidth={1.8}
              />
            </Pressable>
          </View><Pressable disabled={busy} onPress={() => void logout()} accessibilityRole="button" accessibilityLabel="Sign out" style={styles.headerSignOutBtn}><LogOut size={20} color="#0A1931" strokeWidth={1.8} /></Pressable></>
        ) : onboarding && step === 0 ? (
          <Pressable
            disabled={busy}
            onPress={() => void logout()}
            style={styles.headerSignOutBtn}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <LogOut size={20} color="#0A1931" strokeWidth={1.8} />
          </Pressable>
        ) : editing && !onboarding ? (
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
        ) : (
          <View style={styles.headerRightPlaceholder} />
        )}
      </View>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
      >
        {isConversation ? conversationScreen : (
        <ScrollView
          ref={scrollRef}
          onScroll={(event) => { scrollOffset.current = event.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          key={`${editing}-${step}`}
          pointerEvents={busy ? 'none' : 'auto'}
          contentContainerStyle={[
            styles.content,
            // SafeAreaView and KeyboardAvoidingView already provide system clearance.
            { paddingBottom: keyboardHeight > 0 ? 20 : 12 },
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
          </View>
        )}
        {editing ? (
          <>
            {onboarding && <OnboardingProgress step={step} bottomSpacing={0} />}
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
                      if (onboardingMode === 'conversation') {
                        startConversationStep(idx, conversationHistory, draft);
                      }
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

            {isConversation ? null : (
              <>
                <View style={{gap: 8}}>
                <Text
                  style={
                    onboarding
                      ? {
                          fontFamily: 'GeneralSans-Semibold',
                          fontSize: 26,
                          lineHeight: 32,
                          letterSpacing: -0.5,
                          color: '#0A1931',
                          textAlign: 'left',
                        }
                      : styles.sectionTitle
                  }
                >
                  {groups[step].title}
                </Text>
                <Text style={styles.help}>
                  Required fields are marked *.
                </Text>
                </View>
                {step === 0 && (
                  <>
                    {onboarding && (
                      <View style={styles.field}>
                        <Text style={styles.label}>Start with your resume/CV</Text>
                        <View style={styles.row}>
                          <Pressable
                            disabled={busy}
                            onPress={() =>
                              void uploadResume().catch(() =>
                                setError(
                                  'The file picker could not open. Please try again.',
                                ),
                              )
                            }
                            style={[styles.back, { flex: 1, borderRadius: 14 }]}
                          >
                            <ResumePickerLabel filename={selectedFilename || profile?.resume_filename} />
                          </Pressable>
                          {(selectedFilename || profile?.resume_filename) ? (
                            <Pressable
                              disabled={busy}
                              accessibilityRole="button"
                              accessibilityLabel="Remove resume"
                              onPress={async () => {
                                logger.step('CareerDetailsScreen', 'User removed resume from onboarding step 0');
                                setSelectedFilename(undefined);
                                setActiveVersionId(null);
                                setProfile((curr) =>
                                  curr
                                    ? {
                                        ...curr,
                                        resume_version_id: null,
                                        resume_file_id: null,
                                        resume_filename: null,
                                      }
                                    : curr,
                                );
                                await clearPendingResume().catch(() => undefined);
                              }}
                              style={styles.removeResumeIconBtn}
                              hitSlop={8}
                            >
                              <X size={18} color="#0A1931" weight="bold" />
                            </Pressable>
                          ) : null}
                        </View>
                        <Text style={styles.help}>
                          We fill your details from your resume/CV. Review them below. Scoring starts after payment.
                        </Text>
                      </View>
                    )}
                    <View
                      style={styles.field}
                      ref={(view) => { fieldViews.current.fullName = view; }}
                      collapsable={false}
                      onLayout={(e) => onFieldLayout('fullName', e)}
                    >
                      <Text style={styles.label}>Full name *</Text>
                      <TextInput
                        style={styles.input}
                        ref={(input) => { inputRefs.current.fullName = input; }}
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
                      <View style={styles.disabledInputWrapper} accessibilityLabel="Verified email address" accessibilityState={{disabled: true}}>
                        <EnvelopeSimple size={18} color="#9AA1AE" />
                        <Text style={styles.disabledInputText} numberOfLines={1}>
                          {session?.email || ''}
                        </Text>
                      </View>
                      <Text style={styles.help}>Your verified account email.</Text>
                    </View>
                  </>
                )}
                {manualFieldsForStep(step, draft)
                  .map((field) => {
                    if (field.key === 'experience_months') return null;
                    if (field.key === 'experience_years') return <View key={field.key} style={{flexDirection: 'row', gap: 12}}>
                      {(['experience_years', 'experience_months'] as const).map((key) => <View key={key} style={[styles.field, {flex: 1}]} ref={(view) => {fieldViews.current[key] = view;}} collapsable={false} onLayout={(event) => onFieldLayout(key, event)}>
                        <Text style={styles.label}>{key === 'experience_years' ? 'Experience — years' : 'Months'}</Text>
                        <DropdownSelect value={String(draft[key] ?? 0)} modalTitle={key === 'experience_years' ? 'Years of experience' : 'Additional months'} invalid={!!errors[key]} onChange={(value) => update(key, Number(value))}
                          options={Array.from({length: key === 'experience_years' ? 51 : 12}, (_, value) => ({value: String(value), label: key === 'experience_years' && value === 50 ? '50+ years' : `${value} ${key === 'experience_years' ? (value === 1 ? 'year' : 'years') : (value === 1 ? 'month' : 'months')}`}))} />
                        {!!errors[key] && <Text style={styles.error}>{errors[key]}</Text>}
                      </View>)}
                    </View>;
                    const value = draft[field.key];
                    return (
                      <View
                        key={field.key}
                        style={styles.field}
                        ref={(view) => { fieldViews.current[field.key] = view; }}
                        collapsable={false}
                        onLayout={(e) => onFieldLayout(field.key, e)}
                      >
                        <Text style={styles.label}>
                          {careerLabel(field.key, field.label)}
                          {fieldRequired(field, draft) ? ' *' : ''}
                        </Text>
                        {field.key === 'notice_period' && draft.currently_employed === 'NO' ? (
                          <DropdownSelect disabled value="IMMEDIATE" modalTitle="Notice Period" options={[{value: 'IMMEDIATE', label: 'Immediate'}]} onChange={() => {}} />
                        ) : isEducationKey(field.key) ? (
                          <EducationField fieldKey={field.key} label={field.label} details={draft} invalid={!!errors[field.key]} onChange={(next) => {setDraft(next); setErrors((current) => ({...current, [field.key]: ''}));}} />
                        ) : isTaxonomyKey(field.key) ? (
                          <TaxonomyField fieldKey={field.key} label={careerLabel(field.key, field.label)} details={draft} invalid={!!errors[field.key]}
                            onChange={(next) => {setDraft(next); setErrors((current) => ({...current, [field.key]: ''}));}} />
                        ) : field.type === 'select' ? (
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
                            inputRef={phoneRef}
                            value={String(value ?? '')}
                            onChange={(next) => update(field.key, next)}
                            onFocus={() => scrollToField(field.key)}
                            error={errors[field.key]}
                            hint="Select your country code, then enter your mobile number."
                          />
                        ) : field.type === 'month' ? (
                          <MonthYearPicker
                            dateKind={field.key === 'employment_end' ? 'ending' : 'starting'}
                            after={field.key === 'employment_end' ? String(draft.employment_start || '') : undefined}
                            value={String(value ?? '')}
                            invalid={!!errors[field.key]}
                            disabled={busy || (field.key === 'employment_end' && !draft.employment_start)}
                            onOpen={() => scrollToField(field.key)}
                            onChange={(next) => update(field.key, next)}
                          />
                        ) : field.key === 'starting_year' ? (
                          <YearDropdownPicker
                            value={value as number | null}
                            pastYears={100}
                            invalid={!!errors[field.key]}
                            disabled={busy}
                            onOpen={() => scrollToField(field.key)}
                            onChange={(yr) => update(field.key, yr)}
                          />
                        ) : field.key === 'passing_year' ? (
                          <YearDropdownPicker
                            value={value as number | null}
                            minYear={
                              draft.starting_year
                                ? Number(draft.starting_year)
                                : new Date().getFullYear() - 100
                            }
                            maxYear={
                              draft.starting_year
                                ? Math.min(
                                    new Date().getFullYear() + 7,
                                    Number(draft.starting_year) + educationYearSpan,
                                  )
                                : new Date().getFullYear() + 7
                            }
                            modalTitle="Select passing year"
                            invalid={!!errors[field.key]}
                            disabled={busy}
                            onOpen={() => scrollToField(field.key)}
                            onChange={(yr) => update(field.key, yr)}
                          />
                        ) : field.key === 'current_city' ? (
                          <IndianCityDropdown
                            multiple={false}
                            value={String(value ?? '')}
                            onChange={(city) => update(field.key, city)}
                            placeholder="Select your city"
                            modalTitle="Current city"
                            invalid={!!errors[field.key]}
                            disabled={busy}
                          />
                        ) : field.key === 'preferred_locations' ? (
                          <IndianCityDropdown
                            multiple
                            values={Array.isArray(value) ? value : []}
                            onChangeValues={(cities) => {
                              setLists((current) => ({ ...current, [field.key]: cities.join(', ') }));
                              update(field.key, cities);
                            }}
                            placeholder="Select preferred Indian cities"
                            modalTitle="Preferred work locations"
                            invalid={!!errors[field.key]}
                            disabled={busy}
                          />
                        ) : (
                          <TextInput
                            ref={(input) => { inputRefs.current[field.key] = input; }}
                            accessibilityLabel={careerLabel(field.key, field.label)}
                            onFocus={() => scrollToField(field.key)}
                            value={
                              field.key === 'annual_salary' || field.key === 'preferred_salary'
                                ? formatSalaryInput(value, draft[field.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency'])
                                : field.type === 'list'
                                ? lists[field.key] ??
                                  (Array.isArray(value) ? value.join(', ') : '')
                                : String(value ?? '')
                            }
                            placeholder={
                              field.type === 'list'
                                ? 'Separate with commas'
                                : careerLabel(field.key, field.label)
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
                              if (field.key === 'annual_salary' || field.key === 'preferred_salary') {
                                const amount = raw.replace(/,/g, '');
                                if (!amount) update(field.key, null);
                                else if (/^\d+$/.test(amount) && Number.isSafeInteger(Number(amount))) update(field.key, Number(amount));
                              } else if (field.type === 'list') {
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
                  {!(onboarding && step === 0) && <Pressable
                    disabled={busy}
                    onPress={goBack}
                    style={[styles.back, busy && styles.backDisabled]}
                  >
                    <ArrowLeft size={18} color={busy ? '#9AA1AE' : '#0A1931'} />
                    <Text style={[styles.label, busy && styles.labelDisabled]}>
                      Back
                    </Text>
                  </Pressable>}
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
                          ? 'Save'
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
                    field.section === group.key && field.key !== "specialization_name",
                )
                .map((field) => {
                  const value = draft[field.key];
                  const text = profileValueText(value, field.options);
                  const display = ['annual_salary', 'preferred_salary'].includes(field.key) && text !== 'N/A'
                    ? formatSalaryDisplay(typeof value === 'number' ? value : null, draft[field.key === 'annual_salary' ? 'annual_salary_currency' : 'preferred_salary_currency'])
                    : text;
                  return (
                    <View key={field.key} style={styles.field}>
                      <Text style={styles.help}>{careerLabel(field.key, field.label)}</Text>
                      <Text style={styles.label}>{display}</Text>
                    </View>
                  );
                })}
            </View>
          ))
        )}
      </ScrollView>
      )}
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  modeContent: { padding: 20, gap: 16, width: '100%', maxWidth: 600, alignSelf: 'center' },
  modeHeading: { fontFamily: 'GeneralSans-Semibold', fontSize: 26, lineHeight: 32, letterSpacing: -0.4, color: '#0A1931' },
  modeDescription: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#5F6B80' },
  modeCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, padding: 20, borderRadius: 16, borderWidth: 1, borderColor: '#C9BEEB', backgroundColor: '#FFFFFF' },
  modeLabel: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, lineHeight: 22, color: '#5F4DB2' },
  screen: { flex: 1, backgroundColor: '#FFFCF7' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E7E0D4',
  },
  headerBackBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerRightPlaceholder: {
    width: 40,
  },
  headerLeftPlaceholder: {
    width: 40,
    height: 40,
  },
  headerSignOutBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerSignOutText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#0A1931',
  },
  title: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#0A1931',
    textAlign: 'left',
  },
  content: { paddingHorizontal: 20, paddingTop: 20, gap: 20 },
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
  disabledInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    backgroundColor: '#F3F4F6',
  },
  disabledInputText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 16,
    color: '#6B7280',
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
  headerModeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EDE8F8',
    borderRadius: 20,
    padding: 3,
    gap: 2,
  },
  headerModeSegment: {
    width: 34,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerModeSegmentActive: {
    backgroundColor: '#5F4DB2',
  },
  removeResumeIconBtn: {
    width: 48,
    height: 50,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
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
    fontWeight: '600',
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
    fontWeight: '600',
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
  // Full-height conversation: composer scrolls with messages, actions stay above the keyboard.
  chatScreen: { flex: 1, backgroundColor: '#FFFFFF' },
  chatHeader: { paddingHorizontal: 12, gap: 6, borderBottomColor: '#EFF0F4' },
  chatBackBtn: { width: 32, borderWidth: 0, backgroundColor: 'transparent' },
  onboardingTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931', minWidth: 0, flexShrink: 1, textAlign: 'left' },
  completeProfileTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931', textAlign: 'left' },
  convActionRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  convBackBtn: { minHeight: 48, minWidth: 96, paddingHorizontal: 20, borderRadius: 25, borderWidth: 1, borderColor: '#D0C4ED', backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  convBackText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#5F35B5' },
  convContinueBtn: { flex: 1, borderRadius: 25, overflow: 'hidden' },
  convContinueFill: { minHeight: 48, paddingHorizontal: 20, flexDirection: 'row', gap: 12, alignItems: 'center', justifyContent: 'center' },
  convContinueText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#FFFFFF' },
  convInputWrap: { gap: 12 },
  convChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  convChip: { minHeight: 44, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 24, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E4DEED' },
  convChipActive: { backgroundColor: '#F0EBFA', borderColor: '#5F35B5' },
  convChipText: { fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#3A4761' },
  convChipTextActive: { color: '#5F35B5' },
  convAmountWrap: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  convSalaryWrap: { minHeight: 52, borderWidth: 1, borderColor: '#CFC2EC', borderRadius: 12, paddingLeft: 14 },
  convAmountInput: { flex: 1, minWidth: 0, borderWidth: 0, backgroundColor: 'transparent' },
  convTextInput: { flex: 1, minWidth: 0, minHeight: 52, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CFC2EC', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontFamily: 'GeneralSans-Regular', fontSize: 16, color: '#0A1931' },
  convTextInputError: { borderColor: '#C93B2B' },
  convSkipBtn: { alignSelf: 'flex-end', paddingVertical: 4 },
  convSkipText: { fontFamily: 'GeneralSans-Regular', fontSize: 12, color: '#5F6B80', textDecorationLine: 'underline' },
});
