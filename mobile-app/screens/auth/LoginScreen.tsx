import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
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
  Lock,
  Eye,
  EyeSlash,
  WarningCircle,
  Key,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { signInWithEmail, AuthSession, CandidateProfileResponse } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { useAuthContext } from '@/context/AuthContext';

export interface LoginFormData {
  email: string;
  password: string;
}

export interface LoginScreenProps {
  initialEmail?: string;
  onBack?: () => void;
  onNavigateToSignUp?: () => void;
  onNavigateToVerification?: (email: string, password?: string) => void;
  onForgotPassword?: (email?: string) => void;
  onSubmit?: (data: { session: AuthSession; profile: CandidateProfileResponse | null }) => void;
}

export function LoginScreen({
  initialEmail = '',
  onBack,
  onNavigateToSignUp,
  onNavigateToVerification,
  onForgotPassword,
  onSubmit,
}: LoginScreenProps) {
  const { rememberCandidate } = useAuthContext();
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

  useEffect(() => {
    if (initialEmail && !email) {
      setEmail(initialEmail);
    }
  }, [initialEmail]);

  const validate = (): boolean => {
    setErrorMsg(null);

    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) {
      setErrorMsg('Please enter your email address.');
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(trimmedEmail)) {
      setErrorMsg('Please enter a valid email address.');
      return false;
    }

    if (!password) {
      setErrorMsg('Please enter your password.');
      return false;
    }

    return true;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const result = await signInWithEmail({
        email: email.trim().toLowerCase(),
        password,
      });

      rememberCandidate(result.session, result.profile);
      if (onSubmit) {
        onSubmit(result);
      }
    } catch (err: any) {
      console.error('[Login Error]:', err);
      if (err instanceof ApiError) {
        if (err.code === 'account_inactive') {
          setErrorMsg('This account is suspended or has been deleted.');
        } else if (err.code === 'user_not_confirmed') {
          if (onNavigateToVerification) {
            onNavigateToVerification(email.trim().toLowerCase(), password);
            return;
          }
          setErrorMsg('Account not verified yet. Please check your email for the verification code.');
        } else if (err.code === 'unauthenticated') {
          setErrorMsg('Invalid credentials. Please check your email and password.');
        } else if (err.code === 'network_error') {
          setErrorMsg('Cannot connect to backend. Please check your internet connection.');
        } else if (err.code === 'account_contact_in_use') {
          setErrorMsg('An identity conflict occurred for this email. Please check your credentials or register with your email.');
        } else {
          setErrorMsg(err.problem?.title || err.message || 'Failed to sign in.');
        }
      } else {
        setErrorMsg(err?.message || 'Failed to sign in. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isFormFilled = email.trim().length > 0 && password.length > 0;

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
            <Text style={styles.navTitle}>Sign In</Text>
            <View style={styles.navPlaceholder} />
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Header / Intro */}
            <View style={styles.headerSection}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Key size={14} color={Colors.brandAccent} weight="bold" />
                  <Text style={styles.badgeText}>WELCOME BACK</Text>
                </View>
              </View>
              <Text style={styles.title}>Sign in to your account</Text>
              <Text style={styles.subtitle}>
                Access your resume/CV evaluation, verified score, and employer opportunities.
              </Text>
            </View>

            {/* Error Message Box */}
            {errorMsg ? (
              <View style={styles.errorContainer}>
                <WarningCircle size={18} color={Colors.red.fg} weight="fill" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Form Fields */}
            <View style={styles.form}>
              {/* Email Address */}
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
                    placeholder="you@example.com"
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
                    editable={!isLoading}
                    blurOnSubmit={false}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                    textContentType="emailAddress"
                    autoComplete="email"
                  />
                </Pressable>
              </View>

              {/* Password */}
              <View style={styles.inputGroup}>
                <View style={styles.passwordLabelRow}>
                  <Text style={styles.inputLabel}>Password</Text>
                  <Pressable
                    onPress={() => onForgotPassword?.(email.trim().toLowerCase())}
                    hitSlop={8}
                    disabled={isLoading}
                  >
                    <Text style={styles.forgotPasswordText}>Forgot password?</Text>
                  </Pressable>
                </View>
                <Pressable
                  style={[
                    styles.inputWrapper,
                    focusedField === 'password' && styles.inputWrapperFocused,
                  ]}
                  onPress={() => passwordRef.current?.focus()}
                  accessible={false}
                >
                  <Lock
                    size={20}
                    color={focusedField === 'password' ? Colors.brandAccent : Colors.text.muted}
                  />
                  <TextInput
                    ref={passwordRef}
                    style={styles.textInput}
                    placeholder="Enter your password"
                    placeholderTextColor={Colors.text.muted}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onFocus={() => setFocusedField('password')}
                    onBlur={() => setFocusedField(null)}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    blurOnSubmit={true}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    textContentType="password"
                    autoComplete="password"
                  />
                  <Pressable
                    onPress={() => setShowPassword(!showPassword)}
                    hitSlop={8}
                    style={styles.eyeButton}
                  >
                    {showPassword ? (
                      <EyeSlash size={20} color={Colors.text.muted} />
                    ) : (
                      <Eye size={20} color={Colors.text.muted} />
                    )}
                  </Pressable>
                </Pressable>
              </View>
            </View>

            {/* Submit Button */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (!isFormFilled || isLoading) && styles.primaryButtonDisabled,
                pressed && isFormFilled && !isLoading && styles.buttonPressed,
              ]}
              onPress={handleSubmit}
              disabled={!isFormFilled || isLoading}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Sign In</Text>
              )}
            </Pressable>

            {/* Bottom Switch Link */}
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Don't have an account?</Text>
              <Pressable onPress={onNavigateToSignUp} hitSlop={8} disabled={isLoading}>
                <Text style={styles.switchLink}>Get started free</Text>
              </Pressable>
            </View>

            {/* Security / Backend Info Box */}
            <View style={styles.infoCard}>
              <Text style={styles.infoTitle}>Secure Identity Protection</Text>
              <Text style={styles.infoText}>
                Your authentication is protected by AWS Cognito and verified server-side. Passwords are never transmitted to our application servers in plain text.
              </Text>
            </View>
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
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.lg,
  },
  headerSection: {
    gap: Spacing.xs,
  },
  badgeRow: {
    flexDirection: 'row',
    marginBottom: Spacing.xs,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    backgroundColor: Colors.indigoSemantic.bg,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radii.pill,
  },
  badgeText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 11,
    letterSpacing: 0.6,
    color: Colors.brandAccent,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 26,
    lineHeight: 32,
    letterSpacing: -0.4,
    color: Colors.navy,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    lineHeight: 20,
    color: Colors.text.primary,
    marginTop: 2,
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
  form: {
    gap: Spacing.lg,
  },
  inputGroup: {
    gap: Spacing.opt6,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.navy,
  },
  passwordLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  forgotPasswordText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    color: Colors.brandAccent,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.surface.card,
    borderWidth: 1.5,
    borderColor: Colors.surface.border,
    borderRadius: Radii.input,
    paddingHorizontal: Spacing.base,
    height: 52,
  },
  inputWrapperFocused: {
    borderColor: Colors.brandAccent,
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
  primaryButton: {
    backgroundColor: Colors.brandAccent,
    height: 54,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
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
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.xs,
  },
  switchText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 14,
    color: Colors.text.primary,
  },
  switchLink: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: Colors.brandAccent,
  },
  infoCard: {
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    borderRadius: Radii.card,
    padding: Spacing.base,
    gap: Spacing.xs,
    marginTop: Spacing.base,
  },
  infoTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    color: Colors.navy,
  },
  infoText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 17,
    color: Colors.text.muted,
  },
});
