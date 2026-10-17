import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  Image,
  Dimensions,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  Eye,
  DownloadSimple,
  Check,
  Plus,
  Trash,
  X,
  FileText,
  ArrowCounterClockwise,
  PencilSimple,
  Sparkle,
} from 'phosphor-react-native';
import {
  getResumeTemplates,
  getResumeDraft,
  saveResumeDraft,
  resetResumeDraft,
  previewResumeDraft,
  downloadAndShareResumePdf,
  pushResumeDraft,
  type ResumeTemplateKey,
  type ResumeTemplateInfo,
  type ResumeBuilderContent,
  type StructuredResumeProject,
  type StructuredResumeExperience,
  type StructuredResumeEducation,
} from '@/services/api/resumeBuilder';
import { AppAlert } from '@/components/feedback/AppAlert';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export function ResumeBuilderScreen({
  onDone,
  onBack,
  onUploadCv,
}: {
  onDone: (resumeVersionId: string) => void;
  onBack: () => void;
  onUploadCv?: () => void;
}) {
  const [templates, setTemplates] = useState<ResumeTemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<ResumeTemplateKey>('classic');
  const [content, setContent] = useState<ResumeBuilderContent>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [previewPages, setPreviewPages] = useState<string[]>([]);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<
    'personal' | 'experience' | 'education' | 'skills' | 'projects' | 'more'
  >('personal');

  // Project Modal State
  const [projectModalVisible, setProjectModalVisible] = useState(false);
  const [editingProjectIndex, setEditingProjectIndex] = useState<number | null>(null);
  const [projectDraft, setProjectDraft] = useState<StructuredResumeProject>({
    name: '',
    role: '',
    description: '',
    technologies: [],
    url: '',
  });
  const [techInput, setTechInput] = useState('');

  // Experience Modal State
  const [expModalVisible, setExpModalVisible] = useState(false);
  const [editingExpIndex, setEditingExpIndex] = useState<number | null>(null);
  const [expDraft, setExpDraft] = useState<StructuredResumeExperience>({
    job_title: '',
    company: '',
    location: '',
    start_date: '',
    end_date: '',
    is_current: false,
    description: '',
  });

  // Education Modal State
  const [eduModalVisible, setEduModalVisible] = useState(false);
  const [editingEduIndex, setEditingEduIndex] = useState<number | null>(null);
  const [eduDraft, setEduDraft] = useState<StructuredResumeEducation>({
    qualification: '',
    field_of_study: '',
    institution: '',
    start_date: '',
    end_date: '',
    grade: '',
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load initial templates & draft
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([getResumeTemplates(), getResumeDraft()])
      .then(([tplRes, draftRes]) => {
        if (!alive) return;
        setTemplates(tplRes.templates);
        setSelectedTemplate(draftRes.template_key || tplRes.default || 'classic');
        setContent(draftRes.content || {});
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Could not load resume draft.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Debounced Autosave
  const triggerAutoSave = useCallback(
    (newTemplate: ResumeTemplateKey, newContent: ResumeBuilderContent) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(async () => {
        try {
          setSaving(true);
          await saveResumeDraft(newTemplate, newContent);
        } catch (e) {
          console.warn('Autosave warning:', e);
        } finally {
          setSaving(false);
        }
      }, 700);
    },
    [],
  );

  const updateContent = (updater: (prev: ResumeBuilderContent) => ResumeBuilderContent) => {
    setContent((prev) => {
      const next = updater(prev);
      triggerAutoSave(selectedTemplate, next);
      return next;
    });
  };

  const handleTemplateChange = (key: ResumeTemplateKey) => {
    setSelectedTemplate(key);
    triggerAutoSave(key, content);
  };

  // Preview Generation
  const handleOpenPreview = async () => {
    setPreviewing(true);
    setError('');
    try {
      // Save current state first
      await saveResumeDraft(selectedTemplate, content);
      const res = await previewResumeDraft(selectedTemplate, content);
      setPreviewPages(res.pages);
      setPreviewVisible(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Preview generation failed.');
      AppAlert.alert('Preview Error', 'Could not generate resume preview. Check your dates and details.');
    } finally {
      setPreviewing(false);
    }
  };

  // Download PDF
  const handleDownload = async () => {
    setDownloading(true);
    setError('');
    try {
      await saveResumeDraft(selectedTemplate, content);
      await downloadAndShareResumePdf(content.full_name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed.');
      AppAlert.alert('Download Error', 'Could not download PDF. Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  // Push Resume & Continue
  const handlePushAndContinue = async () => {
    setPushing(true);
    setError('');
    try {
      await saveResumeDraft(selectedTemplate, content);
      const pushRes = await pushResumeDraft();
      onDone(pushRes.resume_version_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not finalize resume.';
      setError(msg);
      AppAlert.alert('Resume Incomplete', msg);
    } finally {
      setPushing(false);
    }
  };

  // Reset Draft
  const handleReset = () => {
    AppAlert.alert(
      'Reset from Profile',
      'This will refresh all fields from your onboarding profile and uploaded CV. Continue?',
      [
        { text: 'Cancel', style: 'secondary' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            setLoading(true);
            try {
              const res = await resetResumeDraft();
              setContent(res.content);
              setSelectedTemplate(res.template_key);
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Reset failed.');
            } finally {
              setLoading(false);
            }
          },
        },
      ],
    );
  };

  // --- Project Helpers ---
  const openAddProject = () => {
    setEditingProjectIndex(null);
    setProjectDraft({
      name: '',
      role: '',
      description: '',
      technologies: [],
      url: '',
    });
    setTechInput('');
    setProjectModalVisible(true);
  };

  const openEditProject = (index: number) => {
    const item = content.projects?.[index];
    if (!item) return;
    setEditingProjectIndex(index);
    setProjectDraft({ ...item });
    setTechInput((item.technologies || []).join(', '));
    setProjectModalVisible(true);
  };

  const saveProject = () => {
    if (!projectDraft.name.trim()) {
      AppAlert.alert('Project Name Required', 'Please enter a name for your project.');
      return;
    }
    const techs = techInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);

    const updatedItem: StructuredResumeProject = {
      ...projectDraft,
      technologies: techs,
    };

    updateContent((prev) => {
      const currentProjects = [...(prev.projects || [])];
      if (editingProjectIndex !== null) {
        currentProjects[editingProjectIndex] = updatedItem;
      } else {
        currentProjects.push(updatedItem);
      }
      return { ...prev, projects: currentProjects };
    });
    setProjectModalVisible(false);
  };

  const deleteProject = (index: number) => {
    updateContent((prev) => {
      const currentProjects = (prev.projects || []).filter((_, i) => i !== index);
      return { ...prev, projects: currentProjects };
    });
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerBox}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.loadingText}>Preparing resume builder…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.headerBtn} accessibilityLabel="Back">
          <ArrowLeft size={22} color="#0A1931" />
        </Pressable>
        <View style={styles.headerTitleWrap}>
          <Text style={styles.headerTitle}>Resume Builder</Text>
          <Text style={styles.savingIndicator}>
            {saving ? 'Saving changes…' : 'Autosaved ✓'}
          </Text>
        </View>
        <Pressable
          onPress={handleReset}
          style={styles.headerResetBtn}
          accessibilityLabel="Reset from profile"
        >
          <ArrowCounterClockwise size={18} color="#5F4DB2" />
        </Pressable>
      </View>

      {/* Template Selector Bar */}
      <View style={styles.templateSection}>
        <Text style={styles.templateLabel}>CHOOSE TEMPLATE</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.templateList}>
          {templates.map((tpl) => {
            const isSelected = selectedTemplate === tpl.key;
            return (
              <Pressable
                key={tpl.key}
                onPress={() => handleTemplateChange(tpl.key)}
                style={[styles.templateCard, isSelected && styles.templateCardSelected]}
              >
                <View style={styles.templateHeaderRow}>
                  <Text style={[styles.templateName, isSelected && styles.templateNameSelected]}>
                    {tpl.name}
                  </Text>
                  {isSelected && <Check size={14} color="#5F4DB2" weight="bold" />}
                </View>
                <Text style={styles.templateDesc} numberOfLines={2}>
                  {tpl.description}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Section Tabs */}
      <View style={styles.tabsContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabScroll}>
          {(
            [
              { key: 'personal', label: 'Personal' },
              { key: 'experience', label: `Experience (${content.experience?.length || 0})` },
              { key: 'education', label: `Education (${content.education?.length || 0})` },
              { key: 'skills', label: `Skills (${content.skills?.length || 0})` },
              { key: 'projects', label: `Projects (${content.projects?.length || 0})` },
              { key: 'more', label: 'More' },
            ] as const
          ).map((tab) => {
            const active = activeTab === tab.key;
            return (
              <Pressable
                key={tab.key}
                onPress={() => setActiveTab(tab.key)}
                style={[styles.tabBtn, active && styles.tabBtnActive]}
              >
                <Text style={[styles.tabBtnText, active && styles.tabBtnTextActive]}>
                  {tab.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Main Content Form */}
      <ScrollView style={styles.formContainer} contentContainerStyle={styles.formContent} keyboardShouldPersistTaps="handled">
        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {/* 1. PERSONAL DETAILS */}
        {activeTab === 'personal' && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>Personal Information</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Full Name *</Text>
              <TextInput
                style={styles.input}
                value={content.full_name || ''}
                onChangeText={(text) => updateContent((prev) => ({ ...prev, full_name: text }))}
                placeholder="e.g. Priya Sharma"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Professional Headline</Text>
              <TextInput
                style={styles.input}
                value={content.headline || ''}
                onChangeText={(text) => updateContent((prev) => ({ ...prev, headline: text }))}
                placeholder="e.g. Senior Software Engineer | React Native"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Location</Text>
              <TextInput
                style={styles.input}
                value={content.location || ''}
                onChangeText={(text) => updateContent((prev) => ({ ...prev, location: text }))}
                placeholder="e.g. Bengaluru, India"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Summary / Bio</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={content.summary || ''}
                onChangeText={(text) => updateContent((prev) => ({ ...prev, summary: text }))}
                placeholder="Brief summary of your professional background and strengths…"
                placeholderTextColor="#9AA1AE"
                multiline
                numberOfLines={3}
              />
            </View>

            <Text style={[styles.sectionHeading, { marginTop: 16 }]}>Contact & Social Links</Text>
            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Email Address</Text>
              <TextInput
                style={styles.input}
                value={content.contacts?.email || ''}
                onChangeText={(text) =>
                  updateContent((prev) => ({
                    ...prev,
                    contacts: { ...(prev.contacts || {}), email: text },
                  }))
                }
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="priya@example.com"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Phone Number</Text>
              <TextInput
                style={styles.input}
                value={content.contacts?.phone || ''}
                onChangeText={(text) =>
                  updateContent((prev) => ({
                    ...prev,
                    contacts: { ...(prev.contacts || {}), phone: text },
                  }))
                }
                keyboardType="phone-pad"
                placeholder="+919876543210"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>LinkedIn Profile</Text>
              <TextInput
                style={styles.input}
                value={content.contacts?.linkedin || ''}
                onChangeText={(text) =>
                  updateContent((prev) => ({
                    ...prev,
                    contacts: { ...(prev.contacts || {}), linkedin: text },
                  }))
                }
                placeholder="linkedin.com/in/username"
                placeholderTextColor="#9AA1AE"
                autoCapitalize="none"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Portfolio / Website</Text>
              <TextInput
                style={styles.input}
                value={content.contacts?.website || ''}
                onChangeText={(text) =>
                  updateContent((prev) => ({
                    ...prev,
                    contacts: { ...(prev.contacts || {}), website: text },
                  }))
                }
                placeholder="https://portfolio.dev"
                placeholderTextColor="#9AA1AE"
                autoCapitalize="none"
              />
            </View>
          </View>
        )}

        {/* 2. EXPERIENCE */}
        {activeTab === 'experience' && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>Work Experience</Text>
              <Pressable
                onPress={() => {
                  setEditingExpIndex(null);
                  setExpDraft({
                    job_title: '',
                    company: '',
                    location: '',
                    start_date: '',
                    end_date: '',
                    is_current: false,
                    description: '',
                  });
                  setExpModalVisible(true);
                }}
                style={styles.addSmallBtn}
              >
                <Plus size={14} color="#5F4DB2" weight="bold" />
                <Text style={styles.addSmallBtnText}>Add Job</Text>
              </Pressable>
            </View>

            {(!content.experience || content.experience.length === 0) && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No experience listed</Text>
                <Text style={styles.emptySub}>Fresher or student? You can skip or add internships.</Text>
              </View>
            )}

            {(content.experience || []).map((exp, idx) => (
              <View key={`exp-${idx}`} style={styles.itemCard}>
                <View style={styles.itemCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{exp.job_title || 'Untitled Role'}</Text>
                    <Text style={styles.itemSub}>
                      {exp.company} {exp.location ? `· ${exp.location}` : ''}
                    </Text>
                    <Text style={styles.itemDates}>
                      {exp.start_date || 'Start'} — {exp.is_current ? 'Present' : exp.end_date || 'End'}
                    </Text>
                  </View>
                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() => {
                        setEditingExpIndex(idx);
                        setExpDraft({ ...exp });
                        setExpModalVisible(true);
                      }}
                      style={styles.actionIconBtn}
                    >
                      <PencilSimple size={16} color="#5F4DB2" />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        updateContent((prev) => ({
                          ...prev,
                          experience: (prev.experience || []).filter((_, i) => i !== idx),
                        }));
                      }}
                      style={styles.actionIconBtn}
                    >
                      <Trash size={16} color="#C93B2B" />
                    </Pressable>
                  </View>
                </View>
                {!!exp.description && <Text style={styles.itemDesc}>{exp.description}</Text>}
              </View>
            ))}
          </View>
        )}

        {/* 3. EDUCATION */}
        {activeTab === 'education' && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionHeading}>Education</Text>
              <Pressable
                onPress={() => {
                  setEditingEduIndex(null);
                  setEduDraft({
                    qualification: '',
                    field_of_study: '',
                    institution: '',
                    start_date: '',
                    end_date: '',
                    grade: '',
                  });
                  setEduModalVisible(true);
                }}
                style={styles.addSmallBtn}
              >
                <Plus size={14} color="#5F4DB2" weight="bold" />
                <Text style={styles.addSmallBtnText}>Add Degree</Text>
              </Pressable>
            </View>

            {(!content.education || content.education.length === 0) && (
              <View style={styles.emptyCard}>
                <Text style={styles.emptyTitle}>No education listed</Text>
                <Text style={styles.emptySub}>Add your degree, diploma, or schooling.</Text>
              </View>
            )}

            {(content.education || []).map((edu, idx) => (
              <View key={`edu-${idx}`} style={styles.itemCard}>
                <View style={styles.itemCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>
                      {edu.qualification || 'Degree'} {edu.field_of_study ? `in ${edu.field_of_study}` : ''}
                    </Text>
                    <Text style={styles.itemSub}>{edu.institution || 'University'}</Text>
                    <Text style={styles.itemDates}>
                      {edu.start_date || 'Start'} — {edu.end_date || 'Graduation'}
                      {edu.grade ? ` · Grade: ${edu.grade}` : ''}
                    </Text>
                  </View>
                  <View style={styles.itemActions}>
                    <Pressable
                      onPress={() => {
                        setEditingEduIndex(idx);
                        setEduDraft({ ...edu });
                        setEduModalVisible(true);
                      }}
                      style={styles.actionIconBtn}
                    >
                      <PencilSimple size={16} color="#5F4DB2" />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        updateContent((prev) => ({
                          ...prev,
                          education: (prev.education || []).filter((_, i) => i !== idx),
                        }));
                      }}
                      style={styles.actionIconBtn}
                    >
                      <Trash size={16} color="#C93B2B" />
                    </Pressable>
                  </View>
                </View>
              </View>
            ))}
          </View>
        )}

        {/* 4. SKILLS */}
        {activeTab === 'skills' && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>Key Skills</Text>
            <Text style={styles.helperText}>
              Skills are automatically formatted into ATS keyword tags on your generated resume.
            </Text>

            <View style={styles.skillsTagWrap}>
              {(content.skills || []).map((skill, idx) => (
                <View key={`skill-${idx}`} style={styles.skillPill}>
                  <Text style={styles.skillPillText}>{skill}</Text>
                  <Pressable
                    onPress={() => {
                      updateContent((prev) => ({
                        ...prev,
                        skills: (prev.skills || []).filter((_, i) => i !== idx),
                      }));
                    }}
                    hitSlop={6}
                  >
                    <X size={12} color="#5F4DB2" />
                  </Pressable>
                </View>
              ))}
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Add Skills (separate with commas)</Text>
              <TextInput
                style={styles.input}
                placeholder="Python, React Native, SQL, Financial Modeling…"
                placeholderTextColor="#9AA1AE"
                onSubmitEditing={(e) => {
                  const parts = e.nativeEvent.text
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  if (parts.length > 0) {
                    updateContent((prev) => ({
                      ...prev,
                      skills: Array.from(new Set([...(prev.skills || []), ...parts])),
                    }));
                  }
                }}
              />
            </View>
          </View>
        )}

        {/* 5. PROJECTS (Crucial Requirement) */}
        {activeTab === 'projects' && (
          <View style={styles.sectionBlock}>
            <View style={styles.sectionHeaderRow}>
              <View>
                <Text style={styles.sectionHeading}>Projects</Text>
                <Text style={styles.helperText}>Showcase hands-on projects, open-source work, or academic capstones.</Text>
              </View>
              <Pressable onPress={openAddProject} style={styles.addSmallBtn}>
                <Plus size={14} color="#5F4DB2" weight="bold" />
                <Text style={styles.addSmallBtnText}>Add Project</Text>
              </Pressable>
            </View>

            {(!content.projects || content.projects.length === 0) && (
              <View style={styles.emptyCard}>
                <Sparkle size={28} color="#5F4DB2" weight="duotone" />
                <Text style={styles.emptyTitle}>Add your first project</Text>
                <Text style={styles.emptySub}>
                  Since generated resumes don&apos;t initially contain projects, adding 1 or 2 projects significantly boosts your ATS score!
                </Text>
                <Pressable onPress={openAddProject} style={styles.primaryInlineBtn}>
                  <Plus size={16} color="#FFFFFF" weight="bold" />
                  <Text style={styles.primaryInlineBtnText}>Add a project now</Text>
                </Pressable>
              </View>
            )}

            {(content.projects || []).map((proj, idx) => (
              <View key={`proj-${idx}`} style={styles.itemCard}>
                <View style={styles.itemCardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitle}>{proj.name}</Text>
                    {!!proj.role && <Text style={styles.itemSub}>Role: {proj.role}</Text>}
                    {!!proj.url && <Text style={styles.itemLink}>{proj.url}</Text>}
                  </View>
                  <View style={styles.itemActions}>
                    <Pressable onPress={() => openEditProject(idx)} style={styles.actionIconBtn}>
                      <PencilSimple size={16} color="#5F4DB2" />
                    </Pressable>
                    <Pressable onPress={() => deleteProject(idx)} style={styles.actionIconBtn}>
                      <Trash size={16} color="#C93B2B" />
                    </Pressable>
                  </View>
                </View>
                {!!proj.description && <Text style={styles.itemDesc}>{proj.description}</Text>}
                {!!proj.technologies?.length && (
                  <View style={styles.projTechRow}>
                    {proj.technologies.map((tech, tIdx) => (
                      <View key={`tech-${tIdx}`} style={styles.projTechBadge}>
                        <Text style={styles.projTechText}>{tech}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* 6. MORE: Certifications & Languages */}
        {activeTab === 'more' && (
          <View style={styles.sectionBlock}>
            <Text style={styles.sectionHeading}>Certifications & Languages</Text>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Languages (comma separated)</Text>
              <TextInput
                style={styles.input}
                value={(content.languages || []).map((l) => (typeof l === 'string' ? l : l.name)).join(', ')}
                onChangeText={(text) => {
                  const langs = text
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .map((name) => ({ name }));
                  updateContent((prev) => ({ ...prev, languages: langs }));
                }}
                placeholder="English, Hindi, Marathi…"
                placeholderTextColor="#9AA1AE"
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.fieldLabel}>Achievements / Honors (comma separated)</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={(content.achievements || []).join('\n')}
                onChangeText={(text) => {
                  const ach = text
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean);
                  updateContent((prev) => ({ ...prev, achievements: ach }));
                }}
                placeholder="Dean's List 2024&#10;Winner of National Hackathon&#10;Published Research Paper"
                placeholderTextColor="#9AA1AE"
                multiline
                numberOfLines={3}
              />
            </View>
          </View>
        )}
      </ScrollView>

      {/* Bottom Sticky Action Footer */}
      <View style={styles.footer}>
        <View style={styles.footerTopRow}>
          {onUploadCv && (
            <Pressable onPress={onUploadCv} style={styles.footerSecondaryBtn}>
              <FileText size={16} color="#5F4DB2" />
              <Text style={styles.footerSecondaryText}>Upload CV instead</Text>
            </Pressable>
          )}
          <Pressable
            disabled={previewing}
            onPress={handleOpenPreview}
            style={styles.footerPreviewBtn}
          >
            {previewing ? (
              <ActivityIndicator size="small" color="#5F4DB2" />
            ) : (
              <>
                <Eye size={18} color="#5F4DB2" weight="bold" />
                <Text style={styles.footerPreviewText}>Preview</Text>
              </>
            )}
          </Pressable>
          <Pressable
            disabled={downloading}
            onPress={handleDownload}
            style={styles.footerDownloadBtn}
          >
            {downloading ? (
              <ActivityIndicator size="small" color="#5F4DB2" />
            ) : (
              <>
                <DownloadSimple size={18} color="#5F4DB2" weight="bold" />
                <Text style={styles.footerDownloadText}>Download PDF</Text>
              </>
            )}
          </Pressable>
        </View>

        <Pressable
          disabled={pushing}
          onPress={handlePushAndContinue}
          style={[styles.pushBtn, pushing && styles.pushBtnDisabled]}
        >
          {pushing ? (
            <View style={styles.pushLoadingRow}>
              <ActivityIndicator size="small" color="#FFFFFF" />
              <Text style={styles.pushBtnText}>Finalizing resume…</Text>
            </View>
          ) : (
            <Text style={styles.pushBtnText}>Use this resume and continue</Text>
          )}
        </Pressable>
      </View>

      {/* --- ADD / EDIT PROJECT MODAL --- */}
      <Modal visible={projectModalVisible} animationType="slide" transparent>
        <View style={styles.modalScrim}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingProjectIndex !== null ? 'Edit Project' : 'Add Project'}
              </Text>
              <Pressable onPress={() => setProjectModalVisible(false)} hitSlop={8}>
                <X size={20} color="#0A1931" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Project Name *</Text>
                <TextInput
                  style={styles.input}
                  value={projectDraft.name}
                  onChangeText={(text) => setProjectDraft((prev) => ({ ...prev, name: text }))}
                  placeholder="e.g. E-Commerce Mobile App"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Your Role</Text>
                <TextInput
                  style={styles.input}
                  value={projectDraft.role || ''}
                  onChangeText={(text) => setProjectDraft((prev) => ({ ...prev, role: text }))}
                  placeholder="e.g. Lead Frontend Developer"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={projectDraft.description || ''}
                  onChangeText={(text) => setProjectDraft((prev) => ({ ...prev, description: text }))}
                  placeholder="What problem did you solve? What was the outcome?"
                  placeholderTextColor="#9AA1AE"
                  multiline
                  numberOfLines={4}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Technologies Used (comma separated)</Text>
                <TextInput
                  style={styles.input}
                  value={techInput}
                  onChangeText={setTechInput}
                  placeholder="React Native, Node.js, PostgreSQL"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Project / GitHub URL</Text>
                <TextInput
                  style={styles.input}
                  value={projectDraft.url || ''}
                  onChangeText={(text) => setProjectDraft((prev) => ({ ...prev, url: text }))}
                  placeholder="https://github.com/..."
                  placeholderTextColor="#9AA1AE"
                  autoCapitalize="none"
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setProjectModalVisible(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable onPress={saveProject} style={styles.modalSaveBtn}>
                <Text style={styles.modalSaveText}>Save Project</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- ADD / EDIT EXPERIENCE MODAL --- */}
      <Modal visible={expModalVisible} animationType="slide" transparent>
        <View style={styles.modalScrim}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingExpIndex !== null ? 'Edit Experience' : 'Add Experience'}
              </Text>
              <Pressable onPress={() => setExpModalVisible(false)} hitSlop={8}>
                <X size={20} color="#0A1931" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Job Title *</Text>
                <TextInput
                  style={styles.input}
                  value={expDraft.job_title || ''}
                  onChangeText={(text) => setExpDraft((prev) => ({ ...prev, job_title: text }))}
                  placeholder="e.g. Junior Data Analyst"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Company Name *</Text>
                <TextInput
                  style={styles.input}
                  value={expDraft.company || ''}
                  onChangeText={(text) => setExpDraft((prev) => ({ ...prev, company: text }))}
                  placeholder="e.g. Infosys Ltd"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Location</Text>
                <TextInput
                  style={styles.input}
                  value={expDraft.location || ''}
                  onChangeText={(text) => setExpDraft((prev) => ({ ...prev, location: text }))}
                  placeholder="e.g. Pune, Maharashtra"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Start Month</Text>
                  <TextInput
                    style={styles.input}
                    value={expDraft.start_date || ''}
                    onChangeText={(text) => setExpDraft((prev) => ({ ...prev, start_date: text }))}
                    placeholder="YYYY-MM"
                    placeholderTextColor="#9AA1AE"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>End Month</Text>
                  <TextInput
                    style={styles.input}
                    value={expDraft.end_date || ''}
                    onChangeText={(text) => setExpDraft((prev) => ({ ...prev, end_date: text }))}
                    placeholder="YYYY-MM"
                    placeholderTextColor="#9AA1AE"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Key Responsibilities / Description</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={expDraft.description || ''}
                  onChangeText={(text) => setExpDraft((prev) => ({ ...prev, description: text }))}
                  placeholder="Describe your achievements and daily tasks…"
                  placeholderTextColor="#9AA1AE"
                  multiline
                  numberOfLines={4}
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setExpModalVisible(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!expDraft.job_title?.trim() || !expDraft.company?.trim()) {
                    AppAlert.alert('Required Fields', 'Please enter job title and company.');
                    return;
                  }
                  updateContent((prev) => {
                    const list = [...(prev.experience || [])];
                    if (editingExpIndex !== null) list[editingExpIndex] = expDraft;
                    else list.push(expDraft);
                    return { ...prev, experience: list };
                  });
                  setExpModalVisible(false);
                }}
                style={styles.modalSaveBtn}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- ADD / EDIT EDUCATION MODAL --- */}
      <Modal visible={eduModalVisible} animationType="slide" transparent>
        <View style={styles.modalScrim}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingEduIndex !== null ? 'Edit Education' : 'Add Education'}
              </Text>
              <Pressable onPress={() => setEduModalVisible(false)} hitSlop={8}>
                <X size={20} color="#0A1931" />
              </Pressable>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Degree / Qualification *</Text>
                <TextInput
                  style={styles.input}
                  value={eduDraft.qualification || ''}
                  onChangeText={(text) => setEduDraft((prev) => ({ ...prev, qualification: text }))}
                  placeholder="e.g. B.Tech / B.Com / MCA"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Field of Study / Major</Text>
                <TextInput
                  style={styles.input}
                  value={eduDraft.field_of_study || ''}
                  onChangeText={(text) => setEduDraft((prev) => ({ ...prev, field_of_study: text }))}
                  placeholder="e.g. Computer Science"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>College / Institution *</Text>
                <TextInput
                  style={styles.input}
                  value={eduDraft.institution || ''}
                  onChangeText={(text) => setEduDraft((prev) => ({ ...prev, institution: text }))}
                  placeholder="e.g. Delhi University"
                  placeholderTextColor="#9AA1AE"
                />
              </View>

              <View style={styles.inputRow}>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Start Year</Text>
                  <TextInput
                    style={styles.input}
                    value={eduDraft.start_date || ''}
                    onChangeText={(text) => setEduDraft((prev) => ({ ...prev, start_date: text }))}
                    placeholder="YYYY"
                    placeholderTextColor="#9AA1AE"
                  />
                </View>
                <View style={[styles.inputGroup, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>Graduation Year</Text>
                  <TextInput
                    style={styles.input}
                    value={eduDraft.end_date || ''}
                    onChangeText={(text) => setEduDraft((prev) => ({ ...prev, end_date: text }))}
                    placeholder="YYYY"
                    placeholderTextColor="#9AA1AE"
                  />
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.fieldLabel}>Grade / Percentage / CGPA</Text>
                <TextInput
                  style={styles.input}
                  value={eduDraft.grade || ''}
                  onChangeText={(text) => setEduDraft((prev) => ({ ...prev, grade: text }))}
                  placeholder="e.g. 8.4 CGPA or 85%"
                  placeholderTextColor="#9AA1AE"
                />
              </View>
            </ScrollView>

            <View style={styles.modalFooter}>
              <Pressable onPress={() => setEduModalVisible(false)} style={styles.modalCancelBtn}>
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (!eduDraft.qualification?.trim() || !eduDraft.institution?.trim()) {
                    AppAlert.alert('Required Fields', 'Please enter degree and institution.');
                    return;
                  }
                  updateContent((prev) => {
                    const list = [...(prev.education || [])];
                    if (editingEduIndex !== null) list[editingEduIndex] = eduDraft;
                    else list.push(eduDraft);
                    return { ...prev, education: list };
                  });
                  setEduModalVisible(false);
                }}
                style={styles.modalSaveBtn}
              >
                <Text style={styles.modalSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* --- LIVE PREVIEW MODAL --- */}
      <Modal visible={previewVisible} animationType="slide" onRequestClose={() => setPreviewVisible(false)}>
        <SafeAreaView style={styles.previewScreen}>
          <View style={styles.previewHeader}>
            <Text style={styles.previewHeaderTitle}>Resume Preview</Text>
            <View style={styles.previewHeaderActions}>
              <Pressable
                disabled={downloading}
                onPress={handleDownload}
                style={styles.previewDownloadBtn}
              >
                <DownloadSimple size={16} color="#FFFFFF" weight="bold" />
                <Text style={styles.previewDownloadText}>PDF</Text>
              </Pressable>
              <Pressable onPress={() => setPreviewVisible(false)} style={styles.previewCloseBtn}>
                <X size={20} color="#0A1931" />
              </Pressable>
            </View>
          </View>

          <ScrollView style={styles.previewBody} contentContainerStyle={styles.previewPagesList}>
            {previewPages.map((base64Page, pIdx) => (
              <View key={`page-${pIdx}`} style={styles.pageCard}>
                <Text style={styles.pageNumberBadge}>Page {pIdx + 1} of {previewPages.length}</Text>
                <Image
                  source={{ uri: `data:image/png;base64,${base64Page}` }}
                  style={[
                    styles.pageImage,
                    {
                      width: SCREEN_WIDTH - 32,
                      height: ((SCREEN_WIDTH - 32) * 1286) / 909,
                    },
                  ]}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FAF8F5',
  },
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 14,
    color: '#5F4DB2',
    fontWeight: '600',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE5DC',
    backgroundColor: '#FFFFFF',
  },
  headerBtn: {
    padding: 6,
    marginRight: 8,
  },
  headerTitleWrap: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0A1931',
    letterSpacing: -0.3,
  },
  savingIndicator: {
    fontSize: 11,
    color: '#31A66A',
    fontWeight: '600',
    marginTop: 1,
  },
  headerResetBtn: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: '#EDE8F8',
  },
  templateSection: {
    backgroundColor: '#FFFFFF',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EDE7DE',
  },
  templateLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A92A6',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  templateList: {
    paddingHorizontal: 16,
    gap: 10,
  },
  templateCard: {
    width: 145,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E2DBD2',
    backgroundColor: '#FAF8F5',
    padding: 10,
  },
  templateCardSelected: {
    borderColor: '#5F4DB2',
    backgroundColor: '#F3EEFB',
  },
  templateHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  templateName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#3A4761',
  },
  templateNameSelected: {
    color: '#5F4DB2',
  },
  templateDesc: {
    fontSize: 10,
    lineHeight: 14,
    color: '#7A8699',
  },
  tabsContainer: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EDE7DE',
  },
  tabScroll: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  tabBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: '#F1EAF7',
  },
  tabBtnActive: {
    backgroundColor: '#5F4DB2',
  },
  tabBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  tabBtnTextActive: {
    color: '#FFFFFF',
  },
  formContainer: {
    flex: 1,
  },
  formContent: {
    padding: 16,
    paddingBottom: 24,
  },
  errorBox: {
    backgroundColor: '#FFF0EE',
    borderWidth: 1,
    borderColor: '#F8B4A6',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
  },
  errorText: {
    fontSize: 13,
    color: '#9E2A1A',
    lineHeight: 18,
  },
  sectionBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    padding: 16,
    gap: 14,
  },
  sectionHeading: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0A1931',
    letterSpacing: -0.2,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  helperText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#647087',
  },
  inputGroup: {
    gap: 5,
  },
  inputRow: {
    flexDirection: 'row',
    gap: 10,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#3A4761',
  },
  input: {
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#DED5C9',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: '#0A1931',
  },
  textArea: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  addSmallBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
  },
  addSmallBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  emptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 16,
    backgroundColor: '#FAF8F5',
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#C9BEEB',
    gap: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  emptySub: {
    fontSize: 12,
    color: '#647087',
    textAlign: 'center',
    lineHeight: 16,
  },
  primaryInlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    marginTop: 6,
  },
  primaryInlineBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  itemCard: {
    backgroundColor: '#FAF8F5',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5DED4',
    padding: 12,
    gap: 6,
  },
  itemCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  itemTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  itemSub: {
    fontSize: 12,
    color: '#5F6B80',
    fontWeight: '500',
  },
  itemDates: {
    fontSize: 11,
    color: '#8A92A6',
    marginTop: 2,
  },
  itemLink: {
    fontSize: 11,
    color: '#5F4DB2',
    textDecorationLine: 'underline',
    marginTop: 2,
  },
  itemActions: {
    flexDirection: 'row',
    gap: 4,
  },
  actionIconBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  itemDesc: {
    fontSize: 12,
    lineHeight: 16,
    color: '#3A4761',
  },
  projTechRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  projTechBadge: {
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  projTechText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  skillsTagWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  skillPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDE8F8',
    borderWidth: 1,
    borderColor: '#C9BEEB',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  skillPillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#4A3E8F',
  },
  footer: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EBE5DC',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 10,
  },
  footerTopRow: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },
  footerSecondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: '#F3EEFB',
  },
  footerSecondaryText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  footerPreviewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#F3EEFB',
    borderRadius: 12,
    paddingVertical: 10,
  },
  footerPreviewText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  footerDownloadBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EDE8F8',
    borderRadius: 12,
    paddingVertical: 10,
  },
  footerDownloadText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  pushBtn: {
    backgroundColor: '#5F4DB2',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 3,
  },
  pushBtnDisabled: {
    opacity: 0.65,
  },
  pushLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pushBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Modal styles
  modalScrim: {
    flex: 1,
    backgroundColor: 'rgba(10,25,49,0.5)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE5DC',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0A1931',
  },
  modalBody: {
    padding: 20,
  },
  modalFooter: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 12,
    gap: 12,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#F3EEFB',
  },
  modalCancelText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#5F4DB2',
  },
  modalSaveText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  // Preview Screen
  previewScreen: {
    flex: 1,
    backgroundColor: '#0A1931',
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
  },
  previewHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0A1931',
  },
  previewHeaderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  previewDownloadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#5F4DB2',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
  },
  previewDownloadText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  previewCloseBtn: {
    padding: 6,
  },
  previewBody: {
    flex: 1,
    backgroundColor: '#26334B',
  },
  previewPagesList: {
    padding: 16,
    alignItems: 'center',
    gap: 20,
  },
  pageCard: {
    alignItems: 'center',
    gap: 8,
  },
  pageNumberBadge: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  pageImage: {
    borderRadius: 4,
    backgroundColor: '#FFFFFF',
  },
});
