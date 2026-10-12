/**
 * BharatPath - College Route
 * Connect with your college, link by referral code, view and accept invitations, and manage consent.
 */
import React from 'react';
import { useRouter } from 'expo-router';
import { CollegeScreen } from '@/screens/college/CollegeScreen';

export default function CollegeRoute() {
  const router = useRouter();

  return <CollegeScreen onBack={() => router.back()} />;
}
