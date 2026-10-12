/**
 * BharatPath - Membership after the four profile steps
 *
 * Everything the candidate does next is behind a live subscription: the score
 * itself, job matches and applying, the skill check, mock interviews and
 * courses all answer 402 `subscription_required` without one. So the choice is
 * made here, after the profile is saved, and `has_access` is the only thing this
 * screen trusts - plans, prices and periods all come from the API.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowRight,
  Briefcase,
  CheckCircle,
  GraduationCap,
  Microphone,
  Sparkle,
  Tag,
  WarningCircle,
} from 'phosphor-react-native';
import { ApiError } from '@/services/api/client';
import {
  CheckoutResponse,
  DiscountPreviewResponse,
  PlanResponse,
  SubscriptionResponse,
  billingErrorMessage,
  checkoutSubscription,
  formatMinor,
  formatPeriodEnd,
  getCandidateSubscription,
  listCandidatePlans,
  perMonthMinor,
  periodLabel,
  previewDiscount,
} from '@/services/api/subscription';
import { Radii } from '@/theme/tokens';
import { PaymentSheet } from './PaymentSheet';

const INCLUDED = [
  { icon: Sparkle, label: 'Your score', detail: 'Read as soon as your resume is confirmed' },
  { icon: Briefcase, label: 'Jobs and applying', detail: 'Roles you qualify for, and one board' },
  { icon: Microphone, label: 'Mock interviews', detail: 'Bought per session, at member prices' },
  { icon: GraduationCap, label: 'Courses', detail: 'The catalogue, and what each one adds' },
];

export interface SubscribeScreenProps {
  candidateName?: string;
  onSubscribed: () => void;
  onBack?: () => void;
  /** Dev escape, shown only when the backend has no payment provider wired. */
  onSkip?: () => void;
}

