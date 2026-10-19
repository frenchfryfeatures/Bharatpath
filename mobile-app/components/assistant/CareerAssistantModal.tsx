import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Sparkle,
  ArrowRight,
  ArrowUp,
  X,
  ArrowCounterClockwise,
  Briefcase,
  MapPin,
  ListChecks,
  Check,
  ShieldCheck,
  Building,
} from 'phosphor-react-native';
import {
  sendAssistantMessage,
  type AssistantReply,
  type AssistantTurn,
  type AssistantReplyJob,
  type AssistantReplyApplication,
} from '@/services/api/assistant';
import { applyToJob, applyErrorMessage } from '@/services/api/jobs';
import { HeartbeatThinking } from '@/components/feedback/HeartbeatThinking';
import { TypewriterText } from '@/components/feedback/TypewriterText';

type ChatEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'note'; text: string }
  | { id: number; kind: 'assistant'; response: AssistantReply };

const STARTERS = [
  {
    title: 'Find my best matches',
    description: 'Jobs that suit your profile & skills',
    prompt: 'Jobs that suit my profile',
    icon: Sparkle,
  },
  {
    title: 'Explore remote jobs',
    description: 'Discover flexible roles on the board',
    prompt: 'Remote jobs',
    icon: MapPin,
  },
  {
    title: 'Track my applications',
    description: 'See where your applications stand',
    prompt: 'Where are my applications?',
    icon: ListChecks,
  },
];

