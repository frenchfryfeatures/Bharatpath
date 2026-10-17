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

                <Text style={styles.startersHeading}>GET STARTED</Text>
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
    backgroundColor: '#FAF8F5',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EDE7DE',
    gap: 12,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  headerText: {
    flex: 1,
  },
  brandTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A92A6',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0A1931',
    letterSpacing: -0.2,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#31A66A',
  },
  statusText: {
    fontSize: 11,
    color: '#5F6B80',
    fontWeight: '500',
  },
  headerActionBtn: {
    padding: 8,
    borderRadius: 10,
    backgroundColor: '#F3EEFB',
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
    gap: 16,
    paddingVertical: 8,
  },
  heroCard: {
    backgroundColor: '#5F4DB2',
    borderRadius: 20,
    padding: 20,
    gap: 8,
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.6,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: -0.4,
    lineHeight: 28,
  },
  heroDesc: {
    fontSize: 13,
    lineHeight: 18,
    color: '#EDE8F8',
  },
  trustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  trustBadgeText: {
    fontSize: 11,
    color: '#FFFFFF',
    fontWeight: '600',
  },
  startersHeading: {
    fontSize: 11,
    fontWeight: '800',
    color: '#8A92A6',
    letterSpacing: 0.8,
    marginTop: 6,
  },
  startersGrid: {
    gap: 10,
  },
  starterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    padding: 14,
    gap: 12,
  },
  starterBtnPressed: {
    backgroundColor: '#F7F3FC',
    borderColor: '#C9BEEB',
  },
  starterIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#EDE8F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  starterContent: {
    flex: 1,
  },
  starterTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  starterDesc: {
    fontSize: 12,
    color: '#647087',
    marginTop: 2,
  },
  userMsgRow: {
    alignItems: 'flex-end',
  },
  userBubble: {
    backgroundColor: '#5F4DB2',
    borderRadius: 18,
    borderTopRightRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 11,
    maxWidth: '82%',
  },
  userMsgText: {
    fontSize: 14,
    lineHeight: 20,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  noteRow: {
    alignItems: 'center',
    marginVertical: 4,
  },
  noteText: {
    backgroundColor: '#EDE8F8',
    color: '#5F4DB2',
    fontSize: 12,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 14,
  },
  assistantMsgBlock: {
    gap: 10,
  },
  botHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  botAvatarSmall: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  botName: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F4DB2',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  botBubble: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    maxWidth: '92%',
  },
  botMsgText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#0A1931',
  },
  cardsBlock: {
    gap: 8,
    marginTop: 4,
  },
  jobCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    padding: 12,
    gap: 8,
  },
  jobCardPressed: {
    backgroundColor: '#FAF7FD',
    borderColor: '#C9BEEB',
  },
  jobCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  jobIndexBadge: {
    width: 24,
    height: 24,
    borderRadius: 6,
    backgroundColor: '#EDE8F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  jobIndexText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#5F4DB2',
  },
  jobCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  jobCardSub: {
    fontSize: 12,
    color: '#647087',
    marginTop: 1,
  },
  jobMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  metaBadge: {
    backgroundColor: '#F3EEFB',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  metaBadgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  eligibilityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  eligibilityGreen: {
    backgroundColor: '#E6F8EE',
  },
  eligibilityGreenText: {
    color: '#1B834E',
  },
  eligibilityYellow: {
    backgroundColor: '#FFF8E6',
  },
  eligibilityYellowText: {
    color: '#A17006',
  },
  eligibilityGray: {
    backgroundColor: '#F0ECE6',
  },
  eligibilityGrayText: {
    color: '#6E7787',
  },
  eligibilityText: {
    fontSize: 10,
    fontWeight: '700',
  },
  matchedSkillsText: {
    fontSize: 11,
    color: '#5F4DB2',
    fontWeight: '600',
  },
  applyProposalCard: {
    backgroundColor: '#FAF5FF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#C9BEEB',
    padding: 14,
    gap: 8,
  },
  applyHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  applyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
  },
  applyCompany: {
    fontSize: 12,
    color: '#647087',
  },
  applyActionWrap: {
    marginTop: 6,
    gap: 6,
  },
  confirmApplyBtn: {
    backgroundColor: '#5F4DB2',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmApplyBtnDone: {
    backgroundColor: '#31A66A',
  },
  confirmApplyText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  appliedDoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  applyErrorText: {
    fontSize: 12,
    color: '#C93B2B',
  },
  openExternalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 4,
  },
  openExternalText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  appCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E8E1D7',
    padding: 12,
    gap: 10,
  },
  appIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EDE8F8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  appCardTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0A1931',
  },
  appCardSub: {
    fontSize: 11,
    color: '#647087',
    marginTop: 1,
  },
  suggestionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  suggestionChip: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#C9BEEB',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  suggestionText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  showMoreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 14,
    marginTop: 4,
  },
  showMoreText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#5F4DB2',
  },
  thinkingRow: {
    paddingVertical: 4,
  },
  errorBanner: {
    backgroundColor: '#FFF0EE',
    borderWidth: 1,
    borderColor: '#F8B4A6',
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  errorBannerText: {
    fontSize: 13,
    color: '#9E2A1A',
  },
  retryBtn: {
    alignSelf: 'flex-start',
  },
  retryBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#9E2A1A',
    textDecorationLine: 'underline',
  },
  composerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1,
    borderTopColor: '#EDE7DE',
    gap: 10,
  },
  composerInput: {
    flex: 1,
    backgroundColor: '#FAF8F5',
    borderWidth: 1,
    borderColor: '#DED5C9',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 9,
    fontSize: 14,
    color: '#0A1931',
    maxHeight: 100,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.45,
  },
});
