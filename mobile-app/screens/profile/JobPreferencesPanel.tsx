/**
 * The profile's Job preferences tab (2026-11-23).
 *
 * What the candidate wants from their next job; the job engine ranks "Jobs
 * relevant to your profile" by it. Built from the onboarding form's own
 * pieces -- `DropdownSelect`, the same label, input and help styles, the city
 * suggestions and salary formatting -- so it looks like onboarding.
 *
 * Every choice with a known list is a dropdown showing all its options;
 * fields that take several answers add each pick as a removable chip. Open
 * only once the profile is complete (the server answers 409 before that).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { Plus, X } from 'phosphor-react-native';

import { DropdownSelect, type SelectOption } from '@/components/inputs/DropdownSelect';
import { IndianCityDropdown } from '@/components/inputs/IndianCityDropdown';
import { AppAlert } from '@/components/feedback/AppAlert';
import { formatSalaryInput } from '@/utils/salaryInput';
import { ApiError } from '@/services/api/client';
import {
  getJobPreferenceOptions,
  getJobPreferences,
  saveJobPreferences,
  type JobPreferenceOptions,
  type JobPreferences,
  type JobPreferencesResponse,
} from '@/services/api/career';

const MAX_CHOICES = 5;

function pick(source: JobPreferences): JobPreferences {
  return {
    preferred_roles: source.preferred_roles,
    preferred_industries: source.preferred_industries,
    work_modes: source.work_modes,
    job_types: source.job_types,
    open_to_relocation: source.open_to_relocation,
    preferred_locations: source.preferred_locations,
    preferred_salary: source.preferred_salary,
    preferred_salary_currency: source.preferred_salary_currency,
  };
}

function salaryText(value: number | null): string {
  return value == null ? '' : String(value);
}

/** A dropdown of every option; each pick becomes a removable chip. */
function MultiSelectField({
  label,
  hint,
  options,
  values,
  onChange,
  searchable = false,
}: {
  label: string;
  hint?: string;
  options: SelectOption[];
  values: string[];
  onChange: (values: string[]) => void;
  searchable?: boolean;
}) {
  const remaining = options.filter((option) => !values.includes(option.value));
  const full = values.length >= MAX_CHOICES || remaining.length === 0;
  const labelOf = (value: string) => options.find((o) => o.value === value)?.label ?? value;
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <DropdownSelect
        value=""
        options={remaining}
        placeholder={full ? 'All chosen' : 'Select'}
        modalTitle={label}
        searchable={searchable}
        disabled={full}
        onChange={(value) => value && onChange([...values, value])}
      />
      {values.length > 0 && (
        <View style={styles.chips} accessibilityLabel={`Selected ${label.toLowerCase()}`}>
          {values.map((value) => (
            <View key={value} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>{labelOf(value)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${labelOf(value)}`}
                hitSlop={8}
                onPress={() => onChange(values.filter((item) => item !== value))}
              >
                <X size={14} color="#4A3E8F" weight="bold" />
              </Pressable>
            </View>
          ))}
        </View>
      )}
      {!!hint && <Text style={styles.help}>{full && values.length >= MAX_CHOICES ? `Up to ${MAX_CHOICES}.` : hint}</Text>}
    </View>
  );
}

export function JobPreferencesPanel({ onOpenProfile }: { onOpenProfile?: () => void }) {
  const [loaded, setLoaded] = useState<JobPreferencesResponse | null>(null);
  const [options, setOptions] = useState<JobPreferenceOptions | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Keep a missing backend route retryable after the server is updated.
  const [unsupported, setUnsupported] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    setUnsupported(false);
    try {
      const [prefs, opts] = await Promise.all([getJobPreferences(), getJobPreferenceOptions()]);
      setLoaded(prefs);
      setOptions(opts);
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) setUnsupported(true);
      else setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Every visit: the profile may have been completed in the meantime.
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  if (loading && !loaded) {
    return (
      <View style={styles.card}>
        {[0, 1, 2, 3].map((i) => <View key={i} style={styles.skeleton} />)}
      </View>
    );
  }
  if (unsupported) {
    return (
      <View style={[styles.card, styles.center]}>
        <Text style={styles.title}>Job preferences unavailable</Text>
        <Text style={[styles.help, { textAlign: 'center' }]}>
          We could not load your job preferences. Please try again shortly.
        </Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (loadError || !loaded || !options) {
    return (
      <View style={[styles.card, styles.center]}>
        <Text style={styles.help}>Your job preferences could not be loaded.</Text>
        <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  if (!loaded.profile_completed) {
    return (
      <View style={[styles.card, styles.center]}>
        <Text style={styles.title}>Finish your profile first</Text>
        <Text style={[styles.help, { textAlign: 'center' }]}>
          Job preferences open once your profile is complete. They decide which jobs we recommend to you first.
        </Text>
        {onOpenProfile && (
          <Pressable accessibilityRole="button" onPress={onOpenProfile} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Complete profile</Text>
          </Pressable>
        )}
      </View>
    );
  }
  // Keyed by the saved version: after a save the editor restarts from it.
  return (
    <PreferencesEditor
      key={loaded.updated_at ?? 'new'}
      saved={pick(loaded)}
      options={options}
      onSaved={setLoaded}
    />
  );
}

function PreferencesEditor({
  saved,
  options,
  onSaved,
}: {
  saved: JobPreferences;
  options: JobPreferenceOptions;
  onSaved: (next: JobPreferencesResponse) => void;
}) {
  const [draft, setDraft] = useState<JobPreferences>(saved);
  const [salary, setSalary] = useState(() => salaryText(saved.preferred_salary));
  const [salaryError, setSalaryError] = useState('');
  const [location, setLocation] = useState('');
  const [saving, setSaving] = useState(false);

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft);
  const update = <K extends keyof JobPreferences>(key: K, value: JobPreferences[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const currencyLabel = useMemo(
    () => options.salary_currencies.find((o) => o.value === draft.preferred_salary_currency)?.label,
    [options, draft.preferred_salary_currency],
  );

  const addLocation = (raw = location) => {
    const place = raw.trim().replace(/\s+/g, ' ');
    if (!place || draft.preferred_locations.length >= MAX_CHOICES) return;
    if (!draft.preferred_locations.some((item) => item.toLowerCase() === place.toLowerCase())) {
      update('preferred_locations', [...draft.preferred_locations, place]);
    }
    setLocation('');
  };

  const changeSalary = (raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    setSalary(digits);
    if (!digits) {
      setSalaryError('');
      update('preferred_salary', null);
      return;
    }
    const value = Number(digits);
    if (!Number.isSafeInteger(value) || value > 1_000_000_000) {
      setSalaryError('Enter a whole yearly amount.');
      return;
    }
    setSalaryError('');
    update('preferred_salary', value);
  };

  const submit = async () => {
    if (saving || salaryError) return;
    setSaving(true);
    try {
      const next = await saveJobPreferences(draft);
      onSaved(next);
      AppAlert.alert('Preferences saved', 'Your recommended jobs are updated.');
    } catch (error) {
      AppAlert.alert(
        'Could not save',
        error instanceof ApiError && error.problem.title ? error.problem.title : 'Please check your connection and try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Job preferences</Text>
      <Text style={styles.help}>
        Tell us what you want from your next job. We rank the jobs we recommend to you by these answers. Every
        question is optional.
      </Text>

      <MultiSelectField
        label="Preferred roles"
        hint="The jobs you want next, even if you have not done them before."
        options={options.roles}
        values={draft.preferred_roles}
        onChange={(values) => update('preferred_roles', values)}
        searchable
      />
      <MultiSelectField
        label="Preferred industries"
        options={options.industries}
        values={draft.preferred_industries}
        onChange={(values) => update('preferred_industries', values)}
        searchable
      />
      <MultiSelectField
        label="Work mode"
        hint="Office, hybrid or remote. Choose all that suit you."
        options={options.work_modes}
        values={draft.work_modes}
        onChange={(values) => update('work_modes', values as JobPreferences['work_modes'])}
      />
      <MultiSelectField
        label="Job type"
        options={options.job_types}
        values={draft.job_types}
        onChange={(values) => update('job_types', values as JobPreferences['job_types'])}
      />

      <View style={styles.field}>
        <Text style={styles.label}>Preferred work locations</Text>
        <IndianCityDropdown
          multiple
          values={draft.preferred_locations}
          onChangeValues={(cities) => update('preferred_locations', cities)}
          maxSelections={MAX_CHOICES}
          placeholder="Select Indian cities"
          modalTitle="Preferred work locations"
        />
        <Text style={styles.help}>Up to {MAX_CHOICES} cities.</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Open to relocating?</Text>
        <DropdownSelect
          value={draft.open_to_relocation ? 'YES' : 'NO'}
          modalTitle="Open to relocating?"
          options={[
            { value: 'NO', label: 'No, only my preferred locations' },
            { value: 'YES', label: 'Yes, I can move for the right job' },
          ]}
          onChange={(value) => update('open_to_relocation', value === 'YES')}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Salary currency</Text>
        <DropdownSelect
          value={draft.preferred_salary_currency}
          modalTitle="Salary currency"
          options={options.salary_currencies}
          selectedLabel={currencyLabel}
          onChange={(value) => update('preferred_salary_currency', value as JobPreferences['preferred_salary_currency'])}
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Preferred annual salary</Text>
        <TextInput
          style={[styles.input, !!salaryError && styles.invalid]}
          value={formatSalaryInput(salary, draft.preferred_salary_currency)}
          onChangeText={changeSalary}
          placeholder="Enter annual amount"
          placeholderTextColor="#9AA1AE"
          keyboardType="number-pad"
          accessibilityLabel="Preferred annual salary"
        />
        {salaryError ? (
          <Text style={styles.error}>{salaryError}</Text>
        ) : (
          <Text style={styles.help}>The yearly amount you would like. Jobs paying at least this rank higher.</Text>
        )}
      </View>

      <View style={styles.actions}>
        {dirty && (
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() => {
              setDraft(saved);
              setSalary(salaryText(saved.preferred_salary));
              setSalaryError('');
            }}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>Discard changes</Text>
          </Pressable>
        )}
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !dirty || saving || !!salaryError, busy: saving }}
          disabled={!dirty || saving || !!salaryError}
          onPress={() => void submit()}
          style={[styles.primaryButton, (!dirty || !!salaryError) && { opacity: 0.5 }]}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.primaryButtonText}>Save preferences</Text>}
        </Pressable>
      </View>
    </View>
  );
}

// The onboarding form's own field styles (CareerDetailsScreen).
const styles = StyleSheet.create({
  card: {
    marginHorizontal: 20,
    marginTop: 8,
    padding: 16,
    gap: 18,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    backgroundColor: '#FFFFFF',
  },
  center: { alignItems: 'center', gap: 12 },
  title: { fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 24, color: '#0A1931' },
  field: { gap: 8 },
  label: { fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#0A1931' },
  help: { fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#5F6B80', lineHeight: 20, flexShrink: 1 },
  error: { fontFamily: 'GeneralSans-Medium', color: '#A33A2B', fontSize: 13, lineHeight: 20 },
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
  inputRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addButton: {
    width: 52,
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: '100%',
    paddingVertical: 7,
    paddingLeft: 12,
    paddingRight: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#C9BEEB',
    backgroundColor: '#F1EAF7',
  },
  chipText: { fontFamily: 'GeneralSans-Semibold', fontSize: 13, color: '#4A3E8F', flexShrink: 1 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 10, marginTop: 4 },
  primaryButton: {
    minHeight: 52,
    paddingHorizontal: 22,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#FFFFFF' },
  secondaryButton: {
    minHeight: 52,
    paddingHorizontal: 18,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931' },
  skeleton: { height: 52, borderRadius: 14, backgroundColor: '#EDE8E1' },
});
