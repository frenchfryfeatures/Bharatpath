/**
 * BharatPath - JobFiltersSheet
 *
 * Implements S17a (Filters) from `docs/screen-flows.md`, wired to the backend
 * `JobFilters` type. The board has no total count, so the CTA reads "Show jobs"
 * (no count).
 *
 * Sections (per S17a):
 *  - Show me: All jobs / Only jobs I can apply to  (eligible_only)
 *  - Location: free text                          (location)
 *  - Work mode: Onsite / Hybrid / Remote           (work_mode)
 *  - Minimum monthly salary: ₹10k / ₹15k / ₹20k / ₹25k+  (min_salary_minor, paise)
 *  - Skill: free text                             (skill)
 *
 * No distance slider - the API has no geo search.
 */
import React, { useState, useEffect, useRef } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Platform,
  TextInput,
  Keyboard,
  KeyboardAvoidingView,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {
  Funnel,
  MapPin,
  CurrencyInr,
  Briefcase,
  Wrench,
  Check,
  X,
} from 'phosphor-react-native';
import { Colors } from '@/theme/tokens';
import { JobFilters, DEFAULT_JOB_FILTERS, WorkMode } from '@/types/job';
import { getBoardSkills } from '@/services/api/jobs';
import { IndianCityDropdown } from '@/components/inputs/IndianCityDropdown';

export interface JobFiltersSheetProps {
  visible: boolean;
  onClose: () => void;
  onApply: (filters: JobFilters) => void;
  onReset: () => void;
  /** Current filters from the parent, to seed the sheet state. */
  currentFilters: JobFilters;
}

// Salary options in paise (integer minor units). "₹25k+" is represented as
// 25000 paise; the backend treats min_salary_minor as a floor.
const SALARY_OPTIONS: { label: string; minor: number }[] = [
  { label: '₹10k', minor: 10000 },
  { label: '₹15k', minor: 15000 },
  { label: '₹20k', minor: 20000 },
  { label: '₹25k+', minor: 25000 },
];

const WORK_MODE_OPTIONS: { label: string; value: WorkMode }[] = [
  { label: 'Onsite', value: 'ONSITE' },
  { label: 'Hybrid', value: 'HYBRID' },
  { label: 'Remote', value: 'REMOTE' },
];

