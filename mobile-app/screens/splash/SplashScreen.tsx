import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Image, Pressable, Animated, Easing } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Colors } from '@/theme/tokens';

interface SplashScreenProps {
  onFinish?: () => void;
  autoPlay?: boolean;
}

export function SplashScreen({ onFinish, autoPlay = true }: SplashScreenProps) {
  // Animated values matching BharatPath R_26Aug2026.dc.html phase sequence
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const logoScale = useRef(new Animated.Value(0.82)).current;

  const wordmarkOpacity = useRef(new Animated.Value(0)).current;
  const wordmarkTranslateY = useRef(new Animated.Value(10)).current;

  const ruleOpacity = useRef(new Animated.Value(0)).current;
  const ruleWidth = useRef(new Animated.Value(0)).current;

  const taglineOpacity = useRef(new Animated.Value(0)).current;
  const taglineTranslateY = useRef(new Animated.Value(8)).current;

  const finishedRef = useRef(false);

  const finishCallback = () => {
    if (!finishedRef.current) {
      finishedRef.current = true;
      if (onFinish) {
        onFinish();
      }
    }
  };

  useEffect(() => {
    const easeOutCubic = Easing.bezier(0.16, 0.6, 0.15, 1);

    // Exact timing sequence from BharatPath R_26Aug2026.dc.html:
    // Phase 1 (t = 80ms): Logo fades in and scales from 0.82 to 1
    // Phase 2 (t = 800ms): Wordmark slides up and fades in
    // Phase 3 (t = 2000ms): Gold rule expands to 44px
    // Phase 4 (t = 2480ms): Tagline slides up and fades in
    // Phase 5 (t = 3900ms): Transition to Intro screen

    const animSequence = Animated.sequence([
      // Delay to Phase 1 (80ms)
      Animated.delay(80),

      // Phase 1: Logo fade + scale
      Animated.parallel([
        Animated.timing(logoOpacity, {
          toValue: 1,
          duration: 720,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(logoScale, {
          toValue: 1,
          duration: 720,
          easing: easeOutCubic,
          useNativeDriver: true,
        }),
      ]),

      // Delay to Phase 2 (800ms mark)
      Animated.delay(100),

      // Phase 2: Wordmark fade + slide up
      Animated.parallel([
        Animated.timing(wordmarkOpacity, {
          toValue: 1,
          duration: 1000,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(wordmarkTranslateY, {
          toValue: 0,
          duration: 1100,
          easing: easeOutCubic,
          useNativeDriver: true,
        }),
      ]),

      // Delay to Phase 3 (2000ms mark)
      Animated.delay(200),

      // Phase 3: Saffron Rule expansion
      Animated.parallel([
        Animated.timing(ruleOpacity, {
          toValue: 1,
          duration: 350,
          easing: Easing.ease,
          useNativeDriver: false,
        }),
        Animated.timing(ruleWidth, {
          toValue: 44,
          duration: 550,
          easing: easeOutCubic,
          useNativeDriver: false,
        }),
      ]),

      // Delay to Phase 4 (2480ms mark)
      Animated.delay(130),

      // Phase 4: Tagline fade + slide up
      Animated.parallel([
        Animated.timing(taglineOpacity, {
          toValue: 1,
          duration: 900,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
        Animated.timing(taglineTranslateY, {
          toValue: 0,
          duration: 900,
          easing: Easing.ease,
          useNativeDriver: true,
        }),
      ]),

      // Hold until t = 3900ms
      Animated.delay(520),
    ]);

    animSequence.start(({ finished }) => {
      if (finished && autoPlay) {
        finishCallback();
      }
    });

    return () => {
      animSequence.stop();
    };
  }, []);

  const handleSkip = () => {
    finishCallback();
  };

  return (
    <Pressable style={styles.container} onPress={handleSkip}>
      <StatusBar style="dark" animated />
      <View style={styles.centerContent}>
        {/* Brand Group: Logo Mark + Wordmark in Vertical Stack */}
        <View style={styles.brandStack}>
          {/* Logo Mark */}
          <Animated.View
            style={[
              styles.logoContainer,
              {
                opacity: logoOpacity,
                transform: [{ scale: logoScale }],
              },
            ]}
          >
            <Image
              source={require('../../assets/icons/bharatpath-icon.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
          </Animated.View>

          {/* Two-tone Wordmark: Bharat (#05255C) + Path (#FC8201) */}
          <Animated.View
            style={[
              styles.wordmarkWrapper,
              {
                opacity: wordmarkOpacity,
                transform: [{ translateY: wordmarkTranslateY }],
              },
            ]}
          >
            <Text style={styles.wordmarkText} numberOfLines={1}>
              <Text style={styles.wordmarkBharat}>Bharat</Text>
              <Text style={styles.wordmarkPath}>Path</Text>
            </Text>
          </Animated.View>
        </View>

        {/* Horizontal Saffron Rule (#FC8201) */}
        <Animated.View
          style={[
            styles.saffronRule,
            {
              opacity: ruleOpacity,
              width: ruleWidth,
            },
          ]}
        />

        {/* Tagline (#3A4761) */}
        <Animated.View
          style={{
            opacity: taglineOpacity,
            transform: [{ translateY: taglineTranslateY }],
          }}
        >
          <Text style={styles.taglineText}>Find your best fit</Text>
        </Animated.View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.offWhite, // #FFFCF7 (Warm cream background matching R_26Aug2026 design)
    justifyContent: 'center',
    alignItems: 'center',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandStack: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoContainer: {
    width: 88,
    height: 88,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoImage: {
    width: 88,
    height: 88,
  },
  wordmarkWrapper: {
    overflow: 'hidden',
    marginTop: 16,
  },
  wordmarkText: {
    fontFamily: 'GeneralSans-Bold',
    fontSize: 30,
    lineHeight: 34,
    letterSpacing: -0.6, // -0.02em tracking
    textAlign: 'center',
  },
  wordmarkBharat: {
    color: '#05255C', // Deep Navy Blue
  },
  wordmarkPath: {
    color: '#FC8201', // Saffron matching logo-safron.png
  },
  saffronRule: {
    height: 2,
    borderRadius: 2,
    backgroundColor: '#FC8201', // Exact saffron color from logo-safron.png
    marginTop: 22,
  },
  taglineText: {
    fontFamily: 'GeneralSans-Regular',
    fontSize: 16,
    lineHeight: 22,
    letterSpacing: 0.64, // 0.04em tracking
    color: '#3A4761', // Charcoal Slate
    marginTop: 14,
    textAlign: 'center',
  },
});
