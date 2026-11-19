import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FileText } from 'phosphor-react-native';
import { Colors } from '@/theme/tokens';

/** Keep the resume picker label consistent before and after account verification. */
export function ResumePickerLabel({ filename }: { filename?: string | null }) {
  return (
    <View style={styles.content}>
      <FileText size={20} color={Colors.text.muted} />
      <Text style={styles.text} numberOfLines={1}>
        {filename || 'Choose PDF or DOCX'}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 8, width: '100%' },
  text: { flexShrink: 1, fontFamily: 'GeneralSans-Regular', fontSize: 15, color: Colors.text.muted },
});
