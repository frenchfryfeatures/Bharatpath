import React from 'react';
import { Modal, Platform, type ModalProps } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SystemNavigationFrame, useSystemWindowMetrics } from './SystemNavigationFrame';
import type { SystemBarTone } from '@/utils/systemNavigation';

/** A modal owns another native window; it cannot rely on the root's inset. */
export function AppModal({ children, systemBarTone = 'light', ...props }: ModalProps & { systemBarTone?: SystemBarTone }) {
  const metrics = useSystemWindowMetrics();
  return <Modal {...props} statusBarTranslucent={Platform.OS === 'android' ? true : props.statusBarTranslucent} navigationBarTranslucent={Platform.OS === 'android' ? true : props.navigationBarTranslucent}>
    <SafeAreaProvider initialMetrics={metrics}>
      <SystemNavigationFrame tone={systemBarTone} transparent={props.transparent}>{children}</SystemNavigationFrame>
    </SafeAreaProvider>
  </Modal>;
}
