/**
 * A pulsing placeholder laid over a form field while its value is being
 * filled in for the person (2026-11-23: resume pre-fill). Covers the field
 * so nobody types into something about to change; disappears when done.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet } from 'react-native';

export function FieldSkeleton({ visible, label = 'Filling from your resume' }: { visible: boolean; label?: string }) {
  const pulse = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    if (!visible) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [visible, pulse]);
  if (!visible) return null;
  return (
    <Animated.View
      accessible
      accessibilityLabel={label}
      accessibilityState={{ busy: true }}
      style={[styles.skeleton, { opacity: pulse }]}
    />
  );
}

const styles = StyleSheet.create({
  skeleton: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 14,
    backgroundColor: '#EDE8E1',
    zIndex: 2,
  },
});
