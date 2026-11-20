import { BrandWordmark } from "@/components/BrandWordmark";
import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import * as Speech from 'expo-speech';
import { LinearGradient } from 'expo-linear-gradient';
import { Briefcase, Microphone, SpeakerHigh, PencilSimple } from 'phosphor-react-native';
import { HeartbeatThinking } from '@/components/feedback/HeartbeatThinking';
import { TypewriterText } from '@/components/feedback/TypewriterText';
import type { ConversationAnswer } from './conversationQuestions';

const purple = ['#643AC5', '#5131A7'] as const;

function GuideMessage({ children }: { children: React.ReactNode }) {
  return <View style={styles.assistantRow}>
    <View style={styles.messageAvatar}><Briefcase size={18} color="#5F35B5" /></View>
    <View style={styles.assistantBubble}>{children}</View>
  </View>;
}

export function ConversationPrompt({
  question, closing, thinking, history, onEdit, disabled, children, footer,
  retryMessage, attempts = [],
}: {
  question: string;
  closing?: string;
  stepTitles?: readonly string[];
  thinking: boolean;
  history: ConversationAnswer[];
  onEdit: (answer: ConversationAnswer) => void;
  disabled: boolean;
  children: React.ReactNode;
  footer: React.ReactNode;
  retryMessage?: string;
  attempts?: { answer: string; message: string }[];
}) {
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const spokenRef = useRef<string | null>(null);
  const scrollToLatest = () => scrollRef.current?.scrollToEnd({ animated: true });

  useEffect(() => {
    const timer = setTimeout(scrollToLatest, 120);
    return () => clearTimeout(timer);
  }, [history.length, attempts.length, thinking, closing, question]);

  useEffect(() => {
    if (!voiceEnabled || thinking) {
      Speech.stop();
      return;
    }
    const text = closing || question;
    if (text && spokenRef.current !== text) {
      spokenRef.current = text;
      Speech.stop();
      Speech.speak(text, { language: 'en-IN', rate: 0.95, pitch: 1.0 });
    }
    return () => { Speech.stop(); };
  }, [voiceEnabled, question, closing, thinking]);

  return <View style={styles.screen}>
    <View style={styles.header}>
      <LinearGradient colors={purple} style={styles.avatar}>
        <Briefcase size={22} color="#FFFFFF" />
      </LinearGradient>
      <View style={styles.headerText}>
        <BrandWordmark style={styles.guideTitle} suffix=" Saathi" />
        <Text style={styles.guideSubtitle}>Building your profile, one answer at a time.</Text>
      </View>
      <Pressable
        onPress={() => {
          setVoiceEnabled((current) => !current);
          spokenRef.current = null;
          Speech.stop();
        }}
        style={[styles.voiceBtn, voiceEnabled && styles.voiceBtnActive]}
        accessibilityRole="button"
        hitSlop={4}
        accessibilityLabel={voiceEnabled ? 'Turn off spoken questions' : 'Read questions aloud'}
        accessibilityHint="Reads the guide's questions aloud."
        accessibilityState={{ selected: voiceEnabled }}
      >
        {voiceEnabled ? <SpeakerHigh size={22} color="#5F35B5" /> : <Microphone size={22} color="#5F35B5" />}
      </Pressable>
    </View>

    <ScrollView
      ref={scrollRef}
      style={styles.historyScroll}
      contentContainerStyle={styles.historyContent}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
      onContentSizeChange={scrollToLatest}
      onLayout={scrollToLatest}
    >
      {history.map((item, index) => <View key={`${item.key}-${index}`} style={styles.historyGroup}>
        <GuideMessage><Text style={styles.assistantText}>{item.question}</Text></GuideMessage>
        <View style={styles.userRow}>
          <LinearGradient colors={purple} style={styles.userBubble}>
            <Text style={styles.userText}>{item.answer}</Text>
          </LinearGradient>
          <Pressable disabled={disabled} onPress={() => onEdit(item)}
            style={styles.editBtn} hitSlop={6} accessibilityRole="button"
            accessibilityLabel={`Edit answer for ${item.question}`}>
            <PencilSimple size={20} color="#5F35B5" />
          </Pressable>
        </View>
      </View>)}

      {thinking ? <View style={styles.thinkingBox}>
        <HeartbeatThinking message="Thinking about your next question…" />
      </View> : <GuideMessage>
        <TypewriterText text={closing || question} style={styles.assistantText} speed={18} />
      </GuideMessage>}

      {!thinking && !closing && attempts.map((attempt, index) => <View key={`attempt-${index}`} style={styles.historyGroup}>
        <View style={styles.userRow}><View style={styles.attemptBubble}>
          <Text style={styles.userText}>{attempt.answer || '(no answer)'}</Text>
        </View></View>
        <View style={styles.errorBubble}><Text style={styles.errorText}>{attempt.message}</Text></View>
      </View>)}
      {!!retryMessage && !attempts.length && !thinking && !closing &&
        <View accessibilityRole="alert" style={styles.errorBubble}><Text style={styles.errorText}>{retryMessage}</Text></View>}
      <View pointerEvents={disabled ? 'none' : 'auto'} style={styles.composer}>{children}</View>
    </ScrollView>
    <View style={styles.footer}>{footer}</View>
  </View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#EFF0F4' },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  headerText: { flex: 1, gap: 3, paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: '#EBE8F2' },
  guideTitle: { fontFamily: 'GeneralSans-Semibold', fontSize: 16, lineHeight: 22, color: '#0A1931' },
  guideSubtitle: { fontFamily: 'GeneralSans-Regular', fontSize: 12, lineHeight: 17, color: '#5F6B80' },
  voiceBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#F0EBFA', alignItems: 'center', justifyContent: 'center' },
  voiceBtnActive: { backgroundColor: '#E3D8F8' },
  historyScroll: { flex: 1 },
  historyContent: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 20, gap: 20 },
  historyGroup: { gap: 16 },
  assistantRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  messageAvatar: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F0EBFA', alignItems: 'center', justifyContent: 'center', marginTop: 3 },
  assistantBubble: { flexShrink: 1, backgroundColor: '#F6F6F8', borderRadius: 22, paddingHorizontal: 16, paddingVertical: 12, maxWidth: '88%' },
  assistantText: { fontFamily: 'GeneralSans-Regular', fontSize: 15, lineHeight: 23, color: '#0A1931' },
  userRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, paddingLeft: 38 },
  userBubble: { borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, maxWidth: '84%' },
  userText: { fontFamily: 'GeneralSans-Medium', fontSize: 15, lineHeight: 22, color: '#FFFFFF' },
  editBtn: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: '#EBE8F2', backgroundColor: '#FAF9FC', alignItems: 'center', justifyContent: 'center' },
  thinkingBox: { padding: 12 },
  attemptBubble: { backgroundColor: '#7A6DBA', borderRadius: 24, paddingHorizontal: 18, paddingVertical: 12, maxWidth: '84%' },
  errorBubble: { backgroundColor: '#FFF0EE', borderRadius: 14, padding: 12, marginLeft: 38 },
  errorText: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#9E2A1A' },
  composer: { gap: 12 },
  footer: { paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: '#EFF0F4', backgroundColor: '#FFFFFF' },
});
