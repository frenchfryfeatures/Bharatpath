/**
 * BharatPath - Candidate Subscription Management Screen
 *
 * Direct mobile counterpart of the web portal's Student Subscription page
 * (`/student/subscription`):
 * - Header: "Subscription" / "Manage your plan and billing"
 * - Current subscription card:
 *   - Status (ACTIVE, NONE, etc.)
 *   - Access state ("Access active" in green / "No active paid access")
 *   - Period end date ("Until DD/MM/YYYY")
 *   - "Cancel renewal" button with confirmation alert
 *   - Cancellation notice when renewal has been cancelled
 * - Available plans grid:
 *   - Period uppercase (MONTHLY, QUARTERLY, SEMESTER, ANNUAL)
 *   - Price in rupees (e.g. ₹149, ₹399, ₹699, ₹1,199)
 *   - Duration (1 month, 3 months, etc.)
 *   - "Continue · ₹..." purple CTA button opening Razorpay / stub PaymentSheet
 * - Optional discount code support
 * - Pull to refresh & live status updates
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  CheckCircle,
  CreditCard,
  Sparkle,
  Tag,
  WarningCircle,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { AppAlert } from '@/components/feedback/AppAlert';
import {
  CheckoutResponse,
  DiscountPreviewResponse,
  PlanResponse,
  SubscriptionResponse,
  billingErrorMessage,
  cancelCandidateSubscription,
  checkoutSubscription,
  formatMinor,
  getCandidateSubscription,
  listCandidatePlans,
  periodLabel,
  previewDiscount,
} from '@/services/api/subscription';
import { PaymentSheet } from './PaymentSheet';

export interface SubscriptionManagementScreenProps {
  onBack?: () => void;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
  });
}

function formatLongDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function SubscriptionManagementScreen({
  onBack,
}: SubscriptionManagementScreenProps) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.max(140, Math.floor((width - 40 - 10) / 2));

  const [subscription, setSubscription] = useState<SubscriptionResponse | null>(null);
  const [plans, setPlans] = useState<PlanResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Checkout & PaymentSheet state
  const [checkout, setCheckout] = useState<CheckoutResponse | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<PlanResponse | null>(null);
  const [checkingOutCode, setCheckingOutCode] = useState<string | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  // Discount code state
  const [discountInput, setDiscountInput] = useState('');
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<DiscountPreviewResponse | null>(null);
  const [discountError, setDiscountError] = useState<string | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) {
      setRefreshing(true);
    } else {
      setLoading(true);
    }
    setError(null);
    try {
      const [subData, plansData] = await Promise.all([
        getCandidateSubscription(),
        listCandidatePlans(),
      ]);
      setSubscription(subData);
      const sortedPlans = [...plansData].sort((a, b) => a.months - b.months);
      setPlans(sortedPlans);
    } catch (err) {
      setError(billingErrorMessage(err, 'Could not load subscription details.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleApplyDiscount = async () => {
    const code = discountInput.trim();
    if (!code || plans.length === 0) return;
    setIsPreviewing(true);
    setDiscountError(null);
    try {
      const targetPlanCode = selectedPlan?.code || plans[0]?.code;
      const res = await previewDiscount(targetPlanCode, code);
      setPreview(res);
      setAppliedCode(code);
    } catch (err) {
      setPreview(null);
      setAppliedCode(null);
      setDiscountError(billingErrorMessage(err, 'That code could not be applied.'));
    } finally {
      setIsPreviewing(false);
    }
  };

  const handleClearDiscount = () => {
    setDiscountInput('');
    setAppliedCode(null);
    setPreview(null);
    setDiscountError(null);
  };

  const handleBuy = async (plan: PlanResponse) => {
    setSelectedPlan(plan);
    setCheckingOutCode(plan.code);
    setError(null);
    try {
      const res = await checkoutSubscription(plan.code, appliedCode || undefined);
      setCheckout(res);
    } catch (checkoutErr) {
      setError(billingErrorMessage(checkoutErr, 'Checkout could not be started.'));
      setSelectedPlan(null);
    } finally {
      setCheckingOutCode(null);
    }
  };

  const handlePaid = (updated: SubscriptionResponse) => {
    setCheckout(null);
    setSelectedPlan(null);
    setSubscription(updated);
    AppAlert.alert(
      'Subscription Activated',
      'Your membership is now active! You have full access to resume scoring, applications, courses, and interviews.',
      [{ text: 'Great!' }]
    );
  };

  const handleCancelRenewal = async () => {
    setIsCancelling(true);
    setError(null);
    try {
      const updated = await cancelCandidateSubscription();
      setSubscription(updated);
      AppAlert.alert(
        'Renewal Cancelled',
        `Your subscription will not renew automatically. Access continues until ${formatLongDate(
          updated.cancel_at || updated.current_period_end
        )}.`,
        [{ text: 'OK' }]
      );
    } catch (err) {
      setError(billingErrorMessage(err, 'Cancellation failed. Please try again.'));
    } finally {
      setIsCancelling(false);
    }
  };

  const confirmCancel = () => {
    const endDate = formatLongDate(subscription?.current_period_end);
    const planName = subscription?.plan_code ? ` for ${subscription.plan_code}` : '';
    AppAlert.alert(
      'Cancel subscription?',
      `Cancel renewal${planName}? Your paid access continues ${
        endDate ? `until ${endDate}` : 'until the end of the billing period'
      }. Your subscription will not renew automatically. This does not issue a refund.`,
      [
        { text: 'Keep subscription', style: 'cancel' },
        {
          text: 'Cancel renewal',
          style: 'destructive',
          onPress: handleCancelRenewal,
        },
      ]
    );
  };

  const hasAccess = !!subscription?.has_access;
  const isCancelled = !!subscription?.cancel_at;

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => loadData(true)}
              tintColor={Colors.brandAccent}
              colors={[Colors.brandAccent]}
            />
          }
        >
          {/* Top Bar with back button */}
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
            <Text style={styles.topBarTitle}>Subscription</Text>
          </View>

          {/* Heading Section */}
          <View style={styles.headingSection}>
            <Text style={styles.mainTitle}>Subscription</Text>
            <Text style={styles.mainSubtitle}>Manage your plan and billing</Text>
          </View>

          {/* Error Banner */}
          {error && (
            <View style={styles.errorCard}>
              <WarningCircle size={20} color={Colors.red.fg} weight="fill" />
              <Text style={styles.errorText}>{error}</Text>
              <Pressable
                style={styles.retryButton}
                onPress={() => loadData()}
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          )}

          {/* Current Subscription Card */}
          <View style={styles.subscriptionCard}>
            <Text style={styles.cardHeaderTitle}>Current subscription</Text>

            {loading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color="#5F4DB2" />
                <Text style={styles.loadingText}>Loading subscription…</Text>
              </View>
            ) : (
              <View style={styles.currentDetailsBlock}>
                <View style={styles.currentInfoRow}>
                  <View style={styles.badgeState}>
                    <Text style={styles.badgeStateText}>
                      {subscription?.state || 'NONE'}
                    </Text>
                  </View>

                  <Text
                    style={[
                      styles.accessStatusText,
                      hasAccess ? styles.accessActive : styles.accessInactive,
                    ]}
                  >
                    {hasAccess ? 'Access active' : 'No active paid access'}
                  </Text>

                  {subscription?.current_period_end && (
                    <Text style={styles.periodEndText}>
                      Until {formatDate(subscription.current_period_end)}
                    </Text>
                  )}

                  {hasAccess && !isCancelled && (
                    <Pressable
                      style={({ pressed }) => [
                        styles.cancelButton,
                        pressed && styles.buttonPressed,
                        isCancelling && styles.disabledButton,
                      ]}
                      onPress={confirmCancel}
                      disabled={isCancelling}
                      accessibilityRole="button"
                    >
                      <Text style={styles.cancelButtonText}>
                        {isCancelling ? 'Cancelling…' : 'Cancel renewal'}
                      </Text>
                    </Pressable>
                  )}
                </View>

                {isCancelled && (
                  <Text style={styles.cancelledNotice}>
                    Renewal cancelled. Access continues until{' '}
                    {formatDate(subscription?.cancel_at || subscription?.current_period_end)}.
                  </Text>
                )}
              </View>
            )}
          </View>

          {/* Discount code section */}
          <View style={styles.discountCard}>
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
              style={({ pressed }) => [
                styles.discountApplyButton,
                pressed && styles.buttonPressed,
                (!appliedCode && discountInput.trim().length === 0) &&
                  styles.disabledButton,
              ]}
              onPress={appliedCode ? handleClearDiscount : handleApplyDiscount}
              disabled={
                isPreviewing || (!appliedCode && discountInput.trim().length === 0)
              }
              accessibilityRole="button"
            >
              <Text style={styles.discountApplyButtonText}>
                {isPreviewing ? '…' : appliedCode ? 'Remove' : 'Apply'}
              </Text>
            </Pressable>
          </View>

          {preview && (
            <Text style={styles.discountSuccessText}>
              {formatMinor(preview.discount_minor)} discount applied! You pay{' '}
              {formatMinor(preview.amount_minor)}.
            </Text>
          )}

          {discountError && (
            <Text style={styles.discountErrorText}>{discountError}</Text>
          )}

          {/* Plans Section Header */}
          <View style={styles.plansHeaderRow}>
            <Text style={styles.sectionEyebrow}>CHOOSE A PLAN</Text>
          </View>

          {/* Plans 2x2 Grid */}
          {loading && plans.length === 0 ? (
            <View style={styles.plansSkeletonGrid}>
              {[0, 1, 2, 3].map((idx) => (
                <View
                  key={idx}
                  style={[styles.planCard, { width: cardWidth, opacity: 0.5 }]}
                >
                  <View style={styles.skeletonLineShort} />
                  <View style={styles.skeletonLineLarge} />
                  <View style={styles.skeletonLineShort} />
                  <View style={styles.skeletonButton} />
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.plansGrid}>
              {plans.map((plan) => {
                const isBuying = checkingOutCode === plan.code;
                const priceFormatted = formatMinor(plan.price_minor);
                const periodTitle = (plan.period || '').toUpperCase();
                const durationLabel = `${plan.months} month${
                  plan.months === 1 ? '' : 's'
                }`;

                return (
                  <View
                    key={plan.code}
                    style={[styles.planCard, { width: cardWidth }]}
                  >
                    <View style={styles.planCardTop}>
                      <Text style={styles.planPeriod}>{periodTitle}</Text>
                      <Text style={styles.planPrice}>{priceFormatted}</Text>
                      <Text style={styles.planDuration}>{durationLabel}</Text>
                    </View>

                    <Pressable
                      style={({ pressed }) => [
                        styles.planCtaButton,
                        pressed && styles.buttonPressed,
                        isBuying && styles.disabledButton,
                      ]}
                      onPress={() => handleBuy(plan)}
                      disabled={isBuying}
                      accessibilityRole="button"
                      accessibilityLabel={`Continue ${periodTitle} for ${priceFormatted}`}
                    >
                      {isBuying ? (
                        <ActivityIndicator size="small" color="#FFFFFF" />
                      ) : (
                        <Text
                          style={styles.planCtaButtonText}
                          numberOfLines={1}
                          adjustsFontSizeToFit
                        >
                          Continue · {priceFormatted}
                        </Text>
                      )}
                    </Pressable>
                  </View>
                );
              })}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>

      {/* PaymentSheet Modal for Razorpay / Stub Gateway checkout */}
      {checkout && selectedPlan && (
        <PaymentSheet
          checkout={checkout}
          planLabel={`${periodLabel(selectedPlan)} membership`}
          onPaid={handlePaid}
          onClose={() => {
            setCheckout(null);
            setSelectedPlan(null);
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#FFFCF7', // Matches brand offWhite canvas
  },
  safeArea: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: 16,
    flexGrow: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 4,
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
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy,
  },
  headingSection: {
    gap: 4,
  },
  mainTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: Colors.navy,
  },
  mainSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
  },
  errorCard: {
    backgroundColor: Colors.red.bg,
    borderWidth: 1,
    borderColor: '#F0C4B8',
    borderRadius: 16,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
  },
  retryButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  retryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    color: Colors.navy,
  },
  subscriptionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 18,
    gap: 12,
  },
  cardHeaderTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 16,
    lineHeight: 22,
    color: '#0A1931',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  loadingText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: '#5F6B80',
  },
  currentDetailsBlock: {
    gap: 8,
  },
  currentInfoRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
  },
  badgeState: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    backgroundColor: '#F3EFE9',
    borderRadius: 6,
  },
  badgeStateText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 16,
    color: '#0A1931',
    textTransform: 'uppercase',
  },
  accessStatusText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
  },
  accessActive: {
    color: '#23805D',
  },
  accessInactive: {
    color: '#5F6B80',
  },
  periodEndText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  cancelButton: {
    marginLeft: 'auto',
    borderWidth: 1,
    borderColor: '#FECACA',
    backgroundColor: '#FEF2F2',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  cancelButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 12,
    lineHeight: 16,
    color: '#DC2626',
  },
  cancelledNotice: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  discountCard: {
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
    paddingVertical: 10,
  },
  discountInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: '#0A1931',
    padding: 0,
  },
  discountApplyButton: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: Radii.pill,
    borderWidth: 1,
    borderColor: '#DDD6C7',
    backgroundColor: '#FFFFFF',
  },
  discountApplyButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 17,
    color: '#0A1931',
  },
  discountSuccessText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#1F6B45',
    marginTop: -8,
  },
  discountErrorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#993A22',
    marginTop: -8,
  },
  plansHeaderRow: {
    marginTop: 4,
  },
  sectionEyebrow: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.8,
    color: '#5F6B80',
  },
  plansGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  plansSkeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  planCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 20,
    padding: 16,
    justifyContent: 'space-between',
    minHeight: 175,
  },
  planCardTop: {
    gap: 2,
  },
  planPeriod: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.6,
    color: '#5F6B80',
    textTransform: 'uppercase',
  },
  planPrice: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.5,
    color: '#0A1931',
    marginTop: 4,
  },
  planDuration: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
    marginTop: 2,
  },
  planCtaButton: {
    marginTop: 16,
    width: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  planCtaButtonText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    textAlign: 'center',
  },
  skeletonLineShort: {
    width: 60,
    height: 12,
    backgroundColor: '#EDE8E1',
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonLineLarge: {
    width: 90,
    height: 26,
    backgroundColor: '#EDE8E1',
    borderRadius: 6,
    marginBottom: 6,
  },
  skeletonButton: {
    width: '100%',
    height: 38,
    backgroundColor: '#EDE8E1',
    borderRadius: 10,
    marginTop: 14,
  },
  buttonPressed: {
    transform: [{ scale: 0.97 }],
    opacity: 0.9,
  },
  disabledButton: {
    opacity: 0.6,
  },
});
