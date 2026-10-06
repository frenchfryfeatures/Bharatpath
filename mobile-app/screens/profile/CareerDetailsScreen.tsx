import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  Pressable,
  ActivityIndicator,
  StyleSheet,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, FileText, PencilSimple, X } from 'phosphor-react-native';
import { WebView } from 'react-native-webview';
import { OnboardingProgress } from '@/screens/onboarding/OnboardingProgress';
import { useRouter } from 'expo-router';
import { useAuthContext } from '@/context/AuthContext';
import { updateCandidateName } from '@/services/api/auth';
import {
  getCareerFields,
  getCareerProfile,
  prefillCareerProfile,
  saveCareerProfile,
  getResumePreview,
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
  initialSection = 0,
}: {
  versionId?: string;
  resumeFilename?: string;
  onboarding?: boolean;
  onBack: () => void;
  onDone: (profile: CareerProfile) => void;
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

  useEffect(() => {
    let alive = true;
    setBusy(true);
    Promise.all([getCareerFields(), getCareerProfile()])
      .then(async ([specs, saved]) => {
        if (versionId && saved.resume_version_id !== versionId) {
          try {
            saved = await prefillCareerProfile(versionId);
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
          notice_period: 'NOT_WORKING',
        });
      if (key === 'currently_employed' && value === 'YES')
        next.employment_end = '';
      return next;
    });
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const save = async () => {
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
      const saved = await saveCareerProfile(
        draft,
        activeVersionId,
        step === groups.length - 1,
        resumeFilename,
      );
      setProfile(saved);
      setActiveVersionId(saved.resume_version_id);
      if (step === groups.length - 1) {
        if (onboarding) onDone(saved);
        else {
          setEditing(false);
          setStep(0);
        }
      } else setStep(step + 1);
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

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Back"
          onPress={onBack}
          style={styles.back}
        >
          <ArrowLeft size={22} color="#0A1931" />
        </Pressable>
        <Text style={styles.title}>
          {onboarding ? 'Create your profile' : 'Profile details'}
        </Text>
      </View>
      <ScrollView
        key={`${editing}-${step}`}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {busy && (
          <View style={styles.loading}>
            <ActivityIndicator color="#5F4DB2" />
            <Text style={styles.help}>
              {onboarding && !profile
                ? 'Reading your resume. Scoring starts after membership payment.'
                : 'Please wait…'}
            </Text>
          </View>
        )}
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
              onPress={() => router.push('/resume-details')}
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
            <Text style={onboarding ? {fontFamily:'GeneralSans-Bold',fontSize:26,lineHeight:32,letterSpacing:-0.4,color:'#0A1931'} : styles.sectionTitle}>
              {groups[step].title}
            </Text>
            <Text style={styles.help}>
              Required fields are marked *. Salary and gender are optional.
            </Text>
            {step === 0 && (
              <>
                <View style={styles.field}>
                  <Text style={styles.label}>Full name *</Text>
                  <TextInput
                    style={styles.input}
                    accessibilityLabel="Full name"
                    value={fullName}
                    onChangeText={setFullName}
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
                  <View key={field.key} style={styles.field}>
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
                                value === option.value && styles.selectedText,
                              ]}
                            >
                              {option.label}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    ) : (
                      <TextInput
                        accessibilityLabel={field.label}
                        value={
                          field.type === 'list'
                            ? (lists[field.key] ??
                              (Array.isArray(value) ? value.join(', ') : ''))
                            : String(value ?? '')
                        }
                        placeholder={
                          field.type === 'month'
                            ? 'YYYY-MM'
                            : field.type === 'list'
                              ? 'Separate with commas'
                              : field.key === 'phone'
                                ? '+919876543210'
                                : field.label
                        }
                        placeholderTextColor="#9AA1AE"
                        keyboardType={
                          field.type === 'number'
                            ? 'numeric'
                            : field.type === 'tel'
                              ? 'phone-pad'
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
                    {!!errors[field.key] && (
                      <Text style={styles.error}>{errors[field.key]}</Text>
                    )}
                  </View>
                );
              })}
            <View style={styles.row}>
              <Pressable
                disabled={busy}
                onPress={() => {
                  if (step) setStep(step - 1);
                  else if (onboarding) onBack();
                  else setEditing(false);
                }}
                style={styles.back}
              >
                <ArrowLeft size={18} color="#0A1931" />
                <Text style={styles.label}>Back</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void save()}
                style={[styles.primary, { flex: 1 }]}
              >
                <Text style={styles.primaryText}>
                  {step === 3
                    ? onboarding
                      ? 'Save and continue'
                      : 'Save profile'
                    : 'Save and continue'}
                </Text>
              </Pressable>
            </View>
          </>
        ) : (
          groups.map((group) => (
            <View key={group.key} style={styles.card}>
              <Text style={styles.sectionTitle}>{group.title}</Text>
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
});
