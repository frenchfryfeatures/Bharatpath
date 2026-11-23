import { readScreenCache, writeScreenCache } from '@/services/cache/screenCache';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getRecommendedJobs, type RecommendedJob, type RecommendationKind } from '@/services/api/jobs';
import { JobCard } from '@/screens/jobs/JobsFeedScreen';
import { matchReasonText } from '@/utils/matchReasons';
import { jobCarouselLayout } from '@/utils/jobCarouselLayout';

export function RecommendedJobsSection({ kind, onJobPress, onBrowseJobs, limit = 12, excludeJobId, heading, refreshKey = 0 }: { kind: RecommendationKind; onJobPress?: (id: string) => void; onBrowseJobs?: () => void; limit?: number; excludeJobId?: string; heading?: string; /** Bump to refetch, e.g. on the parent's pull-to-refresh. */ refreshKey?: number }) {
  const { width, fontScale } = useWindowDimensions();
  const [availableWidth, setAvailableWidth] = useState(width - 40);
  const layout = jobCarouselLayout(availableWidth, fontScale);
  // Last visit's cards first, refreshed behind them (2026-11-23).
  const cacheKey = `recommended:${kind}:${limit}:${excludeJobId ?? ''}`;
  const [result, setResult] = useState<{ items: RecommendedJob[]; has_basis: boolean } | null>(
    () => readScreenCache<{ items: RecommendedJob[]; has_basis: boolean }>(cacheKey) ?? null,
  );
  const [loading, setLoading] = useState(() => readScreenCache(cacheKey) === undefined);
  const [error, setError] = useState(false);
  const [revision, setRevision] = useState(0);
  useFocusEffect(useCallback(() => {
    void revision; void refreshKey;
    let active = true; setLoading(true); setError(false);
    void getRecommendedJobs(kind, limit + (excludeJobId ? 1 : 0)).then(data => { if (active) { const next = { ...data, items: data.items.filter(job => job.id !== excludeJobId).slice(0, limit) }; setResult(next); writeScreenCache(cacheKey, next); } }).catch(() => { if (active) setError(true); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, limit, excludeJobId, revision, refreshKey, cacheKey]));
  const title = heading ?? (kind === 'similar-to-applied' ? 'Similar to jobs you applied for' : 'Jobs relevant to your profile');
  return <View style={styles.section} onLayout={event => setAvailableWidth(event.nativeEvent.layout.width)}>
    <View style={styles.header}><Text accessibilityRole="header" style={styles.title}>{title}</Text><Pressable accessibilityRole="button" onPress={onBrowseJobs} hitSlop={8}><Text style={styles.link}>See all jobs</Text></Pressable></View>
    {loading && !result ? <ActivityIndicator color="#5F4DB2" accessibilityLabel={`Loading ${title}`}/> : error ? <View style={styles.empty}><Text style={styles.body}>We couldn’t load these recommendations.</Text><Pressable accessibilityRole="button" onPress={() => setRevision(value => value + 1)}><Text style={styles.link}>Try again</Text></Pressable></View>
      : result?.items.length ? <ScrollView horizontal style={[styles.carousel, { height: layout.height }]} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.rail} contentInsetAdjustmentBehavior="never" automaticallyAdjustContentInsets={false} automaticallyAdjustsScrollIndicatorInsets={false} contentInset={{ top: 0, bottom: 0, left: 0, right: 0 }} snapToInterval={layout.width + 12} decelerationRate="fast" accessibilityLabel={title}>
        {result.items.map(job => <JobCard key={job.id} style={{ width: layout.width, height: layout.height, flexShrink: 0 }} carouselLayout={layout} job={job} applicationStage={job.application_stage} onPress={() => onJobPress?.(job.id)} matchReason={matchReasonText(job.match_reasons)}/>)}
      </ScrollView> : <View style={styles.empty}><Text style={styles.body}>{!result?.has_basis ? kind === 'similar-to-applied' ? 'Apply for a job to see similar opportunities here.' : 'Add your skills, experience and preferences to your profile to see relevant jobs.' : 'No matching jobs right now. Check back as new roles are posted.'}</Text></View>}
  </View>;
}
const styles = StyleSheet.create({ section: { gap: 14, marginTop: 24, alignSelf: 'stretch' }, header: { gap: 8 }, title: { fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 24, color: '#0A1931', letterSpacing: -0.2 }, link: { fontFamily: 'GeneralSans-Medium', fontSize: 13, lineHeight: 20, color: '#5F4DB2' }, carousel: { flexGrow: 0, alignSelf: 'stretch' }, rail: { gap: 12, alignItems: 'flex-start' }, empty: { padding: 18, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 16, backgroundColor: '#FFFFFF', gap: 10 }, body: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#5F6B80' } });
