/**
 * BharatPath - Payment sheet
 *
 * A checkout is only an intent: the payment stays PENDING until the gateway's
 * signed callback has been processed. This sheet therefore sends the payer to
 * the gateway and then polls `GET /billing/payments/{id}` - a redirect back
 * says nothing on its own. Access is re-read from the subscription afterwards.
 *
 * With the stub gateway there is nowhere to send the payer, so the sheet
 * offers the two outcomes the stub can produce instead.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import {
  ArrowSquareOut,
  CheckCircle,
  ShieldCheck,
  WarningCircle,
  Wrench,
} from 'phosphor-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Radii } from '@/theme/tokens';
import {
  CheckoutResponse,
  SubscriptionResponse,
  billingErrorMessage,
  formatMinor,
  getCandidateSubscription,
  getPayment,
  isStubCheckout,
  paymentFailureMessage,
  settleStubPayment,
} from '@/services/api/subscription';

const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 48; // two minutes

export interface PaymentSheetProps {
  checkout: CheckoutResponse;
  planLabel: string;
  onPaid: (subscription: SubscriptionResponse) => void;
  onClose: () => void;
}

type SheetStatus = 'waiting' | 'settling' | 'paid' | 'failed';

export function PaymentSheet({ checkout, planLabel, onPaid, onClose }: PaymentSheetProps) {
  const isStub = isStubCheckout(checkout.redirect_url);
  const insets = useSafeAreaInsets();
  
  // Cache the bottom inset. On Android, insets.bottom can drop to 0 when the app is
  // backgrounded and resumed while a Modal is open. This prevents the buttons from
  // getting cut off again after a resume.
  const bottomInsetRef = useRef(insets.bottom);
  if (insets.bottom > bottomInsetRef.current) {
    bottomInsetRef.current = insets.bottom;
  }
  const safeBottom = bottomInsetRef.current;

  const [status, setStatus] = useState<SheetStatus>('waiting');
  const [message, setMessage] = useState<string | null>(null);
  const [pollCount, setPollCount] = useState(0);
  const [isChecking, setIsChecking] = useState(false);
  const settledRef = useRef(false);

  const grantAccess = useCallback(async () => {
    let subscription = await getCandidateSubscription();
    for (let attempt = 0; !subscription.has_access && attempt < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      subscription = await getCandidateSubscription();
    }
    if (!subscription.has_access) throw new Error('Payment was confirmed but membership access could not be refreshed. Please try again.');
    settledRef.current = true;
    setStatus('paid');
    setMessage(null);
    // A beat on the confirmation, so the payer sees what happened.
    setTimeout(() => onPaid(subscription), 700);
  }, [onPaid]);

  const checkOnce = useCallback(async (): Promise<boolean> => {
    if (settledRef.current) return true;
    const payment = await getPayment(checkout.payment_id);
    if (payment.status === 'SUCCEEDED') {
      await grantAccess();
      return true;
    }
    if (payment.status === 'FAILED') {
      settledRef.current = true;
      setStatus('failed');
      setMessage(paymentFailureMessage(payment.failure_code));
      return true;
    }
    return false;
  }, [checkout.payment_id, grantAccess]);

  // Poll until the callback has been processed, or the window closes.
  useEffect(() => {
    if (isStub || settledRef.current || status !== 'waiting' || pollCount >= MAX_POLLS) return;
    const timer = setTimeout(async () => {
      try {
        await checkOnce();
      } catch (error) {
        // A single failed poll is not an outcome; keep waiting.
        console.warn('[Payment poll]', error);
      }
      setPollCount((count) => count + 1);
    }, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [checkOnce, isStub, pollCount, status]);

  const handleOpenGateway = async () => {
    if (!checkout.redirect_url) return;
    try {
      await Linking.openURL(checkout.redirect_url);
    } catch {
      setMessage('Could not open the payment page. Copy the link from your browser instead.');
    }
  };

  const handleCheckNow = async () => {
    setIsChecking(true);
    setMessage(null);
    try {
      const settled = await checkOnce();
      if (!settled) {
        setMessage('The bank has not confirmed yet. This can take a few seconds.');
      }
    } catch (error) {
      setMessage(billingErrorMessage(error, 'Could not read the payment status.'));
    } finally {
      setIsChecking(false);
    }
  };

  const handleStubOutcome = async (outcome: 'SUCCEEDED' | 'FAILED') => {
    setStatus('settling');
    setMessage(null);
    try {
      const payment = await settleStubPayment(checkout.payment_id, outcome);
      if (payment.status === 'SUCCEEDED') {
        await grantAccess();
      } else {
        settledRef.current = true;
        setStatus('failed');
        setMessage(paymentFailureMessage(payment.failure_code));
      }
    } catch (error) {
      setStatus('waiting');
      setMessage(billingErrorMessage(error, 'The stub gateway could not settle this payment.'));
    }
  };

  const amount = formatMinor(checkout.amount_minor);
  const hasDiscount =
    checkout.list_amount_minor != null && checkout.list_amount_minor > checkout.amount_minor;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <TouchableWithoutFeedback onPress={status === 'paid' ? undefined : onClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={[styles.sheet, { paddingBottom: 36 + safeBottom }]}>
              <View style={styles.dragHandle} />

              <View style={styles.headerRow}>
                <View style={styles.headerInfo}>
                  <Text style={styles.itemTitle}>{planLabel}</Text>
                  <Text style={styles.itemSubtitle}>BharatPath membership</Text>
                </View>
                <View style={styles.amountBlock}>
                  {hasDiscount && (
                    <Text style={styles.listAmount}>
                      {formatMinor(checkout.list_amount_minor as number)}
                    </Text>
                  )}
                  <Text style={styles.amount}>{amount}</Text>
                </View>
              </View>

              <View style={styles.divider} />

              {status === 'paid' ? (
                <View style={styles.resultBlock}>
                  <CheckCircle size={40} color="#1F6B45" weight="fill" />
                  <Text style={styles.resultTitle}>Payment confirmed</Text>
                  <Text style={styles.resultBody}>
                    Your membership is open. Taking you to your resume.
                  </Text>
                </View>
              ) : status === 'failed' ? (
                <View style={styles.resultBlock}>
                  <WarningCircle size={40} color="#993A22" weight="fill" />
                  <Text style={styles.resultTitle}>Payment not completed</Text>
                  <Text style={styles.resultBody}>{message}</Text>
                  <Pressable
                    style={({ pressed }) => [styles.payButton, pressed && styles.buttonPressed]}
                    onPress={onClose}
                    accessibilityRole="button"
                  >
                    <Text style={styles.payButtonText}>Back to plans</Text>
                  </Pressable>
                </View>
              ) : isStub ? (
                <View style={styles.block}>
                  <View style={styles.devNote}>
                    <Wrench size={18} color="#7A5C0E" weight="bold" />
                    <Text style={styles.devNoteText}>
                      This backend is running the stub gateway, so there is no bank to send you
                      to. Settling here signs the same callback a real gateway would send.
                    </Text>
                  </View>

                  <Text style={styles.paymentRef}>PAYMENT {checkout.payment_id.slice(0, 8)}</Text>

                  <Pressable
                    style={({ pressed }) => [styles.payButton, pressed && styles.buttonPressed]}
                    onPress={() => handleStubOutcome('SUCCEEDED')}
                    disabled={status === 'settling'}
                    accessibilityRole="button"
                    accessibilityLabel={`Settle ${amount} as paid`}
                  >
                    {status === 'settling' ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.payButtonText}>Settle {amount} as paid</Text>
                    )}
                  </Pressable>

                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
                    onPress={() => handleStubOutcome('FAILED')}
                    disabled={status === 'settling'}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ghostButtonText}>Simulate a failed payment</Text>
                  </Pressable>

                  {message && <Text style={styles.errorText}>{message}</Text>}
                </View>
              ) : (
                <View style={styles.block}>
                  <View style={styles.noteBox}>
                    <ShieldCheck size={18} color="#3A4761" weight="bold" />
                    <Text style={styles.noteText}>
                      Your membership opens only after the bank confirms. If the payment fails,
                      nothing is charged.
                    </Text>
                  </View>

                  <Text style={styles.paymentRef}>PAYMENT {checkout.payment_id.slice(0, 8)}</Text>

                  <Pressable
                    style={({ pressed }) => [styles.payButton, pressed && styles.buttonPressed]}
                    onPress={handleOpenGateway}
                    accessibilityRole="button"
                    accessibilityLabel={`Pay ${amount}`}
                  >
                    <ArrowSquareOut size={18} color="#FFFFFF" weight="bold" />
                    <Text style={styles.payButtonText}>Pay {amount}</Text>
                  </Pressable>

                  <View style={styles.waitingRow}>
                    <ActivityIndicator size="small" color="#5F4DB2" />
                    <Text style={styles.waitingText}>
                      {pollCount >= MAX_POLLS
                        ? 'Still unconfirmed. Check again once your bank has replied.'
                        : 'Waiting for the bank to confirm…'}
                    </Text>
                  </View>

                  <Pressable
                    style={({ pressed }) => [styles.ghostButton, pressed && styles.buttonPressed]}
                    onPress={handleCheckNow}
                    disabled={isChecking}
                    accessibilityRole="button"
                  >
                    <Text style={styles.ghostButtonText}>
                      {isChecking ? 'Checking…' : 'I have paid - check now'}
                    </Text>
                  </Pressable>

                  {message && <Text style={styles.errorText}>{message}</Text>}
                </View>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
    gap: 16,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: -8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  },
  dragHandle: {
    width: 40,
    height: 4,
    borderRadius: Radii.pill,
    backgroundColor: '#E7E0D4',
    alignSelf: 'center',
    marginBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },
  headerInfo: {
    flex: 1,
    gap: 4,
  },
  itemTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 22,
    color: '#0A1931',
  },
  itemSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  amountBlock: {
    alignItems: 'flex-end',
    gap: 2,
  },
  listAmount: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
    textDecorationLine: 'line-through',
  },
  amount: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: -0.5,
    color: '#0A1931',
  },
  divider: {
    height: 1,
    backgroundColor: '#F0EBDF',
  },
  block: {
    gap: 12,
  },
  resultBlock: {
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
  },
  resultTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 18,
    lineHeight: 24,
    color: '#0A1931',
  },
  resultBody: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: '#3A4761',
    textAlign: 'center',
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F7F4EC',
    borderRadius: 16,
    padding: 15,
  },
  noteText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#3A4761',
  },
  devNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: '#F7EFD6',
    borderRadius: 16,
    padding: 15,
  },
  devNoteText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#7A5C0E',
  },
  paymentRef: {
    fontFamily: 'SpaceMono-Regular',
    fontSize: 11,
    lineHeight: 16,
    letterSpacing: 0.5,
    color: '#5F6B80',
  },
  payButton: {
    width: '100%',
    flexDirection: 'row',
    gap: 8,
    backgroundColor: '#5F4DB2',
    borderRadius: Radii.pill,
    paddingVertical: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  payButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 21,
    color: '#FFFFFF',
  },
  ghostButton: {
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    borderRadius: Radii.pill,
    paddingVertical: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ghostButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: '#0A1931',
  },
  buttonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }],
  },
  waitingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  waitingText: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F6B80',
  },
  errorText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 18,
    color: '#993A22',
  },
});
