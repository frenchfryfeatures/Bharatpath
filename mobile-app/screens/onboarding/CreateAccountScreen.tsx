import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  Image,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Phone, EnvelopeSimple } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';
import { PhoneNumberInput } from '@/components/inputs/PhoneNumberInput';

export interface CreateAccountScreenProps {
  score?: number;
  bandName?: string;
  bandNumber?: number;
  bandTotal?: number;
  initialPhone?: string;
  title?: string;
  onBack?: () => void;
  onSendCode?: (phoneNumber: string) => void;
  onGoogleAuth?: () => void;
  onEmailAuth?: () => void;
}

export function CreateAccountScreen({
  score = 706,
  bandName = 'Emerging',
  bandNumber = 1,
  bandTotal = 4,
  initialPhone = '',
  title = 'Create account',
  onBack,
  onSendCode,
  onGoogleAuth,
  onEmailAuth,
}: CreateAccountScreenProps) {
  const [phoneNumber, setPhoneNumber] = useState(initialPhone);
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Format phone number with a space after 5 digits (e.g. "98765 43210")
  const formatPhoneNumber = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 10);
    if (cleaned.length > 5) {
      return `${cleaned.slice(0, 5)} ${cleaned.slice(5)}`;
    }
    return cleaned;
  };

  const handleChangeText = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 10);
    setPhoneNumber(cleaned);
  };

  const rawDigits = phoneNumber.replace(/\D/g, '');
  const formattedDisplay = formatPhoneNumber(rawDigits);
  const digitCount = rawDigits.length;

  const handleSendCode = () => {
    if (onSendCode) {
      onSendCode(phoneNumber || rawDigits);
    }
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" animated />
      <SafeAreaView style={styles.safeArea}>
        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 12 : 0}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
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
                <ArrowLeft size={16} color={Colors.navy} weight="bold" />
              </Pressable>
              <Text style={styles.navTitle}>{title}</Text>
            </View>

            {/* Score & Band Header Card - Clean solid deep navy */}
            <View style={styles.scoreCard}>
              {/* Left Score Column */}
              <View style={styles.scoreCol}>
                <Text
                  style={styles.scoreText}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.8}
                >
                  {score}
                </Text>
                <Text style={styles.outOfText} numberOfLines={1}>OUT OF 999</Text>
              </View>

              {/* Vertical Divider */}
              <View style={styles.scoreDivider} />

              {/* Right Band Status Column */}
              <View style={styles.bandCol}>
                <View style={styles.bandBadgeRow}>
                  <Text
                    style={styles.bandTitle}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    minimumFontScale={0.8}
                  >
                    {bandName}
                  </Text>
                  <View style={styles.bandBadge}>
                    <Text style={styles.bandBadgeText} numberOfLines={1}>
                      BAND {bandNumber} OF {bandTotal}
                    </Text>
                  </View>
                </View>
                <Text
                  style={styles.bandSubtitle}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.85}
                >
                  Verify to keep this score.
                </Text>
              </View>
            </View>

            {/* Headline & Subtitle */}
            <View style={styles.headingSection}>
              <Text style={styles.title}>Your phone number</Text>
              <Text style={styles.subtitle}>
                We send a 6-digit code. No password to remember.
              </Text>
            </View>

            {/* Phone Number Input */}
            <View style={{ marginBottom: 16 }}>
              <PhoneNumberInput
                value={phoneNumber}
                onChange={setPhoneNumber}
                hint="Select your country code, then enter your mobile number."
              />
            </View>

            {/* Primary Action Button */}
            <Pressable
              style={({ pressed }) => [
                styles.sendCodeButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleSendCode}
              accessibilityRole="button"
            >
              <Text style={styles.sendCodeText}>Send code</Text>
            </Pressable>

            {/* "or" Divider */}
            <View style={styles.orRow}>
              <View style={styles.orLine} />
              <Text style={styles.orText}>or</Text>
              <View style={styles.orLine} />
            </View>

            {/* Social & Alternative Auth Options */}
            <View style={styles.altButtonsContainer}>
              {/* Google Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.altButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onGoogleAuth}
                accessibilityRole="button"
              >
                <Image
                  source={require('../../assets/icons/google.png')}
                  style={styles.googleIcon}
                  resizeMode="contain"
                />
                <Text style={styles.altButtonText}>Continue with Google</Text>
              </Pressable>

              {/* Email Button */}
              <Pressable
                style={({ pressed }) => [
                  styles.altButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onEmailAuth}
                accessibilityRole="button"
              >
                <EnvelopeSimple size={18} color={Colors.navy} weight="bold" />
                <Text style={styles.altButtonText}>Use email instead</Text>
              </Pressable>
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
    backgroundColor: '#FFFCF7', // Matches brand offWhite canvas
  },
  safeArea: {
    flex: 1,
  },
  keyboardAvoid: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: Spacing.lg, // 20px
    paddingTop: Spacing.md, // 12px
    paddingBottom: Spacing.xxl, // 40px
    gap: Spacing.lg, // 20px
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md, // 12px
    paddingBottom: 4,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#E7E0D4',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  navTitle: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
    flex: 1,
  },
  scoreCard: {
    backgroundColor: '#5F4DB2', // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  scoreCol: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  scoreText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 34,
    lineHeight: 32,
    letterSpacing: -1.2,
    color: '#FFFFFF',
  },
  outOfText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 1.4,
    color: '#F1EAF7',
  },
  scoreDivider: {
    width: 1,
    height: 46,
    backgroundColor: 'rgba(255, 252, 247, 0.16)',
  },
  bandCol: {
    flex: 1,
    gap: 8,
    minWidth: 0,
  },
  bandBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'nowrap',
  },
  bandTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    lineHeight: 16,
    color: '#FFFFFF',
  },
  bandBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radii.pill,
    backgroundColor: '#F4D685',
  },
  bandBadgeText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 9,
    lineHeight: 11,
    letterSpacing: 0.8,
    color: '#0A1931',
  },
  bandSubtitle: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 12,
    lineHeight: 16,
    color: '#F1EAF7',
  },
  headingSection: {
    gap: 0,
    marginTop: 4,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: '#0A1931',
    margin: 0,
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
    margin: 0,
  },
  inputCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#0A1931',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 56,
  },
  inputCardFocused: {
    borderColor: '#5F4DB2',
  },
  countryCode: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 24,
    color: '#3A4761',
  },
  inputSeparator: {
    width: 1,
    height: 20,
    backgroundColor: '#E7E0D4',
  },
  textInput: {
    flex: 1,
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 17,
    lineHeight: 24,
    color: '#0A1931',
    letterSpacing: 0.4,
    paddingVertical: 4,
    minHeight: 40,
  },
  counterText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  sendCodeButton: {
    width: '100%',
    backgroundColor: '#5F4DB2', // #5F4DB2 matching BharatPath R_26Aug2026.dc.html
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendCodeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
  orRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  orLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E7E0D4',
  },
  orText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: '#5F6B80',
  },
  altButtonsContainer: {
    gap: 8,
  },
  altButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#DDD6C7',
    paddingVertical: 16,
    borderRadius: Radii.pill, // 999
  },
  googleIcon: {
    width: 18,
    height: 18,
  },
  altButtonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    lineHeight: 20,
    color: Colors.navy, // #0A1931
  },
});
