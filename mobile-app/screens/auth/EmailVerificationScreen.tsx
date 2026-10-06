import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  EnvelopeSimple,
  WarningCircle,
  ShieldCheck,
  CheckCircle,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { OnboardingProgress } from '@/screens/onboarding/OnboardingProgress';

export interface EmailVerificationScreenProps {
  email: string;
  onBack?: () => void;
  onVerify?: (code: string) => Promise<void> | void;
  onResendCode?: () => Promise<void> | void;
}

export function EmailVerificationScreen({
  email,
  onBack,
  onVerify,
  onResendCode,
}: EmailVerificationScreenProps) {
  const [code, setCode] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);
  const inputRef = useRef<TextInput>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown]);

  const handleVerify = async (codeToVerify?: string) => {
    const cleaned = (codeToVerify || code).trim();
    if (cleaned.length < 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsVerifying(true);
    try {
      if (onVerify) {
        await onVerify(cleaned);
      }
    } catch (err: any) {
      console.error('[Verification Error]:', err);
      setErrorMsg(err?.problem?.title || err?.message || 'Verification failed. Please check the code.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleResend = async () => {
    if (resendCooldown === 0 && !isResending) {
      setIsResending(true);
      setErrorMsg(null);
      try {
        if (onResendCode) {
          await onResendCode();
        }
        setSuccessMsg('New verification code sent to your email!');
        setResendCooldown(30);
        setCode('');
      } catch (err: any) {
        setErrorMsg(err?.problem?.title || err?.message || 'Could not resend code. Please try again.');
      } finally {
        setIsResending(false);
      }
    }
  };

  const codeDigits = code.padEnd(6, ' ').split('').slice(0, 6);

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          {/* Top Navigation Bar */}
          <View style={styles.topBar}>
            <Pressable
              style={({ pressed }) => [
                styles.backButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color={Colors.navy} weight="bold" />
            </Pressable>
            <Text style={styles.navTitle}>Verify Email</Text>
            <View style={styles.navPlaceholder} />
          </View>

          <View style={styles.content}>
            <OnboardingProgress step={0} />
            {/* Header / Icon */}
            <View style={styles.headerSection}>
              <View style={styles.iconCircle}>
                <EnvelopeSimple size={32} color={Colors.brandAccent} weight="duotone" />
              </View>
              <Text style={styles.title}>Check your inbox</Text>
              <Text style={styles.subtitle}>
                We sent a 6-digit verification code to{'\n'}
                <Text style={styles.emailHighlight}>{email || 'your email address'}</Text>
              </Text>
            </View>

            {/* Success Message */}
            {successMsg ? (
              <View style={styles.successContainer}>
                <CheckCircle size={18} color="#2D8A4E" weight="fill" />
                <Text style={styles.successText}>{successMsg}</Text>
              </View>
            ) : null}

            {/* Error Message */}
            {errorMsg ? (
              <View style={styles.errorContainer}>
                <WarningCircle size={18} color={Colors.red.fg} weight="fill" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Code Box Representation */}
            <Pressable
              style={styles.codeBoxesContainer}
              onPress={() => inputRef.current?.focus()}
            >
              {codeDigits.map((digit, idx) => {
                const isCurrent = idx === code.length && code.length < 6;
                const isFilled = digit.trim().length > 0;
                return (
                  <View
                    key={idx}
                    style={[
                      styles.codeBox,
                      isCurrent && styles.codeBoxActive,
                      isFilled && styles.codeBoxFilled,
                    ]}
                  >
                    <Text style={styles.codeDigit}>{digit.trim()}</Text>
                  </View>
                );
              })}
            </Pressable>

            {/* Hidden Real TextInput */}
            <TextInput
              ref={inputRef}
              style={styles.hiddenInput}
              value={code}
              onChangeText={(text) => {
                const cleaned = text.replace(/\D/g, '').slice(0, 6);
                setCode(cleaned);
                if (errorMsg) setErrorMsg(null);
                if (cleaned.length === 6 && !isVerifying) {
                  handleVerify(cleaned);
                }
              }}
              keyboardType="number-pad"
              maxLength={6}
              autoFocus
              editable={!isVerifying}
            />

            {/* Verify Button */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (code.length < 6 || isVerifying) && styles.primaryButtonDisabled,
                pressed && code.length === 6 && !isVerifying && styles.buttonPressed,
              ]}
              onPress={() => handleVerify()}
              disabled={code.length < 6 || isVerifying}
              accessibilityRole="button"
            >
              {isVerifying ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Verify & Continue</Text>
              )}
            </Pressable>

            {/* Resend Row */}
            <View style={styles.resendRow}>
              <Text style={styles.resendText}>Didn&apos;t receive the email?</Text>
              {isResending ? (
                <ActivityIndicator size="small" color={Colors.brandAccent} style={{ marginLeft: 6 }} />
              ) : resendCooldown > 0 ? (
                <Text style={styles.resendTimer}>Resend in {resendCooldown}s</Text>
              ) : (
                <Pressable onPress={handleResend} hitSlop={8}>
                  <Text style={styles.resendLink}>Resend Code</Text>
                </Pressable>
              )}
            </View>

            {/* Security note */}
            <View style={styles.securityNote}>
              <ShieldCheck size={16} color={Colors.text.muted} weight="bold" />
              <Text style={styles.securityText}>
                The code expires in 15 minutes. Check spam or junk folders if not received.
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.offWhite,
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.hairline,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface.card,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: Colors.navy,
  },
  navPlaceholder: {
    width: 40,
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  content: {
    flex: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    gap: Spacing.lg,
  },
  headerSection: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingTop: Spacing.md,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: Radii.pill,
    backgroundColor: Colors.indigoSemantic.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: Colors.navy,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 22,
    color: Colors.text.primary,
    textAlign: 'center',
    marginTop: 2,
  },
  emailHighlight: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.navy,
  },
  successContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: '#EBF8EE',
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderRadius: Radii.tile,
    borderWidth: 1,
    borderColor: '#B7E4C7',
  },
  successText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#2D8A4E',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    backgroundColor: Colors.red.bg,
    paddingHorizontal: Spacing.base,
    paddingVertical: Spacing.md,
    borderRadius: Radii.tile,
    borderWidth: 1,
    borderColor: '#E8B6AB',
  },
  errorText: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
  },
  codeBoxesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  codeBox: {
    width: 48,
    height: 56,
    borderRadius: Radii.input,
    backgroundColor: Colors.surface.card,
    borderWidth: 1.5,
    borderColor: Colors.surface.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeBoxActive: {
    borderColor: Colors.brandAccent,
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.brandAccent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 3,
  },
  codeBoxFilled: {
    borderColor: Colors.navy,
    backgroundColor: '#FFFFFF',
  },
  codeDigit: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 24,
    color: Colors.navy,
  },
  hiddenInput: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  primaryButton: {
    backgroundColor: Colors.brandAccent,
    height: 54,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
    shadowColor: Colors.brandAccent,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
  primaryButtonDisabled: {
    backgroundColor: '#C5BFDF',
    shadowOpacity: 0,
    elevation: 0,
  },
  primaryButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    color: '#FFFFFF',
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.xs,
  },
  resendText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: Colors.text.primary,
  },
  resendTimer: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.text.muted,
  },
  resendLink: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: Colors.brandAccent,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.base,
    paddingHorizontal: Spacing.base,
  },
  securityText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
    textAlign: 'center',
  },
});
