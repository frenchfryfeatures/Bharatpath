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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { ArrowLeft, Clock, PhoneCall } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export interface OtpVerificationScreenProps {
  phoneNumber?: string;
  initialCode?: string;
  onBack?: () => void;
  onChangePhone?: () => void;
  onVerify?: (otp: string) => void;
  onResend?: () => void;
  onCallInstead?: () => void;
}

export function OtpVerificationScreen({
  phoneNumber = '98765 43242',
  initialCode = '',
  onBack,
  onChangePhone,
  onVerify,
  onResend,
  onCallInstead,
}: OtpVerificationScreenProps) {
  const [otp, setOtp] = useState(initialCode);
  const [isFocused, setIsFocused] = useState(false);
  const [countdown, setCountdown] = useState(24);
  const inputRef = useRef<TextInput>(null);

  // Auto-focus on mount with slight delay
  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  // Countdown timer effect
  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  const handleOtpChange = (text: string) => {
    const cleaned = text.replace(/\D/g, '').slice(0, 6);
    setOtp(cleaned);
  };

  const handleContainerPress = () => {
    inputRef.current?.focus();
  };

  const handleVerify = () => {
    if (onVerify) {
      onVerify(otp);
    }
  };

  const handleResendPress = () => {
    if (countdown === 0) {
      setCountdown(30);
      if (onResend) {
        onResend();
      }
    }
  };

  // Format phone number nicely for display (e.g., "+91 98765 43242")
  const formatDisplayPhone = (phone: string) => {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
    }
    return phone.startsWith('+91') ? phone : `+91 ${phone}`;
  };

  // 6 boxes
  const otpCells = [0, 1, 2, 3, 4, 5];
  const activeIndex = isFocused ? Math.min(otp.length, 5) : -1;

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
              <Text style={styles.navTitle}>Verify code</Text>
            </View>

            {/* Headline & Subtitle */}
            <View style={styles.headingSection}>
              <Text style={styles.title}>Enter the code</Text>
              <Text style={styles.subtitle}>
                Sent to {formatDisplayPhone(phoneNumber)} ·{' '}
                <Text
                  style={styles.changeLink}
                  onPress={onChangePhone || onBack}
                >
                  Change
                </Text>
              </Text>
            </View>

            {/* 6-Digit OTP Code Cells */}
            <Pressable
              style={styles.otpGrid}
              onPress={handleContainerPress}
              accessible={false}
            >
              {otpCells.map((index) => {
                const digit = otp[index] || '';
                const isCurrentActive = isFocused && index === activeIndex;

                return (
                  <View
                    key={index}
                    pointerEvents="none"
                    style={[
                      styles.otpBox,
                      isCurrentActive && styles.otpBoxActive,
                    ]}
                  >
                    <Text style={styles.otpDigitText}>{digit}</Text>
                  </View>
                );
              })}

              {/* Hidden Real Master TextInput */}
              <TextInput
                ref={inputRef}
                style={styles.hiddenInput}
                value={otp}
                onChangeText={handleOtpChange}
                keyboardType="number-pad"
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                maxLength={6}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                autoFocus={true}
                caretHidden={true}
              />
            </Pressable>

            {/* Resend & Call Me Meta Row */}
            <View style={styles.metaRow}>
              {countdown > 0 ? (
                <View style={styles.resendTimerRow}>
                  <Clock size={14} color="#5F6B80" weight="bold" />
                  <Text style={styles.resendTimerText}>
                    Resend in 0:{countdown < 10 ? `0${countdown}` : countdown}
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={({ pressed }) => [
                    styles.resendActiveRow,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={handleResendPress}
                >
                  <Clock size={14} color={Colors.navy} weight="bold" />
                  <Text style={styles.resendActiveText}>Resend code</Text>
                </Pressable>
              )}

              <Pressable
                style={({ pressed }) => [
                  styles.callMeRow,
                  pressed && styles.buttonPressed,
                ]}
                onPress={onCallInstead}
              >
                <PhoneCall size={14} color={Colors.navy} weight="bold" />
                <Text style={styles.callMeText}>Call me instead</Text>
              </Pressable>
            </View>

            {/* Primary Action Button */}
            <Pressable
              style={({ pressed }) => [
                styles.verifyButton,
                pressed && styles.buttonPressed,
              ]}
              onPress={handleVerify}
              accessibilityRole="button"
            >
              <Text style={styles.verifyText}>Verify</Text>
            </Pressable>
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
    borderColor: '#DDD6C7',
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
  headingSection: {
    gap: 4,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.7,
    color: Colors.navy, // #0A1931
  },
  subtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: Colors.text.primary, // #3A4761
  },
  changeLink: {
    fontFamily: 'GeneralSans-Semibold',
    color: Colors.navy,
  },
  otpGrid: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    position: 'relative',
  },
  otpBox: {
    flex: 1,
    aspectRatio: 1,
    maxHeight: 60,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#DDD6C7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  otpBoxActive: {
    borderColor: Colors.navy, // #0A1931
    borderWidth: 1.5,
  },
  otpDigitText: {
    fontFamily: 'SpaceMono-Bold',
    fontSize: 22,
    lineHeight: 24,
    color: Colors.navy,
  },
  hiddenInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: '100%',
    height: '100%',
    opacity: 0.01,
    color: 'transparent',
    zIndex: 10,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  resendTimerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resendTimerText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 16,
    color: '#5F6B80',
  },
  resendActiveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  resendActiveText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: Colors.navy,
  },
  callMeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  callMeText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 16,
    color: Colors.navy,
  },
  verifyButton: {
    width: '100%',
    backgroundColor: '#5F4DB2',
    paddingVertical: 18,
    borderRadius: Radii.pill, // 999
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  verifyText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 20,
    color: '#FFFFFF',
  },
});
