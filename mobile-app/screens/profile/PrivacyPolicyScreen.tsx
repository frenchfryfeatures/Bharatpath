import React, { useRef } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft } from 'phosphor-react-native';
import { useAuthContext } from '@/context/AuthContext';
import { AppAlert } from '@/components/feedback/AppAlert';
import { DataRightsSection } from './DataRightsSection';

const sections = [
  { title: 'About this policy', text: 'This policy explains how BharatPath uses information when you create a profile, prepare a resume, search and apply for jobs, learn new skills, practise interviews or use BharatPath Saathi.' },
  { title: 'Information you provide', text: 'We process your account and contact details, profile photo, education, employment history, salary and job preferences, skills, resumes and applications. We also process information you submit through assessments, courses, interviews, support requests and conversations with BharatPath Saathi. Payment providers process payment details; BharatPath uses transaction references and subscription information to manage your access.' },
  { title: 'How we use your information', text: 'We use this information to operate your account, build and review your resume, calculate your Bharatpath Score, recommend opportunities, send applications, provide feedback, manage memberships and show activity such as application updates and profile views. We also use service and security records to investigate problems and protect accounts.' },
  { title: 'Who can see your information', text: 'Employers can see candidate information through the recruitment features available to them. Opening a candidate’s full profile can provide access to their CV and contact details. Employer profile visits appear in Profile views. Applying for a job shares your application with that employer. Linked colleges can access information made available through the college features and your sharing settings.' },
  { title: 'Service providers and automated tools', text: 'We use providers for hosting, authentication, document processing, payments, notifications and AI-assisted features. Information needed to perform a feature may be processed by those providers, including resume content, interview responses or assistant messages. Review automated suggestions before using them, and avoid entering sensitive information that the feature does not need.' },
  { title: 'App permissions and device information', text: 'You can choose whether to allow notifications, access to selected documents or photos, and microphone or camera access for features that need them. You can change these permissions in your device settings. Device and notification registration details help deliver app updates and alerts. Disabling a permission may limit the related feature.' },
  { title: 'Storage, security and retention', text: 'We use access controls and other safeguards to protect information. Keep your login credentials private and sign out on shared devices. Information is retained as needed to provide services, resolve requests and meet applicable record-keeping requirements. Account deletion may not immediately remove records that must be retained for security, payment or other required purposes.' },
  { title: 'Your choices and requests', text: 'You can review and update your profile through the app. The Your data section below lets you request an export or account deletion, check request progress and withdraw a deletion request when that option is available. Signing out or uninstalling the app does not delete your account.' },
  { title: 'Updates and contact', text: 'We may update this policy as the app and its services change. Questions about your information or this policy can be sent to hello@bharatpath.com.' },
];

export function PrivacyPolicyScreen({ onBack, showData = false }: { onBack: () => void; showData?: boolean }) {
  const { session } = useAuthContext();
  const scroll = useRef<ScrollView>(null);
  const jumped = useRef(false);
  return <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="Back" style={styles.back}><ArrowLeft size={22} color="#0A1931" /></Pressable>
      <Text accessibilityRole="header" style={styles.title}>Privacy Policy</Text>
    </View>
    <ScrollView ref={scroll} contentContainerStyle={styles.content}>
      <Text style={styles.date}>Last updated: 20 November 2026</Text>
      {sections.map(section => <View key={section.title} style={styles.section}>
        <Text accessibilityRole="header" style={styles.heading}>{section.title}</Text>
        <Text style={styles.body}>{section.text}</Text>
      </View>)}
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('mailto:hello@bharatpath.com?subject=Privacy').catch(() => AppAlert.alert('Contact us', 'Email hello@bharatpath.com with your privacy question.'))}><Text style={styles.link}>Contact us about privacy</Text></Pressable>
      <View onLayout={event => {
        if (showData && !jumped.current) {
          jumped.current = true;
          const y = event.nativeEvent.layout.y;
          requestAnimationFrame(() => scroll.current?.scrollTo({ y, animated: false }));
        }
      }}>
        {session ? <DataRightsSection /> : <View style={styles.section}><Text accessibilityRole="header" style={styles.heading}>Your data</Text><Text style={styles.body}>Sign in to request a copy of your data, request account deletion or view your existing requests.</Text></View>}
      </View>
    </ScrollView>
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, gap: 12, borderBottomWidth: 1, borderBottomColor: '#E7E0D4' },
  back: { minWidth: 40, minHeight: 44, justifyContent: 'center' },
  title: { flex: 1, fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931' },
  content: { padding: 20, gap: 24, paddingBottom: 32 },
  date: { fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 20, color: '#5F6B80' },
  section: { gap: 8 },
  heading: { fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 24, color: '#0A1931' },
  body: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 22, color: '#5F6B80' },
  link: { fontFamily: 'GeneralSans-Medium', fontSize: 14, lineHeight: 22, color: '#5F4DB2' },
});
