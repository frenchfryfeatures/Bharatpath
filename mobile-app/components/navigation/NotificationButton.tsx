import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { Bell } from 'phosphor-react-native';
import { getInbox } from '@/services/api/notifications';

export function NotificationButton() {
  const router = useRouter();
  const [unread, setUnread] = useState(false);
  useFocusEffect(useCallback(() => {
    let active = true;
    void getInbox(null, 1).then(page => { if (active) setUnread(page.unread > 0); }).catch(() => undefined);
    return () => { active = false; };
  }, []));
  return <Pressable accessibilityRole="button" accessibilityLabel={unread ? 'Notifications, unread updates' : 'Notifications'} onPress={() => router.push('/notifications' as any)} style={({ pressed }) => [styles.button, pressed && { opacity: 0.75 }]}>
    <Bell size={18} color="#0A1931" weight="bold"/>
    {unread && <View style={styles.dot}/>}
  </Pressable>;
}
const styles = StyleSheet.create({
  button: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF' },
  dot: { position: 'absolute', right: 10, top: 8, width: 7, height: 7, borderRadius: 4, backgroundColor: '#D9383A', borderWidth: 1, borderColor: '#FFFFFF' },
});
