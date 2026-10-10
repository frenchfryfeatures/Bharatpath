import React, { useEffect, useMemo, useState } from 'react';
import { AppAlert } from '@/components/feedback/AppAlert';
import {
  Alert,
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  User,
  GraduationCap,
  Wrench,
  Flask,
  CheckCircle,
  WarningCircle,
  PencilLine,
  ClipboardText,
  Plus,
  Trophy,
  Globe,
  FileText,
  Sparkle,
  ArrowLeft,
  UploadSimple,
  ArrowRight,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { ManualResumeData, ManualResumeModal } from './ManualResumeModal';
import { PasteTextModal } from './PasteTextModal';
import { SectionEditModal } from './SectionEditModal';
import { FixSuggestionModal } from './FixSuggestionModal';
import { AddSectionModal } from './AddSectionModal';
import {
  confirmResumeVersion,
  editResumeVersion,
  getResumeVersionDetails,
  listResumeVersions,
  ResumeSection,
  ResumeSectionItem,
  ResumeVersionDetailResponse,
  ResumeVersionResponse,
  SectionKind,
} from '@/services/api/resume';
import { ApiError } from '@/services/api/client';
import { extractCandidateResumeInfo } from '@/services/profile/extractedResume';
import {
  readyStructuredResume,
  structuredResumeSections,
} from '@/services/profile/structuredResume';

export interface ReviewDetailsScreenProps {
  onBack?: () => void;
  title?: string;
  subtitle?: string;
  confirmButtonText?: string;
  showReadyBadge?: boolean;
  onConfirm?: (confirmedVersionId?: string, confirmedAt?: string) => void;
  onFixField?: (field: string) => void;
  candidateName?: string;
  candidateEmail?: string;
  manualData?: ManualResumeData;
  versionId?: string;
  versionDetails?: ResumeVersionDetailResponse | null;
  onVersionUpdated?: (
    versionId: string,
    versionDetails: ResumeVersionDetailResponse
  ) => void;
  onUploadNewResume?: () => void;
  onRequireSubscription?: () => void;
  requireEditToSave?: boolean;
  initialHasEdited?: boolean;
}

// Parse header lines into structured basics
function parseHeaderBasics(body: string, parsed?: any, fallbackName?: string) {
  const lines = (body || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let name = parsed?.full_name?.trim() || fallbackName || '';
  let phone = '';
  let city = '';
  const extras: string[] = [];

  lines.forEach((line, index) => {
    if (index === 0 && !name && !line.includes('@') && !/\d{5,}/.test(line)) {
      name = line;
      return;
    }
    const phoneMatch = line.match(/(?:\+?\d{1,3}[\s-]?)?\(?\d{2,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,5}/);
    if (phoneMatch && !phone) {
      phone = phoneMatch[0].trim();
    }
    if (
      (/,\s*[A-Za-z\s]+$/.test(line) ||
        /India|Maharashtra|Karnataka|Delhi|Kanpur|Mumbai|Pune|Bangalore|Bengaluru|Noida|Gurugram/i.test(
          line
        )) &&
      !city &&
      !line.includes('@')
    ) {
      city = line.split('|')[0].trim();
    } else if (line !== phone && line !== name) {
      extras.push(line);
    }
  });

  if (!name && lines.length > 0) {
    name = lines[0];
  }

  return { name, phone, city, extras };
}

export function ReviewDetailsScreen({
  onBack,
  title,
  subtitle,
  confirmButtonText,
  showReadyBadge = false,
  onConfirm,
  candidateName,
  candidateEmail,
  manualData,
  versionId,
  versionDetails,
  onVersionUpdated,
  onUploadNewResume,
  onRequireSubscription,
  requireEditToSave = true,
  initialHasEdited = false,
}: ReviewDetailsScreenProps) {
  const [activeVersionId, setActiveVersionId] = useState(versionId);
  const [details, setDetails] = useState(versionDetails);
  const [hasEdited, setHasEdited] = useState(initialHasEdited);

  const initialVersionIdRef = React.useRef(versionId);

  useEffect(() => {
    if (versionId && initialVersionIdRef.current && versionId !== initialVersionIdRef.current) {
      setHasEdited(true);
    }
  }, [versionId]);

  const canSave = !requireEditToSave || hasEdited;

  // Modals state
  const [editingSectionIndex, setEditingSectionIndex] = useState<number | null>(null);
  const [isAddSectionOpen, setIsAddSectionOpen] = useState(false);
  const [fixingItemInfo, setFixingItemInfo] = useState<{
    sectionIndex: number;
    itemIndex: number;
    item: ResumeSectionItem;
    sectionTitle: string;
  } | null>(null);

  // Fallback modal states (for manual / raw text resumes)
  const [isStructuredEditorOpen, setIsStructuredEditorOpen] = useState(false);
  const [isTextEditorOpen, setIsTextEditorOpen] = useState(false);

  // Action status
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    setActiveVersionId(versionId);
    setDetails(versionDetails);

    // If the provided version is already superseded, automatically migrate to the newest active version
    if (versionDetails?.superseded) {
      listResumeVersions()
        .then(async (versions) => {
          const latest = versions.find((v) => !v.superseded);
          if (latest && latest.resume_version_id !== versionId) {
            const freshDetails = await getResumeVersionDetails(latest.resume_version_id);
            setActiveVersionId(latest.resume_version_id);
            setDetails(freshDetails);
            onVersionUpdated?.(latest.resume_version_id, freshDetails);
          }
        })
        .catch(() => undefined);
    }
  }, [versionDetails, versionId, onVersionUpdated]);

  const parsed = details?.parsed;
  const rawText = typeof parsed?.raw_text === 'string' ? parsed.raw_text : '';
  const structuredResume = useMemo(
    () => readyStructuredResume(details),
    [details],
  );
  const sections = useMemo(() => {
    if (structuredResume) return structuredResumeSections(structuredResume);
    return details?.sections || null;
  }, [details?.sections, structuredResume]);
  const structuredStatus =
    details?.structured_status ?? details?.parsed?.structured_status;

  const resumeInfo = useMemo(
    () => extractCandidateResumeInfo(details, candidateName),
    [details, candidateName]
  );

  const totalUnclear = useMemo(() => {
    if (!sections) return 0;
    return sections.reduce((acc, section) => {
      if (!section.items) return acc;
      return acc + section.items.filter((item) => item.unclear).length;
    }, 0);
  }, [sections]);

  const structuredData = useMemo<ManualResumeData>(
    () => ({
      full_name:
        structuredResume?.full_name?.trim() ||
        parsed?.full_name?.trim() ||
        resumeInfo.name ||
        manualData?.full_name ||
        candidateName ||
        '',
      headline:
        structuredResume?.headline || parsed?.headline || manualData?.headline,
      experience: structuredResume?.experience?.length
        ? structuredResume.experience.map((experience) => ({
            employer: experience.company || '',
            title: experience.job_title || '',
            start_year:
              Number.parseInt(experience.start_date?.slice(0, 4) || '', 10) ||
              new Date().getFullYear(),
            end_year: experience.is_current
              ? null
              : Number.parseInt(experience.end_date?.slice(0, 4) || '', 10) ||
                null,
            summary: experience.description || null,
          }))
        : Array.isArray(parsed?.experience)
        ? parsed.experience
        : manualData?.experience || [],
      education: structuredResume?.education?.length
        ? structuredResume.education.map((education) => ({
            institution: education.institution || '',
            qualification: [
              education.qualification,
              education.field_of_study,
            ]
              .filter(Boolean)
              .join(' — '),
            completed_year:
              Number.parseInt(education.end_date?.slice(0, 4) || '', 10) ||
              null,
          }))
        : Array.isArray(parsed?.education)
        ? parsed.education
        : manualData?.education || [],
      skills: structuredResume?.skills?.length
        ? structuredResume.skills
        : Array.isArray(parsed?.skills)
          ? parsed.skills
          : manualData?.skills || [],
    }),
    [candidateName, manualData, parsed, resumeInfo.name, structuredResume]
  );

  const errorMessage = (error: unknown, fallback: string): string => {
    if (error instanceof ApiError) {
      const detail = error.problem?.params?.detail;
      if (Array.isArray(detail)) {
        const msgs = detail
          .map((d: any) =>
            typeof d === 'string'
              ? d
              : typeof d?.msg === 'string'
              ? d.msg
              : typeof d?.title === 'string'
              ? d.title
              : JSON.stringify(d)
          )
          .filter(Boolean);
        if (msgs.length > 0) return msgs.join('. ');
      }
      if (typeof detail === 'string' && detail.trim()) return detail.trim();
      if (typeof error.problem?.title === 'string' && error.problem.title.trim())
        return error.problem.title.trim();
      if (typeof error.message === 'string' && error.message.trim())
        return error.message.trim();
    }
    if (error instanceof Error && typeof error.message === 'string' && error.message.trim()) {
      return error.message.trim();
    }
    return fallback;
  };

  const isSubscriptionRequiredError = (error: unknown): boolean =>
    error instanceof ApiError && (error.status === 402 || error.code === 'subscription_required');

  const adoptEditedVersion = async (newVersionId: string) => {
    try {
      const newDetails = await getResumeVersionDetails(newVersionId);
      setActiveVersionId(newVersionId);
      setDetails(newDetails);
      setHasEdited(true);
      onVersionUpdated?.(newVersionId, newDetails);
    } catch (fetchErr) {
      console.warn('Adopt version details fetch failed:', fetchErr);
      setActiveVersionId(newVersionId);
      setHasEdited(true);
    }
  };

  const sanitizeSectionPayload = (s: {
    kind: SectionKind;
    heading?: string | null;
    body: string;
  }) => {
    let kind = s.kind;
    const rawHeading = s.heading?.trim() || '';

    // Reclassify if marked as activities but heading indicates another section
    if (kind === 'activities' && rawHeading) {
      const lower = rawHeading.toLowerCase();
      if (lower.includes('summary') || lower.includes('profile') || lower.includes('objective')) {
        kind = 'summary';
      } else if (lower.includes('skill') || lower.includes('technology') || lower.includes('technologies')) {
        kind = 'skills';
      } else if (lower.includes('project')) {
        kind = 'projects';
      } else if (lower.includes('certif') || lower.includes('license')) {
        kind = 'certifications';
      } else if (lower.includes('language')) {
        kind = 'languages';
      } else if (lower.includes('education') || lower.includes('academic')) {
        kind = 'education';
      } else if (lower.includes('experience') || lower.includes('employment') || lower.includes('work')) {
        kind = 'experience';
      } else if (lower.includes('achievement') || lower.includes('award') || lower.includes('honor')) {
        kind = 'achievements';
      }
    }

    // Setting heading to null for all sections instructs backend to write under
    // the canonical heading for the kind (e.g. Summary, Experience, Skills).
    // This is explicitly supported by backend schemas and completely avoids any 422 heading mismatch errors!
    return {
      kind,
      heading: null,
      body: s.body,
    };
  };

  const executeEditWithRetry = async (
    performEdit: (targetVersionId: string) => Promise<ResumeVersionResponse>,
  ): Promise<ResumeVersionResponse> => {
    if (!activeVersionId) throw new Error('No active resume version to edit.');
    try {
      return await performEdit(activeVersionId);
    } catch (firstErr: any) {
      const errCode = firstErr?.code || firstErr?.problem?.code || firstErr?.message;
      const isSuperseded =
        errCode === 'resume_version_superseded' ||
        String(firstErr?.message || '').includes('replaced by a newer one') ||
        firstErr?.status === 409;

      if (isSuperseded) {
        const freshVersions = await listResumeVersions();
        const newest = freshVersions.find((v) => !v.superseded) ?? freshVersions[0];
        if (newest && newest.resume_version_id !== activeVersionId) {
          setActiveVersionId(newest.resume_version_id);
          return await performEdit(newest.resume_version_id);
        }
      }
      throw firstErr;
    }
  };

  // Section-based editing
  const handleSaveSectionEdit = async (updatedSection: {
    kind: SectionKind;
    heading?: string | null;
    body: string;
  }) => {
    if (!activeVersionId || !sections || editingSectionIndex === null) return;
    setConfirmError(null);
    setIsSavingEdit(true);

    try {
      const updatedList = sections.map((s, idx) => {
        if (idx === editingSectionIndex) {
          return sanitizeSectionPayload(updatedSection);
        }
        return sanitizeSectionPayload(s);
      });

      // Backend constraint: HEADER kind can only ever appear as the first section
      const sanitizedList = updatedList.map((s, idx) => {
        if (idx > 0 && s.kind === 'header') {
          return { ...s, kind: 'summary' as SectionKind };
        }
        return s;
      });

      const res = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, {
          sections: sanitizedList,
        }),
      );

      await adoptEditedVersion(res.resume_version_id);
      setEditingSectionIndex(null);
    } catch (err: any) {
      if (isSubscriptionRequiredError(err)) {
        setEditingSectionIndex(null);
        onRequireSubscription?.();
        return;
      }
      const msg = errorMessage(err, 'Failed to save section changes.');
      setConfirmError(msg);
      AppAlert.alert('Save Failed', msg, [{ text: 'OK' }]);
      throw new Error(msg);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteSection = async () => {
    if (!activeVersionId || !sections || editingSectionIndex === null) return;
    setConfirmError(null);
    setIsSavingEdit(true);

    try {
      const updatedList = sections
        .filter((_, idx) => idx !== editingSectionIndex)
        .map((s) => sanitizeSectionPayload(s));

      const sanitizedList = updatedList.map((s, idx) => {
        if (idx > 0 && s.kind === 'header') {
          return { ...s, kind: 'summary' as SectionKind };
        }
        return s;
      });

      const res = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, {
          sections: sanitizedList,
        }),
      );

      await adoptEditedVersion(res.resume_version_id);
      setEditingSectionIndex(null);
    } catch (err) {
      if (isSubscriptionRequiredError(err)) {
        setEditingSectionIndex(null);
        onRequireSubscription?.();
        return;
      }
      const msg = errorMessage(err, 'Failed to delete section.');
      setConfirmError(msg);
      AppAlert.alert('Delete Failed', msg, [{ text: 'OK' }]);
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleAddNewSection = async (newSection: { kind: SectionKind; body: string }) => {
    if (!activeVersionId || !sections) return;
    setConfirmError(null);
    setIsSavingEdit(true);

    try {
      const updatedList = [
        ...sections.map((s) => sanitizeSectionPayload(s)),
        sanitizeSectionPayload({
          kind: newSection.kind,
          heading: null,
          body: newSection.body,
        }),
      ];

      const sanitizedList = updatedList.map((s, idx) => {
        if (idx > 0 && s.kind === 'header') {
          return { ...s, kind: 'summary' as SectionKind };
        }
        return s;
      });

      const res = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, {
          sections: sanitizedList,
        }),
      );

      await adoptEditedVersion(res.resume_version_id);
      setIsAddSectionOpen(false);
    } catch (err) {
      if (isSubscriptionRequiredError(err)) {
        setIsAddSectionOpen(false);
        onRequireSubscription?.();
        return;
      }
      const msg = errorMessage(err, 'Failed to add section.');
      setConfirmError(msg);
      AppAlert.alert('Add Failed', msg, [{ text: 'OK' }]);
    } finally {
      setIsSavingEdit(false);
    }
  };

  // 1-tap suggestion fix for unclear chips
  const handleApplySuggestionFix = async (fixedText: string) => {
    if (!activeVersionId || !sections || !fixingItemInfo) return;
    setConfirmError(null);
    setIsSavingEdit(true);

    const { sectionIndex, itemIndex } = fixingItemInfo;
    const targetSection = sections[sectionIndex];

    try {
      const updatedItems = (targetSection.items || []).map((item, idx) =>
        idx === itemIndex ? { ...item, text: fixedText, unclear: false } : item
      );

      const delimiter = targetSection.kind === 'certifications' ? '\n' : ', ';
      const updatedBody = updatedItems.map((i) => i.text).join(delimiter);

      const updatedList = sections.map((s, idx) => {
        if (idx === sectionIndex) {
          return sanitizeSectionPayload({
            kind: s.kind,
            heading: s.heading,
            body: updatedBody,
          });
        }
        return sanitizeSectionPayload(s);
      });

      const res = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, {
          sections: updatedList,
        }),
      );

      await adoptEditedVersion(res.resume_version_id);
      setFixingItemInfo(null);
    } catch (err) {
      if (isSubscriptionRequiredError(err)) {
        setFixingItemInfo(null);
        onRequireSubscription?.();
        return;
      }
      setConfirmError(errorMessage(err, 'Failed to apply suggestion.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Fallback edit handlers
  const handleStructuredEdit = async (data: ManualResumeData) => {
    if (!activeVersionId) return;
    setConfirmError(null);
    setIsSavingEdit(true);
    try {
      const created = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, { structured: data }),
      );
      await adoptEditedVersion(created.resume_version_id);
      setIsStructuredEditorOpen(false);
    } catch (error) {
      if (isSubscriptionRequiredError(error)) {
        setIsStructuredEditorOpen(false);
        onRequireSubscription?.();
        return;
      }
      setConfirmError(errorMessage(error, 'Could not save your resume changes.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleTextEdit = async (text: string) => {
    if (!activeVersionId) return;
    setConfirmError(null);
    setIsSavingEdit(true);
    try {
      const created = await executeEditWithRetry((targetId) =>
        editResumeVersion(targetId, { text }),
      );
      await adoptEditedVersion(created.resume_version_id);
      setIsTextEditorOpen(false);
    } catch (error) {
      if (isSubscriptionRequiredError(error)) {
        setIsTextEditorOpen(false);
        onRequireSubscription?.();
        return;
      }
      setConfirmError(errorMessage(error, 'Could not save your resume changes.'));
    } finally {
      setIsSavingEdit(false);
    }
  };

  // Confirm gate
  const confirmCurrentVersion = async () => {
    setConfirmError(null);
    if (!activeVersionId) {
      setConfirmError('Resume version is missing. Please return and submit your resume again.');
      return;
    }
    try {
      setIsConfirming(true);
      let targetId = activeVersionId;
      let res;
      try {
        res = await confirmResumeVersion(targetId);
      } catch (firstErr: any) {
        const errCode = firstErr?.code || firstErr?.problem?.code || firstErr?.message;
        const isSuperseded =
          errCode === 'resume_version_superseded' ||
          String(firstErr?.message || '').includes('replaced by a newer one') ||
          firstErr?.status === 409;

        if (isSuperseded) {
          const freshVersions = await listResumeVersions();
          const newest = freshVersions.find((v) => !v.superseded) ?? freshVersions[0];
          if (newest && newest.resume_version_id !== targetId) {
            targetId = newest.resume_version_id;
            setActiveVersionId(targetId);
            res = await confirmResumeVersion(targetId);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
        }
      }
      onConfirm?.(targetId, res?.confirmed_at);
    } catch (error) {
      if (isSubscriptionRequiredError(error)) {
        onRequireSubscription?.();
        return;
      }
      setConfirmError(errorMessage(error, 'Could not confirm this resume version.'));
    } finally {
      setIsConfirming(false);
    }
  };

  const sectionIconForKind = (kind: SectionKind) => {
    switch (kind) {
      case 'header':
        return User;
      case 'education':
        return GraduationCap;
      case 'skills':
        return Wrench;
      case 'experience':
      case 'projects':
        return Flask;
      case 'certifications':
        return CheckCircle;
      case 'languages':
        return Globe;
      case 'summary':
        return FileText;
      case 'achievements':
        return Trophy;
      default:
        return ClipboardText;
    }
  };

  const editingSection =
    editingSectionIndex !== null && sections ? sections[editingSectionIndex] : null;

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
            {onBack ? (
              <View style={styles.topBackRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.backButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={onBack}
                  accessibilityRole="button"
                  accessibilityLabel="Go back"
                >
                  <ArrowLeft size={18} color="#0A1931" weight="bold" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title || 'Review details'}</Text>
              {totalUnclear > 0 ? (
                <View style={styles.toFixBadge}>
                  <WarningCircle size={15} color="#7A5C0E" weight="bold" />
                  <Text style={styles.toFixBadgeText}>{totalUnclear} to fix</Text>
                </View>
              ) : showReadyBadge ? (
                <View style={styles.allFixedBadge}>
                  <CheckCircle size={15} color="#1F6B45" weight="fill" />
                  <Text style={styles.allFixedBadgeText}>
                    {details?.source === 'EDIT' ? 'New version' : 'Ready to review'}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.subtitle}>{subtitle || 'Nothing is scored until you confirm.'}</Text>
          </View>

          {onUploadNewResume ? (
            <Pressable
              style={({ pressed }) => [
                styles.uploadNewBanner,
                pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
              onPress={onUploadNewResume}
              accessibilityRole="button"
              accessibilityLabel="Upload new resume file"
            >
              <View style={styles.uploadNewBannerIcon}>
                <UploadSimple size={20} color="#5F4DB2" weight="bold" />
              </View>
              <View style={styles.uploadNewBannerTextCol}>
                <Text style={styles.uploadNewBannerTitle}>Upload new resume</Text>
                <Text style={styles.uploadNewBannerSub}>
                  Upload a PDF or DOCX file to replace current resume
                </Text>
              </View>
              <ArrowRight size={16} color="#5F4DB2" weight="bold" />
            </Pressable>
          ) : null}

          {confirmError ? (
            <View style={styles.errorBanner}>
              <WarningCircle size={17} color="#8F3B3B" weight="fill" />
              <Text style={styles.errorBannerText}>
                {typeof confirmError === 'string'
                  ? confirmError
                  : typeof (confirmError as any)?.message === 'string'
                  ? (confirmError as any).message
                  : JSON.stringify(confirmError)}
              </Text>
            </View>
          ) : null}

          {!structuredResume &&
          (structuredStatus === 'FAILED' || structuredStatus === 'UNAVAILABLE') ? (
            <View style={styles.errorBanner}>
              <WarningCircle size={17} color="#7A5C0E" weight="fill" />
              <Text style={styles.errorBannerText}>
                Structured resume details are {structuredStatus.toLowerCase()}.
                Showing the extracted resume text instead.
              </Text>
            </View>
          ) : null}

          {/* Cards List */}
          <View style={styles.cardsList}>
            {sections && sections.length > 0 ? (
              /* DYNAMIC SECTIONS LIST */
              <>
                {sections.map((section, idx) => {
                  const Icon = sectionIconForKind(section.kind);
                  const displayHeading =
                    section.kind === 'header'
                      ? 'BASICS'
                      : (section.heading || section.kind).toUpperCase();

                  const unclearCount =
                    section.items?.filter((item) => item.unclear).length || 0;
                  const hasWarning = unclearCount > 0;

                  return (
                    <View key={`section-${idx}`} style={styles.detailCard}>
                      {/* Card Header Row */}
                      <View style={styles.cardHeaderRow}>
                        <Icon size={16} color="#5F6B80" weight="bold" />
                        <Text style={styles.cardEyebrow}>{displayHeading}</Text>

                        {hasWarning ? (
                          <View style={styles.unclearBadge}>
                            <WarningCircle size={13} color="#7A5C0E" weight="fill" />
                            <Text style={styles.unclearBadgeText}>{unclearCount} unclear</Text>
                          </View>
                        ) : (
                          <CheckCircle size={18} color="#1F6B45" weight="fill" />
                        )}

                        <Pressable
                          style={({ pressed }) => [
                            styles.pencilRight,
                            pressed && styles.cardPressed,
                          ]}
                          onPress={() => setEditingSectionIndex(idx)}
                          hitSlop={12}
                        >
                          <PencilLine size={16} color="#566073" weight="bold" />
                        </Pressable>
                      </View>

                      {/* Card Body by Kind */}
                      {section.items ? (
                        /* CHIP ITEMS (Skills, Languages, Certifications) */
                        <View style={styles.chipsWrapRow}>
                          {section.items.map((item, itemIdx) =>
                            item.unclear ? (
                              <Pressable
                                key={`${item.text}-${itemIdx}`}
                                style={({ pressed }) => [
                                  styles.dashedChip,
                                  pressed && styles.cardPressed,
                                ]}
                                onPress={() =>
                                  setFixingItemInfo({
                                    sectionIndex: idx,
                                    itemIndex: itemIdx,
                                    item,
                                    sectionTitle: section.heading || section.kind,
                                  })
                                }
                              >
                                <Text style={styles.dashedChipText}>{item.text}</Text>
                                <View style={styles.dashedChipIcon}>
                                  <PencilLine size={13} color="#7A5C0E" weight="bold" />
                                </View>
                              </Pressable>
                            ) : (
                              <View key={`${item.text}-${itemIdx}`} style={styles.solidChip}>
                                <Text style={styles.solidChipText}>{item.text}</Text>
                              </View>
                            )
                          )}
                        </View>
                      ) : section.kind === 'header' ? (
                        /* BASICS KEY-VALUE LIST */
                        (() => {
                          const basics = parseHeaderBasics(
                            section.body,
                            parsed,
                            structuredData.full_name
                          );
                          return (
                            <View style={styles.keyValueList}>
                              <View style={styles.keyValueRow}>
                                <Text style={styles.keyText}>Name</Text>
                                <Text style={styles.valueText}>{basics.name}</Text>
                              </View>
                              {basics.phone ? (
                                <View style={styles.keyValueRow}>
                                  <Text style={styles.keyText}>Phone</Text>
                                  <Text style={styles.valueText}>{basics.phone}</Text>
                                </View>
                              ) : null}
                              {basics.city ? (
                                <View style={styles.keyValueRow}>
                                  <Text style={styles.keyText}>City</Text>
                                  <Text style={styles.valueText}>{basics.city}</Text>
                                </View>
                              ) : null}
                              {basics.extras.length > 0 ? (
                                <View style={styles.keyValueRow}>
                                  <Text style={styles.keyText}>Details</Text>
                                  <Text style={[styles.valueText, styles.valueTextWrap]}>
                                    {basics.extras.join('\n')}
                                  </Text>
                                </View>
                              ) : null}
                            </View>
                          );
                        })()
                      ) : section.kind === 'education' ? (
                        /* EDUCATION LIST */
                        <View style={styles.eduList}>
                          {!structuredResume && structuredData.education.length > 0 ? (
                            structuredData.education.map((edu, eduIdx) => (
                              <React.Fragment key={`edu-${eduIdx}`}>
                                {eduIdx > 0 && <View style={styles.hairlineDivider} />}
                                <View style={styles.eduItem}>
                                  <Text style={styles.eduTitle}>{edu.qualification}</Text>
                                  <Text style={styles.eduSubtitle}>
                                    {edu.institution}
                                    {edu.completed_year ? ` · ${edu.completed_year}` : ''}
                                  </Text>
                                </View>
                              </React.Fragment>
                            ))
                          ) : (
                            section.body.split('\n\n').map((block, blockIdx) => {
                              const lines = block.split('\n').filter(Boolean);
                              const title = lines[0] || '';
                              const subtitle = lines.slice(1).join(' · ');
                              return (
                                <React.Fragment key={`edu-block-${blockIdx}`}>
                                  {blockIdx > 0 && <View style={styles.hairlineDivider} />}
                                  <View style={styles.eduItem}>
                                    <Text style={styles.eduTitle}>{title}</Text>
                                    {subtitle ? (
                                      <Text style={styles.eduSubtitle}>{subtitle}</Text>
                                    ) : null}
                                  </View>
                                </React.Fragment>
                              );
                            })
                          )}
                        </View>
                      ) : section.kind === 'experience' || section.kind === 'projects' ? (
                        /* EXPERIENCE & PROJECTS LIST */
                        <View style={styles.expList}>
                          {!structuredResume &&
                          section.kind === 'experience' &&
                          structuredData.experience.length > 0 ? (
                            structuredData.experience.map((exp, expIdx) => (
                              <React.Fragment key={`exp-${expIdx}`}>
                                {expIdx > 0 && <View style={styles.hairlineDivider} />}
                                <View style={styles.expItem}>
                                  <Text style={styles.expTitle}>{exp.title}</Text>
                                  <Text style={styles.expSubtitle}>
                                    {exp.employer} · {exp.start_year}–
                                    {exp.end_year || 'Present'}
                                  </Text>
                                  {exp.summary ? (
                                    <Text style={[styles.eduSubtitle, { marginTop: 4 }]}>
                                      {exp.summary}
                                    </Text>
                                  ) : null}
                                </View>
                              </React.Fragment>
                            ))
                          ) : (
                            section.body.split('\n\n').map((block, blockIdx) => {
                              const lines = block.split('\n').filter(Boolean);
                              const title = lines[0] || '';
                              const rest = lines.slice(1);
                              return (
                                <React.Fragment key={`proj-block-${blockIdx}`}>
                                  {blockIdx > 0 && <View style={styles.hairlineDivider} />}
                                  <View style={styles.expItem}>
                                    <Text style={styles.expTitle}>{title}</Text>
                                    {rest.map((r, rIdx) => (
                                      <Text key={rIdx} style={styles.bodyText}>
                                        {r}
                                      </Text>
                                    ))}
                                  </View>
                                </React.Fragment>
                              );
                            })
                          )}
                        </View>
                      ) : (
                        /* GENERIC PROSE SECTION (Summary, Achievements, Personal, etc.) */
                        <View style={styles.expList}>
                          {section.body.split('\n\n').map((para, pIdx) => (
                            <Text key={pIdx} style={styles.bodyText}>
                              {para}
                            </Text>
                          ))}
                        </View>
                      )}
                    </View>
                  );
                })}

                {/* Add a Section button */}
                <Pressable
                  style={({ pressed }) => [
                    styles.addSectionCardBtn,
                    pressed && styles.cardPressed,
                  ]}
                  onPress={() => setIsAddSectionOpen(true)}
                >
                  <Plus size={16} color="#5F4DB2" weight="bold" />
                  <Text style={styles.addSectionCardText}>Add missing section</Text>
                </Pressable>
              </>
            ) : rawText ? (
              /* RAW TEXT FALLBACK (If sections are null) */
              <View style={styles.detailCard}>
                <View style={styles.cardHeaderRow}>
                  <ClipboardText size={16} color="#5F6B80" weight="bold" />
                  <Text style={styles.cardEyebrow}>EXTRACTED RESUME TEXT</Text>
                  <CheckCircle size={18} color="#1F6B45" weight="fill" />
                </View>
                <Text style={styles.rawText}>{rawText}</Text>
                <View style={styles.rawActions}>
                  <Pressable
                    style={({ pressed }) => [
                      styles.secondaryEditButton,
                      pressed && styles.cardPressed,
                    ]}
                    onPress={() => setIsTextEditorOpen(true)}
                  >
                    <PencilLine size={14} color="#5E4DB2" weight="bold" />
                    <Text style={styles.secondaryEditButtonText}>Correct text</Text>
                  </Pressable>
                  <Pressable
                    style={({ pressed }) => [
                      styles.primaryEditButton,
                      pressed && styles.buttonPressed,
                    ]}
                    onPress={() => setIsStructuredEditorOpen(true)}
                  >
                    <Text style={styles.primaryEditButtonText}>Edit as fields</Text>
                  </Pressable>
                </View>
              </View>
            ) : (
              /* STRUCTURED FALLBACK (For manual resumes) */
              <>
                {/* BASICS */}
                <Pressable
                  style={({ pressed }) => [styles.detailCard, pressed && styles.cardPressed]}
                  onPress={() => setIsStructuredEditorOpen(true)}
                >
                  <View style={styles.cardHeaderRow}>
                    <User size={16} color="#5F6B80" weight="bold" />
                    <Text style={styles.cardEyebrow}>BASICS</Text>
                    <CheckCircle size={18} color="#1F6B45" weight="fill" />
                    <View style={styles.pencilRight}>
                      <PencilLine size={15} color="#566073" weight="bold" />
                    </View>
                  </View>
                  <View style={styles.keyValueList}>
                    <View style={styles.keyValueRow}>
                      <Text style={styles.keyText}>Name</Text>
                      <Text style={styles.valueText}>{structuredData.full_name}</Text>
                    </View>
                    {structuredData.headline ? (
                      <View style={styles.keyValueRow}>
                        <Text style={styles.keyText}>Headline</Text>
                        <Text style={styles.valueText}>{structuredData.headline}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>

                {/* EDUCATION */}
                <Pressable
                  style={({ pressed }) => [styles.detailCard, pressed && styles.cardPressed]}
                  onPress={() => setIsStructuredEditorOpen(true)}
                >
                  <View style={styles.cardHeaderRow}>
                    <GraduationCap size={16} color="#5F6B80" weight="bold" />
                    <Text style={styles.cardEyebrow}>EDUCATION</Text>
                    <View style={styles.pencilRight}>
                      <PencilLine size={15} color="#566073" weight="bold" />
                    </View>
                  </View>
                  <View style={styles.eduList}>
                    {structuredData.education.length ? (
                      structuredData.education.map((edu, idx) => (
                        <React.Fragment key={`edu-${idx}`}>
                          {idx > 0 && <View style={styles.hairlineDivider} />}
                          <View style={styles.eduItem}>
                            <Text style={styles.eduTitle}>{edu.qualification}</Text>
                            <Text style={styles.eduSubtitle}>
                              {edu.institution}
                              {edu.completed_year ? ` · ${edu.completed_year}` : ''}
                            </Text>
                          </View>
                        </React.Fragment>
                      ))
                    ) : (
                      <View style={styles.eduItem}>
                        <Text style={styles.eduTitle}>No education added</Text>
                        <Text style={styles.eduSubtitle}>Tap to add your qualification</Text>
                      </View>
                    )}
                  </View>
                </Pressable>

                {/* SKILLS */}
                <Pressable
                  style={({ pressed }) => [styles.detailCard, pressed && styles.cardPressed]}
                  onPress={() => setIsStructuredEditorOpen(true)}
                >
                  <View style={styles.cardHeaderRow}>
                    <Wrench size={16} color="#5F6B80" weight="bold" />
                    <Text style={styles.cardEyebrow}>SKILLS</Text>
                    <View style={styles.pencilRight}>
                      <PencilLine size={15} color="#566073" weight="bold" />
                    </View>
                  </View>
                  {structuredData.skills.length ? (
                    <View style={styles.chipsWrapRow}>
                      {structuredData.skills.map((skill, index) => (
                        <View key={`${skill}-${index}`} style={styles.solidChip}>
                          <Text style={styles.solidChipText}>{skill}</Text>
                        </View>
                      ))}
                    </View>
                  ) : (
                    <Text style={styles.eduSubtitle}>No skills added. Tap to add skills.</Text>
                  )}
                </Pressable>

                {/* EXPERIENCE & PROJECTS */}
                <Pressable
                  style={({ pressed }) => [styles.detailCard, pressed && styles.cardPressed]}
                  onPress={() => setIsStructuredEditorOpen(true)}
                >
                  <View style={styles.cardHeaderRow}>
                    <Flask size={16} color="#5F6B80" weight="bold" />
                    <Text style={styles.cardEyebrow}>EXPERIENCE & PROJECTS</Text>
                    <View style={styles.pencilRight}>
                      <PencilLine size={15} color="#566073" weight="bold" />
                    </View>
                  </View>
                  <View style={styles.expList}>
                    {structuredData.experience.length ? (
                      structuredData.experience.map((exp, idx) => (
                        <React.Fragment key={`exp-${idx}`}>
                          {idx > 0 && <View style={styles.hairlineDivider} />}
                          <View style={styles.expItem}>
                            <Text style={styles.expTitle}>{exp.title}</Text>
                            <Text style={styles.expSubtitle}>
                              {exp.employer} · {exp.start_year}–{exp.end_year || 'Present'}
                            </Text>
                            {exp.summary ? (
                              <Text style={[styles.eduSubtitle, { marginTop: 4 }]}>
                                {exp.summary}
                              </Text>
                            ) : null}
                          </View>
                        </React.Fragment>
                      ))
                    ) : (
                      <View style={styles.expItem}>
                        <Text style={styles.expTitle}>No experience added</Text>
                        <Text style={styles.expSubtitle}>Tap to add a role or project</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>

        {/* Bottom CTA Action Area */}
        <View style={styles.bottomSection}>
          <Pressable
            style={({ pressed }) => [
              styles.confirmButton,
              (!canSave || isConfirming) && styles.buttonDisabled,
              pressed && canSave && !isConfirming && styles.buttonPressed,
            ]}
            onPress={confirmCurrentVersion}
            disabled={!canSave || isConfirming}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSave || isConfirming }}
          >
            {isConfirming ? (
              <View style={styles.buttonLoadingRow}>
                <ActivityIndicator size="small" color="#FFFFFF" />
                <Text style={styles.confirmButtonText}>Confirming...</Text>
              </View>
            ) : (
              <Text
                style={[
                  styles.confirmButtonText,
                  !canSave && styles.confirmButtonTextDisabled,
                ]}
              >
                {confirmButtonText || 'Confirm'}
              </Text>
            )}
          </Pressable>
          <Text style={styles.bottomSubtext}>
            {!canSave
              ? 'Edit any section above to enable save & update score'
              : 'You can edit any of this later'}
          </Text>
        </View>

        {/* Modal: Section Editor */}
        <SectionEditModal
          visible={editingSectionIndex !== null}
          section={editingSection}
          sectionIndex={editingSectionIndex}
          isSubmitting={isSavingEdit}
          onClose={() => !isSavingEdit && setEditingSectionIndex(null)}
          onSave={handleSaveSectionEdit}
          onDelete={handleDeleteSection}
        />

        {/* Modal: Fix Suggestion for Unclear Chip */}
        <FixSuggestionModal
          visible={fixingItemInfo !== null}
          item={fixingItemInfo?.item || null}
          sectionTitle={fixingItemInfo?.sectionTitle}
          isSubmitting={isSavingEdit}
          onClose={() => !isSavingEdit && setFixingItemInfo(null)}
          onApplyFix={handleApplySuggestionFix}
        />

        {/* Modal: Add New Section */}
        <AddSectionModal
          visible={isAddSectionOpen}
          existingKinds={sections ? sections.map((s) => s.kind) : []}
          isSubmitting={isSavingEdit}
          onClose={() => !isSavingEdit && setIsAddSectionOpen(false)}
          onAdd={handleAddNewSection}
        />

        {/* Fallback Modals */}
        <ManualResumeModal
          visible={isStructuredEditorOpen}
          initialData={structuredData}
          initialFullName={candidateName}
          title="Edit resume details"
          subtitle="Saving creates a new resume version"
          submitLabel="Save as new version"
          isSubmitting={isSavingEdit}
          onSubmit={handleStructuredEdit}
          onClose={() => !isSavingEdit && setIsStructuredEditorOpen(false)}
        />

        <PasteTextModal
          visible={isTextEditorOpen}
          initialText={rawText}
          title="Edit extracted resume"
          subtitle="Saving creates a new resume version"
          submitLabel="Save as new version"
          showSampleAction={false}
          isSubmitting={isSavingEdit}
          onSubmit={handleTextEdit}
          onClose={() => !isSavingEdit && setIsTextEditorOpen(false)}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5EFE6', // Warm off-white matching screenshot
  },
  container: {
    flex: 1,
    paddingHorizontal: Spacing.lg, // 20px
    justifyContent: 'space-between',
  },
  scrollContent: {
    paddingTop: Spacing.xl, // 24px
    paddingBottom: Spacing.xl, // 24px
    gap: Spacing.lg, // 20px
  },
  titleSection: {
    gap: 6,
  },
  topBackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontFamily: 'GeneralSans-Bold',
    fontSize: 27,
    lineHeight: 33,
    letterSpacing: -0.6,
    color: '#0A1931',
  },
  toFixBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill, // 999
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#7A5C0E',
  },
  toFixBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 16,
    color: '#7A5C0E',
  },
  allFixedBadge: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: Radii.pill,
    backgroundColor: '#E6F1EA',
  },
  allFixedBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 16,
    color: '#1F6B45',
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#5F6B80',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDECEC',
    borderWidth: 1,
    borderColor: '#F8B4B4',
    borderRadius: 12,
    padding: 12,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#8F3B3B',
  },
  cardsList: {
    gap: Spacing.md, // 12px
  },
  detailCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EAE4DA',
    borderRadius: 22,
    padding: Spacing.lg,
    gap: 16,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
  },
  cardPressed: {
    opacity: 0.7,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardEyebrow: {
    flex: 1,
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    color: '#5F6B80',
  },
  pencilRight: {
    marginLeft: 'auto',
    padding: 4,
  },
  unclearBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#7A5C0E',
  },
  unclearBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    color: '#7A5C0E',
  },
  chipsWrapRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    width: '100%',
  },
  solidChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: '#F5EFE0',
    maxWidth: '100%',
  },
  solidChipText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 20,
    color: '#0A1931',
  },
  dashedChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6C79A',
    borderStyle: 'dashed',
    maxWidth: '100%',
  },
  dashedChipText: {
    flexShrink: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 20,
    color: '#7A5C0E',
  },
  dashedChipIcon: {
    flexShrink: 0,
    alignSelf: 'center',
  },
  keyValueList: {
    gap: 12,
  },
  keyValueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.base,
  },
  keyText: {
    flexShrink: 0,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 20,
    color: '#5F6B80',
  },
  valueText: {
    flexShrink: 1,
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
    textAlign: 'right',
  },
  valueTextWrap: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
  },
  eduList: {
    gap: 14,
  },
  eduItem: {
    gap: 3,
  },
  eduTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 22,
    color: '#0A1931',
  },
  eduSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  hairlineDivider: {
    height: 1,
    backgroundColor: '#F5EFE0',
    marginVertical: 2,
  },
  expList: {
    gap: 14,
  },
  expItem: {
    gap: 4,
  },
  expTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 22,
    color: '#0A1931',
  },
  expSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  bodyText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 22,
    color: '#3A4761',
  },
  addSectionCardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: Radii.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4C7F5',
    borderStyle: 'dashed',
    marginTop: 4,
  },
  addSectionCardText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#5F4DB2',
  },
  rawText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 21,
    color: '#0A1931',
  },
  rawActions: {
    flexDirection: 'row',
    gap: 10,
  },
  secondaryEditButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#D9D0F5',
    borderRadius: 12,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
  },
  secondaryEditButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#5E4DB2',
  },
  primaryEditButton: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    paddingVertical: 11,
    backgroundColor: '#5E4DB2',
  },
  primaryEditButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  bottomSection: {
    gap: 10,
    paddingBottom: 24,
    paddingTop: 10,
    backgroundColor: 'transparent',
  },
  confirmButton: {
    width: '100%',
    backgroundColor: '#5F4DB2', // Purple matching screenshot
    paddingVertical: 18,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 4,
  },
  buttonDisabled: {
    backgroundColor: '#C8C1EC',
    shadowOpacity: 0,
    elevation: 0,
    opacity: 0.75,
  },
  buttonLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }],
  },
  confirmButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  confirmButtonTextDisabled: {
    color: 'rgba(255, 255, 255, 0.85)',
  },
  bottomSubtext: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    textAlign: 'center',
  },
  uploadNewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4C7F5',
    borderRadius: 16,
    padding: 14,
    gap: 12,
    marginBottom: 8,
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  uploadNewBannerIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F1EAF7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  uploadNewBannerTextCol: {
    flex: 1,
    gap: 2,
  },
  uploadNewBannerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#0A1931',
  },
  uploadNewBannerSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#5F6B80',
  },
});
