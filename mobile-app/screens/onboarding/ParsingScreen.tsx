import { intakeCareerResume } from '@/services/api/career';
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  CheckCircle,
  FilePdf,
  ClipboardText,
  NotePencil,
  WarningCircle,
  ArrowClockwise,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { UploadedFileMeta, ResumeIntakePayload } from './ResumeIntakeScreen';
import {
  submitPastedText,
  submitManualResume,
  getResumeVersionDetails,
  ResumeVersionDetailResponse,
} from '@/services/api/resume';
import { ApiError } from '@/services/api/client';

interface ParsingScreenProps {
  fileMeta?: UploadedFileMeta;
  payload?: ResumeIntakePayload;
  onReviewFound?: (
    versionId: string,
    versionDetails: ResumeVersionDetailResponse,
  ) => void;
  onBack?: () => void;
}

interface StepItem {
  id: string;
  title: string;
  countText: string;
}

const DEFAULT_STEPS: StepItem[] = [
  { id: '1', title: 'Contact & Personal Details', countText: 'Review next' },
  { id: '2', title: 'Education & Qualifications', countText: 'Review next' },
  { id: '3', title: 'Work Experience & History', countText: 'Review next' },
  { id: '4', title: 'Skills & Proficiencies', countText: 'Review next' },
  { id: '5', title: 'Profile Draft', countText: 'Not scored' },
];