export function SubscribeScreen({
  candidateName,
  onSubscribed,
  onBack,
  onSkip,
}: SubscribeScreenProps) {
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [discountInput, setDiscountInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscountPreviewResponse | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentsUnavailable, setPaymentsUnavailable] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const [planList, current] = await Promise.all([
        listCandidatePlans(),
        getCandidateSubscription(),
      ]);
      const sorted = [...planList].sort((a, b) => a.months - b.months);
      setPlans(sorted);
      setSubscription(current);
      setSelectedCode((existing) => sorted.some((plan) => plan.code === existing) ? existing : sorted[0]?.code || null);
    } catch (error) {
      setLoadError(billingErrorMessage(error, 'Could not load the membership plans.'));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.code === selectedCode) || null,
    [plans, selectedCode]
  );

  const bestValueCode = useMemo(() => {
    if (plans.length < 2) return null;
    return plans.reduce((best, plan) =>
      perMonthMinor(plan) < perMonthMinor(best) ? plan : best
    ).code;
  }, [plans]);

  const runPreview = useCallback(
    async (planCode: string, code: string) => {
      setIsPreviewing(true);
      setDiscountError(null);
      try {
        const result = await previewDiscount(planCode, code);
        setPreview(result);
        setAppliedCode(code);
      } catch (error) {
        setPreview(null);
        setAppliedCode(null);
        setDiscountError(billingErrorMessage(error, 'That code could not be applied.'));
      } finally {
        setIsPreviewing(false);
      }
    },
    []
  );

  const payableMinor = preview ? preview.amount_minor : selectedPlan?.price_minor ?? 0;

  // A code is worth a different amount on a different plan, so re-check it.
  const handleSelectPlan = (planCode: string) => {
    setSelectedCode(planCode);
    if (appliedCode) {
      runPreview(planCode, appliedCode);
    }
  };

  const handleApplyCode = () => {
    const code = discountInput.trim();
    if (!code || !selectedCode) return;
    runPreview(selectedCode, code);
  };

  const handleClearCode = () => {
    setDiscountInput('');
    setAppliedCode(null);
    setPreview(null);
    setDiscountError(null);
  };

  const handleCheckout = async () => {
    if (!selectedPlan) return;
    setIsCheckingOut(true);
    setCheckoutError(null);
    try {
      const opened = await checkoutSubscription(selectedPlan.code, appliedCode || undefined);
      setCheckout(opened);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'payments_unavailable') {
        setPaymentsUnavailable(true);
      }
      setCheckoutError(billingErrorMessage(error, 'Could not start the payment.'));
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handlePaid = (updated: SubscriptionResponse) => {
    setCheckout(null);
    setSubscription(updated);
  };

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" animated />
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#5F4DB2" />
          <Text style={styles.centeredText}>Loading membership plans…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loadError) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <StatusBar style="dark" animated />
        <View style={styles.centered}>
          <WarningCircle size={36} color="#993A22" weight="fill" />
          <Text style={styles.centeredTitle}>Plans unavailable</Text>
          <Text style={styles.centeredText}>{loadError}</Text>
          <Pressable
            style={({ pressed }) => [styles.ctaButton, pressed && styles.buttonPressed]}
            onPress={load}
            accessibilityRole="button"
          >
            <Text style={styles.ctaButtonText}>Try again</Text>
          </Pressable>
          {onBack && (
            <Pressable onPress={onBack} accessibilityRole="button">
              <Text style={styles.linkText}>Go back</Text>
            </Pressable>
          )}
          {onSkip && (
            <Pressable onPress={onSkip} accessibilityRole="button" style={{ marginTop: 12 }}>
              <Text style={styles.linkText}>Skip payment (dev / test)</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    );
  }

  const hasAccess = !!subscription?.has_access;
  const activePlan = plans.find((plan) => plan.code === subscription?.plan_code);
  const activeSummary = [
    activePlan ? `${periodLabel(activePlan)} membership` : 'Membership',
    subscription?.current_period_end
      ? `open until ${formatPeriodEnd(subscription.current_period_end)}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" animated />
      <View style={styles.container}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {hasAccess ? (
            <>
              <View style={styles.titleSection}>
                <Text style={styles.title}>You&apos;re a member</Text>
                <Text style={styles.subtitle}>{activeSummary}</Text>
              </View>

              <View style={styles.activeCard}>
                <CheckCircle size={24} color="#1F6B45" weight="fill" />
                <Text style={styles.activeCardText}>
                  Your profile and resume review are saved. Continue to confirm
                  the reviewed resume and start scoring.
                </Text>
              </View>
            </>
          ) : (
            <>
              <View style={styles.titleSection}>
                <Text style={styles.title}>
                  {candidateName ? `Almost there, ${candidateName.split(' ')[0]}.` : 'Choose your plan'}
                </Text>
                <Text style={styles.subtitle}>
                  Membership opens your score, job matches and everything that builds on them.
                  Pick a length - you pay once for it.
                </Text>
              </View>

              <View style={styles.includedCard}>
                {INCLUDED.map(({ icon: Icon, label, detail }) => (
                  <View key={label} style={styles.includedRow}>
                    <View style={styles.includedIcon}>
                      <Icon size={16} color="#FFFCF7" weight="bold" />
                    </View>
                    <View style={styles.includedText}>
                      <Text style={styles.includedLabel}>{label}</Text>
                      <Text style={styles.includedDetail}>{detail}</Text>
                    </View>
                  </View>
                ))}
              </View>

              <View style={styles.plansSection}>
                <Text style={styles.sectionEyebrow}>CHOOSE A LENGTH</Text>
                {plans.length === 0 && (
                  <View style={styles.activeCard}>
                    <Text style={styles.centeredText}>No membership plans are available right now.</Text>
                    <Pressable accessibilityRole="button" onPress={load}>
                      <Text style={styles.linkText}>Try again</Text>
                    </Pressable>
                  </View>
                )}
                {plans.map((plan) => {
                  const isSelected = plan.code === selectedCode;
                  return (
                    <Pressable
                      key={plan.code}
                      style={({ pressed }) => [
                        styles.planCard,
                        isSelected && styles.planCardSelected,
                        pressed && styles.cardPressed,
                      ]}
                      onPress={() => handleSelectPlan(plan.code)}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: isSelected }}
                      accessibilityLabel={`${periodLabel(plan)}, ${formatMinor(plan.price_minor)}`}
                    >
                      {isSelected ? (
                        <CheckCircle size={22} color={ACCENT_PURPLE} weight="fill" />
                      ) : (
                        <View style={styles.unselectedCircle} />
                      )}
                      <View style={styles.planInfo}>
                        <View style={styles.planTitleRow}>
                          <Text style={styles.planTitle}>{periodLabel(plan)}</Text>
                          {plan.code === bestValueCode && (
                            <View style={styles.badge}>
                              <Text style={styles.badgeText}>BEST VALUE</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.planMeta}>
                          {formatMinor(perMonthMinor(plan))} a month
                          {plan.months > 1 ? ` · ${plan.months} months up front` : ''}
                        </Text>
                      </View>
                      <Text style={styles.planPrice}>{formatMinor(plan.price_minor)}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.discountSection}>
                <View style={styles.discountRow}>
                  <View style={styles.discountInputWrap}>
                    <Tag size={16} color="#5F6B80" weight="bold" />
                    <TextInput
                      style={styles.discountInput}
                      placeholder="Discount code (optional)"
                      placeholderTextColor="#8A93A5"
                      value={discountInput}
                      onChangeText={setDiscountInput}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      editable={!appliedCode}
                    />
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.applyButton, pressed && styles.buttonPressed]}
                    onPress={appliedCode ? handleClearCode : handleApplyCode}
                    disabled={isPreviewing || (!appliedCode && discountInput.trim().length === 0)}
                    accessibilityRole="button"
                  >
                    <Text style={styles.applyButtonText}>
                      {isPreviewing ? '…' : appliedCode ? 'Remove' : 'Apply'}
                    </Text>
                  </Pressable>
                </View>

                {preview && (
                  <Text style={styles.discountOk}>
                    {formatMinor(preview.discount_minor)} off · you pay{' '}
                    {formatMinor(preview.amount_minor)}. The code is checked again at payment.
                  </Text>
                )}
                {discountError && <Text style={styles.discountError}>{discountError}</Text>}
              </View>
            </>
          )}
        </ScrollView>

        <View style={styles.bottomSection}>
          {checkoutError && (
            <View style={styles.errorBanner}>
              <WarningCircle size={16} color="#993A22" weight="fill" />
              <Text style={styles.errorBannerText}>{checkoutError}</Text>
            </View>
          )}

          {hasAccess ? (
            <Pressable
              style={({ pressed }) => [styles.ctaButton, pressed && styles.buttonPressed]}
              onPress={onSubscribed}
              accessibilityRole="button"
            >
              <Text style={styles.ctaButtonText}>Start resume scoring</Text>
              <ArrowRight size={18} color="#FFFFFF" weight="bold" />
            </Pressable>
          ) : (
            <Pressable
              style={({ pressed }) => [styles.ctaButton, pressed && styles.buttonPressed]}
              onPress={handleCheckout}
              disabled={isCheckingOut || !selectedPlan}
              accessibilityRole="button"
              accessibilityLabel={selectedPlan ? `Continue to payment, ${formatMinor(payableMinor)}` : 'Select a membership plan'}
            >
              {isCheckingOut ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <>
                  <Text style={styles.ctaButtonText}>
                    {selectedPlan ? `Continue · ${formatMinor(payableMinor)}` : 'Select a membership plan'}
                  </Text>
                  <ArrowRight size={18} color="#FFFFFF" weight="bold" />
                </>
              )}
            </Pressable>
          )}

          {!hasAccess && onSkip && (
            <Pressable onPress={onSkip} accessibilityRole="button" style={{ marginTop: 8, paddingVertical: 4 }}>
              <Text style={styles.linkText}>
                {paymentsUnavailable ? 'Skip for now (this backend has no payment gateway)' : 'Skip payment for now (testing)'}
              </Text>
            </Pressable>
          )}

          {onBack && (
            <Pressable onPress={onBack} accessibilityRole="button">
              <Text style={styles.linkText}>Back</Text>
            </Pressable>
          )}
        </View>

        {checkout && selectedPlan && (
          <PaymentSheet
            checkout={checkout}
            planLabel={`${periodLabel(selectedPlan)} membership`}
            onPaid={handlePaid}
            onClose={() => setCheckout(null)}
          />
        )}
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
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  centeredTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 20,
    lineHeight: 26,
    color: '#0A1931',
  },
  centeredText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
    textAlign: 'center',
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
    letterSpacing: 1.32,
    color: '#5F6B80',
  },
  progressSegmentsRow: {
    flexDirection: 'row',
    gap: 6,
  },
  progressSegment: {
    flex: 1,
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#E7E0D4',
  },
  segmentActive: {
    backgroundColor: ACCENT_PURPLE,
  },
  titleSection: {
    marginTop: 8,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.75,
    color: '#0A1931',
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
    marginTop: 6,
  },
  includedCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    gap: 14,
  },
  includedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  includedIcon: {
    width: 32,
    height: 32,
    borderRadius: 11,
    backgroundColor: ACCENT_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  includedText: {
    flex: 1,
    gap: 2,
  },
  includedLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
  },
  includedDetail: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  plansSection: {
    gap: 10,
  },
  sectionEyebrow: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    color: '#5F6B80',
  },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 18,
    padding: 16,
  },
  planCardSelected: {
    borderWidth: 1.5,
    borderColor: ACCENT_PURPLE,
    backgroundColor: '#F8F5FF',
  },
  cardPressed: {
    opacity: 0.95,
    transform: [{ scale: 0.995 }],
  },
  unselectedCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: '#DDD6C7',
  },
  planInfo: {
    flex: 1,
    gap: 3,
  },
  planTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  planTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 21,
    color: '#0A1931',
  },
  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#F7EFD6',
  },
  badgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 9,
    lineHeight: 13,
    letterSpacing: 0.6,
    color: '#7A5C0E',
  },
  planMeta: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: '#5F6B80',
  },
  planPrice: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 17,
    lineHeight: 22,
    color: '#0A1931',
  },
  discountSection: {
    gap: 8,
  },
  discountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  discountInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: Radii.input,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  discountInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#0A1931',
    padding: 0,
  },
  applyButton: {
    paddingHorizontal: 18,
    paddingVertical: 13,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
  },
  applyButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: '#0A1931',
  },
  discountOk: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#1F6B45',
  },
  discountError: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#993A22',
  },
  activeCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#E6F1EA',
    borderRadius: 20,
    padding: 18,
  },
  activeCardText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#1F6B45',
  },
  bottomSection: {
    gap: 12,
    paddingBottom: 20,
    paddingTop: 8,
    backgroundColor: '#FFFCF7',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F8E6E0',
    borderRadius: 14,
    padding: 14,
  },
  errorBannerText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#993A22',
  },
  ctaButton: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: ACCENT_PURPLE,
    paddingVertical: 18,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  linkText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    lineHeight: 20,
    color: '#5F6B80',
    textAlign: 'center',
  },
});
