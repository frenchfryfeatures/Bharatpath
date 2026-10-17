import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Sparkle } from 'phosphor-react-native';
import { CareerAssistantModal } from './CareerAssistantModal';

export function CareerAssistantLauncher({
  bottomOffset = 20,
}: {
  bottomOffset?: number;
}) {
  const [modalVisible, setModalVisible] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <>
      <Pressable
        onPress={() => setModalVisible(true)}
        style={({ pressed }) => [
          styles.launcher,
          { bottom: bottomOffset },
          pressed && styles.launcherPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open AI Career Assistant"
        testID="career-assistant-fab"
      >
        <Sparkle size={24} color="#FFFFFF" weight="fill" />
        <View style={styles.statusWrap}>
          <Animated.View
            style={[
              styles.statusPulse,
              { transform: [{ scale: pulseAnim }] },
            ]}
          />
          <View style={styles.statusDot} />
        </View>
      </Pressable>

      <CareerAssistantModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  launcher: {
    position: 'absolute',
    right: 18,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.38,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 99,
  },
  launcherPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
  statusWrap: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 10,
    height: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusPulse: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(74, 222, 128, 0.45)',
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#4ADE80',
    borderWidth: 1.5,
    borderColor: '#5F4DB2',
  },
});
