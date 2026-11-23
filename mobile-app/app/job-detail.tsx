/**
 * BharatPath - Job Detail Route
 *
 * Fetches `GET /candidate/jobs/{id}` and renders the merged `JobDetailScreen`
 * (S18). One screen handles all eligibility states; the old `job-short` route
 * is gone. On a successful apply, navigates to `/application-sent` with the
 * employer name.
 */
import { ScreenSkeleton } from '@/components/feedback/ScreenSkeleton';
import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useScreenRefresh } from '@/hooks/useScreenRefresh';
import { View, Text, StyleSheet } from 'react-native';
import { Colors } from '@/theme/tokens';
import { JobDetailScreen } from '@/screens/jobs/JobDetailScreen';
import { BoardJobDetail } from '@/types/job';
import { getJobDetail } from '@/services/api/jobs';
import { ApiError } from '@/services/api/client';
import { useJobApplications } from '@/hooks/useJobApplications';
import { readScreenCache, writeScreenCache } from '@/services/cache/screenCache';

export default function JobDetailRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const jobId = params.id;
  const cacheKey = jobId ? `job-detail:${jobId}` : null;

  const [job, setJob] = useState<BoardJobDetail | null>(() =>
    cacheKey ? (readScreenCache<BoardJobDetail>(cacheKey) ?? null) : null,
  );
  const applications = useJobApplications();
  const [loading, setLoading] = useState(() =>
    cacheKey ? readScreenCache<BoardJobDetail>(cacheKey) === undefined : true,
  );
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!jobId) {
      setError('Choose a job from the jobs list to view its details.');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const detail = await getJobDetail(jobId);
      setJob(detail);
      writeScreenCache(`job-detail:${jobId}`, detail);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setError('This job is no longer open.');
      } else {
        setError(
          err instanceof ApiError
            ? err.problem.title
            : 'Could not load this job.',
        );
      }
    } finally {
      setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    const cached = cacheKey ? (readScreenCache<BoardJobDetail>(cacheKey) ?? null) : null;
    setJob(cached);
    setLoading(cached === null);
    setError(null);
    void load();
  }, [cacheKey, load]);

  // Return visits (throttled by 30s) and pull-to-refresh.
  const { refreshing, onRefresh: refreshJob } = useScreenRefresh(load, {
    skipFirstFocus: true,
  });
  const onRefresh = useCallback(async () => {
    await Promise.all([refreshJob(), applications.reload()]);
  }, [refreshJob, applications]);

  if (loading || job?.application_stage === undefined && applications.loading) {
    return <ScreenSkeleton />;
  }

  if (error || !job || job.application_stage === undefined && applications.error && !applications.byJob[job.id]) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>
          {error ?? 'We could not check your application status. Please try again.'}
        </Text>
        <Text style={styles.retryLink} onPress={() => { void load(); void applications.reload(); }}>Try again</Text>
        <Text style={styles.retryLink} onPress={() => router.back()}>
          Back to jobs
        </Text>
      </View>
    );
  }

  const applicationStage = applications.byJob[job.id]?.stage ?? job.application_stage;
  const applicationId = applications.byJob[job.id]?.id ?? job.application_id;
  return (
    <JobDetailScreen
      key={job.id}
      job={job}
      refreshing={refreshing}
      onRefresh={onRefresh}
      applicationStage={applicationStage}
      onViewApplication={() => router.push(applicationId ? { pathname: '/application-detail', params: { id: applicationId } } as any : '/board' as any)}
      onBack={() => router.back()}
      onApplied={(employerName, application) =>
        router.replace({
          pathname: '/application-sent',
          params: { employer: employerName, id: application.id, sentAt: application.created_at, title: application.job_title || job.title },
        } as any)
      }
      onJobGone={() => router.back()}
      onSubscriptionRequired={() => {
        router.push('/subscription' as any);
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.offWhite,
    gap: 12,
    padding: 24,
  },
  errorText: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 16,
    lineHeight: 22,
    color: Colors.navy,
    textAlign: 'center',
  },
  retryLink: {
    fontFamily: 'GeneralSans-Semibold',
    fontSize: 14,
    lineHeight: 18,
    color: Colors.brandAccent,
  },
});
