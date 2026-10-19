import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Platform,
} from 'react-native';
import * as Speech from 'expo-speech';
import { ChatCircleDots, SpeakerHigh, SpeakerSlash, PencilSimple } from 'phosphor-react-native';
import { HeartbeatThinking } from '@/components/feedback/HeartbeatThinking';
import { TypewriterText } from '@/components/feedback/TypewriterText';
import type { ConversationAnswer } from './conversationQuestions';

export function ConversationPrompt({
  question,
  closing,
  thinking,
  progress,
  history,
  stepTitles,
  onEdit,
  disabled,
  children,
  retryMessage,
  attempts = [],
}: {
  question: string;
  closing?: string;
  stepTitles?: readonly string[];
  thinking: boolean;
  progress: string;
  history: ConversationAnswer[];
  onEdit: (answer: ConversationAnswer) => void;
  disabled: boolean;
  children: React.ReactNode;
  retryMessage?: string;
  attempts?: { answer: string; message: string }[];
}) {
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Auto-scroll to bottom on new messages / question change / thinking
  useEffect(() => {
    const timer = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 120);
    return () => clearTimeout(timer);
  }, [history.length, attempts.length, thinking, closing, question]);

  // Handle synchronized speech readout when voice is enabled
  useEffect(() => {
    if (!voiceEnabled || thinking) {
      Speech.stop();
      return;
    }
    const textToSpeak = closing || question;
    if (textToSpeak) {
      Speech.stop();
      Speech.speak(textToSpeak, {
        language: 'en-IN',
        rate: 0.95,
        pitch: 1.0,
      });
    }
    return () => {
      Speech.stop();
    };
  }, [voiceEnabled, question, closing, thinking]);

  const toggleVoice = () => {
    const next = !voiceEnabled;
    setVoiceEnabled(next);
    if (!next) {
      Speech.stop();
    }
  };

  return (
    <View style={styles.card}>
      {/* Header bar */}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <ChatCircleDots size={20} color="#FFFFFF" weight="bold" />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.guideTitle}>Your BharatPath Guide</Text>
          <Text style={styles.guideSubtitle}>
            Building your profile, one answer at a time.
          </Text>
        </View>
        <Pressable
          onPress={toggleVoice}
          style={[styles.voiceBtn, voiceEnabled && styles.voiceBtnActive]}
          accessibilityLabel={voiceEnabled ? 'Disable voice' : 'Enable voice'}
        >
          {voiceEnabled ? (
            <SpeakerHigh size={16} color="#5F4DB2" weight="bold" />
          ) : (
            <SpeakerSlash size={16} color="#7A8699" weight="regular" />
          )}
          <Text style={[styles.voiceText, voiceEnabled && styles.voiceTextActive]}>
            {voiceEnabled ? 'Voice ON' : 'Voice'}
          </Text>
        </Pressable>
      </View>

      {/* Progress pill */}
      <View style={styles.progressRow}>
        <View style={styles.progressBadge}>
          <Text style={styles.progressText}>{progress}</Text>
        </View>
      </View>

      {/* Conversation Thread */}
      <ScrollView
        ref={scrollRef}
        style={styles.historyScroll}
        contentContainerStyle={styles.historyContent}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
      >
        {/* Prior question / answer history */}
        {history.map((item, idx) => {
          const showSectionTitle =
            item.step !== history[idx - 1]?.step && stepTitles?.[item.step];
          return (
            <View key={`${item.key}-${idx}`} style={styles.historyGroup}>
              {showSectionTitle && (
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionHeaderText}>
                    {stepTitles[item.step]}
                  </Text>
                </View>
              )}
              {/* Question bubble */}
              <View style={styles.assistantBubble}>
                <Text style={styles.assistantText}>{item.question}</Text>
              </View>
              {/* User answer bubble with Edit button */}
              <View style={styles.userRow}>
                <Pressable
                  disabled={disabled}
                  onPress={() => onEdit(item)}
                  style={styles.editBtn}
                  accessibilityLabel={`Edit answer for ${item.question}`}
                >
                  <PencilSimple size={13} color="#5F4DB2" />
                  <Text style={styles.editText}>Edit</Text>
                </Pressable>
                <View style={styles.userBubble}>
                  <Text style={styles.userText}>{item.answer}</Text>
                </View>
              </View>
            </View>
          );
        })}

        {/* Current prompt state */}
        {thinking ? (
          <View style={styles.thinkingBox}>
            <HeartbeatThinking message="Thinking about your next question…" />
          </View>
        ) : closing ? (
          <View style={styles.closingBubble}>
            <TypewriterText
              text={closing}
              style={styles.closingText}
              speed={20}
            />
          </View>
        ) : (
          <View style={styles.currentQuestionBubble}>
            <TypewriterText
              text={question}
              style={styles.currentQuestionText}
              speed={18}
            />
          </View>
        )}

        {/* Attempts / Retries */}
        {!thinking &&
          !closing &&
          attempts.map((attempt, index) => (
            <View key={`attempt-${index}`} style={styles.attemptBox}>
              <View style={styles.userRow}>
                <View style={[styles.userBubble, styles.attemptUserBubble]}>
                  <Text style={styles.userText}>
                    {attempt.answer || '(no answer)'}
                  </Text>
                </View>
              </View>
              <View style={styles.errorBubble}>
                <Text style={styles.errorBubbleText}>{attempt.message}</Text>
              </View>
            </View>
          ))}

        {retryMessage && !attempts.length && !thinking && !closing && (
          <View style={styles.errorBubble}>
            <Text style={styles.errorBubbleText}>{retryMessage}</Text>
          </View>
        )}
      </ScrollView>

      {/* Input / Control Area */}
      <View style={styles.inputArea}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F8F5FF',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#C9BEEB',
    overflow: 'hidden',
    marginVertical: 8,
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    elevation: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E7DFF5',
    gap: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 2,
  },
  headerText: {
    flex: 1,
  },
  guideTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0A1931',
    letterSpacing: -0.2,
  },
  guideSubtitle: {
    fontSize: 11,
    color: '#647087',
    marginTop: 1,
  },
  voiceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
  },
  voiceBtnActive: {
    backgroundColor: '#EDE8F8',
    borderColor: '#C9BEEB',
    borderWidth: 1,
  },
  voiceText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#647087',
  },
  voiceTextActive: {
    color: '#5F4DB2',
  },
  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 4,
  },
  progressBadge: {
    backgroundColor: '#EDE8F8',
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  progressText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#5F4DB2',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  historyScroll: {
    maxHeight: 280,
    minHeight: 120,
    paddingHorizontal: 16,
  },
  historyContent: {
    paddingVertical: 10,
    gap: 12,
  },
  historyGroup: {
    gap: 8,
  },
  sectionHeader: {
    alignItems: 'center',
    paddingVertical: 4,
  },
  sectionHeaderText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A92A6',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  assistantBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderTopLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '88%',
    borderWidth: 1,
    borderColor: '#E8E1F3',
  },
  assistantText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#3A4761',
  },
  userRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
  },
  editBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  editText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#5F4DB2',
    textDecorationLine: 'underline',
  },
  userBubble: {
    backgroundColor: '#5F4DB2',
    borderRadius: 16,
    borderTopRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: '80%',
  },
  attemptUserBubble: {
    backgroundColor: '#7A6DBA',
  },
  userText: {
    fontSize: 13,
    lineHeight: 18,
    color: '#FFFFFF',
    fontWeight: '500',
  },
  thinkingBox: {
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  currentQuestionBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '92%',
    borderWidth: 1.5,
    borderColor: '#D4C9EE',
    shadowColor: '#5F4DB2',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 1,
  },
  currentQuestionText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#0A1931',
  },
  closingBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    borderTopLeftRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '92%',
    borderWidth: 1.5,
    borderColor: '#B9E5C9',
  },
  closingText: {
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    color: '#194E34',
  },
  attemptBox: {
    gap: 6,
  },
  errorBubble: {
    alignSelf: 'flex-start',
    backgroundColor: '#FFF0EE',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#F8B4A6',
    maxWidth: '90%',
  },
  errorBubbleText: {
    fontSize: 12,
    lineHeight: 16,
    color: '#9E2A1A',
    fontWeight: '500',
  },
  inputArea: {
    borderTopWidth: 1,
    borderTopColor: '#E7DFF5',
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
});
