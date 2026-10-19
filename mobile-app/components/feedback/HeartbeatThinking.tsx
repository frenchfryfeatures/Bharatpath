import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';

export function HeartbeatThinking({
  message = 'Thinking about your next question…',
  size = 14,
  color = '#5F4DB2',
}: {
  message?: string;
  size?: number;
  color?: string;
}) {
  const heartScale = useRef(new Animated.Value(1)).current;
  const rippleScale = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    // Heartbeat pattern: lub-dub pulse then rest
    const heartbeatAnim = Animated.loop(
      Animated.sequence([
        // Beat 1 (lub)
        Animated.parallel([
          Animated.timing(heartScale, {
            toValue: 1.3,
            duration: 160,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(rippleScale, {
            toValue: 1.9,
            duration: 340,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(rippleOpacity, {
            toValue: 0,
            duration: 340,
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(heartScale, {
          toValue: 1.05,
          duration: 130,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        // Beat 2 (dub)
        Animated.timing(heartScale, {
          toValue: 1.22,
          duration: 150,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(heartScale, {
          toValue: 1.0,
          duration: 200,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
        // Reset ripple
        Animated.parallel([
          Animated.timing(rippleScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(rippleOpacity, {
            toValue: 0.45,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
        // Rest period (diastole)
        Animated.delay(480),
      ]),
    );

    heartbeatAnim.start();
    return () => heartbeatAnim.stop();
  }, [heartScale, rippleScale, rippleOpacity]);

  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={message}>
      <View style={[styles.indicatorWrapper, { width: size * 2.2, height: size * 2.2 }]}>
        {/* Expanding ripple ring */}
        <Animated.View
          style={[
            styles.ripple,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              transform: [{ scale: rippleScale }],
              opacity: rippleOpacity,
            },
          ]}
        />
        {/* Core pulsing heartbeat node */}
        <Animated.View
          style={[
            styles.dot,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              transform: [{ scale: heartScale }],
            },
          ]}
        />
      </View>
      <Text style={[styles.text, { color }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  indicatorWrapper: {
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  ripple: {
    position: 'absolute',
  },
  dot: {
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  text: {
    fontFamily: 'GeneralSans-Medium',
    fontSize: 13,
    lineHeight: 18,
    color: '#5F4DB2',
  },
});
