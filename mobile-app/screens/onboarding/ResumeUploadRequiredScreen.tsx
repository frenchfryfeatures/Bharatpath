import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, NotePencil, UploadSimple } from 'phosphor-react-native';
import { useAuthContext } from '@/context/AuthContext';
import { LogOut } from 'lucide-react-native';
import { Colors } from '@/theme/tokens';

export function ResumeUploadRequiredScreen({
  onUpload,
  onBuildResume,
  onBack,
}: {
  onUpload: () => void;
  onBuildResume?: () => void;
  onBack: () => void;
}) {
  const { signOut } = useAuthContext();
  const { height } = useWindowDimensions();
  const compact = height < 700;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back to profile"
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <ArrowLeft size={20} color={Colors.navy} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1} ellipsizeMode="tail" accessibilityRole="header" accessibilityLabel="Complete your profile">Complete your profile</Text>
        <Pressable onPress={() => void signOut()} accessibilityRole="button" accessibilityLabel="Sign out" style={styles.back}><LogOut size={20} color={Colors.navy} /></Pressable>
      </View>

      <View style={[styles.content, compact && styles.contentCompact]}>
        <View style={styles.intro}>
          <Text accessibilityRole="header" style={styles.title}>One last thing: your resume</Text>
          <Text style={styles.description}>
            Your details are saved. Upload your resume so we can score your profile.
          </Text>
        </View>

        <Pressable onPress={onUpload} accessibilityRole="button"
          accessibilityLabel="Upload your resume, PDF or DOCX, up to 10 MB"
          style={({ pressed }) => [styles.upload, compact && styles.uploadCompact, pressed && styles.pressed]}>
          <View style={styles.uploadIcon}>
            <UploadSimple size={22} color="#FFFFFF" />
          </View>
          <View style={styles.uploadCopy}>
            <Text style={styles.uploadTitle}>Upload your resume</Text>
            <Text style={styles.uploadDetail}>Choose a file from your device.</Text>
          </View>
          <View style={styles.uploadFooter}>
            <Text style={styles.fileTypes}>PDF · DOCX · UP TO 10 MB</Text>
            <ArrowRight size={18} color="#FFFFFF" />
          </View>
        </Pressable>

        {onBuildResume && (
          <Pressable onPress={onBuildResume} accessibilityRole="button"
            accessibilityLabel="Generate a resume instead"
            accessibilityHint="Build and edit a resume from your saved profile details"
            style={({ pressed }) => [styles.build, pressed && styles.pressed]}>
            <View style={styles.buildIcon}>
              <NotePencil size={22} color="#FFFFFF" />
            </View>
            <View style={styles.buildCopy}>
              <Text style={styles.buildTitle}>Generate a resume instead</Text>
              <Text style={styles.buildDetail}>No file? Build one from your answers. Edit, add projects, preview and download.</Text>
            </View>
            <ArrowRight size={18} color={Colors.brandAccent} />
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1,
    borderBottomColor: Colors.surface.hairline,
  },
  back: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.surface.card,
    borderWidth: 1, borderColor: Colors.surface.border, alignItems: 'center', justifyContent: 'center',
  },
  headerTitle: { flex: 1, minWidth: 0, marginHorizontal: 12, textAlign: 'left', fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: Colors.navy },
  headerSpacer: { width: 40 },
  content: { width: '100%', maxWidth: 600, alignSelf: 'center', padding: 20, gap: 20 },
  contentCompact: { paddingTop: 16, gap: 16 },
  intro: { gap: 8 },
  title: { fontFamily: 'GeneralSans-Semibold', fontSize: 26, lineHeight: 32, letterSpacing: -0.5, color: Colors.navy, textAlign: 'left' },
  description: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: Colors.text.muted },
  upload: { backgroundColor: Colors.indigo, borderRadius: 20, padding: 22, gap: 16 },
  uploadCompact: { padding: 18, gap: 12 },
  uploadIcon: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: Colors.indigoSemantic.fg,
    alignItems: 'center', justifyContent: 'center',
  },
  uploadCopy: { gap: 4 },
  uploadTitle: { fontFamily: 'GeneralSans-Bold', fontSize: 21, lineHeight: 27, letterSpacing: -0.3, color: '#FFFFFF' },
  uploadDetail: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 20, color: '#E9E3FA' },
  uploadFooter: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingTop: 14, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.28)',
  },
  fileTypes: { fontFamily: 'GeneralSans-Semibold', fontSize: 11, lineHeight: 16, letterSpacing: 0.5, color: '#E9E3FA' },
  build: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 18, borderRadius: 20,
    borderWidth: 1, borderColor: Colors.surface.borderSecondary, backgroundColor: Colors.surface.card,
  },
  buildIcon: {
    width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.brandAccent,
    flexShrink: 0, alignSelf: 'flex-start', alignItems: 'center', justifyContent: 'center',
  },
  buildCopy: { flex: 1, minWidth: 0, gap: 4 },
  buildTitle: { fontFamily: 'GeneralSans-Bold', fontSize: 16, lineHeight: 22, color: Colors.navy },
  buildDetail: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: Colors.text.primary },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
});
