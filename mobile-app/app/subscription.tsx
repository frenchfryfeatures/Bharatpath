import React from 'react';
import { useRouter } from 'expo-router';
import { SubscriptionManagementScreen } from '@/screens/subscription/SubscriptionManagementScreen';

/**
 * BharatPath - Candidate Subscription Route (/subscription)
 *
 * Provides access to view and manage candidate membership and billing:
 * - Current subscription status (ACTIVE, access indicator, renewal date, cancel renewal)
 * - Available plans list (Monthly, Quarterly, Semester, Annual) with Razorpay checkout
 * - Promo / discount code support
 */
export default function SubscriptionRoute() {
  const router = useRouter();

  return (
    <SubscriptionManagementScreen
      onBack={() => {
        if (router.canGoBack()) {
          router.back();
        } else {
          router.replace('/you');
        }
      }}
    />
  );
}
