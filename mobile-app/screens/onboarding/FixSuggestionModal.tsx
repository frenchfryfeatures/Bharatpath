import React, { useEffect, useState } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Sparkle, WarningCircle, Check, PencilSimple } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { ResumeSectionItem } from '@/services/api/resume';

export interface FixSuggestionModalProps {
  visible: boolean;
  item: ResumeSectionItem | null;
  sectionTitle?: string;
  isSubmitting?: boolean;
  onClose: () => void;
  onApplyFix: (fixedText: string) => void;
}

export function FixSuggestionModal({
  visible,
  item,
  sectionTitle = 'Skills',
  isSubmitting = false,
  onClose,
  onApplyFix,
}: FixSuggestionModalProps) {
  const [customText, setCustomText] = useState('');
  const [isEditingCustom, setIsEditingCustom] = useState(false);

  useEffect(() => {
    if (visible && item) {
      setCustomText(item.suggestion || item.text);
      setIsEditingCustom(!item.suggestion);
    }
  }, [visible, item]);

  if (!item) return null;

  const handleApplySuggestion = () => {
    if (item.suggestion) {
      onApplyFix(item.suggestion);
    }
  };

  const handleApplyCustom = () => {
    const trimmed = customText.trim();
    if (trimmed) {
      onApplyFix(trimmed);
    }
  };

  const handleKeepAsIs = () => {
    // Keeping as is confirms the current spelling without changes
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardWrap}
        >
          <View style={styles.dialogCard}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.warningIconBadge}>
                  <WarningCircle size={16} color="#7A5C0E" weight="bold" />
                </View>
                <Text style={styles.headerTitle}>Review spelling</Text>
              </View>
              <Pressable
                style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
                onPress={onClose}
                disabled={isSubmitting}
                hitSlop={8}
              >
                <X size={18} color="#0A1931" weight="bold" />
              </Pressable>
            </View>

            <Text style={styles.subtitle}>
              In {sectionTitle}: <Text style={styles.currentChipText}>{item.text}</Text>
            </Text>

            {/* If backend returned a clear suggestion */}
            {item.suggestion && !isEditingCustom ? (
              <View style={styles.suggestionBox}>
                <View style={styles.sparkleRow}>
                  <Sparkle size={16} color="#5F4DB2" weight="fill" />
                  <Text style={styles.suggestedHeading}>Suggested correction:</Text>
                </View>
                <Text style={styles.suggestedWord}>{item.suggestion}</Text>
                <Text style={styles.suggestedExplanation}>
                  Standard spelling recognized in our skills directory.
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    isSubmitting && styles.disabled,
                    pressed && !isSubmitting && styles.pressed,
                  ]}
                  onPress={handleApplySuggestion}
                  disabled={isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <Check size={16} color="#FFFFFF" weight="bold" />
                      <Text style={styles.primaryButtonText}>
                        Accept "{item.suggestion}"
                      </Text>
                    </>
                  )}
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.secondaryButton,
                    pressed && styles.pressed,
                  ]}
                  onPress={() => setIsEditingCustom(true)}
                  disabled={isSubmitting}
                >
                  <PencilSimple size={14} color="#5F4DB2" weight="bold" />
                  <Text style={styles.secondaryButtonText}>
                    Enter custom spelling
                  </Text>
                </Pressable>
              </View>
            ) : (
              /* Custom spelling edit form */
              <View style={styles.customEditBox}>
                <Text style={styles.inputLabel}>Correct spelling:</Text>
                <TextInput
                  style={styles.textInput}
                  value={customText}
                  onChangeText={setCustomText}
                  placeholder="Enter corrected word"
                  placeholderTextColor="#A0AEC0"
                  autoFocus
                  onSubmitEditing={handleApplyCustom}
                />

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (!customText.trim() || isSubmitting) && styles.disabled,
                    pressed && customText.trim() && !isSubmitting && styles.pressed,
                  ]}
                  onPress={handleApplyCustom}
                  disabled={!customText.trim() || isSubmitting}
                >
                  {isSubmitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Save spelling</Text>
                  )}
                </Pressable>

                {item.suggestion ? (
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryButton,
                      pressed && styles.pressed,
                    ]}
                    onPress={() => setIsEditingCustom(false)}
                    disabled={isSubmitting}
                  >
                    <Text style={styles.secondaryButtonText}>
                      Back to "{item.suggestion}" suggestion
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            )}

            {/* Keep current spelling action */}
            <Pressable
              style={({ pressed }) => [
                styles.tertiaryButton,
                pressed && styles.pressed,
              ]}
              onPress={handleKeepAsIs}
              disabled={isSubmitting}
            >
              <Text style={styles.tertiaryButtonText}>
                Keep "{item.text}" as written
              </Text>
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  keyboardWrap: {
    width: '100%',
    maxWidth: 420,
  },
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.cardLg,
    padding: Spacing.xl,
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 16,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  warningIconBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FFF9ED',
    borderWidth: 1,
    borderColor: '#E6C79A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    lineHeight: 24,
    color: '#0A1931',
  },
  closeBtn: {
    padding: 4,
  },
  pressed: {
    opacity: 0.8,
  },
  disabled: {
    opacity: 0.5,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
  },
  currentChipText: {
    fontFamily: 'GeneralSans-Semibold',
    color: '#7A5C0E',
  },
  suggestionBox: {
    backgroundColor: '#FAF8FF',
    borderWidth: 1,
    borderColor: '#DCD4F5',
    borderRadius: 14,
    padding: Spacing.base,
    gap: 10,
  },
  sparkleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  suggestedHeading: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#5F4DB2',
  },
  suggestedWord: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 26,
    color: '#0A1931',
  },
  suggestedExplanation: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  customEditBox: {
    gap: 10,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#0A1931',
  },
  textInput: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    color: '#0A1931',
    backgroundColor: '#F9F8F6',
    borderWidth: 1,
    borderColor: '#E2DCD5',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5F4DB2',
    paddingVertical: 14,
    borderRadius: Radii.pill,
    marginTop: 4,
  },
  primaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
  },
  secondaryButtonText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#5F4DB2',
  },
  tertiaryButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  tertiaryButtonText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#5F6B80',
  },
});
