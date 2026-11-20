import React, { useState } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Plus, WarningCircle, CheckCircle } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { SectionKind } from '@/services/api/resume';

export interface AddSectionModalProps {
  visible: boolean;
  existingKinds: SectionKind[];
  isSubmitting?: boolean;
  onClose: () => void;
  onAdd: (newSection: { kind: SectionKind; body: string }) => void;
}

const AVAILABLE_SECTION_KINDS: { kind: SectionKind; label: string; hint: string }[] = [
  { kind: 'summary', label: 'Summary', hint: 'Professional profile or career summary' },
  { kind: 'experience', label: 'Work Experience', hint: 'Roles, companies, dates, accomplishments' },
  { kind: 'projects', label: 'Projects', hint: 'Key personal or academic projects & tech stack' },
  { kind: 'education', label: 'Education', hint: 'Degrees, colleges, boards, grades' },
  { kind: 'skills', label: 'Skills', hint: 'Comma-separated skills' },
  { kind: 'certifications', label: 'Certifications', hint: 'Certificates and licenses (one per line)' },
  { kind: 'languages', label: 'Languages', hint: 'Comma-separated languages known' },
  { kind: 'achievements', label: 'Achievements', hint: 'Awards, contests, recognitions' },
  { kind: 'activities', label: 'Activities', hint: 'Extracurriculars, volunteering, leadership' },
  { kind: 'personal', label: 'Personal Details', hint: 'Declaration, address, details' },
];

export function AddSectionModal({
  visible,
  existingKinds,
  isSubmitting = false,
  onClose,
  onAdd,
}: AddSectionModalProps) {
  const [selectedKind, setSelectedKind] = useState<SectionKind>('projects');
  const [bodyText, setBodyText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const availableKinds = AVAILABLE_SECTION_KINDS.filter(
    (item) => !existingKinds.includes(item.kind)
  );

  const currentKindInfo =
    AVAILABLE_SECTION_KINDS.find((k) => k.kind === selectedKind) ||
    AVAILABLE_SECTION_KINDS[0];

  const handleAdd = () => {
    if (isSubmitting) return;
    setErrorMsg(null);
    const trimmed = bodyText.trim();
    if (!trimmed) {
      setErrorMsg('Please enter section content.');
      return;
    }

    onAdd({
      kind: selectedKind,
      body: trimmed,
    });
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
            <View style={styles.headerTitleWrap}>
              <Text style={styles.headerTitle}>Add section</Text>
              <Text style={styles.headerSubtitle}>
                The server will assign a standard heading
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
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

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Kind Selector */}
            <View style={styles.sectionGroup}>
              <Text style={styles.inputLabel}>Choose section kind</Text>
              <View style={styles.kindPillsRow}>
                {availableKinds.map((item) => {
                  const isSelected = selectedKind === item.kind;
                  return (
                    <Pressable
                      key={item.kind}
                      style={({ pressed }) => [
                        styles.kindPill,
                        isSelected && styles.kindPillSelected,
                        pressed && styles.pressed,
                      ]}
                      onPress={() => setSelectedKind(item.kind)}
                    >
                      <Text
                        style={[
                          styles.kindPillText,
                          isSelected && styles.kindPillTextSelected,
                        ]}
                      >
                        {item.label}
                      </Text>
                      {isSelected ? (
                        <CheckCircle size={14} color="#5F4DB2" weight="fill" />
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Content Field */}
            <View style={styles.sectionGroup}>
              <Text style={styles.inputLabel}>{currentKindInfo.label} Content</Text>
              <Text style={styles.inputHint}>{currentKindInfo.hint}</Text>
              <TextInput
                style={styles.textArea}
                value={bodyText}
                onChangeText={setBodyText}
                placeholder={
                  selectedKind === 'skills' || selectedKind === 'languages'
                    ? 'Enter comma-separated items, e.g. Python, SQL, Git'
                    : selectedKind === 'certifications'
                    ? 'Enter one certification per line'
                    : 'Enter details, dates, accomplishments...'
                }
                placeholderTextColor="#A0AEC0"
                multiline
                textAlignVertical="top"
              />
            </View>
          </ScrollView>

          {/* Bottom Actions */}
          <View style={styles.bottomBar}>
            <Pressable
              style={({ pressed }) => [
                styles.cancelButton,
                pressed && styles.pressed,
              ]}
              onPress={onClose}
              disabled={isSubmitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.addButton,
                isSubmitting && styles.disabled,
                pressed && !isSubmitting && styles.pressed,
              ]}
              onPress={handleAdd}
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator size="small" color="#FFFFFF" />
                  <Text style={styles.addButtonText}>Adding...</Text>
                </View>
              ) : (
                <>
                  <Plus size={16} color="#FFFFFF" weight="bold" />
                  <Text style={styles.addButtonText}>Add Section</Text>
                </>
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
    fontFamily: 'GeneralSans-Semibold',
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
  pressed: {
    opacity: 0.8,
  },
  disabled: {
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
  sectionGroup: {
    gap: 8,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#0A1931',
  },
  inputHint: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
  },
  kindPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  kindPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    backgroundColor: '#F5EFE0',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  kindPillSelected: {
    backgroundColor: '#F3EFFF',
    borderColor: '#5F4DB2',
  },
  kindPillText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#3A4761',
  },
  kindPillTextSelected: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#5F4DB2',
  },
  textArea: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#0A1931',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2DCD5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    height: 180,
    lineHeight: 22,
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
  addButton: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: Radii.pill,
    backgroundColor: '#5F4DB2',
  },
  addButtonText: {
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
