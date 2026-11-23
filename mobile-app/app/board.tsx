/**
 * BharatPath - Application Board Route
 *
 * The Board tab. Lists the candidate's own applications and routes to the
 * detail screen with the application id.
 */
import { navigateToTab } from '@/utils/tabNavigation';
import React, { useState } from 'react';
import { useRouter } from 'expo-router';
import { ApplicationBoardScreen } from '@/screens/board/ApplicationBoardScreen';
import { TabName } from '@/components/navigation/BottomTabBar';

export default function BoardRoute() {
  const router = useRouter();
  const handleTabPress = (tab: TabName, href: string) => {
    navigateToTab(router, 'board', tab, href);
  };

  const handleApplicationPress = (appId: string) => {
    router.push({
      pathname: '/application-detail',
      params: { id: appId },
    } as any);
  };

  return (
    <ApplicationBoardScreen
      activeTab="board"
      onTabPress={handleTabPress}
      onApplicationPress={handleApplicationPress}
    />
  );
}
