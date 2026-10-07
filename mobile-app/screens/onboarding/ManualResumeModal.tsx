import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  NotePencil,
  Plus,
  Trash,
  Briefcase,
  GraduationCap,
  Sparkle,
  WarningCircle,
  CheckCircle,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export interface ManualExperienceItem {
  id: string;
  employer: string;
  title: string;
  start_year: string;
  end_year: string;
  is_current: boolean;
  summary: string;
}

export interface ManualEducationItem {
  id: string;
  institution: string;
  qualification: string;
  completed_year: string;
}

export interface ManualResumeData {
  full_name: string;
  headline?: string;
  experience: {
    employer: string;
    title: string;
    start_year: number;
    end_year?: number | null;
    summary?: string | null;
  }[];
  education: {
    institution: string;
    qualification: string;
    completed_year?: number | null;
  }[];
  skills: string[];
}

export interface ManualResumeModalProps {
  visible: boolean;
  initialFullName?: string;
  initialData?: ManualResumeData;
  onClose: () => void;
  onSubmit: (data: ManualResumeData) => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
}

const SUGGESTED_SKILLS = [
  'React Native',
  'TypeScript',
  'JavaScript',
  'Python',
  'SQL',
  'REST APIs',
  'Git',
  'UI/UX Design',
  'Customer Support',
  'Project Management',
];

