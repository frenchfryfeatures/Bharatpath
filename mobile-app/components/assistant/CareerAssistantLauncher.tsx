import React, { useState } from 'react';
import { StyleSheet, Pressable, ViewStyle } from 'react-native';
import { Sparkle } from 'phosphor-react-native';
import { CareerAssistantModal } from './CareerAssistantModal';

interface CareerAssistantNavButtonProps {
  style?: ViewStyle;
}

export function CareerAssistantNavButton({ style }: CareerAssistantNavButtonProps) {
  const [modalVisible, setModalVisible] = useState(false);

  return (
    <>
      <Pressable
        onPress={() => setModalVisible(true)}
        style={({ pressed }) => [
          styles.navButton,
          style,
          pressed && styles.buttonPressed,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open AI Career Assistant"
        testID="career-assistant-nav-btn"
      >
        <Sparkle size={20} color="#5F4DB2" weight="fill" />
      </Pressable>

      <CareerAssistantModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
      />
    </>
  );
}

// Backward-compatible alias
export const CareerAssistantLauncher = CareerAssistantNavButton;

const styles = StyleSheet.create({
  navButton: {
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
    transform: [{ scale: 0.94 }],
    opacity: 0.85,
  },
});