export function CareerAssistantModal({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; message: string } | null>(null);
  const [appliedJobs, setAppliedJobs] = useState<Record<string, 'loading' | 'done' | 'error'>>({});
  const [applyErrors, setApplyErrors] = useState<Record<string, string>>({});

  const stateRef = useRef<string | undefined>(undefined);
  const historyRef = useRef<AssistantTurn[]>([]);
  const nextId = useRef(0);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll on conversation update
  useEffect(() => {
    if (visible) {
      setTimeout(() => {
        scrollRef.current?.scrollToEnd({ animated: true });
      }, 150);
    }
  }, [entries.length, busy, error, visible]);

  const resetChat = () => {
    setEntries([]);
    setError(null);
    setDraft('');
    setAppliedJobs({});
    setApplyErrors({});
    stateRef.current = undefined;
    historyRef.current = [];
  };

  const handleSend = async (rawText: string, retry = false) => {
    const text = rawText.trim();
    if (!text || busy) return;

    if (!retry) {
      setEntries((prev) => [...prev, { id: ++nextId.current, kind: 'user', text }]);
    }
    setDraft('');
    setError(null);
    setBusy(true);

    const historyPayload = historyRef.current.slice(-12);
    try {
      const response = await sendAssistantMessage({
        message: text,
        history: historyPayload,
        state: stateRef.current,
      });

      stateRef.current = response.state;
      historyRef.current = [
        ...historyRef.current,
        { role: 'user' as const, text },
        { role: 'assistant' as const, text: response.reply },
      ].slice(-12);

      setEntries((prev) => [
        ...prev,
        { id: ++nextId.current, kind: 'assistant', response },
      ]);
    } catch (caught) {
      const msg = caught instanceof Error ? caught.message : 'Could not reach assistant.';
      setError({ text, message: msg });
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmApply = async (jobId: string) => {
    if (appliedJobs[jobId] === 'loading' || appliedJobs[jobId] === 'done') return;

    setAppliedJobs((prev) => ({ ...prev, [jobId]: 'loading' }));
    setApplyErrors((prev) => ({ ...prev, [jobId]: '' }));

    try {
      await applyToJob(jobId);
      setAppliedJobs((prev) => ({ ...prev, [jobId]: 'done' }));
      setEntries((prev) => [
        ...prev,
        {
          id: ++nextId.current,
          kind: 'note',
          text: 'Applied ✓ — you can track it on your Application Board.',
        },
      ]);
    } catch (err) {
      setAppliedJobs((prev) => ({ ...prev, [jobId]: 'error' }));
      const displayMsg = applyErrorMessage(err, 'Could not apply to this job.');
      setApplyErrors((prev) => ({ ...prev, [jobId]: displayMsg }));
    }
  };

  const openJob = (jobId: string) => {
    onClose();
    router.push({
      pathname: '/job-detail',
      params: { id: jobId },
    });
  };

  const openApplication = (appId: string) => {
    onClose();
    router.push({
      pathname: '/application-detail',
      params: { id: appId },
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
    >
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Sparkle size={20} color="#FFFFFF" weight="fill" />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.brandTitle}>BharatPath</Text>
            <Text style={styles.headerTitle}>Career Assistant</Text>
            <View style={styles.statusRow}>
              <View style={styles.onlineDot} />
              <Text style={styles.statusText}>Here to help you move forward</Text>
            </View>
          </View>
          <Pressable
            onPress={resetChat}
            style={styles.headerActionBtn}
            accessibilityLabel="New conversation"
          >
            <ArrowCounterClockwise size={18} color="#5F4DB2" />
          </Pressable>
          <Pressable onPress={onClose} style={styles.headerActionBtn} accessibilityLabel="Close assistant">
            <X size={20} color="#0A1931" />
          </Pressable>
        </View>

        {/* Conversation List */}
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardContainer}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
        >
          <ScrollView
            ref={scrollRef}
            style={styles.chatScroll}
            contentContainerStyle={styles.chatContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Welcome State when empty */}
            {entries.length === 0 && (
              <View style={styles.welcomeSection}>
                <View style={styles.heroCard}>
                  <View style={styles.heroBadge}>
                    <Sparkle size={13} color="#FFFFFF" weight="fill" />
                    <Text style={styles.heroBadgeText}>YOUR CAREER NAVIGATOR</Text>
                  </View>
                  <Text style={styles.heroTitle}>Let&apos;s find what&apos;s next for you.</Text>
                  <Text style={styles.heroDesc}>
                    Discover roles tailored to your score, explore new opportunities, and apply in seconds.
                  </Text>
                  <View style={styles.trustBadge}>
                    <ShieldCheck size={14} color="#EDE8F8" weight="bold" />
                    <Text style={styles.trustBadgeText}>You always confirm job applications</Text>
                  </View>
                </View>

                <View style={styles.startersHeaderRow}>
                  <View>
                    <Text style={styles.startersHeading}>GET STARTED</Text>
                    <Text style={styles.startersSubheading}>What would you like to do?</Text>
                  </View>
                  <Text style={styles.startersChoosePrompt}>Choose a prompt</Text>
                </View>
                <View style={styles.startersGrid}>
                  {STARTERS.map((s) => {
                    const IconComponent = s.icon;
                    return (
                      <Pressable
                        key={s.prompt}
                        onPress={() => void handleSend(s.prompt)}
                        style={({ pressed }) => [styles.starterBtn, pressed && styles.starterBtnPressed]}
                      >
                        <View style={styles.starterIconBox}>
                          <IconComponent size={20} color="#5F4DB2" weight="bold" />
                        </View>
                        <View style={styles.starterContent}>
                          <Text style={styles.starterTitle}>{s.title}</Text>
                          <Text style={styles.starterDesc}>{s.description}</Text>
                        </View>
                        <ArrowRight size={16} color="#5F4DB2" weight="bold" />
                      </Pressable>
                    );
                  })}
                </View>
                <Text style={styles.startersFooterText}>
                  Or ask in your own words, in your language
                </Text>
              </View>
            )}

            {/* Conversation entries */}
            {entries.map((entry) => {
              if (entry.kind === 'user') {
                return (
                  <View key={`msg-${entry.id}`} style={styles.userMsgRow}>
                    <View style={styles.userBubble}>
                      <Text style={styles.userMsgText}>{entry.text}</Text>
                    </View>
                  </View>
                );
              }

              if (entry.kind === 'note') {
                return (
                  <View key={`note-${entry.id}`} style={styles.noteRow}>
                    <Text style={styles.noteText}>{entry.text}</Text>
                  </View>
                );
              }

              const res = entry.response;
              return (
                <View key={`bot-${entry.id}`} style={styles.assistantMsgBlock}>
                  <View style={styles.botHeaderRow}>
                    <View style={styles.botAvatarSmall}>
                      <Sparkle size={13} color="#FFFFFF" weight="fill" />
                    </View>
                    <Text style={styles.botName}>BharatPath Assistant</Text>
                  </View>

                  {/* Reply text with Typewriter animation */}
                  <View style={styles.botBubble}>
                    <TypewriterText
                      text={res.reply}
                      style={styles.botMsgText}
                      speed={16}
                    />
                  </View>

                  {/* Render Recommended Jobs (Numbered 1 to 5) */}
                  {res.jobs?.length > 0 && (
                    <View style={styles.cardsBlock}>
                      {res.jobs.map((job, idx) => (
                        <AssistantJobCard
                          key={`job-${job.id}-${idx}`}
                          job={job}
                          index={idx + 1}
                          onPress={() => openJob(job.id)}
                        />
                      ))}
                    </View>
                  )}

                  {/* Single Job Card (SHOW_JOB) */}
                  {res.job && (
                    <View style={styles.cardsBlock}>
                      <AssistantJobCard
                        job={res.job}
                        onPress={() => openJob(res.job!.id)}
                      />
                    </View>
                  )}

                  {/* Apply Proposal Card (APPLY action) */}
                  {res.apply && (
                    <View style={styles.applyProposalCard}>
                      <View style={styles.applyHeader}>
                        <Building size={18} color="#5F4DB2" weight="bold" />
                        <Text style={styles.applyTitle}>
                          Apply to {res.apply.job_title}?
                        </Text>
                      </View>
                      <Text style={styles.applyCompany}>
                        {res.apply.employer_name || 'Verified Employer'}
                      </Text>

                      {res.apply.in_app ? (
                        <View style={styles.applyActionWrap}>
                          <Pressable
                            disabled={
                              appliedJobs[res.apply.job_id] === 'loading' ||
                              appliedJobs[res.apply.job_id] === 'done'
                            }
                            onPress={() => handleConfirmApply(res.apply!.job_id)}
                            style={[
                              styles.confirmApplyBtn,
                              appliedJobs[res.apply.job_id] === 'done' && styles.confirmApplyBtnDone,
                            ]}
                          >
                            {appliedJobs[res.apply.job_id] === 'loading' ? (
                              <ActivityIndicator size="small" color="#FFFFFF" />
                            ) : appliedJobs[res.apply.job_id] === 'done' ? (
                              <View style={styles.appliedDoneRow}>
                                <Check size={16} color="#FFFFFF" weight="bold" />
                                <Text style={styles.confirmApplyText}>Applied</Text>
                              </View>
                            ) : (
                              <Text style={styles.confirmApplyText}>Confirm Application</Text>
                            )}
                          </Pressable>
                          {!!applyErrors[res.apply.job_id] && (
                            <Text style={styles.applyErrorText}>
                              {applyErrors[res.apply.job_id]}
                            </Text>
                          )}
                        </View>
                      ) : (
                        <Pressable
                          onPress={() => openJob(res.apply!.job_id)}
                          style={styles.openExternalBtn}
                        >
                          <Text style={styles.openExternalText}>Open Job Details</Text>
                          <ArrowRight size={14} color="#5F4DB2" weight="bold" />
                        </Pressable>
                      )}
                    </View>
                  )}

                  {/* Applications Mini-Cards (MY_APPLICATIONS action) */}
                  {res.applications?.length > 0 && (
                    <View style={styles.cardsBlock}>
                      {res.applications.map((app) => (
                        <AssistantAppCard
                          key={`app-${app.id}`}
                          app={app}
                          onPress={() => openApplication(app.id)}
                        />
                      ))}
                    </View>
                  )}

                  {/* Suggestions Chips */}
                  {res.suggestions?.length > 0 && (
                    <View style={styles.suggestionsRow}>
                      {res.suggestions.map((sug, sIdx) => (
                        <Pressable
                          key={`sug-${sIdx}`}
                          onPress={() => void handleSend(sug)}
                          style={styles.suggestionChip}
                        >
                          <Text style={styles.suggestionText}>{sug}</Text>
                        </Pressable>
                      ))}
                    </View>
                  )}

                  {/* Show more button if available */}
                  {res.has_more && (
                    <Pressable
                      onPress={() => void handleSend('Show more')}
                      style={styles.showMoreBtn}
                    >
                      <Text style={styles.showMoreText}>Show more jobs</Text>
                      <ArrowRight size={14} color="#5F4DB2" weight="bold" />
                    </Pressable>
                  )}
                </View>
              );
            })}

            {/* Thinking status */}
            {busy && (
              <View style={styles.thinkingRow}>
                <HeartbeatThinking message="Career assistant is searching & planning…" />
              </View>
            )}

            {/* Error banner with retry */}
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorBannerText}>{error.message}</Text>
                <Pressable
                  onPress={() => void handleSend(error.text, true)}
                  style={styles.retryBtn}
                >
                  <Text style={styles.retryBtnText}>Try again</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>

          {/* Composer Footer */}
          <View style={styles.composerBar}>
            <View style={styles.composerInputRow}>
              <TextInput
                style={styles.composerInput}
                value={draft}
                onChangeText={setDraft}
                placeholder="Ask about jobs, skills, or applications…"
                placeholderTextColor="#9AA1AE"
                multiline={false}
                returnKeyType="send"
                onSubmitEditing={() => void handleSend(draft)}
              />
              <Pressable
                disabled={!draft.trim() || busy}
                onPress={() => void handleSend(draft)}
                style={[styles.sendBtn, (!draft.trim() || busy) && styles.sendBtnDisabled]}
                accessibilityLabel="Send message"
              >
                <ArrowUp size={18} color="#FFFFFF" weight="bold" />
              </Pressable>
            </View>
            <View style={styles.composerFooterRow}>
              <View style={styles.composerFooterItem}>
                <ShieldCheck size={11} color="#8A93A3" weight="bold" />
                <Text style={styles.composerFooterText}>You confirm applications</Text>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

function AssistantJobCard({
  job,
  index,
  onPress,
}: {
  job: AssistantReplyJob;
  index?: number;
  onPress: () => void;
}) {
  const isEligible = job.eligibility === 'ELIGIBLE';
  const isPending = job.eligibility === 'SCORE_PENDING';

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.jobCard, pressed && styles.jobCardPressed]}
    >
      <View style={styles.jobCardTop}>
        {index != null && (
          <View style={styles.jobIndexBadge}>
            <Text style={styles.jobIndexText}>{index}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.jobCardTitle} numberOfLines={1}>
            {job.title}
          </Text>
          <Text style={styles.jobCardSub} numberOfLines={1}>
            {job.employer_name || 'Employer'} {job.location ? `· ${job.location}` : ''}
          </Text>
        </View>
        <ArrowRight size={16} color="#5F4DB2" weight="bold" />
      </View>

      {/* Meta tags */}
      <View style={styles.jobMetaRow}>
        {!!job.work_mode && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>{job.work_mode}</Text>
          </View>
        )}
        {job.min_salary_minor != null && (
          <View style={styles.metaBadge}>
            <Text style={styles.metaBadgeText}>
              ₹{(job.min_salary_minor / 100).toLocaleString('en-IN')}+
            </Text>
          </View>
        )}
        <View
          style={[
            styles.eligibilityBadge,
            isEligible ? styles.eligibilityGreen : isPending ? styles.eligibilityYellow : styles.eligibilityGray,
          ]}
        >
          <Text
            style={[
              styles.eligibilityText,
              isEligible ? styles.eligibilityGreenText : isPending ? styles.eligibilityYellowText : styles.eligibilityGrayText,
            ]}
          >
            {isEligible ? 'Eligible' : isPending ? 'Score Pending' : 'Open'}
          </Text>
        </View>
      </View>

      {/* Matched skills */}
      {job.matched_skills && job.matched_skills.length > 0 && (
        <Text style={styles.matchedSkillsText} numberOfLines={1}>
          Matches: {job.matched_skills.slice(0, 3).join(', ')}
        </Text>
      )}
    </Pressable>
  );
}

