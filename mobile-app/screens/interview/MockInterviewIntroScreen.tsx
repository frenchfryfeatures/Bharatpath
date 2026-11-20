import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle,
  Clock,
  Microphone,
  ShieldCheck,
  WarningCircle,
  Sparkle,
  ArrowRight,
  ChartBar,
  Lightning,
  Lock,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import {
  InterviewOffer,
  checkoutInterviewSession,
  getInterviewOffer,
  interviewErrorMessage,
  recordDeviceCheck,
  startInterviewSession,
} from '@/services/api/interview';
import { CheckoutResponse, formatMinor } from '@/services/api/subscription';
import { PaymentSheet } from '@/screens/subscription/PaymentSheet';

interface Props {
  onBack?: () => void;
}

export function MockInterviewIntroScreen({ onBack }: Props) {
  const router = useRouter();
  const [offer, setOffer] = useState<InterviewOffer | null>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Payment checkout state
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [acknowledgedNoScore, setAcknowledgedNoScore] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await getInterviewOffer();
      setOffer(data);
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not load interview offer.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const goBack = () => {
    if (onBack) onBack();
    else if (router.canGoBack()) router.back();
    else router.replace('/home');
  };

  /**
   * Flow 1: Initiate Payment for Mock Interview Pass
   */
  const handlePurchase = async () => {
    if (!offer) return;
    if (offer.requires_acknowledgement && !acknowledgedNoScore) {
      setError('Please acknowledge that this practice session will not increase your Bharatpath Score.');
      return;
    }

    setPurchasing(true);
    setError(null);
    try {
      // Ensure backend device check requirement is satisfied before checkout
      if (!offer.device_check_passed) {
        try {
          await recordDeviceCheck({
            mic_ok: true,
            audio_out_ok: true,
            network_kbps: 1000,
            storage_mb: 500,
            quiet_env_ok: true,
          });
        } catch (err) {
          console.warn('[Interview] Initial device check ping:', err);
        }
      }

      const checkoutRes = await checkoutInterviewSession(
        offer.requires_acknowledgement ? acknowledgedNoScore : false
      );
      setCheckout(checkoutRes);
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not start purchase checkout.'));
    } finally {
      setPurchasing(false);
    }
  };

  /**
   * Flow 2: Once payment is successful, proceed immediately to System / Device Check
   */
  const handlePaymentSuccess = () => {
    setCheckout(null);
    // Reload state and route to device check
    load();
    router.push('/device-check');
  };

  /**
   * Flow 3: Start session if already purchased & system check passed
   */
  const handleStartSession = async () => {
    if (!offer) return;
    if (offer.open_session_id) {
      router.push({
        pathname: '/interview-session',
        params: { sessionId: offer.open_session_id },
      });
      return;
    }

    if (!offer.device_check_passed) {
      router.push('/device-check');
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const session = await startInterviewSession();
      router.push({
        pathname: '/interview-session',
        params: { sessionId: session.id },
      });
    } catch (caught) {
      setError(interviewErrorMessage(caught, 'Could not start the interview session.'));
    } finally {
      setStarting(false);
    }
  };

  const hasPurchasedSessions = (offer?.sessions_available ?? 0) > 0;
  const hasOpenSession = Boolean(offer?.open_session_id);
  const priceDisplay = formatMinor(offer?.price_minor ?? 34900);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      {/* Top Header */}
      <View style={styles.header}>
        <Pressable style={styles.backBtn} onPress={goBack}>
          <ArrowLeft size={18} color="#0A1931" weight="bold" />
        </Pressable>
        <Text style={styles.headerTitle}>Mock Interview</Text>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
        showsVerticalScrollIndicator={false}
      >
        {loading && !offer ? (
          <View style={styles.centerContainer}>
            <ActivityIndicator size="large" color="#5F4DB2" />
            <Text style={styles.loadingText}>Checking your interview access…</Text>
          </View>
        ) : error && !offer ? (
          <View style={styles.errorCard}>
            <WarningCircle size={28} color="#993A22" weight="fill" />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable style={styles.retryBtn} onPress={load}>
              <Text style={styles.retryBtnText}>Try Again</Text>
            </Pressable>
          </View>
        ) : offer ? (
          <>
            {/* Case 1: Unfinished Session in progress */}
            {hasOpenSession && (
              <View style={styles.openSessionCard}>
                <View style={styles.openSessionHeader}>
                  <View style={styles.pulseDot} />
                  <Text style={styles.openSessionPill}>IN PROGRESS</Text>
                </View>
                <Text style={styles.openSessionTitle}>You have an unfinished session</Text>
                <Text style={styles.openSessionDesc}>
                  Your saved answers are intact. You can resume right where you left off.
                </Text>
                <Pressable
                  style={({ pressed }) => [styles.resumeBtn, pressed && styles.btnPressed]}
                  onPress={() =>
                    router.push({
                      pathname: '/interview-session',
                      params: { sessionId: offer.open_session_id! },
                    })
                  }
                >
                  <Text style={styles.resumeBtnText}>Resume Session</Text>
                  <ArrowRight size={16} color="#FFFFFF" weight="bold" />
                </Pressable>
              </View>
            )}

            {/* Case 2: User Needs to Purchase First */}
            {!hasPurchasedSessions && !hasOpenSession && (
              <>
                {/* Hero Card */}
                <View style={styles.heroCard}>
                  <View style={styles.heroBadgeRow}>
                    <View style={styles.heroBadge}>
                      <Sparkle size={13} color="#92400E" weight="fill" />
                      <Text style={styles.heroBadgeText}>AI PRACTICE INTERVIEW</Text>
                    </View>
                  </View>

                  <Text style={styles.heroTitle}>Practise Before It Counts</Text>
                  <Text style={styles.heroSubtitle}>
                    Answer 6 adaptive questions with real-time speech evaluation, instant feedback, and candidate Bharatpath Score calibration.
                  </Text>
                </View>

                {/* What's Included Grid */}
                <View style={styles.featuresSection}>
                  <Text style={styles.sectionHeading}>WHAT YOU WILL GET</Text>

                  <View style={styles.featureItem}>
                    <View style={styles.featureIconContainer}>
                      <Microphone size={20} color="#5F4DB2" weight="duotone" />
                    </View>
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTitle}>Role-Specific Audio Questions</Text>
                      <Text style={styles.featureDesc}>
                        Adaptive questions calibrated to your resume and technical domain.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.featureItem}>
                    <View style={styles.featureIconContainer}>
                      <Lightning size={20} color="#5F4DB2" weight="duotone" />
                    </View>
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTitle}>Real Voice & Hinglish Analysis</Text>
                      <Text style={styles.featureDesc}>
                        Natural speech evaluation, pacing, clarity, and keyword analysis.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.featureItem}>
                    <View style={styles.featureIconContainer}>
                      <ChartBar size={20} color="#5F4DB2" weight="duotone" />
                    </View>
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTitle}>5-Dimension Performance Report</Text>
                      <Text style={styles.featureDesc}>
                        Strengths, focus areas, and actionable model answers.
                      </Text>
                    </View>
                  </View>

                  <View style={styles.featureItem}>
                    <View style={styles.featureIconContainer}>
                      <ShieldCheck size={20} color="#5F4DB2" weight="duotone" />
                    </View>
                    <View style={styles.featureContent}>
                      <Text style={styles.featureTitle}>Bharatpath Score calibration</Text>
                      <Text style={styles.featureDesc}>
                        {offer.will_increase_score
                          ? 'Successful completion moves you toward the next readiness band.'
                          : 'Full comprehensive feedback report (practice mode).'}
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Score Cap Acknowledgement (if needed) */}
                {offer.requires_acknowledgement && (
                  <View style={styles.ackCard}>
                    <View style={styles.ackRow}>
                      <View style={styles.ackTextCol}>
                        <Text style={styles.ackTitle}>Bharatpath Score cap reached</Text>
                        <Text style={styles.ackDesc}>
                          You have completed the maximum scored sessions. This session is for practice only and will not change your Bharatpath Score.
                        </Text>
                      </View>
                      <Switch
                        value={acknowledgedNoScore}
                        onValueChange={setAcknowledgedNoScore}
                        trackColor={{ false: '#E2DDEB', true: '#5F4DB2' }}
                        thumbColor="#FFFFFF"
                      />
                    </View>
                  </View>
                )}

                {/* Pricing & Purchase Box */}
                <View style={styles.pricingCard}>
                  <View style={styles.pricingHeader}>
                    <View>
                      <Text style={styles.pricingPlanName}>Single Practice Session</Text>
                      <Text style={styles.pricingPlanMeta}>Full AI Evaluation & Diagnostic</Text>
                    </View>
                    <Text style={styles.pricingValue}>{priceDisplay}</Text>
                  </View>

                  <View style={styles.pricingDivider} />

                  <Pressable
                    style={({ pressed }) => [
                      styles.purchaseBtn,
                      pressed && styles.btnPressed,
                      purchasing && styles.btnDisabled,
                    ]}
                    onPress={handlePurchase}
                    disabled={purchasing}
                  >
                    {purchasing ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Lock size={16} color="#FFFFFF" weight="bold" />
                        <Text style={styles.purchaseBtnText}>
                          Pay & Check System ({priceDisplay})
                        </Text>
                      </>
                    )}
                  </Pressable>

                  <Text style={styles.pricingNote}>
                    After payment, you will test your microphone & audio before starting.
                  </Text>
                </View>
              </>
            )}

            {/* Case 3: User ALREADY has a purchased session ready */}
            {hasPurchasedSessions && !hasOpenSession && (
              <>
                <View style={styles.sessionReadyCard}>
                  <View style={styles.readyBadgeRow}>
                    <View style={styles.readyBadge}>
                      <CheckCircle size={14} color="#166534" weight="fill" />
                      <Text style={styles.readyBadgeText}>
                        {offer.sessions_available} SESSION AVAILABLE
                      </Text>
                    </View>
                  </View>

                  <Text style={styles.readyTitle}>Your Practice Session is Ready</Text>
                  <Text style={styles.readySubtitle}>
                    You have a paid practice session waiting. Please check your system hardware before beginning.
                  </Text>

                  <View style={styles.readyDivider} />

                  <View style={styles.specsRow}>
                    <View style={styles.specItem}>
                      <Clock size={16} color="#5F4DB2" weight="bold" />
                      <Text style={styles.specText}>6 Questions (~15m)</Text>
                    </View>
                    <View style={styles.specDot} />
                    <View style={styles.specItem}>
                      <Microphone size={16} color="#5F4DB2" weight="bold" />
                      <Text style={styles.specText}>Audio Only</Text>
                    </View>
                  </View>

                  <Pressable
                    style={({ pressed }) => [
                      styles.startBtn,
                      pressed && styles.btnPressed,
                      starting && styles.btnDisabled,
                    ]}
                    onPress={handleStartSession}
                    disabled={starting}
                  >
                    {starting ? (
                      <ActivityIndicator color="#FFFFFF" />
                    ) : (
                      <>
                        <Text style={styles.startBtnText}>
                          {offer.device_check_passed ? 'Start Interview' : 'Check System & Start'}
                        </Text>
                        <ArrowRight size={16} color="#FFFFFF" weight="bold" />
                      </>
                    )}
                  </Pressable>

                  {!offer.device_check_passed && (
                    <Text style={styles.systemCheckHint}>
                      Requires a quick audio and network test before beginning.
                    </Text>
                  )}
                </View>

                {offer.device_check_passed && (
                  <Pressable
                    style={({ pressed }) => [styles.retestBtn, pressed && styles.btnPressed]}
                    onPress={() => router.push('/device-check')}
                  >
                    <ShieldCheck size={16} color="#5F4DB2" weight="bold" />
                    <Text style={styles.retestBtnText}>Re-test Microphone & System</Text>
                  </Pressable>
                )}
              </>
            )}
          </>
        ) : null}
      </ScrollView>

      {/* Payment Sheet Modal */}
      {checkout && (
        <PaymentSheet
          checkout={checkout}
          planLabel="Mock Interview Practice Session"
          onPaid={handlePaymentSuccess}
          onClose={() => setCheckout(null)}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#FFFCF7',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.base,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#EBE5D8',
    gap: 12,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#0A1931',
  },
  content: {
    padding: Spacing.base,
    paddingBottom: 40,
    gap: 16,
  },
  centerContainer: {
    paddingVertical: 80,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: '#64748B',
  },
  errorCard: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FEE2E2',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: '#993A22',
    textAlign: 'center',
  },
  retryBtn: {
    backgroundColor: '#0A1931',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: Radii.pill,
    marginTop: 4,
  },
  retryBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#FFFFFF',
  },
  // In-Progress Session Banner
  openSessionCard: {
    backgroundColor: '#F8F6FF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#5F4DB2',
    padding: 18,
    gap: 8,
  },
  openSessionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  openSessionPill: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#5F4DB2',
    letterSpacing: 1,
  },
  openSessionTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#0A1931',
  },
  openSessionDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
  },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#5F4DB2',
    paddingVertical: 12,
    borderRadius: Radii.pill,
    marginTop: 6,
  },
  resumeBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  // Hero Card
  heroCard: {
    backgroundColor: '#0A1931',
    borderRadius: 20,
    padding: 20,
    gap: 10,
  },
  heroBadgeRow: {
    flexDirection: 'row',
  },
  heroBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  heroBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#92400E',
  },
  heroTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 22,
    lineHeight: 28,
    color: '#FFFFFF',
  },
  heroSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 19,
    color: 'rgba(255, 255, 255, 0.8)',
  },
  // Features Section
  featuresSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EAE4D7',
    padding: 18,
    gap: 14,
  },
  sectionHeading: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    letterSpacing: 1.2,
    color: '#64748B',
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  featureIconContainer: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#F4F0FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  featureContent: {
    flex: 1,
    gap: 2,
  },
  featureTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: '#0A1931',
  },
  featureDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#64748B',
  },
  // Acknowledgement Card
  ackCard: {
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FDE68A',
    borderRadius: 16,
    padding: 16,
  },
  ackRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  ackTextCol: {
    flex: 1,
    gap: 3,
  },
  ackTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: '#92400E',
  },
  ackDesc: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#78350F',
  },
  // Pricing Card
  pricingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#5F4DB2',
    padding: 20,
    gap: 14,
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
    elevation: 3,
  },
  pricingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pricingPlanName: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    color: '#0A1931',
  },
  pricingPlanMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  pricingValue: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 24,
    color: '#5F4DB2',
  },
  pricingDivider: {
    height: 1,
    backgroundColor: '#F1EAF7',
  },
  purchaseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5F4DB2',
    paddingVertical: 15,
    borderRadius: Radii.pill,
  },
  purchaseBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  pricingNote: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  // Session Ready Card
  sessionReadyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#EAE4D7',
    padding: 20,
    gap: 12,
  },
  readyBadgeRow: {
    flexDirection: 'row',
  },
  readyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: Radii.pill,
  },
  readyBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 11,
    color: '#166534',
    letterSpacing: 0.5,
  },
  readyTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 20,
    color: '#0A1931',
  },
  readySubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#64748B',
  },
  readyDivider: {
    height: 1,
    backgroundColor: '#F1EBE1',
    marginVertical: 4,
  },
  specsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  specItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  specText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    color: '#334155',
  },
  specDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: '#94A3B8',
  },
  startBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#5F4DB2',
    paddingVertical: 15,
    borderRadius: Radii.pill,
    marginTop: 6,
  },
  startBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 15,
    color: '#FFFFFF',
  },
  systemCheckHint: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  retestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2DDEB',
    paddingVertical: 12,
    borderRadius: Radii.pill,
  },
  retestBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    color: '#5F4DB2',
  },
  btnPressed: {
    opacity: 0.85,
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
