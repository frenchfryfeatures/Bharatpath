import React, { useEffect, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, ClipboardText, Trash, Sparkle, WarningCircle } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export interface PasteTextModalProps {
  visible: boolean;
  onClose: () => void;
  onSubmit: (text: string) => void;
  initialText?: string;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  showSampleAction?: boolean;
  isSubmitting?: boolean;
}

const SAMPLE_RESUME_TEXT = `Priya Sharma
Frontend & Mobile Developer
Bengaluru, Karnataka | priya.sharma@example.com

SUMMARY
Passionate software engineer with 2+ years of experience building modern React Native and web applications. Experienced with TypeScript, REST APIs, and clean UI/UX design.

EXPERIENCE
Software Engineer - BharatTech Labs (2023 - Present)
- Developed cross-platform mobile app features for 50,000+ active candidates.
- Built reusable UI component libraries and integrated backend REST APIs.

Junior Developer - Apex Solutions (2022 - 2023)
- Built responsive web dashboards using React and Tailwind CSS.
- Collaborated with product design teams to enhance user retention by 20%.

EDUCATION
Bachelor of Technology in Computer Science (2018 - 2022)
Visvesvaraya Technological University, Belagavi

KEY SKILLS
React Native, React.js, TypeScript, JavaScript, Python, REST APIs, Git, UI/UX Design`;

export function PasteTextModal({
  visible,
  onClose,
  onSubmit,
  initialText = '',
  title = 'Paste your CV / Resume',
  subtitle = 'No file needed · Minimum 50 chars',
  submitLabel = 'Continue & Parse',
  showSampleAction = true,
  isSubmitting = false,
}: PasteTextModalProps) {
  const [text, setText] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setText(initialText);
      setErrorMsg(null);
    }
  }, [initialText, visible]);

  const trimmedLength = text.trim().length;
  const isMinLengthMet = trimmedLength >= 50;

  const handleClear = () => {
    setText('');
    setErrorMsg(null);
  };

  const handleUseSample = () => {
    setText(SAMPLE_RESUME_TEXT);
    setErrorMsg(null);
  };

  const handleSubmit = () => {
    if (isSubmitting) return;
    if (!isMinLengthMet) {
      setErrorMsg('Please enter at least 50 characters of resume text to proceed.');
      return;
    }
    setErrorMsg(null);
    onSubmit(text.trim());
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView edges={['top', 'left', 'right']} style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconCircle}>
                <ClipboardText size={20} color="#5E4DB2" weight="bold" />
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
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* Quick Actions Row */}
            <View style={styles.quickActionsRow}>
              {showSampleAction ? (
                <Pressable
                  style={({ pressed }) => [styles.sampleButton, pressed && styles.pressed]}
                  onPress={handleUseSample}
                >
                  <Sparkle size={14} color="#5E4DB2" weight="fill" />
                  <Text style={styles.sampleButtonText}>Use sample CV</Text>
                </Pressable>
              ) : (
                <View />
              )}

              {trimmedLength > 0 && (
                <Pressable
                  style={({ pressed }) => [styles.clearButton, pressed && styles.pressed]}
                  onPress={handleClear}
                >
                  <Trash size={14} color="#8F3B3B" weight="regular" />
                  <Text style={styles.clearButtonText}>Clear</Text>
                </Pressable>
              )}
            </View>

            {/* Multiline Text Input Container */}
            <View style={[styles.inputWrapper, errorMsg ? styles.inputWrapperError : null]}>
              <TextInput
                style={styles.textInput}
                multiline
                textAlignVertical="top"
                placeholder="Paste your full resume or CV text here...&#10;&#10;Include your work experience, education, skills, and summary so the scoring engine can analyze your profile accurately."
                placeholderTextColor="#8F9AA7"
                value={text}
                onChangeText={(val) => {
                  setText(val);
                  if (errorMsg && val.trim().length >= 50) {
                    setErrorMsg(null);
                  }
                }}
                autoFocus
              />
            </View>

            {/* Character Count & Requirement Indicator */}
            <View style={styles.counterRow}>
              <Text
                style={[
                  styles.counterText,
                  isMinLengthMet ? styles.counterSuccess : styles.counterPending,
                ]}
              >
                {trimmedLength} / 50 characters min
              </Text>

              {isMinLengthMet ? (
                <Text style={styles.readyIndicator}>✓ Ready to parse</Text>
              ) : (
                <Text style={styles.moreNeededIndicator}>
                  {Math.max(0, 50 - trimmedLength)} more characters needed
                </Text>
              )}
            </View>

            {/* Error Message */}
            {errorMsg && (
              <View style={styles.errorBanner}>
                <WarningCircle size={16} color="#8F3B3B" weight="fill" />
                <Text style={styles.errorBannerText}>{errorMsg}</Text>
              </View>
            )}

            {/* Guidance Note */}
            <View style={styles.tipCard}>
              <Text style={styles.tipTitle}>💡 What to include for best scoring</Text>
              <Text style={styles.tipText}>
                • Job titles, company names, and dates of work{'\n'}
                • Degrees, colleges, and completion years{'\n'}
                • Technical and professional skills
              </Text>
            </View>
          </ScrollView>

          {/* Footer Actions */}
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
                (!isMinLengthMet || isSubmitting) && styles.submitButtonDisabled,
                pressed && isMinLengthMet && !isSubmitting && styles.pressed,
              ]}
              onPress={handleSubmit}
              disabled={!isMinLengthMet || isSubmitting}
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
    fontFamily: 'GeneralSans-Semibold',
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
    gap: 14,
  },
  quickActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sampleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: Radii.pill,
    backgroundColor: '#EFEBFB',
    borderWidth: 1,
    borderColor: '#D9D0F5',
  },
  sampleButtonText: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 12,
    color: '#5E4DB2',
  },
  clearButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  clearButtonText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#8F3B3B',
  },
  inputWrapper: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#EAE6DF',
    minHeight: 280,
    padding: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 1,
  },
  inputWrapperError: {
    borderColor: '#8F3B3B',
  },
  textInput: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 22,
    color: '#0A1931',
    flex: 1,
    minHeight: 240,
  },
  counterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  counterText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
  },
  counterSuccess: {
    color: '#1F6B45',
  },
  counterPending: {
    color: '#7A5C0E',
  },
  readyIndicator: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 12,
    color: '#1F6B45',
  },
  moreNeededIndicator: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#7A5C0E',
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
  tipCard: {
    backgroundColor: '#F8F5EE',
    borderRadius: 12,
    padding: 14,
    gap: 6,
    borderWidth: 1,
    borderColor: '#EFEAE0',
  },
  tipTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: '#0A1931',
  },
  tipText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#5F6B80',
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
