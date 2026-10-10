import React, { useState } from 'react';
import { AppAlert } from "@/components/feedback/AppAlert";
import { View, Text, StyleSheet, Pressable, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as DocumentPicker from 'expo-document-picker';
import { UploadSimple, ArrowRight, ClipboardText, NotePencil } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { PasteTextModal } from './PasteTextModal';
import { ManualResumeModal, ManualResumeData } from './ManualResumeModal';
import { resumeFileError } from '@/services/profile/resumeFile';

export interface UploadedFileMeta {
  fileName: string;
  fileSize: string;
  fileSizeBytes?: number;
  fileUri?: string;
  mimeType?: string;
}

export interface ResumeIntakePayload {
  source: 'upload' | 'paste' | 'form';
  fileMeta?: UploadedFileMeta;
  pastedText?: string;
  manualData?: ManualResumeData;
}

interface ResumeIntakeScreenProps {
  onSelectOption?: (
    option: 'upload' | 'paste' | 'form',
    fileMeta?: UploadedFileMeta,
    payload?: ResumeIntakePayload
  ) => void;
  onBack?: () => void;
  userName?: string;
}

export function ResumeIntakeScreen({ onSelectOption, onBack, userName }: ResumeIntakeScreenProps) {
  const [isPasteModalOpen, setIsPasteModalOpen] = useState(false);
  const [isManualModalOpen, setIsManualModalOpen] = useState(false);

  const handleUploadPress = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          'application/pdf',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        ],
        copyToCacheDirectory: true,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const validationError = resumeFileError(asset);
        if (validationError) {
          AppAlert.alert('Cannot use this file', validationError);
          return;
        }
        const fileName = asset.name || 'Candidate_Resume.pdf';
        const fileSize = asset.size ? `${(asset.size / 1024).toFixed(0)} KB` : '412 KB';
        const fileSizeBytes = asset.size;
        const fileUri = asset.uri;
        const mimeType = asset.mimeType || 'application/pdf';

        onSelectOption &&
          onSelectOption(
            'upload',
            { fileName, fileSize, fileSizeBytes, fileUri, mimeType },
            {
              source: 'upload',
              fileMeta: { fileName, fileSize, fileSizeBytes, fileUri, mimeType },
            }
          );
      }
    } catch (e) {
      console.warn('Document picker error:', e);
      AppAlert.alert('File selection failed', 'Please choose the file again.');
    }
  };

  const handlePasteSubmit = (text: string) => {
    setIsPasteModalOpen(false);
    const meta: UploadedFileMeta = {
      fileName: 'Pasted_Resume.txt',
      fileSize: `${text.length} chars`,
    };
    onSelectOption &&
      onSelectOption('paste', meta, {
        source: 'paste',
        fileMeta: meta,
        pastedText: text,
      });
  };

  const handleManualSubmit = (data: ManualResumeData) => {
    setIsManualModalOpen(false);
    const meta: UploadedFileMeta = {
      fileName: `${data.full_name.replace(/\s+/g, '_')}_Profile`,
      fileSize: `${data.skills.length} skills · ${data.experience.length} roles`,
    };
    onSelectOption &&
      onSelectOption('form', meta, {
        source: 'form',
        fileMeta: meta,
        manualData: data,
      });
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Step Progress Header */}
          <View style={styles.headerProgressSection}>
            <Text style={styles.stepEyebrow}>YOUR RESUME</Text>
          </View>

          {/* Screen Title & Subtitle */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>How would you{'\n'}like to start?</Text>
            <Text style={styles.subtitle}>Pick whichever is fastest for you.</Text>
          </View>

          {/* Options Section */}
          <View style={styles.optionsSection}>
            {/* Primary Featured Option: Upload a file */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryUploadCard,
                pressed && styles.cardPressed,
              ]}
              onPress={handleUploadPress}
              accessibilityRole="button"
              accessibilityLabel="Upload a file"
            >
              <View style={styles.uploadCardTopRow}>
                <View style={styles.uploadIconCircle}>
                  <UploadSimple size={21} color="#FFFCF7" weight="bold" />
                </View>
                <View style={styles.fastestBadge}>
                  <Text style={styles.fastestBadgeText}>FASTEST</Text>
                </View>
              </View>

              <View style={styles.uploadCardContent}>
                <Text style={styles.uploadCardTitle}>Upload a file</Text>
                <Text style={styles.uploadCardSubtitle}>
                  We read it in about 20 seconds.
                </Text>
              </View>

              <View style={styles.uploadCardFooter}>
                <Text style={styles.uploadCardMeta}>PDF · DOCX · UP TO 5 MB</Text>
                <ArrowRight size={16} color="#FFFCF7" weight="bold" />
              </View>
            </Pressable>

            {/* Secondary Options Row (2 columns) */}
            <View style={styles.secondaryRow}>
              {/* Option 2: Paste text */}
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryCard,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setIsPasteModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Paste text"
              >
                <View style={styles.secondaryIconSquare}>
                  <ClipboardText size={18} color="#FFFCF7" weight="bold" />
                </View>
                <View style={styles.secondaryCardContent}>
                  <Text style={styles.secondaryCardTitle}>Paste text</Text>
                  <Text style={styles.secondaryCardSubtitle}>From email or notes</Text>
                </View>
              </Pressable>

              {/* Option 3: Fill a form */}
              <Pressable
                style={({ pressed }) => [
                  styles.secondaryCard,
                  pressed && styles.cardPressed,
                ]}
                onPress={() => setIsManualModalOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Fill a form"
              >
                <View style={styles.secondaryIconSquare}>
                  <NotePencil size={18} color="#FFFCF7" weight="bold" />
                </View>
                <View style={styles.secondaryCardContent}>
                  <Text style={styles.secondaryCardTitle}>Fill a form</Text>
                  <Text style={styles.secondaryCardSubtitle}>No resume yet</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </ScrollView>

        {/* Paste Text Modal */}
        <PasteTextModal
          visible={isPasteModalOpen}
          onClose={() => setIsPasteModalOpen(false)}
          onSubmit={handlePasteSubmit}
        />

        {/* Manual Resume Modal */}
        <ManualResumeModal
          visible={isManualModalOpen}
          initialFullName={userName}
          onClose={() => setIsManualModalOpen(false)}
          onSubmit={handleManualSubmit}
        />

        {/* Bottom Actions Section */}
        <View style={styles.bottomSection}>
          <Pressable
            style={({ pressed }) => [
              styles.backButton,
              pressed && styles.buttonPressed,
            ]}
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Text style={styles.backButtonText}>Back</Text>
          </Pressable>

        </View>
      </View>
    </SafeAreaView>
  );
}

