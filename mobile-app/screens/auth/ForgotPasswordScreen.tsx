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
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  Key,
  Lock,
  Eye,
  EyeSlash,
  WarningCircle,
  CheckCircle,
  EnvelopeSimple,
  ShieldCheck,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { forgotPassword, confirmForgotPassword } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';

export interface ForgotPasswordScreenProps {
  initialEmail?: string;
  onBack?: () => void;
  onSuccess?: (email: string) => void;
}

export function ForgotPasswordScreen({
  initialEmail = '',
  onBack,
  onSuccess,
}: ForgotPasswordScreenProps) {
  // Step: 1 = Enter Email, 2 = Enter Code & New Password, 3 = Success
  const [step, setStep] = useState<1 | 2 | 3>(1);

  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(30);

  const emailRef = useRef<TextInput>(null);
  const codeInputRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);

  // Sync initialEmail if passed or changed
  useEffect(() => {
    if (initialEmail && !email) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  // Autofocus input depending on the step
  useEffect(() => {
    if (step === 1) {
      const timer = setTimeout(() => {
        emailRef.current?.focus();
      }, 150);
      return () => clearTimeout(timer);
    } else if (step === 2) {
      const timer = setTimeout(() => {
        codeInputRef.current?.focus();
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [step]);

  useEffect(() => {
    if (resendCooldown > 0 && step === 2) {
      const timer = setTimeout(() => setResendCooldown((prev) => prev - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCooldown, step]);

  // Step 1 Validation & Submission
  const handleRequestCode = async () => {
    setErrorMsg(null);
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your email address.');
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    setIsLoading(true);
    try {
      await forgotPassword(trimmedEmail);
      setStep(2);
      setResendCooldown(30);
    } catch (err: any) {
      console.error('[Forgot Password Request Error]:', err);
      if (err instanceof ApiError) {
        setErrorMsg(err.problem?.title || err.message || 'Could not send reset code.');
      } else {
        setErrorMsg(err?.message || 'Could not send reset code. Please check your connection.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2 Validation & Submission
  const handleResetPassword = async () => {
    setErrorMsg(null);
    const cleanedCode = code.trim();
    if (cleanedCode.length < 6) {
      setErrorMsg('Please enter the complete 6-digit verification code.');
      return;
    }

    if (newPassword.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return;
    }
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
    if (!hasUpper || !hasLower || !hasNumber || !hasSpecial) {
      setErrorMsg('Password must include uppercase, lowercase, numbers, and special characters (!@#$%^&*).');
      return;
    }

    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      await confirmForgotPassword(email.trim().toLowerCase(), cleanedCode, newPassword);
      setStep(3);
    } catch (err: any) {
      console.error('[Confirm Forgot Password Error]:', err);
      if (err instanceof ApiError) {
        setErrorMsg(err.problem?.title || err.message || 'Failed to reset password.');
      } else {
        setErrorMsg(err?.message || 'Failed to reset password. Please check code and try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCooldown === 0 && !isResending) {
      setIsResending(true);
      setErrorMsg(null);
      try {
        await forgotPassword(email.trim().toLowerCase());
        setSuccessMsg('A fresh verification code was sent to your email.');
        setResendCooldown(30);
        setCode('');
      } catch (err: any) {
        setErrorMsg(err?.problem?.title || err?.message || 'Could not resend reset code.');
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
              onPress={step === 2 ? () => setStep(1) : onBack}
              accessibilityRole="button"
              accessibilityLabel="Go back"
            >
              <ArrowLeft size={18} color={Colors.navy} weight="bold" />
            </Pressable>
            <Text style={styles.navTitle}>
              {step === 3 ? 'Success' : 'Reset Password'}
            </Text>
            <View style={styles.navPlaceholder} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {/* STEP 1: Enter Email */}
            {step === 1 && (
              <View style={styles.stepContainer}>
                <View style={styles.iconCircle}>
                  <Key size={32} color={Colors.brandAccent} weight="duotone" />
                </View>
                <Text style={styles.title}>Forgot password?</Text>
                <Text style={styles.subtitle}>
                  Enter the email address registered with your account. We will send you a 6-digit code to reset your password.
                </Text>

                {errorMsg ? (
                  <View style={styles.errorContainer}>
                    <WarningCircle size={18} color={Colors.red.fg} weight="fill" />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Email Address</Text>
                  <Pressable
                    style={[
                      styles.inputWrapper,
                      focusedField === 'email' && styles.inputWrapperFocused,
                    ]}
                    onPress={() => emailRef.current?.focus()}
                    accessible={false}
                  >
                    <EnvelopeSimple
                      size={20}
                      color={focusedField === 'email' ? Colors.brandAccent : Colors.text.muted}
                    />
                    <TextInput
                      ref={emailRef}
                      style={styles.textInput}
                      placeholder="name@example.com"
                      placeholderTextColor={Colors.text.muted}
                      value={email}
                      onChangeText={(text) => {
                        setEmail(text);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      onFocus={() => setFocusedField('email')}
                      onBlur={() => setFocusedField(null)}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      autoCorrect={false}
                      autoFocus={true}
                      editable={!isLoading}
                      returnKeyType="done"
                      onSubmitEditing={handleRequestCode}
                      textContentType="emailAddress"
                      autoComplete="email"
                    />
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (!email.trim() || isLoading) && styles.primaryButtonDisabled,
                    pressed && email.trim() && !isLoading && styles.buttonPressed,
                  ]}
                  onPress={handleRequestCode}
                  disabled={!email.trim() || isLoading}
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Send Reset Code</Text>
                  )}
                </Pressable>

                <Pressable onPress={onBack} hitSlop={8} style={styles.footerLink}>
                  <Text style={styles.footerLinkText}>Remember your password? <Text style={styles.linkHighlight}>Sign in</Text></Text>
                </Pressable>
              </View>
            )}

            {/* STEP 2: Enter Code & New Password */}
            {step === 2 && (
              <View style={styles.stepContainer}>
                <View style={styles.iconCircle}>
                  <Lock size={32} color={Colors.brandAccent} weight="duotone" />
                </View>
                <Text style={styles.title}>Create new password</Text>
                <Text style={styles.subtitle}>
                  We sent a 6-digit reset code to{'\n'}
                  <Text style={styles.emailHighlight}>{email.trim().toLowerCase()}</Text>
                </Text>

                {successMsg ? (
                  <View style={styles.successContainer}>
                    <CheckCircle size={18} color="#2D8A4E" weight="fill" />
                    <Text style={styles.successText}>{successMsg}</Text>
                  </View>
                ) : null}

                {errorMsg ? (
                  <View style={styles.errorContainer}>
                    <WarningCircle size={18} color={Colors.red.fg} weight="fill" />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                ) : null}

                {/* 6-Digit Code Representation */}
                <View style={styles.codeSection}>
                  <Text style={styles.inputLabel}>Verification Code</Text>
                  <View style={styles.codeWrapper}>
                    <Pressable
                      style={styles.codeBoxesContainer}
                      onPress={() => codeInputRef.current?.focus()}
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

                    {/* Hidden Input for Code */}
                    <TextInput
                      ref={codeInputRef}
                      style={styles.hiddenInput}
                      value={code}
                      onChangeText={(text) => {
                        const cleaned = text.replace(/\D/g, '').slice(0, 6);
                        setCode(cleaned);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      keyboardType="number-pad"
                      maxLength={6}
                      editable={!isLoading}
                    />
                  </View>

                  {/* Resend Link */}
                  <View style={styles.resendRow}>
                    <Text style={styles.resendText}>Didn't receive the code?</Text>
                    {isResending ? (
                      <ActivityIndicator size="small" color={Colors.brandAccent} style={{ marginLeft: 6 }} />
                    ) : resendCooldown > 0 ? (
                      <Text style={styles.resendTimer}>Resend in {resendCooldown}s</Text>
                    ) : (
                      <Pressable onPress={handleResendCode} hitSlop={8}>
                        <Text style={styles.resendLink}>Resend Code</Text>
                      </Pressable>
                    )}
                  </View>
                </View>

                {/* New Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>New Password</Text>
                  <Pressable
                    style={[
                      styles.inputWrapper,
                      focusedField === 'newPassword' && styles.inputWrapperFocused,
                    ]}
                    onPress={() => passwordRef.current?.focus()}
                    accessible={false}
                  >
                    <Lock
                      size={20}
                      color={focusedField === 'newPassword' ? Colors.brandAccent : Colors.text.muted}
                    />
                    <TextInput
                      ref={passwordRef}
                      style={styles.textInput}
                      placeholder="At least 8 characters"
                      placeholderTextColor={Colors.text.muted}
                      value={newPassword}
                      onChangeText={(text) => {
                        setNewPassword(text);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      onFocus={() => setFocusedField('newPassword')}
                      onBlur={() => setFocusedField(null)}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isLoading}
                      returnKeyType="next"
                      onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    />
                    <Pressable
                      onPress={() => setShowPassword(!showPassword)}
                      hitSlop={10}
                      style={styles.eyeButton}
                    >
                      {showPassword ? (
                        <EyeSlash size={20} color={Colors.text.muted} />
                      ) : (
                        <Eye size={20} color={Colors.text.muted} />
                      )}
                    </Pressable>
                  </Pressable>
                  <Text style={styles.inputHint}>
                    Must be at least 8 characters with uppercase, lowercase, number & symbol.
                  </Text>
                </View>

                {/* Confirm New Password Field */}
                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Confirm New Password</Text>
                  <Pressable
                    style={[
                      styles.inputWrapper,
                      focusedField === 'confirmPassword' && styles.inputWrapperFocused,
                    ]}
                    onPress={() => confirmPasswordRef.current?.focus()}
                    accessible={false}
                  >
                    <Lock
                      size={20}
                      color={focusedField === 'confirmPassword' ? Colors.brandAccent : Colors.text.muted}
                    />
                    <TextInput
                      ref={confirmPasswordRef}
                      style={styles.textInput}
                      placeholder="Re-enter your new password"
                      placeholderTextColor={Colors.text.muted}
                      value={confirmPassword}
                      onChangeText={(text) => {
                        setConfirmPassword(text);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      onFocus={() => setFocusedField('confirmPassword')}
                      onBlur={() => setFocusedField(null)}
                      secureTextEntry={!showConfirmPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      editable={!isLoading}
                      returnKeyType="done"
                      onSubmitEditing={handleResetPassword}
                    />
                    <Pressable
                      onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                      hitSlop={10}
                      style={styles.eyeButton}
                    >
                      {showConfirmPassword ? (
                        <EyeSlash size={20} color={Colors.text.muted} />
                      ) : (
                        <Eye size={20} color={Colors.text.muted} />
                      )}
                    </Pressable>
                  </Pressable>
                </View>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    (code.length < 6 || newPassword.length < 8 || isLoading) && styles.primaryButtonDisabled,
                    pressed && code.length === 6 && newPassword.length >= 8 && !isLoading && styles.buttonPressed,
                  ]}
                  onPress={handleResetPassword}
                  disabled={code.length < 6 || newPassword.length < 8 || isLoading}
                  accessibilityRole="button"
                >
                  {isLoading ? (
                    <ActivityIndicator color="#FFFFFF" size="small" />
                  ) : (
                    <Text style={styles.primaryButtonText}>Reset Password</Text>
                  )}
                </Pressable>
              </View>
            )}

            {/* STEP 3: Success Screen */}
            {step === 3 && (
              <View style={styles.stepContainer}>
                <View style={[styles.iconCircle, { backgroundColor: '#EBF8EE' }]}>
                  <CheckCircle size={36} color="#2D8A4E" weight="fill" />
                </View>
                <Text style={styles.title}>Password Reset!</Text>
                <Text style={styles.subtitle}>
                  Your password has been reset successfully. You can now log into your account using your new password.
                </Text>

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={() => {
                    if (onSuccess) {
                      onSuccess(email.trim().toLowerCase());
                    } else if (onBack) {
                      onBack();
                    }
                  }}
                  accessibilityRole="button"
                >
                  <Text style={styles.primaryButtonText}>Sign In Now</Text>
                </Pressable>
              </View>
            )}
          </ScrollView>
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
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.xxl,
  },
  stepContainer: {
    width: '100%',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: Radii.pill,
    backgroundColor: Colors.indigoSemantic.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xs,
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
    marginTop: -4,
  },
  emailHighlight: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.navy,
  },
  inputGroup: {
    width: '100%',
    gap: Spacing.xs,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: Colors.text.primary,
  },
  inputWrapper: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface.card,
    borderRadius: Radii.input,
    borderWidth: 1.5,
    borderColor: Colors.surface.border,
    paddingHorizontal: Spacing.md,
    height: 52,
    gap: Spacing.sm,
  },
  inputWrapperFocused: {
    borderColor: Colors.brandAccent,
    backgroundColor: '#FFFFFF',
    shadowColor: Colors.brandAccent,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  textInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    color: Colors.navy,
    paddingVertical: Platform.OS === 'ios' ? 0 : 8,
  },
  eyeButton: {
    padding: Spacing.xs,
  },
  inputHint: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    color: Colors.text.muted,
    lineHeight: 16,
  },
  errorContainer: {
    width: '100%',
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
  successContainer: {
    width: '100%',
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
  codeSection: {
    width: '100%',
    gap: Spacing.xs,
  },
  codeWrapper: {
    position: 'relative',
    width: '100%',
  },
  codeBoxesContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: Spacing.sm,
    marginTop: Spacing.xs,
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
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    zIndex: 10,
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
    marginTop: Spacing.sm,
  },
  resendText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    color: Colors.text.primary,
  },
  resendTimer: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: Colors.text.muted,
  },
  resendLink: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: Colors.brandAccent,
  },
  primaryButton: {
    width: '100%',
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
  footerLink: {
    paddingVertical: Spacing.xs,
  },
  footerLinkText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: Colors.text.primary,
  },
  linkHighlight: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.brandAccent,
  },
});
