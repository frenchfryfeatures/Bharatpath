/**
 * BharatPath - ProfilePhotoModal
 *
 * Dedicated candidate profile photo manager for students:
 *   - Circular preview of current photo (or initials)
 *   - Camera capture with square crop via `expo-image-picker`
 *   - Photo library pick with square crop via `expo-image-picker`
 *   - Validates size (≤ 5MB) and mime type (JPEG, PNG, WebP)
 *   - Direct S3 binary upload + backend confirmation
 *   - Photo removal via `DELETE /profile/photo`
 *
 * Synchronized with the web frontend:
 * The photo uploaded here appears identically on web and vice-versa.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  Camera,
  Image as ImageIcon,
  Trash,
  X,
  CheckCircle,
  WarningCircle,
} from 'phosphor-react-native';
import { Colors, Radii, Spacing, Typography } from '@/theme/tokens';
import {
  createProfilePhotoUpload,
  uploadPhotoBinary,
  confirmProfilePhoto,
  deleteProfilePhoto,
} from '@/services/api/profilePhoto';

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

interface ProfilePhotoModalProps {
  visible: boolean;
  onClose: () => void;
  currentPhotoUrl?: string | null;
  candidateName?: string;
  initials?: string;
  onPhotoUpdated?: (newUrl: string | null) => void;
}

export function ProfilePhotoModal({
  visible,
  onClose,
  currentPhotoUrl,
  candidateName = 'Candidate',
  initials = 'C',
  onPhotoUpdated,
}: ProfilePhotoModalProps) {
  const [busy, setBusy] = useState(false);
  const [busyText, setBusyText] = useState('Updating photo...');
  const [error, setError] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  const displayInitials = initials.trim() || 'C';
  const hasPhoto = Boolean(currentPhotoUrl && !imageError);

  const resetState = () => {
    setError(null);
    setBusy(false);
    setImageError(false);
  };

  const handleClose = () => {
    if (busy) return;
    resetState();
    onClose();
  };

  const processAndUpload = async (asset: ImagePicker.ImagePickerAsset) => {
    setError(null);

    // 1. Validate file size if available from picker
    if (asset.fileSize && asset.fileSize > MAX_BYTES) {
      setError('That image is too large. The limit is 5 MB.');
      return;
    }

    // 2. Validate MIME type
    let mimeType = asset.mimeType;
    if (!mimeType) {
      const ext = (asset.uri.split('.').pop() || '').toLowerCase();
      if (ext === 'png') mimeType = 'image/png';
      else if (ext === 'webp') mimeType = 'image/webp';
      else mimeType = 'image/jpeg';
    }

    if (!ACCEPTED_TYPES.includes(mimeType)) {
      setError('Please select a JPEG, PNG, or WebP image.');
      return;
    }

    setBusy(true);
    setBusyText('Preparing upload...');

    try {
      // Step A: Request presigned ticket from backend
      const ticket = await createProfilePhotoUpload();

      if (asset.fileSize && asset.fileSize > ticket.max_bytes) {
        setError(`That image is too large. The limit is 5 MB.`);
        setBusy(false);
        return;
      }

      setBusyText('Uploading photo...');

      // Step B: Direct binary upload to S3/storage
      await uploadPhotoBinary(ticket.url, asset.uri, mimeType);

      setBusyText('Optimizing & confirming...');

      // Step C: Confirm with backend (server verifies, strips EXIF, rescales to 512px)
      const confirmed = await confirmProfilePhoto(ticket.upload_id);

      setImageError(false);
      onPhotoUpdated?.(confirmed.url);
      setBusy(false);
      onClose();
    } catch (caught: any) {
      setBusy(false);
      const msg =
        caught?.message ||
        caught?.error ||
        'Could not upload your photo. Please try again.';
      setError(msg);
    }
  };

  const handleLaunchCamera = async () => {
    setError(null);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Camera Permission',
          'Camera access is required to take a profile photo. Please enable camera access in your device settings.',
        );
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await processAndUpload(result.assets[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not open camera.');
    }
  };

  const handleLaunchLibrary = async () => {
    setError(null);
    try {
      const { status } =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Photo Library Permission',
          'Photo library access is required to select a profile photo. Please enable photo access in your device settings.',
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        await processAndUpload(result.assets[0]);
      }
    } catch (err: any) {
      setError(err?.message || 'Could not open photo library.');
    }
  };

  const handleRemovePhoto = () => {
    Alert.alert(
      'Remove Photo',
      'Are you sure you want to remove your profile photo? Your account will show initials instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setBusyText('Removing photo...');
            try {
              await deleteProfilePhoto();
              setImageError(false);
              onPhotoUpdated?.(null);
              setBusy(false);
              onClose();
            } catch (caught: any) {
              setBusy(false);
              setError(
                caught?.message ||
                  'Could not remove profile photo. Please try again.',
              );
            }
          },
        },
      ],
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={handleClose} />

        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerTitleRow}>
              <Text style={styles.title}>Profile Photo</Text>
              <Pressable
                onPress={handleClose}
                disabled={busy}
                hitSlop={12}
                style={({ pressed }) => [
                  styles.closeButton,
                  pressed && styles.buttonPressed,
                ]}
                accessibilityLabel="Close"
              >
                <X size={20} color={Colors.navy} weight="bold" />
              </Pressable>
            </View>
            <Text style={styles.subtitle}>
              Your photo is private to you and BharatPath staff. Employers and
              colleges cannot see your photo.
            </Text>
          </View>

          {/* Avatar Preview */}
          <View style={styles.previewContainer}>
            <View style={styles.avatarRing}>
              {hasPhoto ? (
                <Image
                  source={{ uri: currentPhotoUrl! }}
                  style={styles.avatarImage}
                  onError={() => setImageError(true)}
                />
              ) : (
                <View style={styles.initialsContainer}>
                  <Text style={styles.initialsText}>{displayInitials}</Text>
                </View>
              )}
            </View>
            <Text style={styles.candidateName} numberOfLines={1}>
              {candidateName}
            </Text>
          </View>

          {/* Error Banner */}
          {error ? (
            <View style={styles.errorBox}>
              <WarningCircle size={16} color="#DC2626" weight="fill" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          {/* Busy Overlay */}
          {busy ? (
            <View style={styles.busyContainer}>
              <ActivityIndicator size="small" color="#5F4DB2" />
              <Text style={styles.busyText}>{busyText}</Text>
            </View>
          ) : (
            /* Action Buttons */
            <View style={styles.actionsContainer}>
              <Pressable
                style={({ pressed }) => [
                  styles.primaryActionButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleLaunchCamera}
                accessibilityRole="button"
              >
                <Camera size={20} color="#FFFFFF" weight="bold" />
                <Text style={styles.primaryActionText}>Take Photo</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.secondaryActionButton,
                  pressed && styles.buttonPressed,
                ]}
                onPress={handleLaunchLibrary}
                accessibilityRole="button"
              >
                <ImageIcon size={20} color="#5F4DB2" weight="bold" />
                <Text style={styles.secondaryActionText}>
                  Choose from Library
                </Text>
              </Pressable>

              {hasPhoto ? (
                <Pressable
                  style={({ pressed }) => [
                    styles.dangerActionButton,
                    pressed && styles.buttonPressed,
                  ]}
                  onPress={handleRemovePhoto}
                  accessibilityRole="button"
                >
                  <Trash size={18} color="#DC2626" weight="bold" />
                  <Text style={styles.dangerActionText}>Remove Photo</Text>
                </Pressable>
              ) : null}
            </View>
          )}

          {/* Footer note */}
          <Text style={styles.footerNote}>
            JPEG, PNG or WebP · Maximum size 5 MB
          </Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.55)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: Spacing.lg,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  sheet: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: '#FFFFFF',
    borderRadius: Radii.cardLg,
    padding: Spacing.xl,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  header: {
    marginBottom: Spacing.md,
  },
  headerTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 18,
    fontWeight: '700',
    color: Colors.navy,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F1EAF7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 17,
    color: '#68758A',
  },
  previewContainer: {
    alignItems: 'center',
    marginVertical: Spacing.md,
  },
  avatarRing: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 3,
    borderColor: '#5F4DB2',
    backgroundColor: '#F1EAF7',
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 4,
  },
  avatarImage: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  initialsContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1EAF7',
  },
  initialsText: {
    fontSize: 40,
    fontWeight: '700',
    color: '#5F4DB2',
    letterSpacing: 1,
  },
  candidateName: {
    marginTop: 10,
    fontSize: 14,
    fontWeight: '600',
    color: Colors.navy,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FCA5A5',
    borderRadius: Radii.input,
    padding: Spacing.sm,
    marginBottom: Spacing.md,
  },
  errorText: {
    flex: 1,
    fontSize: 12,
    color: '#991B1B',
    lineHeight: 16,
  },
  busyContainer: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
    gap: 10,
  },
  busyText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  actionsContainer: {
    gap: 10,
    marginTop: 4,
  },
  primaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#5F4DB2',
    paddingVertical: 13,
    borderRadius: Radii.input,
  },
  primaryActionText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#E9E4F0',
    paddingVertical: 12,
    borderRadius: Radii.input,
  },
  secondaryActionText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5F4DB2',
  },
  dangerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FED7D7',
    paddingVertical: 11,
    borderRadius: Radii.input,
    marginTop: 2,
  },
  dangerActionText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#DC2626',
  },
  buttonPressed: {
    opacity: 0.82,
    transform: [{ scale: 0.98 }],
  },
  footerNote: {
    textAlign: 'center',
    fontSize: 11,
    color: '#94A3B8',
    marginTop: Spacing.md,
  },
});