const ACCENT_PURPLE = '#5F4DB2';
const HERO_PURPLE = '#5E4DB2';

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  container: {
    flex: 1,
    backgroundColor: '#FFFCF7',
    paddingHorizontal: 20,
    justifyContent: 'space-between',
  },
  scrollContent: {
    paddingTop: 24,
    paddingBottom: 20,
    gap: 20,
  },
  headerProgressSection: {
    gap: 8,
  },
  stepEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 1.32, // 0.12em tracking
    color: '#5F6B80',
  },
  progressSegmentsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: Radii.pill, // 999
  },
  segmentActive: {
    backgroundColor: ACCENT_PURPLE, // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
  },
  titleSection: {
    gap: 0,
    marginTop: 8,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.75, // -0.025em tracking
    color: '#0A1931',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
    marginTop: 4,
  },
  optionsSection: {
    gap: 16,
  },
  primaryUploadCard: {
    backgroundColor: HERO_PURPLE, // #5E4DB2
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 0,
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.99 }],
  },
  uploadCardTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    width: '100%',
  },
  uploadIconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: ACCENT_PURPLE, // #5F4DB2
    alignItems: 'center',
    justifyContent: 'center',
  },
  fastestBadge: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: Radii.pill, // 999
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
  },
  fastestBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 12,
    letterSpacing: 0.88, // 0.08em tracking
    color: '#0A1931',
  },
  uploadCardContent: {
    gap: 4,
  },
  uploadCardTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 22,
    lineHeight: 26,
    letterSpacing: -0.44, // -0.02em tracking
    color: '#FFFFFF',
  },
  uploadCardSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#E0DBF4',
  },
  uploadCardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 252, 247, 0.28)',
    paddingTop: 14,
  },
  uploadCardMeta: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.1, // 0.1em tracking
    color: '#E0DBF4',
  },
  secondaryRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: -4,
  },
  secondaryCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 16,
  },
  secondaryIconSquare: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: ACCENT_PURPLE, // #5F4DB2
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryCardContent: {
    gap: 4,
  },
  secondaryCardTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 20,
    color: '#0A1931',
  },
  secondaryCardSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  bottomSection: {
    gap: 12,
    paddingBottom: 20,
    paddingTop: 8,
    backgroundColor: '#FFFCF7',
  },
  backButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.8,
  },
  backButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#0A1931',
  },
  privacyNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  privacyNoteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
});
