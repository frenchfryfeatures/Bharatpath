import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle, Info, WarningCircle } from 'phosphor-react-native';
import { Colors, Radii, Spacing } from '@/theme/tokens';

export type ToastTone = 'error' | 'success' | 'info';

interface ToastRequest {
  id: number;
  message: string;
  tone: ToastTone;
  durationMs: number;
}

type ToastListener = (request: ToastRequest) => void;

// Stack of mounted toast hosts; only the top-most host (e.g. an open Modal,
// falling back to RootLayout) renders the toast so it is never hidden behind
// an Android native Modal window.
const hostStack: ToastListener[] = [];
let nextToastId = 1;

export const AppToast = {
  show(message: string, tone: ToastTone = 'error', durationMs = 3400) {
    const trimmed = message.trim();
    if (!trimmed) return;
    const activeHost = hostStack[hostStack.length - 1];
    if (!activeHost) return;
    activeHost({
      id: nextToastId++,
      message: trimmed,
      tone,
      durationMs,
    });
  },
  error(message: string, durationMs = 3600) {
    AppToast.show(message, 'error', durationMs);
  },
  success(message: string, durationMs = 3000) {
    AppToast.show(message, 'success', durationMs);
  },
  info(message: string, durationMs = 3200) {
    AppToast.show(message, 'info', durationMs);
  },
};

export function AppToastRoot() {
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastRequest | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 12,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setToast(null);
    });
  }, [opacity, translateY]);

  useEffect(() => {
    const handleShow: ToastListener = (request) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setToast(request);
      opacity.setValue(0);
      translateY.setValue(16);
      Animated.parallel([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
        Animated.timing(translateY, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      timerRef.current = setTimeout(() => {
        dismiss();
      }, request.durationMs);
    };

    hostStack.push(handleShow);
    return () => {
      const idx = hostStack.lastIndexOf(handleShow);
      if (idx >= 0) hostStack.splice(idx, 1);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [dismiss, opacity, translateY]);

  if (!toast) return null;

  const isError = toast.tone === 'error';
  const isSuccess = toast.tone === 'success';
  const Icon = isError ? WarningCircle : isSuccess ? CheckCircle : Info;
  const iconColor = isError ? '#FCA5A5' : isSuccess ? '#86EFAC' : '#C4B5FD';

  return (
    <View
      pointerEvents="box-none"
      style={[styles.overlay, { bottom: Math.max(insets.bottom, 16) + 16 }]}
    >
      <Animated.View
        style={[
          styles.toastWrap,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <Pressable
          onPress={dismiss}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            isError && styles.toastError,
            isSuccess && styles.toastSuccess,
          ]}
        >
          <Icon size={18} color={iconColor} weight="fill" />
          <Text style={styles.message}>{toast.message}</Text>
        </Pressable>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    left: Spacing.base,
    right: Spacing.base,
    zIndex: 9999,
    elevation: 20,
    alignItems: 'center',
  },
  toastWrap: {
    width: '100%',
    maxWidth: 420,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.navy,
    borderRadius: Radii.card,
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.24,
    shadowRadius: 16,
    elevation: 10,
  },
  toastError: {
    backgroundColor: '#2B1418',
    borderWidth: 1,
    borderColor: '#7F1D1D',
  },
  toastSuccess: {
    backgroundColor: '#122B20',
    borderWidth: 1,
    borderColor: '#166534',
  },
  message: {
    flex: 1,
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
  },
});
