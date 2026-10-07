import React, { useState, useRef, useEffect } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import type { UploadedFileMeta } from '@/screens/onboarding/ResumeIntakeScreen';
import { previewSignupResume, type CareerDetails } from '@/services/api/career';
import { OnboardingProgress } from '@/screens/onboarding/OnboardingProgress';
import { passwordRequirements } from '@/services/profile/onboarding';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  ActivityIndicator,
  type LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import {
  ArrowLeft,
  User,
  EnvelopeSimple,
  Lock,
  Eye,
  EyeSlash,
  WarningCircle,
  ShieldCheck,
  Check,
  X,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { signUpWithEmail } from '@/services/api/auth';
import { ApiError } from '@/services/api/client';
import { useAuthContext } from '@/context/AuthContext';

export interface SignUpFormData {
  referralCode?: string;
  details: CareerDetails;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export interface SignUpScreenProps {
  onResumeSelected?: (file: UploadedFileMeta) => void;
  onBack?: () => void;
  onNavigateToLogin?: () => void;
  onSubmit?: (
    data: SignUpFormData,
    isUnconfirmed?: boolean,
  ) => void | Promise<void>;
}

export function SignUpScreen({
  onBack,
  onNavigateToLogin,
  onSubmit,
  onResumeSelected,
}: SignUpScreenProps) {
  const { rememberCandidate } = useAuthContext();
  const [fullName, setFullName] = useState('');
  const [resumeName, setResumeName] = useState('');
  const [resumeDetails, setResumeDetails] = useState<CareerDetails>({});
  const [phone, setPhone] = useState('');
  const [workStatus, setWorkStatus] = useState('');
  const [referralCode, setReferralCode] = useState('');
  const [readingResume, setReadingResume] = useState(false);
  const careerDetails = (): CareerDetails => ({
    ...resumeDetails,
    phone,
    work_status: workStatus,
    ...(workStatus === 'FRESHER'
      ? { experience_years: 0, experience_months: 0, currently_employed: 'NO' }
      : {}),
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [focusedField, setFocusedField] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Explicit input refs for clean, controlled keyboard navigation
  const fullNameRef = useRef<TextInput>(null);
  const emailRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmPasswordRef = useRef<TextInput>(null);
  const scrollRef = useRef<ScrollView>(null);
  const fieldOffsets = useRef<Record<string, number>>({});
  const formYRef = useRef<number>(0);
  const activeFieldKey = useRef<string | null>(null);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        const height = e.endCoordinates?.height || 280;
        setKeyboardHeight(height);
        if (activeFieldKey.current) {
          scrollToField(activeFieldKey.current, activeFieldKey.current !== 'referralCode');
        }
      },
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
        activeFieldKey.current = null;
      },
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const onFieldLayout = (key: string, event: LayoutChangeEvent) => {
    fieldOffsets.current[key] = event.nativeEvent.layout.y;
  };

  const scrollToField = (key: string, isInsideForm = true) => {
    activeFieldKey.current = key;
    const performScroll = () => {
      const localY = fieldOffsets.current[key];
      if (localY !== undefined && scrollRef.current) {
        const totalY = isInsideForm ? formYRef.current + localY : localY;
        scrollRef.current.scrollTo({ y: Math.max(0, totalY - 70), animated: true });
      }
    };
    performScroll();
    setTimeout(performScroll, 80);
    setTimeout(performScroll, 200);
    setTimeout(performScroll, 350);
  };

  // Validation rules according to backend invariants:
  // - full_name: 1-100 chars, letters, spaces, . ' - only, no digits or @
  // - candidate pool: 8 characters, uppercase, lowercase and a number
  const validate = (): boolean => {
    setErrorMsg(null);
    if (readingResume) return false;
    if (!/^\+[1-9]\d{7,14}$/.test(phone) || !workStatus) {
      setErrorMsg(
        !workStatus
          ? 'Choose experienced or fresher.'
          : 'Enter your mobile number in international format, for example +919876543210.',
      );
      return false;
    }

    const trimmedName = fullName.trim();
    if (!trimmedName) {
      setErrorMsg('Please enter your full name.');
      return false;
    }
    if (trimmedName.length > 100) {
      setErrorMsg('Full name cannot exceed 100 characters.');
      return false;
    }
    const nameRegex = /^[a-zA-Z\s\.\'\-]+$/;
    if (!nameRegex.test(trimmedName)) {
      setErrorMsg(
        'Full name can only contain letters, spaces, dots, hyphens, and apostrophes (no digits or @).',
      );
      return false;
    }

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

    if (password.length < 8) {
      setErrorMsg('Password must be at least 8 characters long.');
      return false;
    }
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    if (!hasUpper || !hasLower || !hasNumber) {
      setErrorMsg(
        'Password must include uppercase, lowercase and a number. Symbols are optional.',
      );
      return false;
    }

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return false;
    }

    return true;
  };

  const requirements = passwordRequirements(password);

  const handleSubmit = async () => {
    if (!validate()) return;

    setIsLoading(true);
    setErrorMsg(null);

    try {
      const result = await signUpWithEmail({
        fullName: fullName.trim(),
        email: email.trim().toLowerCase(),
        password,
      });

      if ('unconfirmed' in result && result.unconfirmed) {
        if (onSubmit) {
          await onSubmit(
            {
              fullName: fullName.trim(),
              email: email.trim().toLowerCase(),
              password,
              confirmPassword,
              details: careerDetails(),
              referralCode: referralCode.trim().toUpperCase(),
            },
            true,
          );
        }
        return;
      }

      rememberCandidate(
        result as any,
        {
          full_name: fullName.trim(),
          city: null,
          state_code: null,
          updated_at: null,
        },
        fullName.trim(),
      );

      if (onSubmit) {
        await onSubmit(
          {
            fullName: fullName.trim(),
            email: email.trim().toLowerCase(),
            password,
            confirmPassword,
            details: careerDetails(),
            referralCode: referralCode.trim().toUpperCase(),
          },
          false,
        );
      }
    } catch (err: any) {
      if (err instanceof ApiError && err.code === 'user_not_confirmed') {
        if (onSubmit) {
          await onSubmit(
            {
              fullName: fullName.trim(),
              email: email.trim().toLowerCase(),
              password,
              confirmPassword,
              details: careerDetails(),
              referralCode: referralCode.trim().toUpperCase(),
            },
            true,
          );
          return;
        }
      }
      console.error('[SignUp Error]:', err);
      if (err instanceof ApiError) {
        if (err.code === 'account_contact_in_use') {
          setErrorMsg(
            'An account with this email already exists. Please sign in instead.',
          );
        } else if (err.code === 'network_error') {
          setErrorMsg(
            'Cannot reach backend server. Please verify your internet connection.',
          );
        } else {
          setErrorMsg(
            err.problem?.title || err.message || 'Failed to create account.',
          );
        }
      } else {
        setErrorMsg(
          err?.message ||
            'Failed to create account. Please check your connection.',
        );
      }
    } finally {
      setIsLoading(false);
    }
  };

  const isFormFilled =
    fullName.trim().length > 0 &&
    email.trim().length > 0 &&
    password.length >= 8 &&
    confirmPassword.length >= 8;

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
            <Text style={styles.navTitle}>Create Account</Text>
            <View style={styles.navPlaceholder} />
          </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={[
              styles.scrollContent,
              {
                paddingBottom:
                  keyboardHeight > 0 ? keyboardHeight + 120 : Spacing.xxl,
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
          >
            {/* Header / Intro */}
            <View style={styles.headerSection}>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <ShieldCheck
                    size={14}
                    color={Colors.brandAccent}
                    weight="bold"
                  />
                  <Text style={styles.badgeText}>CANDIDATE SIGNUP</Text>
                </View>
              </View>
              <OnboardingProgress step={0} />
              <Text style={styles.title}>Basic details</Text>
              <Text style={styles.subtitle}>
                Create an account to evaluate your resume, discover matching
                jobs, and get recruited.
              </Text>
            </View>

            {onResumeSelected && (
              <View style={{ marginBottom: 24, gap: 10 }}>
                <Text
                  style={{
                    fontFamily: 'GeneralSans-Semibold',
                    fontSize: 16,
                    color: '#0A1931',
                  }}
                >
                  Start with your resume
                </Text>
                <Pressable
                  style={{
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: '#DDD6C7',
                    padding: 16,
                    backgroundColor: '#fff',
                  }}
                  disabled={readingResume || isLoading}
                  onPress={async () => {
                    try {
                      const result = await DocumentPicker.getDocumentAsync({
                        type: [
                          'application/pdf',
                          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                        ],
                        copyToCacheDirectory: true,
                      });
                      if (result.canceled) return;
                      const asset = result.assets[0];
                      if (asset.size && asset.size > 10 * 1024 * 1024) {
                        setErrorMsg('Choose a PDF or DOCX up to 10 MB.');
                        return;
                      }
                      setResumeName(asset.name);
                      onResumeSelected?.({
                        fileName: asset.name,
                        fileUri: asset.uri,
                        fileSizeBytes: asset.size,
                        fileSize: asset.size
                          ? `${Math.round(asset.size / 1024)} KB`
                          : '',
                        mimeType: asset.mimeType,
                      });
                      setErrorMsg(null);
                      setReadingResume(true);
                      try {
                        const facts = await previewSignupResume({
                          fileName: asset.name,
                          fileUri: asset.uri,
                          mimeType: asset.mimeType,
                          fileSize: '',
                        });
                        setResumeDetails(facts.details);
                        if (facts.full_name?.trim())
                          setFullName((current) => current || facts.full_name.trim());
                        if (facts.email?.trim())
                          setEmail((current) => current || facts.email.trim());
                        if (facts.details?.phone)
                          setPhone((current) => current || String(facts.details.phone).trim());
                        if (facts.details?.work_status)
                          setWorkStatus(
                            (current) => current || String(facts.details.work_status).trim(),
                          );
                      } catch (err) {
                        console.warn('Transient resume preview skipped or unavailable:', err);
                      } finally {
                        setReadingResume(false);
                      }
                    } catch (pickerErr) {
                      console.warn('Document picker error:', pickerErr);
                    }
                  }}
                >
                  <Text
                    style={{
                      fontFamily: 'GeneralSans-Medium',
                      color: '#5F4DB2',
                    }}
                  >
                    {resumeName || 'Choose PDF or DOCX'}
                  </Text>
                </Pressable>
                <Text
                  style={{
                    fontFamily: 'GeneralSans-Regular',
                    color: '#5F6B80',
                    fontSize: 13,
                    lineHeight: 20,
                  }}
                >
                  {readingResume
                    ? 'Reading your resume and filling your details…'
                    : 'Your resume fills your details now. Scoring starts after payment.'}
                </Text>
              </View>
            )}
            {/* Error Message Box */}
            {errorMsg ? (
              <View style={styles.errorContainer}>
                <WarningCircle size={18} color={Colors.red.fg} weight="fill" />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            {/* Form Fields */}
            <View
              style={styles.form}
              onLayout={(e) => {
                formYRef.current = e.nativeEvent.layout.y;
              }}
            >
              {/* Full Name */}
              <View
                style={styles.inputGroup}
                onLayout={(e) => onFieldLayout('fullName', e)}
              >
                <Text style={styles.inputLabel}>Full Name</Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'fullName' && styles.inputWrapperFocused,
                  ]}
                >
                  <User
                    size={20}
                    color={
                      focusedField === 'fullName'
                        ? Colors.brandAccent
                        : Colors.text.muted
                    }
                  />
                  <TextInput
                    ref={fullNameRef}
                    style={styles.textInput}
                    placeholder="e.g. Priya Sharma"
                    placeholderTextColor={Colors.text.muted}
                    value={fullName}
                    onChangeText={(text) => {
                      setFullName(text);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onFocus={() => {
                      setFocusedField('fullName');
                      scrollToField('fullName');
                    }}
                    onBlur={() => {
                      setFocusedField(null);
                      if (activeFieldKey.current === 'fullName')
                        activeFieldKey.current = null;
                    }}
                    autoCapitalize="words"
                    autoCorrect={false}
                    maxLength={100}
                    editable={!isLoading}
                    blurOnSubmit={false}
                    returnKeyType="next"
                    onSubmitEditing={() => emailRef.current?.focus()}
                    textContentType="name"
                    autoComplete="name"
                  />
                </View>
                <Text style={styles.inputHint}>
                  Only letters and spaces. Stored in profile upon signup.
                </Text>
              </View>

              {/* Email Address */}
              <View
                style={styles.inputGroup}
                onLayout={(e) => onFieldLayout('email', e)}
              >
                <Text style={styles.inputLabel}>Email Address</Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'email' && styles.inputWrapperFocused,
                  ]}
                >
                  <EnvelopeSimple
                    size={20}
                    color={
                      focusedField === 'email'
                        ? Colors.brandAccent
                        : Colors.text.muted
                    }
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
                    onFocus={() => {
                      setFocusedField('email');
                      scrollToField('email');
                    }}
                    onBlur={() => {
                      setFocusedField(null);
                      if (activeFieldKey.current === 'email')
                        activeFieldKey.current = null;
                    }}
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
                </View>
                <Text style={styles.inputHint}>
                  Used to verify your identity and send notification updates.
                </Text>
              </View>

              <View
                style={{ marginBottom: 24, gap: 12 }}
                onLayout={(e) => onFieldLayout('phone', e)}
              >
                <Text style={styles.inputLabel}>Mobile number *</Text>
                <TextInput
                  value={phone}
                  onChangeText={setPhone}
                  onFocus={() => {
                    setFocusedField('phone');
                    scrollToField('phone');
                  }}
                  onBlur={() => {
                    setFocusedField(null);
                    if (activeFieldKey.current === 'phone')
                      activeFieldKey.current = null;
                  }}
                  keyboardType="phone-pad"
                  placeholder="+919876543210"
                  accessibilityLabel="Mobile number"
                  style={{
                    borderWidth: 1,
                    borderColor: '#E7E0D4',
                    borderRadius: 16,
                    padding: 16,
                    fontFamily: 'GeneralSans-Medium',
                    fontSize: 16,
                  }}
                />
                <Text style={styles.inputLabel}>Work status *</Text>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {[
                    { value: 'EXPERIENCED', label: "I'm experienced" },
                    { value: 'FRESHER', label: "I'm a fresher" },
                  ].map((item) => (
                    <Pressable
                      key={item.value}
                      onPress={() => setWorkStatus(item.value)}
                      style={{
                        flex: 1,
                        padding: 16,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor:
                          workStatus === item.value ? '#5F4DB2' : '#E7E0D4',
                        backgroundColor:
                          workStatus === item.value ? '#F1EAF7' : '#fff',
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: 'GeneralSans-Medium',
                          color: '#0A1931',
                        }}
                      >
                        {item.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
              {/* Password */}
              <View
                style={styles.inputGroup}
                onLayout={(e) => onFieldLayout('password', e)}
              >
                <Text style={styles.inputLabel}>Password</Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'password' && styles.inputWrapperFocused,
                  ]}
                >
                  <Lock
                    size={20}
                    color={
                      focusedField === 'password'
                        ? Colors.brandAccent
                        : Colors.text.muted
                    }
                  />
                  <TextInput
                    ref={passwordRef}
                    style={styles.textInput}
                    placeholder="At least 8 characters"
                    placeholderTextColor={Colors.text.muted}
                    value={password}
                    onChangeText={(text) => {
                      setPassword(text);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onFocus={() => {
                      setFocusedField('password');
                      scrollToField('password');
                    }}
                    onBlur={() => {
                      setFocusedField(null);
                      if (activeFieldKey.current === 'password')
                        activeFieldKey.current = null;
                    }}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    blurOnSubmit={false}
                    returnKeyType="next"
                    onSubmitEditing={() => confirmPasswordRef.current?.focus()}
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />
                  <Pressable
                    accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
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
                </View>
                {password.length > 0 ? (
                  <View style={{ backgroundColor: '#F7F4EC', borderColor: '#E7E0D4', borderWidth: 1, borderRadius: 14, padding: 14, gap: 10 }}>
                    {requirements.map(({ label, met }) => {
                      const Icon = met ? Check : X;
                      const color = met ? '#1F6B45' : '#A33A2B';
                      return <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Icon size={17} color={color} weight="bold" />
                        <Text accessibilityLabel={`${label}: ${met ? 'met' : 'not met'}`} style={[styles.inputHint, { color, fontFamily: 'GeneralSans-Medium' }]}>{label}</Text>
                      </View>;
                    })}
                  </View>
                ) : (
                  <Text style={styles.inputHint}>
                    Must be at least 8 characters with uppercase, lowercase,
                    and a number. Symbols are optional.
                  </Text>
                )}
              </View>

              {/* Confirm Password */}
              <View
                style={styles.inputGroup}
                onLayout={(e) => onFieldLayout('confirmPassword', e)}
              >
                <Text style={styles.inputLabel}>Confirm Password</Text>
                <View
                  style={[
                    styles.inputWrapper,
                    focusedField === 'confirmPassword' &&
                      styles.inputWrapperFocused,
                  ]}
                >
                  <Lock
                    size={20}
                    color={
                      focusedField === 'confirmPassword'
                        ? Colors.brandAccent
                        : Colors.text.muted
                    }
                  />
                  <TextInput
                    ref={confirmPasswordRef}
                    style={styles.textInput}
                    placeholder="Re-enter your password"
                    placeholderTextColor={Colors.text.muted}
                    value={confirmPassword}
                    onChangeText={(text) => {
                      setConfirmPassword(text);
                      if (errorMsg) setErrorMsg(null);
                    }}
                    onFocus={() => {
                      setFocusedField('confirmPassword');
                      scrollToField('confirmPassword');
                    }}
                    onBlur={() => {
                      setFocusedField(null);
                      if (activeFieldKey.current === 'confirmPassword')
                        activeFieldKey.current = null;
                    }}
                    secureTextEntry={!showConfirmPassword}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!isLoading}
                    blurOnSubmit={true}
                    returnKeyType="done"
                    onSubmitEditing={handleSubmit}
                    textContentType="newPassword"
                    autoComplete="new-password"
                  />
                  <Pressable
                    accessibilityLabel={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                    onPress={() => setShowConfirmPassword(!showConfirmPassword)}
                    hitSlop={8}
                    style={styles.eyeButton}
                  >
                    {showConfirmPassword ? (
                      <EyeSlash size={20} color={Colors.text.muted} />
                    ) : (
                      <Eye size={20} color={Colors.text.muted} />
                    )}
                  </Pressable>
                </View>
                {confirmPassword.length > 0 && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {confirmPassword === password ? <Check size={17} color="#1F6B45" weight="bold" /> : <X size={17} color="#A33A2B" weight="bold" />}
                    <Text style={[styles.inputHint, { fontFamily: 'GeneralSans-Medium', color: confirmPassword === password ? '#1F6B45' : '#A33A2B' }]}>
                      {confirmPassword === password ? 'Passwords match.' : 'Passwords do not match.'}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Submit Button */}
            <View
              style={[styles.inputGroup, { marginBottom: 24 }]}
              onLayout={(e) => onFieldLayout('referralCode', e)}
            >
              <Text style={styles.inputLabel}>College referral code (optional)</Text>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={styles.textInput}
                  accessibilityLabel="College referral code"
                  value={referralCode}
                  onChangeText={setReferralCode}
                  maxLength={32}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  placeholder="Enter your college code"
                  editable={!isLoading}
                  onFocus={() => {
                    setFocusedField('referralCode');
                    scrollToField('referralCode', false);
                  }}
                  onBlur={() => {
                    setFocusedField(null);
                    if (activeFieldKey.current === 'referralCode')
                      activeFieldKey.current = null;
                  }}
                />
              </View>
              <Text style={styles.inputHint}>This is separate from a payment discount code. You choose whether to link after verifying your email.</Text>
            </View>
            <Pressable
              style={({ pressed }) => [
                styles.primaryButton,
                (!isFormFilled || isLoading) && styles.primaryButtonDisabled,
                pressed && isFormFilled && !isLoading && styles.buttonPressed,
              ]}
              onPress={handleSubmit}
              disabled={!isFormFilled || isLoading || readingResume}
              accessibilityRole="button"
            >
              {isLoading ? (
                <ActivityIndicator color="#FFFFFF" size="small" />
              ) : (
                <Text style={styles.primaryButtonText}>Create Account</Text>
              )}
            </Pressable>

            {/* Bottom Switch Link */}
            <View style={styles.switchRow}>
              <Text style={styles.switchText}>Already have an account?</Text>
              <Pressable
                onPress={onNavigateToLogin}
                hitSlop={8}
                disabled={isLoading}
              >
                <Text style={styles.switchLink}>Sign In</Text>
              </Pressable>
            </View>

            {/* Legal / DPDP Notice */}
            <View style={styles.legalSection}>
              <Text style={styles.legalText}>
                By creating an account, you agree to BharatPath&apos;s Terms of
                Service and Privacy Policy. Your data is protected in accordance
                with the Digital Personal Data Protection (DPDP) Act.
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
    gap: Spacing.base,
  },
  inputGroup: {
    gap: Spacing.opt6,
  },
  inputLabel: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.navy,
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
    height: '100%',
  },
  eyeButton: {
    padding: Spacing.xs,
  },
  inputHint: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
    paddingHorizontal: 2,
  },
  primaryButton: {
    backgroundColor: Colors.brandAccent,
    height: 54,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.xs,
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
    marginTop: Spacing.xs,
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
  legalSection: {
    marginTop: Spacing.base,
    paddingTop: Spacing.base,
    borderTopWidth: 1,
    borderTopColor: Colors.surface.hairline,
  },
  legalText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 11,
    lineHeight: 16,
    color: Colors.text.muted,
    textAlign: 'center',
  },
});
