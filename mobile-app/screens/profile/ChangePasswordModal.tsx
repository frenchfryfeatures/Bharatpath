/**
 * BharatPath - ChangePasswordModal
 *
 * Allows signed-in candidates to change their account password.
 * Matches the website's password security requirements:
 *   - At least 8 characters
 *   - An uppercase letter
 *   - A lowercase letter
 *   - A number
 *
 * Calls AWS Cognito `ChangePassword` API via `changePassword()`.
 */
import React, { useState, useCallback } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  LockKey,
  Eye,
  EyeSlash,
  CheckCircle,
  XCircle,
  X,
  ShieldCheck,
} from 'phosphor-react-native';
import { Colors, Spacing, Radii, Typography } from '@/theme/tokens';
import { passwordRequirements } from '@/services/profile/onboarding';
import { changePassword } from '@/services/api/auth';
import { AppAlert } from '@/components/feedback/AppAlert';

export interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function ChangePasswordModal({
  visible,
  onClose,
  onSuccess,
}: ChangePasswordModalProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const requirements = passwordRequirements(newPassword);
  const allRequirementsMet = requirements.every((r) => r.met);

  const resetForm = useCallback(() => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setError(null);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    resetForm();
    onClose();
  }, [submitting, resetForm, onClose]);

  const handleSubmit = useCallback(async () => {
    setError(null);

    if (!currentPassword) {
      setError('Please enter your current password.');
      return;
    }
    if (!newPassword) {
      setError('Please enter a new password.');
      return;
    }
    if (!allRequirementsMet) {
      setError('New password does not meet all requirements.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('New password must be different from your current password.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirm password do not match.');
      return;
    }

    setSubmitting(true);
    try {
      await changePassword(currentPassword, newPassword);
      resetForm();
      onClose();
      onSuccess?.();
      AppAlert.alert(
        'Password Updated',
        'Your password has been changed successfully.',
        [{ text: 'OK' }],
      );
    } catch (err: any) {
      setError(err?.message || 'Could not update password. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    currentPassword,
    newPassword,
    confirmPassword,
    allRequirementsMet,
    resetForm,
    onClose,
    onSuccess,
  ]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.keyboardView}
        >
          <View style={styles.modalCard}>
            {/* Header */}
            <View style={styles.headerRow}>
              <View style={styles.headerTitleGroup}>
                <View style={styles.iconBadge}>
                  <LockKey size={20} color={Colors.purple} weight="duotone" />
                </View>
                <View style={styles.headerTextGroup}>
                  <Text style={styles.modalTitle}>Change password</Text>
                  <Text style={styles.modalSubtitle}>
                    Enter your current password, then choose a new one.
                  </Text>
                </View>
              </View>
              <Pressable
                style={({ pressed }) => [
                  styles.closeBtn,
                  pressed && styles.pressed,
                ]}
                onPress={handleClose}
                disabled={submitting}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X size={18} color={Colors.navy} weight="bold" />
              </Pressable>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.formScroll}
              keyboardShouldPersistTaps="handled"
            >
              {error ? (
                <View style={styles.errorBox}>
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {/* Current Password */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Current password</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={currentPassword}
                    onChangeText={setCurrentPassword}
                    placeholder="Enter current password"
                    placeholderTextColor="#9AA1AE"
                    secureTextEntry={!showCurrent}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    style={styles.eyeBtn}
                    onPress={() => setShowCurrent((v) => !v)}
                  >
                    {showCurrent ? (
                      <EyeSlash size={18} color="#718096" />
                    ) : (
                      <Eye size={18} color="#718096" />
                    )}
                  </Pressable>
                </View>
              </View>

              {/* New Password */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>New password</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={newPassword}
                    onChangeText={setNewPassword}
                    placeholder="Enter new password"
                    placeholderTextColor="#9AA1AE"
                    secureTextEntry={!showNew}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    style={styles.eyeBtn}
                    onPress={() => setShowNew((v) => !v)}
                  >
                    {showNew ? (
                      <EyeSlash size={18} color="#718096" />
                    ) : (
                      <Eye size={18} color="#718096" />
                    )}
                  </Pressable>
                </View>

                {/* Password Requirements Checklist */}
                <View style={styles.checklistCard}>
                  {requirements.map((req, idx) => (
                    <View key={idx} style={styles.checkItem}>
                      {req.met ? (
                        <CheckCircle
                          size={15}
                          color={Colors.green.fg}
                          weight="fill"
                        />
                      ) : (
                        <View style={styles.pendingDot} />
                      )}
                      <Text
                        style={[
                          styles.checkLabel,
                          req.met && styles.checkLabelMet,
                        ]}
                      >
                        {req.label}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* Confirm New Password */}
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>Confirm new password</Text>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={styles.textInput}
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    placeholder="Re-enter new password"
                    placeholderTextColor="#9AA1AE"
                    secureTextEntry={!showConfirm}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Pressable
                    style={styles.eyeBtn}
                    onPress={() => setShowConfirm((v) => !v)}
                  >
                    {showConfirm ? (
                      <EyeSlash size={18} color="#718096" />
                    ) : (
                      <Eye size={18} color="#718096" />
                    )}
                  </Pressable>
                </View>
              </View>

              {/* Actions Row */}
              <View style={styles.actionsRow}>
                <Pressable
                  style={({ pressed }) => [
                    styles.cancelBtn,
                    pressed && styles.pressed,
                  ]}
                  onPress={handleClose}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  <Text style={styles.cancelBtnText}>Cancel</Text>
                </Pressable>

                <Pressable
                  style={({ pressed }) => [
                    styles.submitBtn,
                    pressed && styles.pressed,
                    submitting && styles.btnDisabled,
                  ]}
                  onPress={handleSubmit}
                  disabled={submitting}
                  accessibilityRole="button"
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#FFFFFF" />
                  ) : (
                    <>
                      <ShieldCheck size={16} color="#FFFFFF" weight="bold" />
                      <Text style={styles.submitBtnText}>Update password</Text>
                    </>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.45)',
    justifyContent: 'flex-end',
  },
  keyboardView: {
    width: '100%',
    maxHeight: '90%',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: Spacing.xl,
    paddingTop: Spacing.xl,
    paddingBottom: Platform.OS === 'ios' ? 38 : Spacing.xl,
    gap: Spacing.base,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingBottom: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surface.hairline,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm + 2,
    flex: 1,
    paddingRight: Spacing.sm,
  },
  iconBadge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#F3F0FA',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E8E1F5',
  },
  headerTextGroup: {
    flex: 1,
    gap: 2,
  },
  modalTitle: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 18,
    lineHeight: 22,
    color: Colors.navy,
  },
  modalSubtitle: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 13,
    lineHeight: 17,
    color: Colors.text.muted,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: Colors.surface.tint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  formScroll: {
    gap: Spacing.base,
    paddingVertical: Spacing.xs,
  },
  errorBox: {
    backgroundColor: Colors.red.bg,
    borderWidth: 1,
    borderColor: 'rgba(153, 58, 34, 0.2)',
    borderRadius: Radii.tile,
    padding: Spacing.md,
  },
  errorText: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.red.fg,
  },
  fieldGroup: {
    gap: 6,
  },
  fieldLabel: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 13,
    lineHeight: 18,
    color: Colors.navy,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: Colors.surface.border,
    borderRadius: 14,
    paddingHorizontal: Spacing.md,
  },
  textInput: {
    flex: 1,
    height: 46,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 14,
    color: Colors.navy,
  },
  eyeBtn: {
    padding: 6,
  },
  checklistCard: {
    backgroundColor: Colors.surface.tint, // #F7F4EC
    borderRadius: 12,
    padding: Spacing.sm + 2,
    gap: 6,
    marginTop: 2,
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  checkItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pendingDot: {
    width: 15,
    height: 15,
    borderRadius: 7.5,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: 'transparent',
  },
  checkLabel: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 12,
    lineHeight: 16,
    color: Colors.text.muted,
  },
  checkLabelMet: {
    color: Colors.green.fg,
    fontFamily: 'GeneralSans-Semibold',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    marginTop: Spacing.sm,
  },
  cancelBtn: {
    flex: 1,
    height: 46,
    borderRadius: Radii.pill,
    backgroundColor: Colors.surface.tint,
    borderWidth: 1,
    borderColor: Colors.surface.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    color: Colors.navy,
  },
  submitBtn: {
    flex: 2,
    height: 46,
    borderRadius: Radii.pill,
    backgroundColor: Colors.purple, // #5F4DB2
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowColor: Colors.purple,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 3,
  },
  submitBtnText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 14,
    color: '#FFFFFF',
  },
  btnDisabled: {
    opacity: 0.65,
  },
});