export function ParsingScreen({
  fileMeta,
  payload,
  onReviewFound,
  onBack,
}: ParsingScreenProps) {
  const fileName = fileMeta?.fileName || 'Candidate_Resume.pdf';
  const fileSizeText = fileMeta?.fileSize
    ? `${fileMeta.fileSize} · uploaded`
    : 'Uploaded file';

  const isPasted =
    payload?.source === 'paste' ||
    fileName.includes('Pasted') ||
    fileName.endsWith('.txt');
  const isManual = payload?.source === 'form' || fileName.includes('Profile');

  const screenTitle = isPasted
    ? 'Analyzing pasted text'
    : isManual
      ? 'Structuring your profile'
      : 'Reading your resume';

  const screenSubtitle = isPasted
    ? 'Extracting your work history, skills, and education from your text.'
    : isManual
      ? 'Formatting your experience and skills according to BharatPath standards.'
      : 'Your resume is saved to your profile. Review the extracted details next. Scoring starts after payment.';

  // State
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [progressPercent, setProgressPercent] = useState(20);
  const [isCompleted, setIsCompleted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [versionId, setVersionId] = useState<string | null>(null);
  const [versionDetails, setVersionDetails] =
    useState<ResumeVersionDetailResponse | null>(null);

  const hasStartedRef = useRef(false);

  const executeParsing = async () => {
    setErrorMsg(null);
    setCurrentStepIndex(0);
    setProgressPercent(20);
    setIsCompleted(false);

    try {
      let createdVersionId: string | null = null;

      // 1. Process according to source
      if (payload?.source === 'paste' && payload.pastedText) {
        // Step 1: Submit pasted text to backend
        setCurrentStepIndex(0);
        setProgressPercent(25);
        const res = await submitPastedText(payload.pastedText);
        createdVersionId = res.resume_version_id;

        // Step 2-4: Simulated visual progress while fetching
        setCurrentStepIndex(1);
        setProgressPercent(50);
        await new Promise((r) => setTimeout(r, 400));

        setCurrentStepIndex(2);
        setProgressPercent(75);
        await new Promise((r) => setTimeout(r, 400));

        setCurrentStepIndex(3);
        setProgressPercent(90);
        await new Promise((r) => setTimeout(r, 300));
      } else if (payload?.source === 'form' && payload.manualData) {
        // Step 1: Submit manual structured data to backend
        setCurrentStepIndex(0);
        setProgressPercent(25);
        const res = await submitManualResume(payload.manualData);
        createdVersionId = res.resume_version_id;

        // Step 2-4: Simulated visual progress
        setCurrentStepIndex(1);
        setProgressPercent(50);
        await new Promise((r) => setTimeout(r, 350));

        setCurrentStepIndex(2);
        setProgressPercent(75);
        await new Promise((r) => setTimeout(r, 350));

        setCurrentStepIndex(3);
        setProgressPercent(90);
        await new Promise((r) => setTimeout(r, 300));
      } else {
        // Step 1: Upload flow
        setCurrentStepIndex(0);
        setProgressPercent(20);

        try {
          const selectedFile = payload?.fileMeta ?? fileMeta;
          if (!selectedFile?.fileUri)
            throw new Error('Choose your resume file again.');
          const created = await intakeCareerResume(selectedFile);
          createdVersionId = created.resume_version_id;
        } catch (uploadErr) {
          console.warn('Upload/complete failed:', uploadErr);
          throw uploadErr;
        }

        setCurrentStepIndex(3);
        setProgressPercent(90);
      }

      // Step 5: Fetch complete version details from backend
      setCurrentStepIndex(4);
      setProgressPercent(100);

      if (createdVersionId) {
        setVersionId(createdVersionId);
        const details = await getResumeVersionDetails(createdVersionId);
        setVersionDetails(details);
      }

      setIsCompleted(true);
    } catch (err: any) {
      console.error('[Parsing Error]:', err);
      if (err instanceof ApiError) {
        setErrorMsg(
          err.problem?.title || err.message || 'Failed to parse resume.',
        );
      } else {
        setErrorMsg(
          err?.message ||
            'Network error while parsing resume. Please try again.',
        );
      }
    }
  };

  useEffect(() => {
    if (!hasStartedRef.current) {
      hasStartedRef.current = true;
      executeParsing();
    }
  }, []);

  const handleReviewPress = () => {
    if (onReviewFound && versionId && versionDetails) {
      onReviewFound(versionId, versionDetails);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header Title & Subtitle */}
          <View style={styles.titleSection}>
            <Text style={styles.title}>{screenTitle}</Text>
            <Text style={styles.subtitle}>{screenSubtitle}</Text>
          </View>

          {/* Error Banner if parsing failed */}
          {errorMsg && (
            <View style={styles.errorCard}>
              <WarningCircle size={18} color="#8F3B3B" weight="fill" />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>Parsing failed</Text>
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.retryButton,
                  pressed && styles.pressed,
                ]}
                onPress={executeParsing}
              >
                <ArrowClockwise size={14} color="#8F3B3B" weight="bold" />
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Parsing Card Container */}
          <View style={styles.parsingCard}>
            {/* Header File Info */}
            <View style={styles.fileHeaderRow}>
              <View style={styles.pdfIconContainer}>
                {isPasted ? (
                  <ClipboardText size={18} color="#5E4DB2" weight="bold" />
                ) : isManual ? (
                  <NotePencil size={18} color="#5E4DB2" weight="bold" />
                ) : (
                  <FilePdf size={18} color="#5E4DB2" weight="duotone" />
                )}
              </View>
              <View style={styles.fileMetaColumn}>
                <Text style={styles.fileNameText} numberOfLines={1}>
                  {fileName}
                </Text>
                <Text style={styles.fileSizeText}>{fileSizeText}</Text>
              </View>
              <Text style={styles.stepCounterText}>
                {isCompleted ? '5 / 5' : `${currentStepIndex + 1} / 5`}
              </Text>
            </View>

            {/* Progress Track Line */}
            <View style={styles.progressTrack}>
              <View
                style={[styles.progressFill, { width: `${progressPercent}%` }]}
              />
            </View>

            {/* Step Items List */}
            <View style={styles.itemsList}>
              {DEFAULT_STEPS.map((step, index) => {
                const isStepFinished = isCompleted || index < currentStepIndex;
                const isStepActive = !isCompleted && index === currentStepIndex;

                if (isStepFinished) {
                  return (
                    <View
                      key={step.id}
                      style={[
                        styles.itemRow,
                        index > 0 && styles.itemBorderTop,
                      ]}
                    >
                      <CheckCircle size={20} color="#1F6B45" weight="fill" />
                      <Text style={styles.itemTitle}>{step.title}</Text>
                      <Text style={styles.itemMeta}>{step.countText}</Text>
                    </View>
                  );
                }

                if (isStepActive) {
                  return (
                    <View
                      key={step.id}
                      style={[
                        styles.itemRow,
                        styles.itemActiveReading,
                        index > 0 && styles.itemBorderTop,
                      ]}
                    >
                      <ActivityIndicator
                        size="small"
                        color="#5E4DB2"
                        style={styles.spinner}
                      />
                      <Text style={styles.itemTitle}>{step.title}</Text>
                      <Text style={styles.itemMetaReading}>reading</Text>
                    </View>
                  );
                }

                return (
                  <View
                    key={step.id}
                    style={[
                      styles.itemRow,
                      styles.itemBorderTop,
                      styles.itemDimmed,
                    ]}
                  >
                    <View style={styles.emptyCircleIcon} />
                    <Text style={styles.itemTitle}>{step.title}</Text>
                  </View>
                );
              })}
            </View>
          </View>

          {/* Puzzle Illustration */}
          <View style={styles.illustrationWrapper}>
            <Image
              source={require('../../assets/icons/parsing.png')}
              style={styles.illustrationImage}
              resizeMode="contain"
            />
          </View>
        </ScrollView>

        {/* Bottom CTA Button */}
        <View style={styles.bottomSection}>
          <Pressable
            style={({ pressed }) => [
              styles.reviewButton,
              !isCompleted && styles.reviewButtonDisabled,
              pressed && isCompleted && styles.buttonPressed,
            ]}
            onPress={handleReviewPress}
            disabled={!isCompleted}
          >
            {isCompleted ? (
              <Text style={styles.reviewButtonText}>Review what we found</Text>
            ) : (
              <View style={styles.buttonLoadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.reviewButtonText}>Parsing resume...</Text>
              </View>
            )}
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const ACCENT_PURPLE = '#5F4DB2';

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
    gap: 18,
  },
  titleSection: {
    gap: 2,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
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
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FDECEC',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#F8B4B4',
  },
  errorTitle: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 13,
    color: '#8F3B3B',
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#8F3B3B',
    marginTop: 2,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E8A5A5',
  },
  retryButtonText: {
    fontFamily: 'GeneralSans-SemiBold',
    fontSize: 12,
    color: '#8F3B3B',
  },
  pressed: {
    opacity: 0.8,
    transform: [{ scale: 0.98 }],
  },
  parsingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    gap: 16,
    borderWidth: 1,
    borderColor: '#EAE6DF',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
    elevation: 2,
  },
  fileHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pdfIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFEBFB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  fileMetaColumn: {
    flex: 1,
    gap: 2,
  },
  fileNameText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  fileSizeText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  stepCounterText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 18,
    color: '#5E4DB2',
  },
  progressTrack: {
    height: 4,
    backgroundColor: '#EFEAE0',
    borderRadius: Radii.pill,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: ACCENT_PURPLE,
    borderRadius: Radii.pill,
  },
  itemsList: {
    gap: 0,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  itemBorderTop: {
    borderTopWidth: 1,
    borderTopColor: '#F0ECE4',
  },
  itemActiveReading: {
    backgroundColor: '#F9F8FD',
    marginHorizontal: -8,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  itemDimmed: {
    opacity: 0.4,
  },
  itemTitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
    flex: 1,
  },
  itemMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#1F6B45',
  },
  itemMetaReading: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5E4DB2',
  },
  spinner: {
    width: 20,
    height: 20,
  },
  emptyCircleIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: '#D4CEBF',
  },
  illustrationWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  illustrationImage: {
    width: '100%',
    height: 160,
  },
  bottomSection: {
    paddingBottom: 16,
    paddingTop: 8,
  },
  reviewButton: {
    backgroundColor: '#5E4DB2',
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5E4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  reviewButtonDisabled: {
    backgroundColor: '#C8C1EC',
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  reviewButtonText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
});
