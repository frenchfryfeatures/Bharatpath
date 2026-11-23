import React, { useState, useEffect } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { X, Check, PencilLine } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

interface FixSkillModalProps {
  visible: boolean;
  originalSkill: string;
  initialValue?: string;
  suggestions?: string[];
  onSave?: (newValue: string) => void;
  onRemove?: () => void;
  onClose?: () => void;
}

export function FixSkillModal({
  visible,
  originalSkill,
  initialValue = 'MS Office',
  suggestions = ['MS Office', 'MS Excel', 'Office 365'],
  onSave,
  onRemove,
  onClose,
}: FixSkillModalProps) {
  const [skillText, setSkillText] = useState(initialValue);

  useEffect(() => {
    setSkillText(initialValue);
  }, [initialValue, visible]);

  const handleSave = () => {
    if (onSave) {
      onSave(skillText.trim());
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.backdrop}
      >
        <Pressable style={styles.overlayPressable} onPress={onClose} />

        <View style={styles.sheetContainer}>
          {/* Top Handle Pill */}
          <View style={styles.handleBar} />

          {/* Header Row */}
          <View style={styles.headerRow}>
            <View style={styles.headerTextCol}>
              <Text style={styles.sheetTitle}>Fix this skill</Text>
              <Text style={styles.sheetSubtitle}>
                We read "{originalSkill}" from your resume
              </Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.closeButton,
                pressed && styles.closePressed,
              ]}
              onPress={onClose}
            >
              <X size={16} color="#3A4761" weight="bold" />
            </Pressable>
          </View>

          {/* Editable Text Input Box */}
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.textInput}
              value={skillText}
              onChangeText={setSkillText}
              placeholder="Skill name"
              placeholderTextColor="#9DA9BE"
              autoFocus={false}
            />
            <PencilLine size={18} color="#5F6B80" weight="bold" />
          </View>

          {/* DID YOU MEAN Suggestions Section */}
          <View style={styles.suggestionsSection}>
            <Text style={styles.eyebrowText}>DID YOU MEAN</Text>
            <View style={styles.chipsWrapRow}>
              {Array.from(new Set(suggestions)).map((suggestion, index) => {
                const isSelected = skillText.trim().toLowerCase() === suggestion.toLowerCase();
                return (
                  <Pressable
                    key={`${suggestion}-${index}`}
                    style={({ pressed }) => [
                      styles.suggestionChip,
                      isSelected ? styles.chipSelected : styles.chipNormal,
                      pressed && styles.chipPressed,
                    ]}
                    onPress={() => setSkillText(suggestion)}
                  >
                    {isSelected && (
                      <Check size={12} color="#0A1931" weight="bold" />
                    )}
                    <Text
                      style={[
                        styles.chipText,
                        isSelected ? styles.chipTextSelected : styles.chipTextNormal,
                      ]}
                    >
                      {suggestion}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Bottom Action Buttons */}
          <View style={styles.actionsRow}>
            <Pressable
              style={({ pressed }) => [
                styles.removeButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onRemove}
            >
              <Text style={styles.removeButtonText}>Remove</Text>
            </Pressable>

            <Pressable
              style={({ pressed }) => [
                styles.saveButton,
                pressed && styles.savePressed,
              ]}
              onPress={handleSave}
            >
              <Text style={styles.saveButtonText}>Save skill</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.44)',
    justifyContent: 'flex-end',
  },
  overlayPressable: {
    flex: 1,
  },
  sheetContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.lg, // 20px
    paddingTop: Spacing.md, // 12px
    paddingBottom: Spacing.xxl, // 32-40px
    gap: Spacing.lg, // 20px
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.22,
    shadowRadius: 26,
    elevation: 12,
  },
  handleBar: {
    width: 40,
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#E7E0D4',
    alignSelf: 'center',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md, // 12px
  },
  headerTextCol: {
    flex: 1,
    gap: 4,
  },
  sheetTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 20,
    lineHeight: 24,
    letterSpacing: -0.4,
    color: Colors.navy, // #0A1931
  },
  sheetSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closePressed: {
    backgroundColor: '#F4EFE4',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.navy, // #0A1931
    borderRadius: Radii.input, // 16px
    paddingHorizontal: Spacing.base, // 16px
    paddingVertical: 14,
  },
  textInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
    padding: 0,
  },
  suggestionsSection: {
    gap: Spacing.sm, // 8px
  },
  eyebrowText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.1,
    color: '#5F6B80',
  },
  chipsWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: Radii.pill, // 999
  },
  chipNormal: {
    backgroundColor: '#F7EFD6',
  },
  chipSelected: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
  },
  chipPressed: {
    opacity: 0.8,
  },
  chipText: {
    fontSize: 13,
    lineHeight: 16,
  },
  chipTextNormal: {
    fontFamily: 'GeneralSans-Medium',
    color: '#0A1931',
  },
  chipTextSelected: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#0A1931',
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingTop: 4,
  },
  removeButton: {
    width: 96,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 16,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  removeButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
  },
  saveButton: {
    flex: 1,
    backgroundColor: '#5F4DB2', // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
    paddingVertical: 16,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  savePressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  saveButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#FFFFFF',
  },
});

export default FixSkillModal;

