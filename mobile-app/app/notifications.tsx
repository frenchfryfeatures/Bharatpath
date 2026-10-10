/**
 * BharatPath - Notifications Route
 * The in-app notification inbox. Phone permission is handled during onboarding.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { NotificationScreen } from '@/screens/notifications/NotificationScreen';

export default function NotificationsRoute() {
  const router = useRouter();

  return <NotificationScreen onBack={() => router.back()} />;
}
