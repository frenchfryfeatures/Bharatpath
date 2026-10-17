import React, { useEffect, useRef, useState } from 'react';
import { Text, Pressable, type StyleProp, type TextStyle } from 'react-native';

export function TypewriterText({
  text,
  speed = 18,
  stepChars = 2,
  onComplete,
  style,
  showCursor = false,
}: {
  text: string;
  speed?: number;
  stepChars?: number;
  onComplete?: () => void;
  style?: StyleProp<TextStyle>;
  showCursor?: boolean;
}) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setDisplayedLength(0);
    if (!text) {
      onCompleteRef.current?.();
      return;
    }

    let cursor = 0;
    const interval = setInterval(() => {
      cursor = Math.min(text.length, cursor + stepChars);
      setDisplayedLength(cursor);
      if (cursor >= text.length) {
        clearInterval(interval);
        onCompleteRef.current?.();
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed, stepChars]);

  const completeImmediately = () => {
    if (displayedLength < text.length) {
      setDisplayedLength(text.length);
      onCompleteRef.current?.();
    }
  };

  const isTyping = displayedLength < text.length;

  return (
    <Pressable onPress={completeImmediately} accessibilityRole="text">
      <Text style={style}>
        {text.slice(0, displayedLength)}
        {showCursor && isTyping ? '▍' : ''}
      </Text>
    </Pressable>
  );
}
