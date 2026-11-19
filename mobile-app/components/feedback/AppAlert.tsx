import React, { useState, useEffect } from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { Colors, Radii } from '@/theme/tokens';
import { logger } from '@/utils/logger';

export type AlertButton = {
  text: string;
  onPress?: () => void;
  style?: 'default' | 'cancel' | 'destructive' | 'secondary';
};

export type AlertConfig = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
};

let listeners: ((config: AlertConfig | null) => void)[] = [];

export const AppAlert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) => {
    logger.warn('AppAlert', `Showing alert dialog: "${title}"`, {
      message,
      buttons: buttons?.map((b) => b.text) || ['OK'],
    });
    listeners.forEach((listener) => listener({ title, message, buttons }));
  },
};

export function AppAlertRoot() {
  const [config, setConfig] = useState<AlertConfig | null>(null);

  useEffect(() => {
    const listener = (c: AlertConfig | null) => setConfig(c);
    listeners.push(listener);
    return () => {
      listeners = listeners.filter((l) => l !== listener);
    };
  }, []);

  if (!config) return null;

  const rawButtons = config.buttons && config.buttons.length > 0 ? config.buttons : [{ text: 'OK' }];
  const isStacked = rawButtons.length > 2;

  // When stacked (3+ buttons), keep action buttons first and place cancel at the bottom
  const buttons = isStacked
    ? [
        ...rawButtons.filter((b) => b.style !== 'cancel'),
        ...rawButtons.filter((b) => b.style === 'cancel'),
      ]
    : rawButtons;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => setConfig(null)}>
      <View style={styles.overlay}>
        <View style={styles.dialog}>
          <Text style={styles.title}>{config.title}</Text>
          {!!config.message && <Text style={styles.message}>{config.message}</Text>}
          <View style={[styles.actions, isStacked ? styles.actionsStacked : styles.actionsRow]}>
            {buttons.map((btn, idx) => {
              const isCancel = btn.style === 'cancel';
              const isDestructive = btn.style === 'destructive';
              const isSecondary = btn.style === 'secondary';

              return (
                <Pressable
                  key={idx}
                  style={({ pressed }) => [
                    styles.button,
                    isStacked ? styles.buttonStacked : buttons.length === 2 ? styles.buttonHalf : undefined,
                    isCancel
                      ? styles.buttonCancel
                      : isDestructive
                      ? styles.buttonDestructive
                      : isSecondary
                      ? styles.buttonSecondary
                      : styles.buttonPrimary,
                    pressed && { opacity: 0.8 },
                  ]}
                  onPress={() => {
                    setConfig(null);
                    if (btn.onPress) btn.onPress();
                  }}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      isCancel
                        ? styles.textCancel
                        : isDestructive
                        ? styles.textDestructive
                        : isSecondary
                        ? styles.textSecondary
                        : styles.textPrimary,
                    ]}
                  >
                    {btn.text}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(10, 25, 49, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  dialog: {
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 12,
    shadowColor: '#0A1931',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  title: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 20,
    lineHeight: 26,
    color: '#0A1931',
  },
  message: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 15,
    lineHeight: 22,
    color: '#3A4761',
  },
  actions: {
    marginTop: 8,
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    alignItems: 'center',
  },
  actionsStacked: {
    flexDirection: 'column',
    gap: 10,
    width: '100%',
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: Radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 80,
  },
  buttonStacked: {
    width: '100%',
  },
  buttonHalf: {
    flex: 1,
  },
  buttonPrimary: {
    backgroundColor: '#5F4DB2',
  },
  buttonSecondary: {
    backgroundColor: '#F1EAF7',
    borderWidth: 1,
    borderColor: '#D4C7F5',
  },
  buttonCancel: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
  },
  buttonDestructive: {
    backgroundColor: Colors.red.fg,
  },
  buttonText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 15,
    textAlign: 'center',
  },
  textPrimary: {
    color: '#FFFFFF',
  },
  textSecondary: {
    color: '#5F4DB2',
  },
  textCancel: {
    color: '#5F6B80',
  },
  textDestructive: {
    color: '#FFFFFF',
  },
});
