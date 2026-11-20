import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DownloadSimple, FileText, X } from 'phosphor-react-native';
import { downloadResumeVersion, listResumeVersions, previewResumeVersion } from '@/services/api/resume';
import { selectApplicationResume } from '@/utils/applicationResume';
import { ZoomableResumePages } from '@/components/resume-builder/ZoomableResumePages';

export function ApplyResumePreview({ visible, jobTitle, companyName, external, submitting, submitError, onClose, onConfirm, onEditResume }: {
  visible: boolean; jobTitle: string; companyName: string; external?: boolean; submitting: boolean; submitError?: string;
  onClose: () => void; onConfirm: () => Promise<void>; onEditResume: () => void;
}) {
  const [document, setDocument] = useState<{ id: string; pages: string[]; truncated: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const revision = useRef(0);
  const locked = useRef(false);
  const currentResume = useCallback(async () => {
    const versions = await listResumeVersions();
    return selectApplicationResume(versions);
  }, []);
  const load = useCallback(async () => {
    const token = ++revision.current;
    setLoading(true); setError(''); setDocument(null);
    try {
      const version = await currentResume();
      if (!version) {
        if (token === revision.current) setError('Confirm a resume in Resume review before applying.');
        return;
      }
      const preview = await previewResumeVersion(version.resume_version_id);
      if (!preview.pages.length) {
        if (token === revision.current) setError('Your resume preview is not ready. Please try again.');
        return;
      }
      if (token === revision.current) setDocument({ id: version.resume_version_id, ...preview });
    } catch {
      if (token === revision.current) setError('Your resume preview could not be loaded. Please try again, or check your resume in Resume review.');
    } finally { if (token === revision.current) setLoading(false); }
  }, [currentResume]);
  useEffect(() => {
    if (visible) void load();
    return () => { revision.current += 1; };
  }, [visible, load]);
  const confirm = async () => {
    if (!document || locked.current || submitting) return;
    locked.current = true; setChecking(true); setError('');
    try {
      const latest = await currentResume();
      if (latest?.resume_version_id !== document.id) {
        await load();
        setError('Your resume changed. Review the updated version before continuing.');
        return;
      }
      await onConfirm();
    } catch {
      setError('We could not check your resume. Please try again before applying.');
    } finally { locked.current = false; setChecking(false); }
  };
  const busy = submitting || checking;
  return <Modal visible={visible} animationType="slide" onRequestClose={() => !busy && onClose()}>
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}><View style={styles.headerCopy}><Text style={styles.title}>Review your resume</Text><Text style={styles.body}>{jobTitle} · {companyName}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Close resume preview" disabled={busy} onPress={onClose} style={styles.icon}><X size={22} color="#0A1931"/></Pressable></View>
      <View style={[styles.content, { flex: 1 }]}>
        {external && <View style={styles.note}><FileText size={20} color="#5F4DB2"/><Text style={[styles.body, { flex: 1 }]}>Review your current resume before continuing to the employer’s website. You will complete the application there.</Text></View>}
        {loading && <View style={styles.empty}><ActivityIndicator color="#5F4DB2"/><Text style={styles.body}>Preparing your resume preview…</Text></View>}
        {!!(error || submitError) && <Text accessibilityRole="alert" style={styles.error}>{error || submitError}</Text>}
        {!loading && !document && <Pressable accessibilityRole="button" onPress={() => void load()} style={styles.secondary}><Text style={styles.link}>Retry preview</Text></Pressable>}
        {!!document && <ZoomableResumePages key={document.id} pages={document.pages} truncated={document.truncated}/>}
        {!!document && <Pressable accessibilityRole="button" disabled={downloading || busy} style={styles.download} onPress={async () => { setDownloading(true); try { await downloadResumeVersion(document.id); } catch { setError('The resume could not be downloaded. Please try again.'); } finally { setDownloading(false); } }}><DownloadSimple size={18} color="#5F4DB2"/><Text style={styles.link}>{downloading ? 'Downloading…' : 'Download full resume'}</Text></Pressable>}
      </View>
      <View style={styles.footer}><Pressable accessibilityRole="button" disabled={busy} onPress={onEditResume} style={styles.secondary}><Text style={styles.link}>Edit resume</Text></Pressable><Pressable accessibilityRole="button" accessibilityState={{ disabled: !document || loading || busy }} disabled={!document || loading || busy} onPress={() => void confirm()} style={[styles.primary, (!document || loading || busy) && { opacity: 0.5 }]}>{busy ? <ActivityIndicator color="#FFFFFF"/> : <Text style={styles.primaryText}>{external ? 'Continue to employer' : 'Confirm & apply'}</Text>}</Pressable></View>
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' }, header: { padding: 20, borderBottomWidth: 1, borderBottomColor: '#E7E0D4', flexDirection: 'row', gap: 12, alignItems: 'flex-start' }, headerCopy: { flex: 1, gap: 4 },
  title: { fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931' }, body: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#5F6B80' },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#FFFFFF' }, content: { padding: 20, gap: 16 },
  note: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16, backgroundColor: '#F1EAF7' }, empty: { minHeight: 200, alignItems: 'center', justifyContent: 'center', gap: 12 },
  error: { fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#993A22' }, page: { overflow: 'hidden', backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 12 }, caption: { padding: 10, fontFamily: 'GeneralSans-Medium', fontSize: 12, color: '#5F6B80' },
  footer: { padding: 20, borderTopWidth: 1, borderTopColor: '#E7E0D4', flexDirection: 'row', gap: 10 }, primary: { flex: 1, minHeight: 50, paddingHorizontal: 12, paddingVertical: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 16, backgroundColor: '#5F4DB2' }, primaryText: { fontFamily: 'GeneralSans-Semibold', fontSize: 15, lineHeight: 21, color: '#FFFFFF', textAlign: 'center' }, secondary: { minHeight: 50, padding: 12, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, link: { fontFamily: 'GeneralSans-Semibold', fontSize: 14, lineHeight: 20, color: '#5F4DB2' }, download: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
