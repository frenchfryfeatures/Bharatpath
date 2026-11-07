import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, UploadSimple } from 'phosphor-react-native';

export function ResumeUploadRequiredScreen({ onUpload, onBack }: {
  onUpload: () => void;
  onBack: () => void;
}) {
  return (
    <SafeAreaView style={styles.screen}>
      <Pressable onPress={onBack} accessibilityLabel="Back to profile" style={styles.back}>
        <ArrowLeft size={22} color="#0A1931" />
      </Pressable>
      <View style={styles.content}>
        <Text style={styles.title}>One last thing: your resume</Text>
        <Text style={styles.description}>
          Your profile answers are saved. Upload a PDF or DOCX resume to continue to membership and scoring.
        </Text>
        <Pressable onPress={onUpload} accessibilityRole="button" style={styles.upload}>
          <UploadSimple size={27} color="#FFFFFF" weight="bold" />
          <Text style={styles.uploadTitle}>Upload your resume</Text>
          <Text style={styles.uploadDetail}>PDF or DOCX · up to 5 MB</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' },
  back: { margin: 22, alignSelf: 'flex-start', padding: 8 },
  content: { flex: 1, paddingHorizontal: 28, paddingTop: 60, gap: 18 },
  title: { color: '#0A1931', fontSize: 30, fontWeight: '800', lineHeight: 37 },
  description: { color: '#5F6B80', fontSize: 16, lineHeight: 25 },
  upload: { backgroundColor: '#5F4DB2', borderRadius: 20, padding: 24, gap: 12, marginTop: 20 },
  uploadTitle: { color: '#FFFFFF', fontSize: 21, fontWeight: '700' },
  uploadDetail: { color: '#E9E3FA', fontSize: 13 },
});