function AssistantAppCard({
  app,
  onPress,
}: {
  app: AssistantReplyApplication;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.appCard, pressed && styles.jobCardPressed]}
    >
      <View style={styles.appIconBox}>
        <Briefcase size={16} color="#5F4DB2" weight="bold" />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.appCardTitle} numberOfLines={1}>
          {app.job_title || 'Application'}
        </Text>
        <Text style={styles.appCardSub} numberOfLines={1}>
          {app.employer_name || 'Employer'} · Stage: {app.stage}
        </Text>
      </View>
      <ArrowRight size={15} color="#5F4DB2" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFDF9',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEE8E0',
    gap: 12,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.24,
    shadowRadius: 10,
    elevation: 4,
  },
  headerText: {
    flex: 1,
  },
  brandTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: '#8675AE',
    letterSpacing: 1.8,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.4,
    color: '#0A1931',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 3,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#31A66A',
  },
  statusText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#5F6B80',
  },
  headerActionBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyboardContainer: {
    flex: 1,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    padding: 16,
    gap: 16,
  },
  welcomeSection: {
    gap: 18,
    paddingVertical: 4,
  },
  heroCard: {
    backgroundColor: '#5947AD',
    borderRadius: 22,
    padding: 20,
    gap: 10,
    shadowColor: '#3A2B81',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 12,
  },
  heroBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: '#E8DFFF',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  heroTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 23,
    lineHeight: 28,
    letterSpacing: -0.6,
    color: '#FFFFFF',
  },
  heroDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 18,
    color: '#EEE9FF',
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    alignSelf: 'flex-start',
  },
  trustBadgeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 10,
    color: 'rgba(255, 255, 255, 0.9)',
  },
  startersHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  startersHeading: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: '#9B87BD',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
  },
  startersSubheading: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: -0.3,
    color: '#0A1931',
    marginTop: 3,
  },
  startersChoosePrompt: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: '#8B8FA0',
  },
  startersGrid: {
    gap: 10,
  },
  starterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    padding: 12,
    gap: 12,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  starterBtnPressed: {
    backgroundColor: '#FAF7FD',
    borderColor: '#C9B9EC',
  },
  starterIconBox: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterContent: {
    flex: 1,
  },
  starterTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 17,
    color: '#16243A',
  },
  starterDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    color: '#69758A',
    marginTop: 2,
  },
  startersFooterText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 15,
    color: '#7C8596',
    textAlign: 'center',
    marginTop: 6,
    paddingVertical: 4,
  },
  userMsgRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#5F4DB2',
    borderRadius: 19,
    borderBottomRightRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '86%',
    shadowColor: '#4B3B96',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 10,
    elevation: 2,
  },
  userMsgText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 19.5,
    color: '#FFFFFF',
  },
  noteRow: {
    alignItems: 'center',
    marginVertical: 4,
  },
  noteText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F4DB2',
    backgroundColor: '#F1EAF7',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 999,
  },
  assistantMsgBlock: {
    gap: 8,
  },
  botHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  botAvatarSmall: {
    width: 22,
    height: 22,
    borderRadius: 7,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botName: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    letterSpacing: 1.2,
    color: '#8272AD',
    textTransform: 'uppercase',
  },
  botBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 19,
    borderTopLeftRadius: 6,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E9E2F0',
    maxWidth: '92%',
    shadowColor: '#2A1E54',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
  },
  botMsgText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 21,
    color: '#26334B',
  },
  cardsBlock: {
    gap: 8,
    marginTop: 4,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    padding: 12,
    gap: 8,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 6,
    elevation: 1,
  },
  jobCardPressed: {
    backgroundColor: '#FAF8FC',
    borderColor: '#C9BEEB',
  },
  jobCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobIndexBadge: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobIndexText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#5F4DB2',
  },
  jobCardTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 17,
    color: '#0A1931',
  },
  jobCardSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 15,
    color: '#647087',
    marginTop: 2,
  },
  jobMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaBadge: {
    backgroundColor: '#F7F4EC',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  metaBadgeText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 14,
    color: '#526078',
  },
  eligibilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  eligibilityGreen: {
    backgroundColor: '#E6F1EA',
  },
  eligibilityGreenText: {
    color: '#1F6B45',
  },
  eligibilityYellow: {
    backgroundColor: '#F7EFD6',
  },
  eligibilityYellowText: {
    color: '#7A5C0E',
  },
  eligibilityGray: {
    backgroundColor: '#F0ECE6',
  },
  eligibilityGrayText: {
    color: '#6E7787',
  },
  eligibilityText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 10,
  },
  matchedSkillsText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F4DB2',
  },
  applyProposalCard: {
    backgroundColor: '#F1EAF7',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    padding: 14,
    gap: 8,
  },
  applyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  applyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    lineHeight: 16,
    color: '#0A1931',
  },
  applyCompany: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: '#647087',
  },
  applyActionWrap: {
    marginTop: 6,
    gap: 6,
  },
  confirmApplyBtn: {
    backgroundColor: '#5F4DB2',
    paddingVertical: 9,
    paddingHorizontal: 16,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  confirmApplyBtnDone: {
    backgroundColor: '#1F6B45',
  },
  confirmApplyText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    color: '#FFFFFF',
  },
  appliedDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  applyErrorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 11,
    color: '#993A22',
  },
  openExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  openExternalText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    color: '#5F4DB2',
  },
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    padding: 12,
    gap: 10,
  },
  appIconBox: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appCardTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    color: '#0A1931',
  },
  appCardSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    color: '#647087',
    marginTop: 2,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  suggestionChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 999,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  suggestionText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F4DB2',
  },
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginTop: 4,
  },
  showMoreText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 15,
    color: '#5F4DB2',
  },
  thinkingRow: {
    paddingVertical: 4,
  },
  errorBanner: {
    backgroundColor: '#FFF5F2',
    borderWidth: 1,
    borderColor: '#E9C7BF',
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  errorBannerText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#8D3926',
  },
  retryBtn: {
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    color: '#8D3926',
    textDecorationLine: 'underline',
  },
  composerBar: {
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 14 : 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EEE8E0',
    gap: 8,
  },
  composerInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFEFF',
    borderWidth: 1,
    borderColor: '#DCD4EB',
    borderRadius: 19,
    paddingHorizontal: 12,
    paddingVertical: 4,
    gap: 8,
    shadowColor: '#372869',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
  composerInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 19,
    color: '#0A1931',
    paddingVertical: 8,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 13,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.22,
    shadowRadius: 6,
    elevation: 3,
  },
  sendBtnDisabled: {
    opacity: 0.4,
    shadowOpacity: 0,
  },
  composerFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingHorizontal: 4,
  },
  composerFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  composerFooterText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 10,
    color: '#8A93A3',
  },
});
