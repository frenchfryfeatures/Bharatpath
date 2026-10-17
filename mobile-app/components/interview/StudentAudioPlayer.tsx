import React, { useRef, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Play, Pause } from 'phosphor-react-native';
import { useAudioPlayer, useAudioPlayerStatus, setAudioModeAsync } from 'expo-audio';

interface StudentAudioPlayerProps {
  src: string;
  knownDurationMs?: number;
  label?: string;
}

const clock = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

export function StudentAudioPlayer({
  src,
  knownDurationMs = 0,
  label = 'Your recording',
}: StudentAudioPlayerProps) {
  const player = useAudioPlayer({ uri: src });
  const status = useAudioPlayerStatus(player);
  const [trackWidth, setTrackWidth] = useState(0);

  const durationSec =
    Number.isFinite(status.duration) && status.duration > 0
      ? status.duration
      : knownDurationMs > 0
        ? knownDurationMs / 1000
        : 0;

  const currentSec = Math.min(status.currentTime || 0, durationSec);
  const progressPercent = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;

  const togglePlayback = async () => {
    try {
      if (status.playing) {
        player.pause();
      } else {
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        // If at the end, replay from beginning
        if (currentSec >= durationSec && durationSec > 0) {
          await player.seekTo(0);
        }
        player.play();
      }
    } catch (err) {
      console.warn('[StudentAudioPlayer] togglePlayback error:', err);
    }
  };

  const handleSeek = async (evt: { nativeEvent: { locationX: number } }) => {
    if (!trackWidth || durationSec <= 0) return;
    const clickX = Math.max(0, Math.min(evt.nativeEvent.locationX, trackWidth));
    const targetSeconds = (clickX / trackWidth) * durationSec;
    try {
      await player.seekTo(targetSeconds);
    } catch (err) {
      console.warn('[StudentAudioPlayer] seek error:', err);
    }
  };

  return (
    <View style={styles.container}>
      <Pressable
        onPress={togglePlayback}
        style={({ pressed }) => [styles.playBtn, pressed && styles.btnPressed]}
        accessibilityRole="button"
        accessibilityLabel={status.playing ? `Pause ${label}` : `Play ${label}`}
      >
        {status.playing ? (
          <Pause size={16} color="#FFFFFF" weight="fill" />
        ) : (
          <Play size={16} color="#FFFFFF" weight="fill" style={{ marginLeft: 2 }} />
        )}
      </Pressable>

      <View style={styles.infoCol}>
        <View style={styles.topRow}>
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.timeText}>
            {clock(currentSec)} / {clock(durationSec)}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E7E0D4',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    width: '100%',
  },
  playBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#5F4DB2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.95 }],
  },
  infoCol: {
    flex: 1,
    gap: 6,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0A1931',
    textTransform: 'capitalize',
  },
  timeText: {
    fontSize: 11,
    fontFamily: 'SpaceMono-Bold',
    color: '#5F6B80',
  },
  trackContainer: {
    height: 18,
    justifyContent: 'center',
  },
  trackBackground: {
    height: 6,
    backgroundColor: '#ECE7DE',
    borderRadius: 3,
    overflow: 'hidden',
  },
  trackFill: {
    height: '100%',
    backgroundColor: '#5F4DB2',
    borderRadius: 3,
  },
});
