import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

export const BrandColors = { navy: '#05255C', orange: '#FF8A26' } as const;

export function BrandWordmark({ style, light = false, suffix = '' }: { style?: StyleProp<TextStyle>; light?: boolean; suffix?: string }) {
  return <Text style={[style, { color: light ? '#FFFFFF' : BrandColors.navy, textTransform: 'none' }]}>Bharat<Text style={{ color: BrandColors.orange }}>Path</Text>{suffix}</Text>;
}
