import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { Brain, QuestionMark, Sparkle } from 'phosphor-react-native';

interface InterviewerThinkingAnimationProps {
  questionNumber?: number;
  stage?: 'saving' | 'preparing';
}

export function InterviewerThinkingAnimation({
  stage = 'preparing',
}: InterviewerThinkingAnimationProps) {
  // 0 = Thinking state (Brain / Sparkles), 1 = Question Mark state
  const morphAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const rippleAnim = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    // 1. Continuous pulse animation for core
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.08,
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
      ])
    );

    // 2. Continuous radar ripple expansion
    const rippleLoop = Animated.loop(
      Animated.parallel([
        Animated.timing(rippleAnim, {
          toValue: 2.1,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(rippleOpacity, {
          toValue: 0,
          duration: 1800,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    // 3. Morph sequence: Thinking -> Question Mark -> Thinking
    const morphLoop = Animated.loop(
      Animated.sequence([
        // Stay in thinking state for 1.8s
        Animated.delay(1800),
        // Morph to Question mark over 350ms
        Animated.timing(morphAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.out(Easing.back(1.5)),
          useNativeDriver: true,
        }),
        // Stay in question mark state for 1.8s
        Animated.delay(1800),
        // Morph back to thinking state over 350ms
        Animated.timing(morphAnim, {
          toValue: 0,
          duration: 350,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoop.start();
    rippleLoop.start();
    morphLoop.start();

    return () => {
      pulseLoop.stop();
      rippleLoop.stop();
      morphLoop.stop();
    };
  }, [morphAnim, pulseAnim, rippleAnim, rippleOpacity]);

  // Thinking icon animations
  const thinkingOpacity = morphAnim.interpolate({
    inputRange: [0, 0.4, 0.6, 1],
    outputRange: [1, 0.8, 0, 0],
  });
  const thinkingScale = morphAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 0.4, 0.2],
  });

  // Question mark icon animations
  const questionOpacity = morphAnim.interpolate({
    inputRange: [0, 0.4, 0.6, 1],
    outputRange: [0, 0, 0.8, 1],
  });
  const questionScale = morphAnim.interpolate({
    inputRange: [0, 0.4, 0.7, 1],
    outputRange: [0.3, 0.3, 1.25, 1.0],
  });
  const questionRotate = morphAnim.interpolate({
    inputRange: [0, 0.5, 0.8, 1],
    outputRange: ['-25deg', '-15deg', '8deg', '0deg'],
  });

  return (
    <View style={styles.container}>
      {/* Significantly enlarged animated emblem */}
      <View style={styles.emblemContainer}>
        {/* Expanding Ripple Ring */}
        <Animated.View
          style={[
            styles.rippleRing,
            {
              transform: [{ scale: rippleAnim }],
              opacity: rippleOpacity,
            },
          ]}
        />

        {/* Ambient Halo */}
        <View style={styles.ambientHalo} />

        {/* Central Large Pulsing Badge */}
        <Animated.View
          style={[
            styles.coreBadge,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          {/* Thinking Icon (Brain + Sparkle) */}
          <Animated.View
            style={[
              styles.iconLayer,
              {
                opacity: thinkingOpacity,
                transform: [{ scale: thinkingScale }],
              },
            ]}
          >
            <Brain size={58} color="#FFFFFF" weight="fill" />
            <View style={styles.sparkleBadge}>
              <Sparkle size={18} color="#FFD166" weight="fill" />
            </View>
          </Animated.View>

          {/* Question Mark Icon */}
          <Animated.View
            style={[
              styles.iconLayer,
              {
                opacity: questionOpacity,
                transform: [
                  { scale: questionScale },
                  { rotate: questionRotate },
                ],
              },
            ]}
          >
            <QuestionMark size={64} color="#FFFFFF" weight="bold" />
          </Animated.View>
        </Animated.View>
      </View>

      {/* Clean, simplified message without extra clutter */}
      <View style={styles.textContainer}>
        <Text style={styles.title}>
          {stage === 'saving'
            ? 'Saving your answer…'
            : 'Please wait, next question is coming…'}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 32,
  },
  emblemContainer: {
    width: 200,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rippleRing: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    borderWidth: 2.5,
    borderColor: '#7C67E6',
    backgroundColor: 'rgba(124, 103, 230, 0.16)',
  },
  ambientHalo: {
    position: 'absolute',
    width: 156,
    height: 156,
    borderRadius: 78,
    backgroundColor: '#F1EAF7',
  },
  coreBadge: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 10,
  },
  iconLayer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleBadge: {
    position: 'absolute',
    top: -8,
    right: -10,
    backgroundColor: '#3E2E8C',
    borderRadius: 12,
    padding: 3,
  },
  textContainer: {
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0A1931',
    textAlign: 'center',
    letterSpacing: -0.2,
  },
});
