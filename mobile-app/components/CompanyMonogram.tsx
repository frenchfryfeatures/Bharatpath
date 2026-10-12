/**
 * CompanyMonogram - Circular brand logo or monogram with initials.
 * Renders organisation logo image if `logoUrl` is provided, otherwise falls
 * back to deterministic navy/indigo monogram initials.
 */
import React, { useState } from 'react';
import { View, Text, StyleSheet, Image, StyleProp, ViewStyle } from 'react-native';
import { Colors, Typography } from '@/theme/tokens';
import { pickFromString } from '@/utils/helpers';

export interface CompanyMonogramProps {
  name: string;
  initials?: string;
  logoUrl?: string | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
}

const bgOptions = [Colors.navy, Colors.indigo];

export function CompanyMonogram({
  name,
  initials,
  logoUrl,
  size = 44,
  style,
}: CompanyMonogramProps) {
  const [imageError, setImageError] = useState(false);
  const bg = pickFromString(name, bgOptions);
  const displayInitials = initials ?? name.slice(0, 2).toUpperCase();

  if (logoUrl && !imageError) {
    return (
      <View
        style={[
          styles.monogram,
          styles.imageContainer,
          { width: size, height: size, borderRadius: size / 2 },
          style,
        ]}
      >
        <Image
          source={{ uri: logoUrl }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
          onError={() => setImageError(true)}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.monogram,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: bg },
        style,
      ]}
    >
      <Text style={[styles.text, { fontSize: size * 0.36 }]}>{displayInitials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  monogram: {
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
  },
  imageContainer: {
    backgroundColor: '#F7F5FA',
    borderWidth: 1,
    borderColor: '#E5E8EE',
  },
  text: {
    ...Typography.monoNumber,
    color: Colors.offWhite,
    fontWeight: '700',
  },
});
