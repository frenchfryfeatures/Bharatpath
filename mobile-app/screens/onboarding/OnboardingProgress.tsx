import React from 'react';
import { View, Text } from 'react-native';

export function OnboardingProgress({ step }: { step: number }) {
  return (
    <View style={{ gap: 8, marginBottom: 16 }}>
      <Text
        style={{
          fontFamily: 'GeneralSans-Bold',
          fontSize: 11,
          letterSpacing: 1.2,
          color: '#5F6B80',
        }}
      >
        STEP {step + 1} OF 4
      </Text>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {[0, 1, 2, 3].map((index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 4,
              backgroundColor: index <= step ? '#5F4DB2' : '#E7E0D4',
            }}
          />
        ))}
      </View>
    </View>
  );
}