export function ManualResumeModal({
  visible,
  initialFullName = '',
  initialData,
  onClose,
  onSubmit,
  title = 'Manual Resume Entry',
  subtitle = 'Create your profile step-by-step',
  submitLabel = 'Save & Review',
  isSubmitting = false,
}: ManualResumeModalProps) {
  const [fullName, setFullName] = useState(initialFullName);
  const [headline, setHeadline] = useState('');
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates?.height || 280);
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Experience state
  const [experienceList, setExperienceList] = useState<ManualExperienceItem[]>([
    {
      id: '1',
      employer: '',
      title: '',
      start_year: '',
      end_year: '',
      is_current: false,
      summary: '',
    },
  ]);

  // Education state
  const [educationList, setEducationList] = useState<ManualEducationItem[]>([
    {
      id: '1',
      institution: '',
      qualification: '',
      completed_year: '',
    },
  ]);

  // Skills state
  const [skills, setSkills] = useState<string[]>([]);
  const [newSkillText, setNewSkillText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;

    setFullName(initialData?.full_name || initialFullName);
    setHeadline(initialData?.headline || '');
    setExperienceList(
      initialData?.experience.length
        ? initialData.experience.map((item, index) => ({
            id: `initial-exp-${index}`,
            employer: item.employer,
            title: item.title,
            start_year: String(item.start_year),
            end_year: item.end_year ? String(item.end_year) : '',
            is_current: item.end_year == null,
            summary: item.summary || '',
          }))
        : [
            {
              id: '1',
              employer: '',
              title: '',
              start_year: '',
              end_year: '',
              is_current: false,
              summary: '',
            },
          ]
    );
    setEducationList(
      initialData?.education.length
        ? initialData.education.map((item, index) => ({
            id: `initial-edu-${index}`,
            institution: item.institution,
            qualification: item.qualification,
            completed_year: item.completed_year ? String(item.completed_year) : '',
          }))
        : [{ id: '1', institution: '', qualification: '', completed_year: '' }]
    );
    setSkills(initialData?.skills || []);
    setNewSkillText('');
    setErrorMsg(null);
  }, [initialData, initialFullName, visible]);

  // Handlers for Experience
  const addExperience = () => {
    setExperienceList((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        employer: '',
        title: '',
        start_year: '',
        end_year: '',
        is_current: false,
        summary: '',
      },
    ]);
  };

  const updateExperience = (id: string, field: keyof ManualExperienceItem, val: any) => {
    setExperienceList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  const removeExperience = (id: string) => {
    setExperienceList((prev) => prev.filter((item) => item.id !== id));
  };

  // Handlers for Education
  const addEducation = () => {
    setEducationList((prev) => [
      ...prev,
      {
        id: Date.now().toString(),
        institution: '',
        qualification: '',
        completed_year: '',
      },
    ]);
  };

  const updateEducation = (id: string, field: keyof ManualEducationItem, val: string) => {
    setEducationList((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  const removeEducation = (id: string) => {
    setEducationList((prev) => prev.filter((item) => item.id !== id));
  };

  // Handlers for Skills
  const addSkill = (skillName: string) => {
    const trimmed = skillName.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills((prev) => [...prev, trimmed]);
      setNewSkillText('');
    }
  };

  const removeSkill = (skillToRemove: string) => {
    setSkills((prev) => prev.filter((s) => s !== skillToRemove));
  };

  const validate = (): boolean => {
    setErrorMsg(null);
    if (!fullName.trim()) {
      setErrorMsg('Please enter your full name.');
      return false;
    }

    // Validate experiences if provided
    for (const exp of experienceList) {
      if (exp.employer.trim() || exp.title.trim()) {
        if (!exp.employer.trim()) {
          setErrorMsg('Please enter the employer/company name for all added experiences.');
          return false;
        }
        if (!exp.title.trim()) {
          setErrorMsg(`Please enter the job title for ${exp.employer}.`);
          return false;
        }
        const startY = parseInt(exp.start_year, 10);
        if (!startY || startY < 1950 || startY > 2100) {
          setErrorMsg(`Please enter a valid start year (e.g. 2022) for ${exp.employer}.`);
          return false;
        }
        if (!exp.is_current && exp.end_year.trim()) {
          const endY = parseInt(exp.end_year, 10);
          if (endY < startY) {
            setErrorMsg(`End year cannot be before start year for ${exp.employer}.`);
            return false;
          }
        }
      }
    }

    // Validate education if provided
    for (const edu of educationList) {
      if (edu.institution.trim() || edu.qualification.trim()) {
        if (!edu.institution.trim()) {
          setErrorMsg('Please enter the college/institution name for all added educations.');
          return false;
        }
        if (!edu.qualification.trim()) {
          setErrorMsg(`Please enter the qualification or degree for ${edu.institution}.`);
          return false;
        }
        if (edu.completed_year.trim()) {
          const compY = parseInt(edu.completed_year, 10);
          if (!compY || compY < 1950 || compY > 2100) {
            setErrorMsg(`Please enter a valid completion year for ${edu.institution}.`);
            return false;
          }
        }
      }
    }

    if (skills.length === 0 && experienceList.length === 0 && educationList.length === 0) {
      setErrorMsg('Please add at least one skill, experience, or education.');
      return false;
    }

    return true;
  };

  const handleSubmit = () => {
    if (isSubmitting) return;
    if (!validate()) return;

    // Build payload matching backend ManualResumeRequest
    const cleanExperiences = experienceList
      .filter((exp) => exp.employer.trim() && exp.title.trim())
      .map((exp) => ({
        employer: exp.employer.trim(),
        title: exp.title.trim(),
        start_year: parseInt(exp.start_year, 10),
        end_year: exp.is_current || !exp.end_year.trim() ? null : parseInt(exp.end_year, 10),
        summary: exp.summary.trim() ? exp.summary.trim() : null,
      }));

    const cleanEducation = educationList
      .filter((edu) => edu.institution.trim() && edu.qualification.trim())
      .map((edu) => ({
        institution: edu.institution.trim(),
        qualification: edu.qualification.trim(),
        completed_year: edu.completed_year.trim() ? parseInt(edu.completed_year, 10) : null,
      }));

    const data: ManualResumeData = {
      full_name: fullName.trim(),
      headline: headline.trim() ? headline.trim() : undefined,
      experience: cleanExperiences,
      education: cleanEducation,
      skills,
    };

    onSubmit(data);
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <NotePencil size={20} color="#5E4DB2" weight="bold" />
              </View>
              <View>
                <Text style={styles.headerTitle}>{title}</Text>
                <Text style={styles.headerSubtitle}>{subtitle}</Text>
              </View>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <X size={20} color="#0A1931" weight="bold" />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingBottom:
                  keyboardHeight > 0 ? keyboardHeight + 80 : Spacing.xl,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            showsVerticalScrollIndicator={false}
          >
            {/* Error Banner */}
            {errorMsg && (
              <View style={styles.errorBanner}>
                <WarningCircle size={16} color="#8F3B3B" weight="fill" />
                <Text style={styles.errorBannerText}>{errorMsg}</Text>
              </View>
            )}

            {/* SECTION 1: Personal Info */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>1. Personal Info</Text>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>
                  Full Name <Text style={styles.required}>*</Text>
                </Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Priya Sharma"
                  placeholderTextColor="#8F9AA7"
                  value={fullName}
                  onChangeText={setFullName}
                />
              </View>

              <View style={styles.fieldGroup}>
                <Text style={styles.label}>Headline / Target Role</Text>
                <TextInput
                  style={styles.input}
                  placeholder="e.g. Frontend Engineer | React Native"
                  placeholderTextColor="#8F9AA7"
                  value={headline}
                  onChangeText={setHeadline}
                />
              </View>
            </View>

            {/* SECTION 2: Work Experience */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderTitleRow}>
                  <Briefcase size={18} color="#5E4DB2" weight="bold" />
                  <Text style={styles.sectionTitle}>2. Work Experience</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.addItemButton, pressed && styles.pressed]}
                  onPress={addExperience}
                >
                  <Plus size={14} color="#5E4DB2" weight="bold" />
                  <Text style={styles.addItemButtonText}>Add Role</Text>
                </Pressable>
              </View>

              {experienceList.map((exp, index) => (
                <View key={exp.id} style={styles.itemCard}>
                  <View style={styles.itemCardHeader}>
                    <Text style={styles.itemCardIndex}>Role #{index + 1}</Text>
                    {experienceList.length > 1 && (
                      <Pressable
                        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                        onPress={() => removeExperience(exp.id)}
                      >
                        <Trash size={14} color="#8F3B3B" />
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Company / Employer</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. BharatTech Labs"
                      placeholderTextColor="#8F9AA7"
                      value={exp.employer}
                      onChangeText={(val) => updateExperience(exp.id, 'employer', val)}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Job Title / Designation</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Software Engineer"
                      placeholderTextColor="#8F9AA7"
                      value={exp.title}
                      onChangeText={(val) => updateExperience(exp.id, 'title', val)}
                    />
                  </View>

                  <View style={styles.rowFields}>
                    <View style={[styles.fieldGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Start Year</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. 2022"
                        placeholderTextColor="#8F9AA7"
                        keyboardType="numeric"
                        maxLength={4}
                        value={exp.start_year}
                        onChangeText={(val) => updateExperience(exp.id, 'start_year', val)}
                      />
                    </View>

                    <View style={[styles.fieldGroup, { flex: 1 }]}>
                      <Text style={styles.label}>End Year</Text>
                      <TextInput
                        style={[styles.input, exp.is_current && styles.inputDisabled]}
                        placeholder={exp.is_current ? 'Present' : 'e.g. 2024'}
                        placeholderTextColor="#8F9AA7"
                        keyboardType="numeric"
                        maxLength={4}
                        editable={!exp.is_current}
                        value={exp.is_current ? '' : exp.end_year}
                        onChangeText={(val) => updateExperience(exp.id, 'end_year', val)}
                      />
                    </View>
                  </View>

                  <View style={styles.switchRow}>
                    <Text style={styles.switchLabel}>I currently work here</Text>
                    <Switch
                      value={exp.is_current}
                      onValueChange={(val) => updateExperience(exp.id, 'is_current', val)}
                      trackColor={{ false: '#D4CEBF', true: '#5E4DB2' }}
                    />
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>Summary / Responsibilities</Text>
                    <TextInput
                      style={[styles.input, styles.multilineInput]}
                      placeholder="Briefly describe what you worked on..."
                      placeholderTextColor="#8F9AA7"
                      multiline
                      numberOfLines={3}
                      value={exp.summary}
                      onChangeText={(val) => updateExperience(exp.id, 'summary', val)}
                    />
                  </View>
                </View>
              ))}
            </View>

            {/* SECTION 3: Education */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={styles.sectionHeaderTitleRow}>
                  <GraduationCap size={18} color="#5E4DB2" weight="bold" />
                  <Text style={styles.sectionTitle}>3. Education</Text>
                </View>
                <Pressable
                  style={({ pressed }) => [styles.addItemButton, pressed && styles.pressed]}
                  onPress={addEducation}
                >
                  <Plus size={14} color="#5E4DB2" weight="bold" />
                  <Text style={styles.addItemButtonText}>Add Degree</Text>
                </Pressable>
              </View>

              {educationList.map((edu, index) => (
                <View key={edu.id} style={styles.itemCard}>
                  <View style={styles.itemCardHeader}>
                    <Text style={styles.itemCardIndex}>Education #{index + 1}</Text>
                    {educationList.length > 1 && (
                      <Pressable
                        style={({ pressed }) => [styles.removeButton, pressed && styles.pressed]}
                        onPress={() => removeEducation(edu.id)}
                      >
                        <Trash size={14} color="#8F3B3B" />
                        <Text style={styles.removeButtonText}>Remove</Text>
                      </Pressable>
                    )}
                  </View>

                  <View style={styles.fieldGroup}>
                    <Text style={styles.label}>College / University / School</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. Delhi Technological University"
                      placeholderTextColor="#8F9AA7"
                      value={edu.institution}
                      onChangeText={(val) => updateEducation(edu.id, 'institution', val)}
                    />
                  </View>

                  <View style={styles.rowFields}>
                    <View style={[styles.fieldGroup, { flex: 2 }]}>
                      <Text style={styles.label}>Degree / Qualification</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. B.Tech Computer Science"
                        placeholderTextColor="#8F9AA7"
                        value={edu.qualification}
                        onChangeText={(val) => updateEducation(edu.id, 'qualification', val)}
                      />
                    </View>

                    <View style={[styles.fieldGroup, { flex: 1 }]}>
                      <Text style={styles.label}>Completion</Text>
                      <TextInput
                        style={styles.input}
                        placeholder="e.g. 2022"
                        placeholderTextColor="#8F9AA7"
                        keyboardType="numeric"
                        maxLength={4}
                        value={edu.completed_year}
                        onChangeText={(val) => updateEducation(edu.id, 'completed_year', val)}
                      />
                    </View>
                  </View>
                </View>
              ))}
            </View>

            {/* SECTION 4: Skills */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderTitleRow}>
                <Sparkle size={18} color="#5E4DB2" weight="bold" />
                <Text style={styles.sectionTitle}>4. Key Skills</Text>
              </View>

              {/* Add Skill Input */}
              <View style={styles.addSkillRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  placeholder="e.g. React Native, Python..."
                  placeholderTextColor="#8F9AA7"
                  value={newSkillText}
                  onChangeText={setNewSkillText}
                  onSubmitEditing={() => addSkill(newSkillText)}
                />
                <Pressable
                  style={({ pressed }) => [
                    styles.addSkillSubmitButton,
                    !newSkillText.trim() && styles.addSkillSubmitDisabled,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => addSkill(newSkillText)}
                  disabled={!newSkillText.trim()}
                >
                  <Plus size={16} color="#FFFFFF" weight="bold" />
                  <Text style={styles.addSkillSubmitText}>Add</Text>
                </Pressable>
              </View>

              {/* Selected Skill Chips */}
              {skills.length > 0 && (
                <View style={styles.skillsChipContainer}>
                  {skills.map((skill) => (
                    <View key={skill} style={styles.skillChip}>
                      <Text style={styles.skillChipText}>{skill}</Text>
                      <Pressable onPress={() => removeSkill(skill)} hitSlop={6}>
                        <X size={12} color="#5E4DB2" weight="bold" />
                      </Pressable>
                    </View>
                  ))}
                </View>
              )}

              {/* Suggested Skills */}
              <Text style={styles.suggestionTitle}>Quick Suggestions:</Text>
              <View style={styles.suggestedChipsRow}>
                {SUGGESTED_SKILLS.filter((s) => !skills.includes(s)).map((skill) => (
                  <Pressable
                    key={skill}
                    style={({ pressed }) => [styles.suggestedChip, pressed && styles.pressed]}
                    onPress={() => addSkill(skill)}
                  >
                    <Plus size={10} color="#5F6B80" weight="bold" />
                    <Text style={styles.suggestedChipText}>{skill}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {/* Invariant 5 Privacy Note */}
            <View style={styles.privacyCard}>
              <CheckCircle size={16} color="#1F6B45" weight="fill" />
              <Text style={styles.privacyCardText}>
                No age or date of birth required. BharatPath assesses your readiness solely on
                skills, education, and experience.
              </Text>
            </View>
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <Pressable
              style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]}
              onPress={onClose}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                isSubmitting && styles.submitButtonDisabled,
                pressed && !isSubmitting && styles.pressed,
              ]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              <Text style={styles.submitButtonText}>
                {isSubmitting ? 'Saving new version...' : submitLabel}
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  keyboardAvoid: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EAE6DF',
    backgroundColor: '#FFFCF7',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EFEBFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    color: '#0A1931',
  },
  headerSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
    marginTop: 2,
  },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F0ECE4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  scrollContent: {
    padding: 20,
    gap: 18,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEC',
    padding: 12,
    borderRadius: 10,
  },
  errorBannerText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#8F3B3B',
    flex: 1,
  },
  sectionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    borderWidth: 1,
    borderColor: '#EAE6DF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionHeaderTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    color: '#0A1931',
  },
  addItemButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#EFEBFB',
    borderRadius: Radii.pill,
  },
  addItemButtonText: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 12,
    color: '#5E4DB2',
  },
  itemCard: {
    backgroundColor: '#FAF8F4',
    borderRadius: 12,
    padding: 14,
    gap: 12,
    borderWidth: 1,
    borderColor: '#EDE9E1',
  },
  itemCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  itemCardIndex: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 13,
    color: '#5F6B80',
  },
  removeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeButtonText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#8F3B3B',
  },
  fieldGroup: {
    gap: 6,
  },
  rowFields: {
    flexDirection: 'row',
    gap: 10,
  },
  label: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#3A4761',
  },
  required: {
    color: '#8F3B3B',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4CEBF',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#0A1931',
  },
  inputDisabled: {
    backgroundColor: '#F0ECE4',
    color: '#5F6B80',
  },
  multilineInput: {
    minHeight: 65,
    textAlignVertical: 'top',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  switchLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#3A4761',
  },
  addSkillRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  addSkillSubmitButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#5E4DB2',
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: 10,
  },
  addSkillSubmitDisabled: {
    backgroundColor: '#C8C1EC',
  },
  addSkillSubmitText: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  skillsChipContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  skillChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFEBFB',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#D9D0F5',
  },
  skillChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#5E4DB2',
  },
  suggestionTitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#5F6B80',
    marginTop: 4,
  },
  suggestedChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  suggestedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F0ECE4',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: Radii.pill,
  },
  suggestedChipText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: '#3A4761',
  },
  privacyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#EBF6EE',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#C8E6D0',
  },
  privacyCardText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#1F6B45',
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: '#EAE6DF',
    backgroundColor: '#FFFCF7',
  },
  cancelButton: {
    paddingVertical: 14,
    paddingHorizontal: 18,
    borderRadius: 12,
    backgroundColor: '#F0ECE4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelButtonText: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 14,
    color: '#0A1931',
  },
  submitButton: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    backgroundColor: '#5E4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5E4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 2,
  },
  submitButtonDisabled: {
    backgroundColor: '#C8C1EC',
    shadowOpacity: 0,
    elevation: 0,
  },
  submitButtonText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
});
