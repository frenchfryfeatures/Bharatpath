import React, { useEffect, useState } from 'react';
import { AppAlert } from "@/components/feedback/AppAlert";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  Plus,
  Trash,
  Check,
  WarningCircle,
  Sparkle,
  PencilLine,
  ArrowsClockwise,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { ResumeSection, ResumeSectionItem, SectionKind } from '@/services/api/resume';

export interface SectionEditModalProps {
  visible: boolean;
  section: ResumeSection | null;
  sectionIndex: number | null;
  isSubmitting?: boolean;
  onClose: () => void;
  onSave: (updatedSection: { kind: SectionKind; heading?: string | null; body: string }) => void | Promise<void>;
  onDelete?: () => void;
}

const IS_CHIP_KIND = (kind?: SectionKind) =>
  kind === 'skills' || kind === 'languages' || kind === 'certifications';

export function SectionEditModal({
  visible,
  section,
  sectionIndex,
  isSubmitting = false,
  onClose,
  onSave,
  onDelete,
}: SectionEditModalProps) {
  const [heading, setHeading] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [chips, setChips] = useState<ResumeSectionItem[]>([]);
  const [newChipInput, setNewChipInput] = useState('');
  const [editingChipIndex, setEditingChipIndex] = useState<number | null>(null);
  const [editingChipText, setEditingChipText] = useState('');
  const [isRawMode, setIsRawMode] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
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

  // Basics field state when section.kind === 'header'
  const [basicsName, setBasicsName] = useState('');
  const [basicsPhone, setBasicsPhone] = useState('');
  const [basicsCity, setBasicsCity] = useState('');
  const [basicsDetails, setBasicsDetails] = useState('');

  useEffect(() => {
    if (!section || !visible) return;

    setErrorMsg(null);
    setIsRawMode(false);
    setNewChipInput('');
    setEditingChipIndex(null);
    setHeading(section.heading || '');
    setBodyText(section.body || '');

    if (IS_CHIP_KIND(section.kind)) {
      if (section.items && section.items.length > 0) {
        setChips(section.items.map((i) => ({ ...i })));
      } else {
        const delimiter = section.kind === 'certifications' ? '\n' : ',';
        const parsedChips = (section.body || '')
          .split(delimiter)
          .map((s) => s.trim().replace(/^[-•*]\s*/, ''))
          .filter(Boolean)
          .map((text) => ({ text, unclear: false }));
        setChips(parsedChips);
      }
    } else if (section.kind === 'header') {
      const lines = (section.body || '').split('\n').map((l) => l.trim()).filter(Boolean);
      let name = '';
      let phone = '';
      let city = '';
      const otherLines: string[] = [];

      lines.forEach((line, index) => {
        if (index === 0 && !line.includes('@') && !/\d{5,}/.test(line)) {
          name = line;
          return;
        }
        const phoneMatch = line.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/);
        if (phoneMatch && !phone) {
          phone = phoneMatch[0].trim();
        }
        if (/,\s*[A-Za-z\s]+$/.test(line) && !city && !line.includes('@')) {
          city = line;
        } else if (line !== phone && line !== name) {
          otherLines.push(line);
        }
      });

      setBasicsName(name);
      setBasicsPhone(phone);
      setBasicsCity(city);
      setBasicsDetails(otherLines.join('\n'));
    }
  }, [section, visible]);

  if (!section) return null;

  const isChipSection = IS_CHIP_KIND(section.kind) && !isRawMode;
  const isHeader = section.kind === 'header';

  const handleAddChip = () => {
    const val = newChipInput.trim();
    if (!val) return;
    setChips((prev) => [...prev, { text: val, unclear: false }]);
    setNewChipInput('');
  };

  const handleRemoveChip = (index: number) => {
    setChips((prev) => prev.filter((_, i) => i !== index));
    if (editingChipIndex === index) {
      setEditingChipIndex(null);
    }
  };

  const handleApplySuggestion = (index: number, suggestion: string) => {
    setChips((prev) =>
      prev.map((c, i) => (i === index ? { text: suggestion, unclear: false, suggestion: null } : c))
    );
  };

  const handleStartEditChip = (index: number) => {
    setEditingChipIndex(index);
    setEditingChipText(chips[index].text);
  };

  const handleSaveEditChip = () => {
    if (editingChipIndex === null) return;
    const trimmed = editingChipText.trim();
    if (trimmed) {
      setChips((prev) =>
        prev.map((c, i) =>
          i === editingChipIndex ? { ...c, text: trimmed, unclear: false } : c
        )
      );
    }
    setEditingChipIndex(null);
  };

  const handleSave = async () => {
    if (isSubmitting) return;
    setErrorMsg(null);

    let finalBody = '';

    if (isHeader) {
      const parts = [basicsName.trim(), basicsPhone.trim(), basicsCity.trim(), basicsDetails.trim()]
        .filter(Boolean);
      finalBody = parts.join('\n');
    } else if (isChipSection) {
      const delimiter = section.kind === 'certifications' ? '\n' : ', ';
      finalBody = chips.map((c) => c.text.trim()).filter(Boolean).join(delimiter);
    } else {
      finalBody = bodyText.trim();
    }

    if (!finalBody && section.kind !== 'skills') {
      setErrorMsg('Please enter section content before saving.');
      return;
    }

    try {
      await onSave({
        kind: section.kind,
        heading: isHeader ? null : (heading.trim() || section.heading || null),
        body: finalBody,
      });
    } catch (err: any) {
      const msg = typeof err === 'string' ? err : err?.message || 'Could not save section changes.';
      setErrorMsg(msg);
    }
  };

  const handleDeletePress = () => {
    AppAlert.alert(
      'Delete Section',
      `Are you sure you want to remove the "${section.heading || section.kind}" section?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: onDelete },
      ]
    );
  };

  const titleText = isHeader
    ? 'Edit Basics'
    : `Edit ${section.heading || section.kind.charAt(0).toUpperCase() + section.kind.slice(1)}`;

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
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>{titleText}</Text>
              <Text style={styles.headerSubtitle}>
                Changes will be saved as a new version
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.btnPressed]}
              onPress={onClose}
              disabled={isSubmitting}
              hitSlop={12}
            >
              <X size={20} color="#0A1931" weight="bold" />
            </Pressable>
          </View>

          {errorMsg ? (
            <View style={styles.errorBanner}>
              <WarningCircle size={16} color="#8F3B3B" weight="fill" />
              <Text style={styles.errorBannerText}>{errorMsg}</Text>
            </View>
          ) : null}

          {/* Form Content */}
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingBottom:
                  keyboardHeight > 0 ? keyboardHeight + 80 : Spacing.lg,
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Header (Basics) Section Fields */}
            {isHeader ? (
              <View style={styles.fieldsGroup}>
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Full Name</Text>
                  <TextInput
                    style={styles.textInput}
                    value={basicsName}
                    onChangeText={setBasicsName}
                    placeholder="e.g. Priya Deshmukh"
                    placeholderTextColor="#A0AEC0"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Phone Number</Text>
                  <TextInput
                    style={styles.textInput}
                    value={basicsPhone}
                    onChangeText={setBasicsPhone}
                    placeholder="e.g. +91 98765 43210"
                    placeholderTextColor="#A0AEC0"
                    keyboardType="phone-pad"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>City</Text>
                  <TextInput
                    style={styles.textInput}
                    value={basicsCity}
                    onChangeText={setBasicsCity}
                    placeholder="e.g. Pune"
                    placeholderTextColor="#A0AEC0"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Additional Details (Email, Links)</Text>
                  <TextInput
                    style={[styles.textInput, styles.textAreaSmall]}
                    value={basicsDetails}
                    onChangeText={setBasicsDetails}
                    placeholder="e.g. priya@example.com&#10;linkedin.com/in/priya"
                    placeholderTextColor="#A0AEC0"
                    multiline
                  />
                </View>
              </View>
            ) : isChipSection ? (
              /* Chips Section Editor */
              <View style={styles.chipsSectionWrap}>
                <View style={styles.chipSectionHeader}>
                  <Text style={styles.inputLabel}>
                    {section.kind === 'skills'
                      ? 'Skills (Chips)'
                      : section.kind === 'languages'
                      ? 'Languages (Chips)'
                      : 'Certifications'}
                  </Text>
                  <Pressable
                    onPress={() => setIsRawMode(true)}
                    style={styles.switchModeBtn}
                  >
                    <Text style={styles.switchModeBtnText}>Edit as raw text</Text>
                  </Pressable>
                </View>

                {/* Add new chip row */}
                <View style={styles.addChipRow}>
                  <TextInput
                    style={styles.addChipInput}
                    value={newChipInput}
                    onChangeText={setNewChipInput}
                    placeholder={`Add a new ${section.kind.slice(0, -1)}...`}
                    placeholderTextColor="#A0AEC0"
                    onSubmitEditing={handleAddChip}
                    returnKeyType="done"
                  />
                  <Pressable
                    style={({ pressed }) => [
                      styles.addChipBtn,
                      pressed && styles.btnPressed,
                      !newChipInput.trim() && styles.btnDisabled,
                    ]}
                    onPress={handleAddChip}
                    disabled={!newChipInput.trim()}
                  >
                    <Plus size={16} color="#FFFFFF" weight="bold" />
                    <Text style={styles.addChipBtnText}>Add</Text>
                  </Pressable>
                </View>

                {/* Chip list */}
                <View style={styles.chipsContainer}>
                  {chips.map((chip, idx) => (
                    <View key={`${chip.text}-${idx}`} style={styles.chipItemWrap}>
                      {editingChipIndex === idx ? (
                        <View style={styles.editingChipRow}>
                          <TextInput
                            style={styles.editingChipInput}
                            value={editingChipText}
                            onChangeText={setEditingChipText}
                            autoFocus
                            onSubmitEditing={handleSaveEditChip}
                          />
                          <Pressable
                            style={styles.chipActionMini}
                            onPress={handleSaveEditChip}
                          >
                            <Check size={14} color="#1F6B45" weight="bold" />
                          </Pressable>
                        </View>
                      ) : (
                        <View
                          style={[
                            styles.chipPill,
                            chip.unclear ? styles.chipUnclearPill : styles.chipSolidPill,
                          ]}
                        >
                          <Pressable
                            onPress={() => handleStartEditChip(idx)}
                            style={styles.chipTextPress}
                          >
                            <Text
                              style={[
                                styles.chipText,
                                chip.unclear && styles.chipUnclearText,
                              ]}
                            >
                              {chip.text}
                            </Text>
                            {chip.unclear && (
                              <PencilLine size={12} color="#7A5C0E" weight="bold" />
                            )}
                          </Pressable>
                          <Pressable
                            style={styles.chipRemoveBtn}
                            onPress={() => handleRemoveChip(idx)}
                            hitSlop={6}
                          >
                            <X size={12} color={chip.unclear ? '#7A5C0E' : '#5F6B80'} />
                          </Pressable>
                        </View>
                      )}

                      {/* Suggestion pill if unclear and suggestion exists */}
                      {chip.unclear && chip.suggestion ? (
                        <Pressable
                          style={({ pressed }) => [
                            styles.suggestionPill,
                            pressed && styles.btnPressed,
                          ]}
                          onPress={() => handleApplySuggestion(idx, chip.suggestion!)}
                        >
                          <Sparkle size={12} color="#5F4DB2" weight="fill" />
                          <Text style={styles.suggestionPillText}>
                            Change to <Text style={styles.suggestionBold}>{chip.suggestion}</Text>
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))}
                </View>
              </View>
            ) : (
              /* Prose / Standard Section Editor */
              <View style={styles.fieldsGroup}>
                {IS_CHIP_KIND(section.kind) && isRawMode ? (
                  <View style={styles.switchModeBanner}>
                    <Text style={styles.switchModeNotice}>
                      Editing as comma-separated raw text
                    </Text>
                    <Pressable
                      onPress={() => setIsRawMode(false)}
                      style={styles.switchModeBtn}
                    >
                      <Text style={styles.switchModeBtnText}>Switch to chips</Text>
                    </Pressable>
                  </View>
                ) : null}

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Section Heading</Text>
                  <TextInput
                    style={styles.textInput}
                    value={heading}
                    onChangeText={setHeading}
                    placeholder="e.g. Education, Experience, Projects"
                    placeholderTextColor="#A0AEC0"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Content / Body</Text>
                  <TextInput
                    style={[styles.textInput, styles.textAreaLarge]}
                    value={bodyText}
                    onChangeText={setBodyText}
                    placeholder="Enter section details, bullet points, dates..."
                    placeholderTextColor="#A0AEC0"
                    multiline
                    textAlignVertical="top"
                  />
                </View>
              </View>
            )}

            {/* Delete section button */}
            {!isHeader && onDelete ? (
              <Pressable
                style={({ pressed }) => [
                  styles.deleteSectionBtn,
                  pressed && styles.btnPressed,
                ]}
                onPress={handleDeletePress}
              >
                <Trash size={16} color="#C53030" weight="bold" />
                <Text style={styles.deleteSectionText}>Delete this section</Text>
              </Pressable>
            ) : null}
          </ScrollView>

          {/* Bottom Actions */}
          <View style={styles.bottomBar}>
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.btnPressed,
              ]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                isSubmitting && styles.btnDisabled,
                pressed && !isSubmitting && styles.btnPressed,
              ]}
              onPress={handleSave}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.saveButtonText}>Saving...</Text>
                </View>
              ) : (
                <Text style={styles.saveButtonText}>Save changes</Text>
              )}
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
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: '#EAE4DA',
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 26,
    color: '#0A1931',
  },
  headerSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F5EFE0',
  },
  btnPressed: {
    opacity: 0.8,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEC',
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.sm,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#F8B4B4',
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#8F3B3B',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: Spacing.lg,
    gap: Spacing.lg,
  },
  fieldsGroup: {
    gap: Spacing.md,
  },
  inputGroup: {
    gap: 6,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#0A1931',
  },
  textInput: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    color: '#0A1931',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2DCD5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  textAreaSmall: {
    height: 80,
    textAlignVertical: 'top',
  },
  textAreaLarge: {
    height: 220,
    textAlignVertical: 'top',
    lineHeight: 22,
  },
  chipsSectionWrap: {
    gap: Spacing.md,
  },
  chipSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  switchModeBtn: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  switchModeBtnText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#5F4DB2',
  },
  switchModeBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 10,
    backgroundColor: '#F5EFE0',
    borderRadius: 10,
  },
  switchModeNotice: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#5F6B80',
  },
  addChipRow: {
    flexDirection: 'row',
    gap: 8,
  },
  addChipInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#0A1931',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2DCD5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addChipBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 16,
    borderRadius: 12,
    justifyContent: 'center',
  },
  addChipBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  chipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },
  chipItemWrap: {
    gap: 4,
  },
  chipPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: Radii.pill,
  },
  chipSolidPill: {
    backgroundColor: '#F7EFD6',
  },
  chipUnclearPill: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6C79A',
    borderStyle: 'dashed',
  },
  chipTextPress: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#0A1931',
  },
  chipUnclearText: {
    color: '#7A5C0E',
  },
  chipRemoveBtn: {
    padding: 2,
  },
  editingChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#5F4DB2',
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  editingChipInput: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#0A1931',
    minWidth: 80,
    paddingVertical: 2,
  },
  chipActionMini: {
    padding: 4,
  },
  suggestionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3EFFF',
    borderWidth: 1,
    borderColor: '#D4C7F5',
    borderRadius: Radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  suggestionPillText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: '#5F4DB2',
  },
  suggestionBold: {
    fontFamily: 'GeneralSans-Bold',
    color: '#5F4DB2',
  },
  deleteSectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: Spacing.md,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#FEB2B2',
    borderRadius: 12,
    backgroundColor: '#FFF5F5',
  },
  deleteSectionText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#C53030',
  },
  bottomBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#EAE4DA',
    backgroundColor: '#FFFCF7',
  },
  cancelButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radii.pill,
    backgroundColor: '#F5EFE0',
  },
  cancelButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#5F6B80',
  },
  saveButton: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
  },
  saveButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
