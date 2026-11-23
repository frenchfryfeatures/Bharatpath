/**
 * BharatPath - Jobs Hub Route
 *
 * The Jobs feed. Wires `JobsFeedScreen` to the router and passes the candidate's
 * declared city (from the auth profile) into the header. Tapping a card pushes
 * `/job-detail?id=<jobId>`.
 */
import { navigateToTab } from '@/utils/tabNavigation';
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { JobsFeedScreen } from '@/screens/jobs/JobsFeedScreen';
import { TabName } from '@/components/navigation/BottomTabBar';
import { useAuth } from '@/hooks/useAuth';

export default function JobsRoute() {
  const router = useRouter();
  const { profile } = useAuth();
  const handleTabPress = (tab: TabName, href: string) => {
    navigateToTab(router, 'jobs', tab, href);
  };

  const handleJobPress = (jobId: string) => {
    // One detail screen now handles all eligibility states (S18).
    router.push({ pathname: '/job-detail', params: { id: jobId } } as any);
  };

  return (
    <JobsFeedScreen
      activeTab="jobs"
      onTabPress={handleTabPress}
      onJobPress={handleJobPress}
      candidateCity={profile?.city ?? null}
    />
  );
}