export function JobFiltersSheet({
  visible,
  onClose,
  onApply,
  onReset,
  currentFilters,
}: JobFiltersSheetProps) {
  const [draft, setDraft] = useState<JobFilters>(currentFilters);
  const [skillQuery, setSkillQuery] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const scrollRef = useRef<ScrollView>(null);

  const selectedSkills = React.useMemo(
    () =>
      draft.skill
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    [draft.skill],
  );

  // Re-seed the draft whenever the sheet opens or the parent filters change.
  useEffect(() => {
    if (visible) {
      setDraft(currentFilters);
      setSkillQuery('');
    } else {
      setKeyboardHeight(0);
    }
  }, [visible, currentFilters]);

  // Lift the bottom sheet cleanly above the Android soft keyboard so the SKILL
  // input and its suggestion chips stay fully visible while typing.
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardHeight(event.endCoordinates?.height || 0);
      setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  // Skill options come from the skills live jobs ask for, so a pick always
  // finds something. Fetched as the candidate types, newest answer wins.
  const [skillOptions, setSkillOptions] = useState<string[]>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillsError, setSkillsError] = useState(false);
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSkillsLoading(true);
    setSkillsError(false);
    const timer = setTimeout(() => {
      getBoardSkills(skillQuery, 24)
        .then((items) => { if (active) setSkillOptions(items); })
        .catch(() => { if (active) setSkillsError(true); })
        .finally(() => { if (active) setSkillsLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [visible, skillQuery]);

  const update = (patch: Partial<JobFilters>) =>
    setDraft((prev) => ({ ...prev, ...patch }));

  const toggleSkill = (skillName: string) => {
    const clean = skillName.trim();
    if (!clean) return;
    const exists = selectedSkills.some((s) => s.toLowerCase() === clean.toLowerCase());
    const next = exists
      ? selectedSkills.filter((s) => s.toLowerCase() !== clean.toLowerCase())
      : [...selectedSkills, clean];
    update({ skill: next.join(', ') });
  };

  const commitTypedSkill = () => {
    const clean = skillQuery.trim();
    if (!clean) return;
    if (!selectedSkills.some((s) => s.toLowerCase() === clean.toLowerCase())) {
      update({ skill: [...selectedSkills, clean].join(', ') });
    }
    setSkillQuery('');
  };

  const handleReset = () => {
    setDraft(DEFAULT_JOB_FILTERS);
    setSkillQuery('');
  };

  const handleApply = () => {
    const cleanTyped = skillQuery.trim();
    let finalDraft = draft;
    if (cleanTyped && !selectedSkills.some((s) => s.toLowerCase() === cleanTyped.toLowerCase())) {
      finalDraft = { ...draft, skill: [...selectedSkills, cleanTyped].join(', ') };
    }
    onApply(finalDraft);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Pressable style={styles.dismissOverlay} onPress={onClose} />

        <View
          style={[
            styles.sheetContainer,
            Platform.OS === 'android' && keyboardHeight > 0 && { marginBottom: keyboardHeight },
          ]}
        >
          {/* Top Grab Handle */}
          <View style={styles.grabHandle} />

          {/* Header */}
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Filters</Text>
            <Pressable onPress={handleReset} accessibilityRole="button">
              <Text style={styles.resetButtonText}>Reset</Text>
            </Pressable>
          </View>

          <ScrollView
            ref={scrollRef}
            style={styles.sectionsScrollView}
            contentContainerStyle={styles.sectionsScroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
          {/* Section 1: SHOW ME */}
          <View style={styles.filterSection}>
            <View style={styles.sectionEyebrow}>
              <Funnel size={12} color="#A87C17" weight="bold" />
              <Text style={styles.eyebrowText}>SHOW ME</Text>
            </View>
            <Pressable
              style={styles.checkboxRow}
              onPress={() => update({ eligible_only: !draft.eligible_only })}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.eligible_only }}
              accessibilityLabel="Only jobs I can apply to"
            >
              <View style={[styles.checkbox, draft.eligible_only && styles.checkboxChecked]}>
                {draft.eligible_only ? <Check size={13} color="#FFFFFF" weight="bold" /> : null}
              </View>
              <Text style={styles.checkboxLabel}>Only jobs I can apply to</Text>
            </Pressable>
          </View>

          {/* Section 2: LOCATION */}
          <View style={styles.filterSection}>
            <View style={styles.sectionEyebrow}>
              <MapPin size={12} color="#A87C17" weight="bold" />
              <Text style={styles.eyebrowText}>LOCATION</Text>
            </View>
            <IndianCityDropdown
              multiple
              compact
              values={draft.location
                .split(',')
                .map((c) => c.trim())
                .filter(Boolean)}
              onChangeValues={(cities) => update({ location: cities.join(', ') })}
              placeholder="Select Indian cities"
              modalTitle="Filter by location"
            />
          </View>

          {/* Section 3: WORK MODE */}
          <View style={styles.filterSection}>
            <View style={styles.sectionEyebrow}>
              <Briefcase size={12} color="#A87C17" weight="bold" />
              <Text style={styles.eyebrowText}>WORK MODE</Text>
            </View>
            <View style={styles.pillsRow}>
              {WORK_MODE_OPTIONS.map((opt) => {
                const isSelected = draft.work_mode === opt.value;
                return (
                  <Pressable
                    key={opt.value}
                    style={[styles.modePill, isSelected && styles.pillActive]}
                    onPress={() =>
                      update({
                        work_mode: isSelected ? undefined : opt.value,
                      })
                    }
                  >
                    {isSelected && (
                      <Check size={12} color="#4A3E8F" weight="bold" />
                    )}
                    <Text
                      style={[
                        styles.modePillText,
                        isSelected && styles.pillTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Section 4: MINIMUM MONTHLY SALARY */}
          <View style={styles.filterSection}>
            <View style={styles.sectionEyebrow}>
              <CurrencyInr size={12} color="#A87C17" weight="bold" />
              <Text style={styles.eyebrowText}>MINIMUM MONTHLY SALARY</Text>
            </View>
            <View style={styles.pillsRow}>
              {SALARY_OPTIONS.map((opt) => {
                const isSelected = draft.min_salary_minor === opt.minor;
                return (
                  <Pressable
                    key={opt.label}
                    style={[styles.salaryPill, isSelected && styles.pillActive]}
                    onPress={() =>
                      update({
                        min_salary_minor: isSelected ? undefined : opt.minor,
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.salaryPillText,
                        isSelected && styles.pillTextActive,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Section 5: SKILL */}
          <View style={styles.filterSection}>
            <View style={styles.sectionEyebrow}>
              <Wrench size={12} color="#A87C17" weight="bold" />
              <Text style={styles.eyebrowText}>SKILLS</Text>
            </View>
            <View style={styles.textInputWrap}>
              <TextInput
                style={styles.textInput}
                placeholder="Search or add skills (e.g. React, Python)"
                placeholderTextColor="#566073"
                value={skillQuery}
                onChangeText={setSkillQuery}
                onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 120)}
                onSubmitEditing={commitTypedSkill}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="done"
              />
              {skillQuery.length > 0 && (
                <Pressable
                  hitSlop={8}
                  onPress={() => setSkillQuery('')}
                  accessibilityRole="button"
                  accessibilityLabel="Clear skill search"
                >
                  <X size={15} color="#5F6B80" weight="bold" />
                </Pressable>
              )}
            </View>
            {selectedSkills.length > 0 && (
              <View style={styles.selectedChipsWrap} accessibilityLabel="Selected skills">
                {selectedSkills.map((sk) => (
                  <View key={sk} style={styles.selectedSkillChip}>
                    <Text style={styles.selectedSkillChipText} numberOfLines={1}>{sk}</Text>
                    <Pressable
                      hitSlop={8}
                      onPress={() => toggleSkill(sk)}
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${sk}`}
                    >
                      <X size={13} color="#4A3E8F" weight="bold" />
                    </Pressable>
                  </View>
                ))}
              </View>
            )}
            {/* One horizontal row: a long list never pushes "Show jobs" off a small screen. */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ gap: 8, paddingTop: 10, alignItems: 'center' }}
            >
              {skillsLoading && skillOptions.length === 0 ? (
                <ActivityIndicator size="small" color="#5F4DB2" />
              ) : skillsError ? (
                <Text style={styles.salaryPillText}>Could not load skills. You can still type one.</Text>
              ) : skillOptions.length === 0 ? (
                <Text style={styles.salaryPillText}>No live job asks for that skill yet.</Text>
              ) : (
                skillOptions.map((option) => {
                  const isSelected = selectedSkills.some((s) => s.toLowerCase() === option.toLowerCase());
                  return (
                    <Pressable
                      key={option}
                      style={[styles.salaryPill, isSelected && styles.pillActive]}
                      onPress={() => {
                        toggleSkill(option);
                        setSkillQuery('');
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`Skill ${option}`}
                    >
                      {isSelected && <Check size={12} color="#4A3E8F" weight="bold" />}
                      <Text style={[styles.salaryPillText, isSelected && styles.pillTextActive]} numberOfLines={1}>
                        {option}
                      </Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
          </ScrollView>

          {/* Bottom Action - no count (board has no total) */}
          <Pressable
            style={({ pressed }) => [
              styles.applyButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={handleApply}
            accessibilityRole="button"
          >
            <Text style={styles.applyButtonText}>Show jobs</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
    justifyContent: 'flex-end',
  },
  dismissOverlay: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    maxHeight: '88%',
    gap: 14,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 20,
  },
  sectionsScrollView: {
    flexShrink: 1,
  },
  sectionsScroll: {
    gap: 18,
    paddingBottom: 6,
  },
  grabHandle: {
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E7E0D4',
    alignSelf: 'center',
    marginBottom: 4,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: Colors.navy,
  },
  resetButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
  },
  filterSection: {
    gap: 10,
  },
  sectionEyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  eyebrowText: {
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.2,
    color: '#5F6B80',
    fontWeight: '700',
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 48,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    backgroundColor: '#F7F4EC',
  },
  checkbox: {
    width: 21,
    height: 21,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: '#9AA2AF',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    borderColor: Colors.brandAccent,
    backgroundColor: Colors.brandAccent,
  },
  checkboxLabel: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 19,
    color: '#0A1931',
  },
  textInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F7F4EC',
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy,
    padding: 0,
  },
  pillsRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  salaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#F7EFD6',
  },
  selectedChipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  selectedSkillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#D4C7F5',
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  selectedSkillChipText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#4A3E8F',
    maxWidth: 180,
  },
  salaryPillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: '#3A4761',
  },
  modePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: '#F7EFD6',
  },
  modePillText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: '#3A4761',
  },
  pillActive: {
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#C9BEEB',
  },
  pillTextActive: {
    color: '#4A3E8F',
  },
  applyButton: {
    width: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 999,
    paddingVertical: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
  },
  applyButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
});
