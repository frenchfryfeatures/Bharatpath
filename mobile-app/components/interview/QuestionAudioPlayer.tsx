import React, { useEffect, useState, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { Play, Pause, SpeakerHigh, ArrowClockwise } from 'phosphor-react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';
import { getInterviewQuestionAudio } from '@/services/api/interview';

interface QuestionAudioPlayerProps {
  sessionId: string;
  index: number;
}

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function QuestionAudioPlayer({ sessionId, index }: QuestionAudioPlayerProps) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const [trackWidth, setTrackWidth] = useState(0);

  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const hasAttemptedAutoplay = useRef(false);

  useEffect(() => {
    let cancelled = false;
    hasAttemptedAutoplay.current = false;
    setLoading(true);
    setAudioUrl(null);
    setBlocked(false);

    (async () => {
      try {
        const res = await getInterviewQuestionAudio(sessionId, index);
        if (cancelled) return;
        setAudioUrl(res.url);

        // Configure audio mode for playback through loudspeaker
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        if (cancelled) return;

        player.replace({ uri: res.url });

        // Autoplay question audio
        try {
          player.play();
          hasAttemptedAutoplay.current = true;
        } catch {
          setBlocked(true);
        }
      } catch (err) {
        // If voice is not configured or fails, the written prompt on screen is the source of truth
        console.log('[QuestionAudio] Audio unavailable for question', index, err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      try {
        player.pause();
        player.seekTo(0);
      } catch {
        // Cleanup
      }
    };
  }, [index, sessionId]);

  if (loading) {
    return (
      <View style={styles.loadingRow}>
        <ActivityIndicator size="small" color="#5F4DB2" />
        <Text style={styles.loadingText}>Loading audio…</Text>
      </View>
    );
  }

  if (!audioUrl) {
    return null;
  }

  const durationSec = Number.isFinite(status.duration) && status.duration > 0 ? status.duration : 0;
  const currentSec = Math.min(status.currentTime || 0, durationSec);
  const progressPercent = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;

  const togglePlayback = async () => {
    try {
      if (status.playing) {
        player.pause();
      } else {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        if (currentSec >= durationSec && durationSec > 0) {
          await player.seekTo(0);
        }
        player.play();
        setBlocked(false);
      }
    } catch (err) {
      console.warn('[QuestionAudio] toggle error:', err);
    }
  };

  const handleSeek = async (evt: { nativeEvent: { locationX: number } }) => {
    if (!trackWidth || durationSec <= 0) return;
    const clickX = Math.max(0, Math.min(evt.nativeEvent.locationX, trackWidth));
    const targetSeconds = (clickX / trackWidth) * durationSec;
    try {
      await player.seekTo(targetSeconds);
    } catch (err) {
      console.warn('[QuestionAudio] seek error:', err);
    }
  };

  const handleReplay = async () => {
    try {
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
      await player.seekTo(0);
      player.play();
    } catch (err) {
      console.warn('[QuestionAudio] replay error:', err);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.playerCard}>
        <Pressable
          onPress={togglePlayback}
          style={({ pressed }) => [styles.playBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel={status.playing ? 'Pause question audio' : 'Play question audio'}
        >
          {status.playing ? (
            <Pause size={17} color="#FFFFFF" weight="fill" />
          ) : (
            <Play size={17} color="#FFFFFF" weight="fill" style={{ marginLeft: 2 }} />
          )}
        </Pressable>

        <View style={styles.infoCol}>
          <View style={styles.topRow}>
            <View style={styles.labelRow}>
              <SpeakerHigh size={14} color="#5F4DB2" weight="fill" />
              <Text style={styles.headerLabel}>Interviewer audio</Text>
            </View>
            <Text style={styles.timeText}>
              {durationSec > 0 ? `${clock(currentSec)} / ${clock(durationSec)}` : 'Playing'}
            </Text>
          </View>

          <Pressable
            style={styles.trackContainer}
            onPress={handleSeek}
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
          >
            <View style={styles.trackBackground}>
              <View style={[styles.trackFill, { width: `${progressPercent}%` }]} />
            </View>
          </Pressable>
        </View>

        <Pressable
          onPress={handleReplay}
          style={({ pressed }) => [styles.replayBtn, pressed && styles.btnPressed]}
          accessibilityRole="button"
          accessibilityLabel="Replay question"
        >
          <ArrowClockwise size={16} color="#5F4DB2" weight="bold" />
        </Pressable>
      </View>

      {blocked && (
        <View style={styles.noticeRow}>
          <SpeakerHigh size={13} color="#5F6B80" />
          <Text style={styles.noticeText}>
            Audio ready. Tap play to hear the AI interviewer ask the question.
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 10,
    marginBottom: 4,
    width: '100%',
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    marginBottom: 4,
    paddingVertical: 6,
  },
  loadingText: {
    fontSize: 12,
    color: '#5F6B80',
    fontWeight: '500',
  },
  playerCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F7F4EC',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  playBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  replayBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(95, 77, 178, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.94 }],
  },
  infoCol: {
    flex: 1,
    gap: 5,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0A1931',
  },
  timeText: {
    fontSize: 11,
    fontFamily: 'SpaceMono-Bold',
    color: '#5F6B80',
  },
  trackContainer: {
    height: 16,
    justifyContent: 'center',
  },
  trackBackground: {
    height: 5,
    backgroundColor: '#E5DFD4',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 3,
  },
  noticeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingHorizontal: 4,
  },
  noticeText: {
    fontSize: 12,
    color: '#5F6B80',
    fontWeight: '500',
  },
});
