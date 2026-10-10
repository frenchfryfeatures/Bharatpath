/**
 * BharatPath - CollegeScreen
 *
 * Candidate-facing College section:
 * - Campus link hero banner with Linked, Invitations, College Seat stats
 * - Link with a 12-character Crockford code (XXXX-XXXX-XXXX)
 * - College invitations (Accept / Decline)
 * - Linked colleges list with visibility tracking (Linked → Counted → Seen by name)
 * - Individual visibility toggling and college disconnection
 * - Consent terms dialog before linking, accepting invitations, or sharing by name
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
  Modal,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  GraduationCap,
  Link,
  EnvelopeSimple,
  ShieldCheck,
  Buildings,
  Users,
  ArrowRight,
  Check,
  Eye,
  EyeSlash,
  Sparkle,
  X,
} from 'phosphor-react-native';
import { Colors, Layout, Spacing } from '@/theme/tokens';
import { AppAlert } from '@/components/feedback/AppAlert';
import { ApiError } from '@/services/api/client';
import {
  getStudentCollegeLinks,
  getCollegeConsentTerms,
  linkCollegeByReferral,
  getCollegeInvitations,
  acceptCollegeInvitation,
  declineCollegeInvitation,
  grantCollegeIndividualVisibility,
  revokeCollegeConsent,
  consolidateCollegeLinks,
  collegeMonogram,
  daysUntilExpiry,
} from '@/services/api/college';
import {
  CollegeConsentScope,
  CollegeLinkResponse,
  CandidateInvitationResponse,
  ConsentTermsResponse,
  LinkedCollege,
} from '@/types/college';

type PendingConsent =
  | { kind: 'link'; code: string }
  | { kind: 'accept'; invitationId: string; college: string }
  | { kind: 'individual'; collegeId: string; college: string };

export interface CollegeScreenProps {
  onBack?: () => void;
}

export function CollegeScreen({ onBack }: CollegeScreenProps) {
  const [links, setLinks] = useState<CollegeLinkResponse[]>([]);
  const [invitations, setInvitations] = useState<CandidateInvitationResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [code, setCode] = useState('');
  const [pending, setPending] = useState<PendingConsent | null>(null);
  const [disconnecting, setDisconnecting] = useState<LinkedCollege | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consent terms state
  const [terms, setTerms] = useState<ConsentTermsResponse | null>(null);
  const [termsLoading, setTermsLoading] = useState(false);
  const [termsError, setTermsError] = useState<string | null>(null);

  // Load links and invitations
  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [linksData, invitesData] = await Promise.all([
        getStudentCollegeLinks().catch((err) => {
          console.warn('Failed to load college links:', err);
          return [] as CollegeLinkResponse[];
        }),
        getCollegeInvitations().catch((err) => {
          console.warn('Failed to load college invitations:', err);
          return [] as CandidateInvitationResponse[];
        }),
      ]);
      setLinks(linksData || []);
      setInvitations(invitesData || []);
    } catch (err) {
      setError('Could not load college information.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Load consent terms whenever a pending consent action begins
  useEffect(() => {
    if (!pending) {
      setTerms(null);
      setTermsError(null);
      return;
    }
    const scope: CollegeConsentScope =
      pending.kind === 'individual' ? 'INDIVIDUAL' : 'ROSTER';

    let active = true;
    setTermsLoading(true);
    setTermsError(null);

    getCollegeConsentTerms(scope)
      .then((res) => {
        if (active) setTerms(res);
      })
      .catch((err) => {
        if (active) {
          setTermsError('The consent terms could not be loaded. Please try again.');
        }
      })
      .finally(() => {
        if (active) setTermsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [pending]);

  // Grouped active linked colleges
  const colleges = useMemo<LinkedCollege[]>(() => {
    return consolidateCollegeLinks(links);
  }, [links]);

  const inviteCount = invitations.length;
  const seated = colleges.some((c) => c.seatHeld);

  // Format Crockford code
  const handleCodeChange = (text: string) => {
    const raw = text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
    setCode(raw);
  };

  const formattedCode = useMemo(() => {
    const p1 = code.slice(0, 4);
    const p2 = code.slice(4, 8);
    const p3 = code.slice(8, 12);
    return [p1, p2, p3].filter(Boolean).join('-');
  }, [code]);

  const submitCode = () => {
    if (code.length === 12) {
      setError(null);
      setPending({ kind: 'link', code: formattedCode });
    }
  };

  // Run asynchronous mutation
  const runAction = async (action: () => Promise<unknown>, successMsg: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      AppAlert.alert('Success', successMsg);
      setPending(null);
      setDisconnecting(null);
      await loadData();
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.problem.title || err.code
          : err instanceof Error
            ? err.message
            : 'That did not go through. Please try again.';
      setError(msg);
      AppAlert.alert('Could not complete', msg);
    } finally {
      setBusy(false);
    }
  };

  // Confirm pending consent
  const handleConfirmConsent = () => {
    if (!pending || !terms) return;
    const consentVersion = terms.consent_version;

    if (pending.kind === 'link') {
      const entered = pending.code;
      void runAction(async () => {
        await linkCollegeByReferral(entered, consentVersion);
        setCode('');
      }, 'College linked successfully.');
    } else if (pending.kind === 'accept') {
      void runAction(async () => {
        await acceptCollegeInvitation(pending.invitationId, consentVersion);
      }, 'Invitation accepted.');
    } else {
      void runAction(async () => {
        await grantCollegeIndividualVisibility(pending.collegeId, consentVersion);
      }, 'Your college can now see your profile by name.');
    }
  };

  // Decline invitation
  const handleDeclineInvitation = (invitationId: string) => {
    AppAlert.alert(
      'Decline invitation?',
      'Are you sure you want to decline this college invitation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => {
            void runAction(async () => {
              await declineCollegeInvitation(invitationId);
            }, 'Invitation declined.');
          },
        },
      ],
    );
  };

  // Stop sharing by name
  const handleStopSharingByName = (collegeId: string) => {
    void runAction(async () => {
      await revokeCollegeConsent(collegeId, 'INDIVIDUAL');
    }, 'Your college can no longer see you by name.');
  };

  // Disconnect college
  const handleConfirmDisconnect = () => {
    if (!disconnecting) return;
    void runAction(async () => {
      await revokeCollegeConsent(disconnecting.collegeId, 'ROSTER');
    }, 'You are disconnected from the college.');
  };

  const consentTitle =
    pending?.kind === 'link'
      ? 'Link this college?'
      : pending?.kind === 'accept'
        ? `Accept invitation from ${pending.college}?`
        : pending
          ? `Let ${pending.college} see you by name?`
          : '';

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Top Bar */}
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Back"
            >
              <ArrowLeft size={16} color={Colors.navy} weight="bold" />
            </Pressable>
            <Text style={styles.topBarTitle}>College</Text>
          </View>

          {/* Hero Banner */}
          <View style={styles.heroCard}>
            <View style={styles.heroBadgeRow}>
              <View style={styles.heroBadgePill}>
                <GraduationCap size={14} color="#5F4DB2" weight="bold" />
                <Text style={styles.heroBadgeText}>CAMPUS LINK</Text>
              </View>
            </View>

            <Text style={styles.heroHeadline}>
              Connect with your college{'\n'}
              <Text style={styles.heroHeadlineAccent}>
                and choose what it sees.
              </Text>
            </Text>

            <Text style={styles.heroDescription}>
              Use the code your college gave you or accept their invitation.
              Linking lets your college count you in its totals; seeing your
              profile by name is a separate choice you can switch on or off,
              and you can disconnect at any time.
            </Text>

            {/* 3 Metric Tiles */}
            <View style={styles.heroStatsRow}>
              <View style={styles.heroStatTile}>
                <Link size={16} color="#5F4DB2" weight="bold" />
                <Text style={styles.heroStatValue} numberOfLines={1}>
                  {colleges.length}
                </Text>
                <Text
                  style={styles.heroStatLabel}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  LINKED
                </Text>
              </View>

              <View style={styles.heroStatTile}>
                <EnvelopeSimple size={16} color="#5F4DB2" weight="bold" />
                <Text style={styles.heroStatValue} numberOfLines={1}>
                  {inviteCount}
                </Text>
                <Text
                  style={styles.heroStatLabel}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  INVITATIONS
                </Text>
              </View>

              <View style={styles.heroStatTile}>
                <ShieldCheck size={16} color="#5F4DB2" weight="bold" />
                <Text style={styles.heroStatValue} numberOfLines={1}>
                  {seated ? 'Yes' : 'No'}
                </Text>
                <Text
                  style={styles.heroStatLabel}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.7}
                >
                  COLLEGE SEAT
                </Text>
              </View>
            </View>
          </View>

          {/* Card: Link with a Code */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Link size={15} color="#68758A" weight="bold" />
              <Text style={styles.sectionHeaderTitle}>LINK WITH A CODE</Text>
            </View>
            <Text style={styles.sectionHeaderSub}>
              Your college gives you a 12-character code. Type or paste it below.
            </Text>

            <View style={styles.codeInputContainer}>
              <TextInput
                value={formattedCode}
                onChangeText={handleCodeChange}
                placeholder="XXXX-XXXX-XXXX"
                placeholderTextColor="#B9B2A0"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={14}
                style={styles.codeTextInput}
                accessibilityLabel="College referral code"
              />
            </View>

            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (code.length !== 12 || busy) && styles.buttonDisabled,
                pressed && styles.buttonPressed,
              ]}
              disabled={code.length !== 12 || busy}
              onPress={submitCode}
              accessibilityRole="button"
            >
              <Text style={styles.primaryButtonText}>Continue</Text>
              <ArrowRight size={15} color="#FFFFFF" weight="bold" />
            </Pressable>
          </View>

          {/* Card: Invitations */}
          <View style={styles.card}>
            <View style={styles.sectionHeaderRow}>
              <Users size={15} color="#68758A" weight="bold" />
              <Text style={styles.sectionHeaderTitle}>INVITATIONS</Text>
            </View>

            {loading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="small" color="#5F4DB2" />
              </View>
            ) : inviteCount === 0 ? (
              <View style={styles.emptyNoticeBox}>
                <Text style={styles.emptyNoticeText}>
                  Nothing waiting. Invitations from your college will appear here.
                </Text>
              </View>
            ) : (
              <View style={styles.invitationsList}>
                {invitations.map((item) => {
                  const daysLeft = daysUntilExpiry(item.expires_at);
                  const expiryText =
                    daysLeft > 0
                      ? `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`
                      : 'expires today';

                  return (
                    <View key={item.id} style={styles.invitationItem}>
                      <View style={styles.invitationHeader}>
                        <View style={styles.invitationMonogram}>
                          <Text style={styles.invitationMonogramText}>
                            {collegeMonogram(item.college_name)}
                          </Text>
                        </View>
                        <View style={styles.invitationInfo}>
                          <Text style={styles.invitationTitle} numberOfLines={1}>
                            {item.college_name}
                          </Text>
                          <Text style={styles.invitationMeta}>
                            Sent {formatSimpleDate(item.sent_at)} · {expiryText}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.invitationButtonsRow}>
                        <Pressable
                          style={({ pressed }) => [
                            styles.invitationAcceptButton,
                            busy && styles.buttonDisabled,
                            pressed && styles.buttonPressed,
                          ]}
                          disabled={busy}
                          onPress={() =>
                            setPending({
                              kind: 'accept',
                              invitationId: item.id,
                              college: item.college_name,
                            })
                          }
                          accessibilityRole="button"
                        >
                          <Text style={styles.invitationAcceptButtonText}>
                            Accept
                          </Text>
                        </Pressable>

                        <Pressable
                          style={({ pressed }) => [
                            styles.invitationDeclineButton,
                            busy && styles.buttonDisabled,
                            pressed && styles.buttonPressed,
                          ]}
                          disabled={busy}
                          onPress={() => handleDeclineInvitation(item.id)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.invitationDeclineButtonText}>
                            Decline
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </View>

          {/* Section: Linked Colleges */}
          <View style={styles.sectionWrapper}>
            <View style={styles.sectionHeaderRow}>
              <Buildings size={15} color="#68758A" weight="bold" />
              <Text style={styles.sectionHeaderTitle}>LINKED COLLEGES</Text>
            </View>

            {loading ? (
              <View style={styles.centerLoading}>
                <ActivityIndicator size="small" color="#5F4DB2" />
              </View>
            ) : colleges.length === 0 ? (
              <View style={styles.emptyDashedCard}>
                <View style={styles.emptyIconCircle}>
                  <GraduationCap size={28} color="#5F4DB2" weight="duotone" />
                </View>
                <Text style={styles.emptyTitle}>No college linked yet</Text>
                <Text style={styles.emptySubtitle}>
                  Type the code from your college above, or accept an invitation
                  when one arrives.
                </Text>
              </View>
            ) : (
              <View style={styles.collegesList}>
                {colleges.map((college) => (
                  <View key={college.collegeId} style={styles.collegeCard}>
                    {/* Left vertical color accent bar */}
                    <View style={styles.collegeCardAccent} />

                    <View style={styles.collegeCardContent}>
                      {/* Top Header */}
                      <View style={styles.collegeCardHeader}>
                        <View style={styles.collegeMonogramBadge}>
                          <Text style={styles.collegeMonogramText}>
                            {collegeMonogram(college.name)}
                          </Text>
                        </View>
                        <View style={styles.collegeInfoCol}>
                          <Text style={styles.collegeNameText} numberOfLines={1}>
                            {college.name}
                          </Text>
                          <Text style={styles.collegeSinceText}>
                            Linked since {formatSimpleDate(college.since)}
                          </Text>
                        </View>
                      </View>

                      {/* College seat held badge */}
                      {college.seatHeld && (
                        <View style={styles.seatBadgePill}>
                          <Sparkle size={13} color="#1F6B45" weight="fill" />
                          <Text style={styles.seatBadgeText}>
                            Seat paid by college
                          </Text>
                        </View>
                      )}

                      {/* Visibility Steps (Linked -> Counted -> Seen by name) */}
                      <View style={styles.visibilityStepsBox}>
                        <VisibilityStepRow
                          number={1}
                          label="Linked"
                          note="You and your college are connected"
                          done={true}
                        />
                        <View style={styles.stepConnector} />
                        <VisibilityStepRow
                          number={2}
                          label="Counted"
                          note="In cohort totals, with no name"
                          done={true}
                        />
                        <View style={styles.stepConnector} />
                        <VisibilityStepRow
                          number={3}
                          label="Seen by name"
                          note="Your college can open your profile"
                          done={college.byName}
                        />
                      </View>

                      {/* Action buttons */}
                      <View style={styles.collegeActionsRow}>
                        {college.byName ? (
                          <Pressable
                            style={({ pressed }) => [
                              styles.secondaryActionButton,
                              busy && styles.buttonDisabled,
                              pressed && styles.buttonPressed,
                            ]}
                            disabled={busy}
                            onPress={() =>
                              handleStopSharingByName(college.collegeId)
                            }
                            accessibilityRole="button"
                          >
                            <EyeSlash size={14} color="#3A4761" weight="bold" />
                            <Text style={styles.secondaryActionText}>
                              Stop sharing by name
                            </Text>
                          </Pressable>
                        ) : (
                          <Pressable
                            style={({ pressed }) => [
                              styles.secondaryActionButton,
                              busy && styles.buttonDisabled,
                              pressed && styles.buttonPressed,
                            ]}
                            disabled={busy}
                            onPress={() =>
                              setPending({
                                kind: 'individual',
                                collegeId: college.collegeId,
                                college: college.name,
                              })
                            }
                            accessibilityRole="button"
                          >
                            <Eye size={14} color="#3A4761" weight="bold" />
                            <Text style={styles.secondaryActionText}>
                              Share by name
                            </Text>
                          </Pressable>
                        )}

                        <Pressable
                          style={({ pressed }) => [
                            styles.disconnectButton,
                            busy && styles.buttonDisabled,
                            pressed && styles.buttonPressed,
                          ]}
                          disabled={busy}
                          onPress={() => setDisconnecting(college)}
                          accessibilityRole="button"
                        >
                          <Text style={styles.disconnectButtonText}>
                            Disconnect
                          </Text>
                        </Pressable>
                      </View>
                    </View>
                  </View>
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>

      {/* Consent Modal Dialog */}
      <Modal
        visible={Boolean(pending)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setPending(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>{consentTitle}</Text>
              {!busy && (
                <Pressable
                  onPress={() => setPending(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={20} color="#5F6B80" weight="bold" />
                </Pressable>
              )}
            </View>

            <Text style={styles.modalEyebrow}>READ BEFORE YOU AGREE</Text>

            <View style={styles.modalTermsBox}>
              {termsLoading ? (
                <View style={styles.termsLoadingRow}>
                  <ActivityIndicator size="small" color="#5F4DB2" />
                  <Text style={styles.termsLoadingText}>
                    Loading consent terms…
                  </Text>
                </View>
              ) : termsError ? (
                <Text style={styles.termsErrorText}>{termsError}</Text>
              ) : (
                <ScrollView
                  style={styles.termsScroll}
                  showsVerticalScrollIndicator={true}
                >
                  <Text style={styles.termsBodyText}>
                    {terms?.text || 'Consent terms unavailable.'}
                  </Text>
                </ScrollView>
              )}
            </View>

            {error && (
              <View style={styles.modalErrorBanner}>
                <Text style={styles.modalErrorText}>{error}</Text>
              </View>
            )}

            <View style={styles.modalButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCancelButton,
                  pressed && styles.buttonPressed,
                ]}
                disabled={busy}
                onPress={() => setPending(null)}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalAgreeButton,
                  (busy || !terms) && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                disabled={busy || !terms}
                onPress={handleConfirmConsent}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalAgreeText}>Agree</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* Disconnect Confirmation Dialog */}
      <Modal
        visible={Boolean(disconnecting)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!busy) setDisconnecting(null);
        }}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeaderRow}>
              <Text style={styles.modalTitle}>
                Disconnect from {disconnecting?.name}?
              </Text>
              {!busy && (
                <Pressable
                  onPress={() => setDisconnecting(null)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <X size={20} color="#5F6B80" weight="bold" />
                </Pressable>
              )}
            </View>

            <Text style={styles.disconnectDescText}>
              Your college will stop counting you and can no longer see your
              details.
              {disconnecting?.seatHeld
                ? ' Your college seat will be released, so you may lose access unless you have a membership.'
                : ''}
            </Text>

            <View style={styles.modalButtonsRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.modalCancelButton,
                  pressed && styles.buttonPressed,
                ]}
                disabled={busy}
                onPress={() => setDisconnecting(null)}
                accessibilityRole="button"
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.modalDestructiveButton,
                  busy && styles.buttonDisabled,
                  pressed && styles.buttonPressed,
                ]}
                disabled={busy}
                onPress={handleConfirmDisconnect}
                accessibilityRole="button"
              >
                {busy ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Text style={styles.modalDestructiveText}>Disconnect</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Step Row Component
// ---------------------------------------------------------------------------

function VisibilityStepRow({
  number,
  label,
  note,
  done,
}: {
  number: number;
  label: string;
  note: string;
  done: boolean;
}) {
  return (
    <View style={styles.stepRow}>
      <View
        style={[
          styles.stepIconBadge,
          done ? styles.stepIconBadgeDone : styles.stepIconBadgePending,
        ]}
      >
        {done ? (
          <Check size={12} color="#FFFFFF" weight="bold" />
        ) : (
          <Text style={styles.stepNumberText}>{number}</Text>
        )}
      </View>
      <View style={styles.stepInfoCol}>
        <Text
          style={[
            styles.stepLabelText,
            done ? styles.stepLabelTextActive : styles.stepLabelTextInactive,
          ]}
        >
          {label}
        </Text>
        <Text style={styles.stepNoteText}>{note}</Text>
      </View>
    </View>
  );
}

function formatSimpleDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl + 20,
    gap: 16,
    flexGrow: 1,
    maxWidth: Layout.maxContentWidth,
    width: '100%',
    alignSelf: 'center',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    justifyContent: 'center',
    alignItems: 'center',
  },
  topBarTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    lineHeight: 22,
    color: Colors.navy,
  },
  buttonPressed: {
    transform: [{ scale: 0.98 }],
    opacity: 0.9,
  },
  buttonDisabled: {
    opacity: 0.5,
  },

  // Hero Card
  heroCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 18,
    gap: 12,
  },
  heroBadgeRow: {
    flexDirection: 'row',
  },
  heroBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F0FB',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  heroBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 1.2,
    color: '#5F4DB2',
  },
  heroHeadline: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 24,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  heroHeadlineAccent: {
    color: '#5F4DB2',
  },
  heroDescription: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#5F6B80',
  },
  heroStatsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 6,
  },
  heroStatTile: {
    flex: 1,
    backgroundColor: '#FBF8F1',
    borderWidth: 1,
    borderColor: '#EFE9DC',
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 10,
    justifyContent: 'space-between',
    minHeight: 82,
  },
  heroStatValue: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 21,
    lineHeight: 25,
    letterSpacing: -0.4,
    color: Colors.navy,
    marginTop: 2,
    marginBottom: 2,
  },
  heroStatLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.1,
    color: '#68758A',
  },

  // Standard Card
  card: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 24,
    padding: 20,
    gap: 12,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionHeaderTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    color: '#68758A',
  },
  sectionHeaderSub: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#68758A',
  },

  // Code input
  codeInputContainer: {
    marginTop: 4,
  },
  codeTextInput: {
    height: 56,
    backgroundColor: '#FFFCF7',
    borderWidth: 1,
    borderColor: '#D9D2C3',
    borderRadius: 16,
    paddingHorizontal: 16,
    textAlign: 'center',
    fontFamily: Platform.select({
      ios: 'SpaceMono-Bold',
      android: 'SpaceMono-Bold',
      default: 'monospace',
    }),
    fontSize: 19,
    letterSpacing: 2.5,
    color: '#2D2466',
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    height: 48,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
    marginTop: 4,
  },
  primaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#FFFFFF',
  },

  // Invitations
  invitationsList: {
    gap: 12,
    marginTop: 4,
  },
  invitationItem: {
    backgroundColor: '#FFFCF7',
    borderWidth: 1,
    borderColor: '#EFE9DC',
    borderRadius: 16,
    padding: 14,
    gap: 12,
  },
  invitationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  invitationMonogram: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F4F1FC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationMonogramText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#5F4DB2',
  },
  invitationInfo: {
    flex: 1,
    gap: 2,
  },
  invitationTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 18,
    color: Colors.navy,
  },
  invitationMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11.5,
    color: '#68758A',
  },
  invitationButtonsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  invitationAcceptButton: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationAcceptButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  invitationDeclineButton: {
    flex: 1,
    height: 38,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D9D2C3',
    justifyContent: 'center',
    alignItems: 'center',
  },
  invitationDeclineButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#3A4761',
  },

  // Linked Colleges
  sectionWrapper: {
    gap: 12,
  },
  emptyDashedCard: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D9D2C3',
    backgroundColor: '#FFFCF7',
    borderRadius: 24,
    paddingVertical: 36,
    paddingHorizontal: 20,
    alignItems: 'center',
    gap: 8,
  },
  emptyIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#F4F1FC',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 4,
  },
  emptyTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: Colors.navy,
  },
  emptySubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: '#68758A',
    textAlign: 'center',
    maxWidth: 280,
  },
  emptyNoticeBox: {
    backgroundColor: '#FBF8F1',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    marginTop: 4,
  },
  emptyNoticeText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#68758A',
    textAlign: 'center',
  },
  collegesList: {
    gap: 14,
  },
  collegeCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 24,
    overflow: 'hidden',
    position: 'relative',
  },
  collegeCardAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: '#5F4DB2',
  },
  collegeCardContent: {
    padding: 18,
    paddingLeft: 22,
    gap: 12,
  },
  collegeCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  collegeMonogramBadge: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#5F4DB2',
    justifyContent: 'center',
    alignItems: 'center',
  },
  collegeMonogramText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  collegeInfoCol: {
    flex: 1,
    gap: 2,
  },
  collegeNameText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 18,
    lineHeight: 22,
    letterSpacing: -0.3,
    color: Colors.navy,
  },
  collegeSinceText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#68758A',
  },
  seatBadgePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EEF7F1',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
  },
  seatBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11.5,
    color: '#1F6B45',
  },

  // Visibility Steps Track
  visibilityStepsBox: {
    backgroundColor: '#FBF8F1',
    borderRadius: 16,
    padding: 12,
    gap: 8,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  stepConnector: {
    width: 1,
    height: 6,
    backgroundColor: '#DDD6C7',
    marginLeft: 11,
  },
  stepIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 1,
  },
  stepIconBadgeDone: {
    backgroundColor: '#5F4DB2',
  },
  stepIconBadgePending: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BDB4A0',
    backgroundColor: 'transparent',
  },
  stepNumberText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    color: '#8A8472',
  },
  stepInfoCol: {
    flex: 1,
    gap: 1,
  },
  stepLabelText: {
    fontSize: 13,
  },
  stepLabelTextActive: {
    fontFamily: 'GeneralSans-Bold',
    color: Colors.navy,
  },
  stepLabelTextInactive: {
    fontFamily: 'GeneralSans-Bold',
    color: '#8A8472',
  },
  stepNoteText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11.5,
    lineHeight: 15,
    color: '#68758A',
  },

  // College Actions Row
  collegeActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginTop: 2,
  },
  secondaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D9D2C3',
    backgroundColor: '#FFFFFF',
  },
  secondaryActionText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12.5,
    color: '#3A4761',
  },
  disconnectButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  disconnectButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12.5,
    color: '#DC2626',
  },

  // Modal Dialogs
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(19, 26, 38, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 24,
    gap: 14,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 8 },
        shadowOpacity: 0.15,
        shadowRadius: 20,
      },
      android: {
        elevation: 8,
      },
    }),
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  modalTitle: {
    flex: 1,
    fontFamily: 'GeneralSans-Bold',
    fontSize: 18,
    lineHeight: 24,
    letterSpacing: -0.3,
    color: Colors.navy,
  },
  modalEyebrow: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#8A8472',
  },
  modalTermsBox: {
    backgroundColor: '#FFFCF7',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    padding: 14,
    maxHeight: 220,
  },
  termsScroll: {
    maxHeight: 200,
  },
  termsBodyText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 20,
    color: '#3A4761',
  },
  termsLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 20,
  },
  termsLoadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#5F6B80',
  },
  termsErrorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: '#DC2626',
    textAlign: 'center',
  },
  modalErrorBanner: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    padding: 10,
  },
  modalErrorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#DC2626',
  },
  modalButtonsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalCancelButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D9D2C3',
    backgroundColor: '#FFFFFF',
  },
  modalCancelText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#3A4761',
  },
  modalAgreeButton: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#5F4DB2',
    minWidth: 80,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAgreeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  modalDestructiveButton: {
    paddingHorizontal: 22,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: '#DC2626',
    minWidth: 90,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalDestructiveText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  disconnectDescText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13.5,
    lineHeight: 20,
    color: '#3A4761',
  },
  centerLoading: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
