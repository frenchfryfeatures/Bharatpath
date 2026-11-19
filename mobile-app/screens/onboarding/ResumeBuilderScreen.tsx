import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable, ActivityIndicator, Modal, Image, KeyboardAvoidingView, Platform, BackHandler, Keyboard, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, ArrowRight, Eye, DownloadSimple, Cloud, CloudWarning, Check, Plus, X, UploadSimple, ArrowsClockwise } from 'phosphor-react-native';
import { BuilderField, BuilderRepeater, BuilderScroll } from '@/components/resume-builder/BuilderFields';
import { TemplateSelector } from '@/components/resume-builder/TemplateSelector';
import { useResumeBuilderDraft, type ResumeBuilderApi } from './resume-builder/useResumeBuilderDraft';
import * as defaultApi from '@/services/api/resumeBuilder';
import { contacts, steps, stepErrors, finalErrors, type Row } from './resume-builder/model';
import type { ResumeBuilderContent } from '@/services/api/resumeBuilder';
import { AppAlert } from '@/components/feedback/AppAlert';
export function ResumeBuilderScreen({ onDone, onBack, onUploadCv, api = defaultApi, initialContent, initialStep = 0 }: {
  api?: ResumeBuilderApi;
  initialContent?: ResumeBuilderContent;
  initialStep?: number;
  onDone: (resumeVersionId: string) => void | Promise<void>;
  onBack: () => void;
  onUploadCv?: () => void;
}) {
  const builder = useResumeBuilderDraft(api, initialContent);
  const [selecting, setSelecting] = useState(!initialContent);
  const [step, setStep] = useState(initialStep);
  const [completed, setCompleted] = useState<number[]>(initialContent ? steps.map((_,index)=>index) : []);
  const [templateModal, setTemplateModal] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const [skill, setSkill] = useState('');
  const [operation, setOperation] = useState<'preview' | 'download' | 'submit' | 'leave' | 'next' | 'reset' | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [preview, setPreview] = useState<{
    pages: string[];
    mime: string;
  } | null>(null);
  const { width } = useWindowDimensions();
  const tabs = useRef<ScrollView>(null);
  const tabPositions = useRef<Record<number, number>>({});
  const leaving = useRef(false);
  const active = Boolean(operation);
  const draft = builder.draft;
  const content = draft?.content || {};
  const patch = (values: Partial<ResumeBuilderContent>) => {
    const latest = builder.getLatest();
    if (latest)
      builder.update({ ...latest, content: { ...latest.content, ...values } });
    setErrors([]);
    // Edits may invalidate a completed step, so its checkmark is removed until revalidated.
    setCompleted(previous => previous.filter(index => index !== step));
  };
  const handleFailure = (message: string) => { setErrors([message]); };
  const flushAndLeave = async (action: () => void) => {
    if (leaving.current)
      return;
    leaving.current = true;
    setOperation('leave');
    if (skill.trim())
      addSkills();
    try {
      await builder.flush();
      action();
    }
    catch {
      AppAlert.alert('Changes are not saved yet', 'Your changes are kept on this device. Retry before leaving, or come back later to restore them.', [
        { text: 'Stay here', style: 'cancel' },
        { text: 'Retry', onPress: () => void flushAndLeave(action) },
        { text: 'Leave and keep on device', onPress: action },
      ]);
    }
    finally {
      leaving.current = false;
      setOperation(null);
    }
  };
  const back = () => {
    if (active)
      return;
    Keyboard.dismiss();
    if (templateModal) {
      setTemplateModal(false);
      return;
    }
    if (preview) {
      setPreview(null);
      return;
    }
    if (!selecting) {
      if (step > 0)
        setStep(index => index - 1);
      else
        setSelecting(true);
      return;
    }
    void flushAndLeave(onBack);
  };
  const backRef = useRef(back);
  backRef.current = back;
  useEffect(() => { const listener = BackHandler.addEventListener('hardwareBackPress', () => { backRef.current(); return true; }); return () => listener.remove(); }, []);
  useEffect(() => { tabs.current?.scrollTo({ x: Math.max(0, (tabPositions.current[step] || 0) - 20), animated: true }); }, [step]);
  const addSkills = () => {
    const values = skill.split(',').map(item => item.trim()).filter(Boolean);
    const latest = builder.getLatest();
    if (!latest)
      return;
    if (values.length) {
      const next = [...(latest.content.skills || [])];
      for (const value of values)
        if (!next.some(item => item.toLowerCase() === value.toLowerCase()))
          next.push(value);
      patch({ skills: next });
    }
    setSkill('');
  };
  const next = async () => {
    if (active || !draft)
      return;
    const latest = builder.getLatest()!;
    const validation = selecting ? [] : stepErrors(step, latest.content);
    if (validation.length) {
      setErrors(validation);
      return;
    }
    if (step === 3 && skill.trim())
      addSkills();
    setOperation('next');
    try {
      await builder.flush();
      Keyboard.dismiss();
      setErrors([]);
      if (selecting)
        setSelecting(false);
      else {
        setCompleted(previous => Array.from(new Set([...previous, step])));
        setStep(index => Math.min(5, index + 1));
      }
    }
    catch {
      handleFailure('Your changes could not be saved. Check your connection and retry.');
    }
    finally {
      setOperation(null);
    }
  };
  const output = async (kind: 'preview' | 'download' | 'submit') => {
    if (active)
      return;
    if (skill.trim())
      addSkills();
    if (kind === 'submit') {
      const value = builder.getLatest();
      if (!value)
        return;
      const invalid = finalErrors(value.content);
      if (invalid.length) {
        setErrors(invalid);
        const first = steps.findIndex((_, index) => stepErrors(index, value.content).length > 0);
        if (first >= 0)
          setStep(first);
        return;
      }
    }
    setOperation(kind);
    setErrors([]);
    Keyboard.dismiss();
    try {
      await builder.flush();
      const value = builder.getLatest();
      if (!value)
        return;
      if (kind === 'preview') {
        const result = await api.previewResumeDraft(value.template_key, value.content);
        setPreview({ pages: result.pages, mime: result.mime });
      }
      else if (kind === 'download')
        await api.downloadAndShareResumePdf(value.content.full_name);
      else {
        const result = await api.pushResumeDraft();
        await onDone(result.resume_version_id);
      }
    }
    catch {
      handleFailure(kind === 'preview' ? 'Your resume preview could not be opened. Check your details and connection, then try again.' : kind === 'download' ? 'Your PDF could not be downloaded. Your edits are still here; please try again.' : 'Your resume could not be finalized. Check your details and retry.');
    }
    finally {
      setOperation(null);
    }
  };
  const reset = () => AppAlert.alert('Refresh from profile and CV?', 'This replaces your resume draft with the latest uploaded CV and profile answers.', [
    { text: 'Cancel', style: 'cancel' }, {
      text: 'Refresh', style: 'destructive', onPress: async () => {
        setOperation('reset');
        try {
          await builder.flush();
          await api.resetResumeDraft();
          await builder.load();
          setCompleted([]);
          setErrors([]);
        }
        catch {
          handleFailure('Your draft could not be refreshed. Please try again.');
        }
        finally {
          setOperation(null);
        }
      }
    }
  ]);
  const rows = (key: keyof ResumeBuilderContent) => (content[key] || []) as Row[];
  const repeater = (key: keyof ResumeBuilderContent) => <BuilderRepeater section={key} primary={step !== 5} items={rows(key)} onChange={items => patch({ [key]: items })} />;
  if (builder.loading)
    return <SafeAreaView style={styles.screen}><View style={styles.loading}><ActivityIndicator color="#5F4DB2" /><Text style={styles.body}>Preparing your resume…</Text></View></SafeAreaView>;
  if (!draft)
    return <SafeAreaView style={styles.screen}><View style={styles.loading}><Text style={styles.error}>{builder.error}</Text><Pressable style={styles.primary} onPress={() => void builder.load()}><Text style={styles.primaryText}>Try again</Text></Pressable><Pressable style={styles.link} onPress={onBack}><Text style={styles.linkText}>Back</Text></Pressable></View></SafeAreaView>;
  const templateCopy: Record<string, string> = {
    classic: 'A timeless single-column layout with clear section headings.', modern: 'A crisp layout with subtle accents and a contemporary feel.', sidebar: 'A balanced two-column layout that keeps skills and contact details in view.', minimal: 'A simple, spacious layout that puts your experience first.'
  };
  const templateName = builder.templates.find(item => item.key === draft.template_key)?.name || 'Classic';
  return <SafeAreaView style={styles.screen}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={active} onPress={back} style={styles.icon}><ArrowLeft size={22} color="#0A1931" /></Pressable>
        <View style={styles.headerTitleRow}><Text style={styles.headerTitle} numberOfLines={1}>Resume Builder</Text>
          <Pressable accessibilityRole="button" accessibilityLabel={builder.status === 'saving' ? 'Saving resume' : builder.status === 'saved' ? 'Resume saved' : builder.status === 'error' ? 'Save failed. Tap to retry' : 'Resume save status'} disabled={builder.status !== 'error' || active} onPress={() => void builder.flush().catch(() => { })} style={styles.saveStatus}>
            {builder.status === 'saving' ? <ActivityIndicator size="small" color="#5F4DB2" /> : builder.status === 'saved' ? <Check size={18} color="#1F6B45" weight="bold" /> : builder.status === 'error' ? <CloudWarning size={20} color="#993A22" /> : <Cloud size={19} color="#A8AFBC" />}
          </Pressable>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Preview resume" disabled={active} onPress={() => void output('preview')} style={styles.icon}>{operation === 'preview' ? <ActivityIndicator color="#5F4DB2" /> : <Eye size={22} color="#5F4DB2" />}</Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Download resume PDF" disabled={active} onPress={() => void output('download')} style={styles.icon}>{operation === 'download' ? <ActivityIndicator color="#5F4DB2" /> : <DownloadSimple size={21} color="#5F4DB2" />}</Pressable>
      </View>
      {!!builder.error && <View style={styles.notice}><Text accessibilityRole="alert" style={styles.error}>{builder.error}</Text><Pressable accessibilityRole="button" onPress={() => void builder.flush().catch(() => { })}><Text style={styles.linkText}>Retry save</Text></Pressable></View>}
      {!!builder.recovery && <View style={styles.notice}><Text style={styles.body}>Unsaved edits from this device are available.</Text><View style={styles.inline}><Pressable onPress={builder.restore} style={styles.link}><Text style={styles.linkText}>Restore edits</Text></Pressable><Pressable onPress={builder.dismissRecovery} style={styles.link}><Text style={styles.muted}>Keep saved version</Text></Pressable></View></View>}
      {selecting ? <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.selectionContent} showsVerticalScrollIndicator={false}>
        <View style={styles.selectionIntro}><Text accessibilityRole="header" style={styles.heading}>Choose your template</Text><Text style={styles.body}>A clear, professional layout for your story. You can change it later.</Text></View>
        <View><TemplateSelector templates={builder.templates} value={draft.template_key} version={builder.templateVersion} renderPreview={api.previewResumeDraft} onChange={template_key => {
          if (!active)
            builder.update({ ...builder.getLatest()!, template_key });
        }} /></View>
        <View style={styles.selectionIntro}><Text style={styles.subheading}>{templateName}</Text><Text style={styles.body}>{templateCopy[draft.template_key]}</Text><Text style={styles.muted}>Your existing resume details are ready to edit.</Text></View>
      </ScrollView> : <>
        <View style={styles.progressHeader}><Text style={styles.progressText}>Step {step + 1} of 6</Text><Pressable disabled={active} accessibilityRole="button" accessibilityLabel="Change resume template" onPress={() => setTemplateModal(true)} style={styles.templateButton}><Text style={styles.linkText}>{templateName} · Change template</Text></Pressable></View>
        <View><ScrollView ref={tabs} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{steps.map((label, index) => {
          const selected = step === index, done = completed.includes(index);
          return <Pressable key={label} accessibilityRole="tab" accessibilityState={{ selected, disabled: active || (!done && index > step) }} onLayout={event => { tabPositions.current[index] = event.nativeEvent.layout.x; }} disabled={active || (!done && index > step)} onPress={() => { setStep(index); setErrors([]); Keyboard.dismiss(); }} style={[styles.tab, selected && styles.tabActive]}><View style={[styles.stepNumber, (selected || done) && styles.stepNumberActive]}>{done && !selected ? <Check size={12} color="#5F4DB2" weight="bold" /> : <Text style={[styles.stepNumberText, selected && styles.activeText]}>{index + 1}</Text>}</View><Text style={[styles.tabText, selected && styles.activeText]}>{label}</Text></Pressable>;
        })}</ScrollView></View>
        <View style={[{ flex: 1 }, active && { opacity: 0.7 }]} pointerEvents={active ? 'none' : 'auto'}>
          <BuilderScroll key={step}>
            {![1, 2, 4].includes(step) && <Text accessibilityRole="header" style={styles.heading}>{steps[step]}</Text>}
            {!!errors.length && <View accessibilityRole="alert" style={styles.validation}>{errors.map((message, index) => <Text key={index} style={styles.error}>{message}</Text>)}</View>}
            {builder.outOfDate && step === 0 && <View style={styles.notice}><Text style={styles.body}>A newer CV is available. Keep your edits, or refresh this draft from it.</Text><View style={styles.inline}><Pressable onPress={reset} style={styles.link}><Text style={styles.linkText}>Refresh from CV</Text></Pressable><Pressable style={styles.link} onPress={() => void api.keepResumeDraft().then(() => builder.setOutOfDate(false)).catch(() => handleFailure('Could not keep the draft. Please retry.'))}><Text style={styles.linkText}>Keep my edits</Text></Pressable></View></View>}
            {step === 0 && <>
              <BuilderField field={{
                key: 'full_name', label: 'Full name', required: true
              }} value={content.full_name} error={errors.length && !content.full_name?.trim() ? 'Enter your full name.' : undefined} onChange={value => patch({ full_name: String(value) })} />
              <BuilderField field={{ key: 'headline', label: 'Professional headline' }} value={content.headline} onChange={value => patch({ headline: String(value) })} />
              <BuilderField field={{ key: 'location', label: 'Location' }} value={content.location} onChange={value => patch({ location: String(value) })} />
              <BuilderField field={{
                key: 'summary', label: 'Summary / Bio', kind: 'long'
              }} value={content.summary} onChange={value => patch({ summary: String(value) })} />
              {contacts.slice(0, 2).map(field => <BuilderField key={field.key} field={field} value={content.contacts?.[field.key as keyof NonNullable<ResumeBuilderContent['contacts']>]} onChange={value => patch({ contacts: { ...content.contacts, [field.key]: value } })} />)}
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: linksOpen }} style={styles.secondary} onPress={() => setLinksOpen(value => !value)}><Text style={styles.linkText}>{linksOpen ? 'Hide' : 'Show'} professional & social links</Text></Pressable>
              {linksOpen && <>{contacts.slice(2).map(field => <BuilderField key={field.key} field={field} value={content.contacts?.[field.key as keyof NonNullable<ResumeBuilderContent['contacts']>]} onChange={value => patch({ contacts: { ...content.contacts, [field.key]: value } })} />)}<BuilderRepeater section="contact_links" items={(content.contacts?.others || []) as unknown as Row[]} onChange={items => patch({
                contacts: {
                  ...content.contacts, others: items as unknown as {
                    label: string;
                    url: string;
                  }[]
                }
              })} /></>}
              {onUploadCv && <Pressable accessibilityRole="button" disabled={active} onPress={() => void flushAndLeave(onUploadCv)} style={styles.upload}><UploadSimple size={18} color="#5F4DB2" /><View style={{ flex: 1, gap: 3 }}><Text style={styles.linkText}>Import from your CV instead</Text><Text style={styles.muted}>Upload a PDF or DOCX using the existing CV flow.</Text></View><ArrowRight size={18} color="#5F4DB2" /></Pressable>}
            </>}
            {step === 1 && repeater('experience')}
            {step === 2 && repeater('education')}
            {step === 3 && <><Text style={styles.body}>Add skills that reflect your experience. Separate several skills with commas.</Text>
              <BuilderField field={{ key: 'new_skill', label: 'Add skills' }} value={skill} onChange={value => setSkill(String(value))} /><Pressable accessibilityRole="button" onPress={addSkills} style={styles.secondary}><Plus size={17} color="#5F4DB2" /><Text style={styles.linkText}>Add skills</Text></Pressable>
              <View style={styles.skillList}>{(content.skills || []).map((value, index) => <View key={`${value}-${index}`} style={styles.skill}><Text style={styles.skillText}>{value}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Remove skill ${value}`} hitSlop={8} onPress={() => patch({ skills: (content.skills || []).filter((_, i) => i !== index) })}><X size={15} color="#5F4DB2" /></Pressable></View>)}</View>
            </>}
            {step === 4 && repeater('projects')}
            {step === 5 && <>{repeater('certifications')}{repeater('languages')}
              <BuilderField field={{
                key: 'achievements', label: 'Achievements (one per line)', kind: 'lines'
              }} value={content.achievements} onChange={value => patch({ achievements: value as string[] })} />
              <BuilderField field={{
                key: 'interests', label: 'Interests (comma separated)', kind: 'list'
              }} value={content.interests} onChange={value => patch({ interests: value as string[] })} />
              {repeater('other_sections')}
              <Pressable accessibilityRole="button" onPress={reset} style={styles.reset}><ArrowsClockwise size={18} color="#5F6B80" /><Text style={styles.muted}>Reset draft from profile and CV</Text></Pressable>
            </>}
          </BuilderScroll></View></>}
      {!!errors.length && selecting && <View style={styles.notice}><Text style={styles.error}>{errors[0]}</Text></View>}
      <View style={styles.footer}>{!selecting && step > 0 && <Pressable accessibilityRole="button" accessibilityLabel="Previous step" disabled={active} style={styles.previous} onPress={back}><ArrowLeft size={20} color="#5F4DB2" /></Pressable>}
        <Pressable accessibilityRole="button" disabled={active} onPress={() => !selecting && step === 5 ? void output('submit') : void next()} style={[styles.primary, active && styles.disabled]}>
          {operation === 'next' || operation === 'submit' || operation === 'leave' ? <ActivityIndicator color="#fff" /> : <><Text style={styles.primaryText}>{selecting ? 'Continue with ' + templateName : step === 5 ? 'Use this resume and continue' : 'Next Step'}</Text>{(selecting || step < 5) && <ArrowRight size={20} color="#fff" />}</>}</Pressable></View>
    </KeyboardAvoidingView>
    <Modal visible={templateModal} animationType="slide" onRequestClose={() => setTemplateModal(false)}><SafeAreaView style={styles.screen}><View style={styles.modalHeader}><Text style={styles.headerTitle}>Change template</Text><Pressable accessibilityRole="button" accessibilityLabel="Close template selector" onPress={() => setTemplateModal(false)} style={styles.icon}><X size={23} color="#0A1931" /></Pressable></View><ScrollView contentContainerStyle={styles.selectionContent}><View style={styles.selectionIntro}><Text style={styles.body}>Your details stay the same when you switch layouts.</Text></View><View><TemplateSelector templates={builder.templates} value={draft.template_key} version={builder.templateVersion} renderPreview={api.previewResumeDraft} onChange={template_key => {
      if (!active)
        builder.update({ ...builder.getLatest()!, template_key });
    }} /></View></ScrollView><View style={styles.footer}><Pressable accessibilityRole="button" style={styles.primary} onPress={() => setTemplateModal(false)}><Text style={styles.primaryText}>Keep {templateName}</Text></Pressable></View></SafeAreaView></Modal>
    <Modal visible={preview !== null} animationType="slide" onRequestClose={() => setPreview(null)}><SafeAreaView style={styles.screen}><View style={styles.modalHeader}><Text style={styles.headerTitle}>Resume preview</Text><View style={styles.inline}><Pressable accessibilityRole="button" accessibilityLabel="Download preview as PDF" disabled={active} onPress={() => void output('download')} style={styles.icon}><DownloadSimple size={22} color="#5F4DB2" /></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Close resume preview" onPress={() => setPreview(null)} style={styles.icon}><X size={23} color="#0A1931" /></Pressable></View></View><>{!!errors.length && <View style={styles.notice}><Text style={styles.error}>{errors[0]}</Text></View>}<ScrollView contentContainerStyle={styles.previewContent} maximumZoomScale={3} minimumZoomScale={1} centerContent>{preview?.pages.map((page, index) => <View key={index} style={{ gap: 8 }}><Text style={styles.muted}>Page {index + 1} of {preview.pages.length}</Text><Image source={{ uri: `data:${preview.mime};base64,${page}` }} resizeMode="contain" style={{
      width: width - 32, height: (width - 32) * 297 / 210, backgroundColor: '#fff'
    }} /></View>)}</ScrollView></></SafeAreaView></Modal>
  </SafeAreaView>;
}
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFCF7' }, loading: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16
  }, header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#F0EBDF', backgroundColor: '#fff'
  }, icon: {
    width: 42, height: 44, alignItems: 'center', justifyContent: 'center'
  }, headerTitleRow: {
    flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6
  }, headerTitle: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 25, color: '#0A1931', flexShrink: 1
  }, saveStatus: {
    width: 24, height: 32, alignItems: 'center', justifyContent: 'center'
  }, heading: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 24, lineHeight: 30, letterSpacing: -0.3, color: '#0A1931'
  }, subheading: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 18, color: '#0A1931'
  }, body: {
    fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#3A4761'
  }, muted: {
    fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#5F6B80'
  }, selectionContent: {
    gap: 22, paddingTop: 24, paddingBottom: 24
  }, selectionIntro: { paddingHorizontal: 20, gap: 9 }, progressHeader: {
    paddingHorizontal: 20, paddingTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10
  }, progressText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 12, color: '#5F6B80'
  }, templateButton: { minHeight: 36, justifyContent: 'center' }, tabs: {
    paddingHorizontal: 20, paddingVertical: 12, gap: 8
  }, tab: {
    flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, minHeight: 40, borderRadius: 22, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#fff'
  }, tabActive: { backgroundColor: '#F1EAF7', borderColor: '#C9BEEB' }, tabText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 13, color: '#788194'
  }, activeText: { color: '#5F4DB2' }, stepNumber: {
    width: 21, height: 21, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F2F3F5'
  }, stepNumberActive: { backgroundColor: '#E9E1F5' }, stepNumberText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 11, color: '#788194'
  }, notice: {
    padding: 14, gap: 8, backgroundColor: '#F8F5FF'
  }, error: {
    fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#993A22'
  }, validation: {
    padding: 14, gap: 6, borderRadius: 12, backgroundColor: '#FFF0EE'
  }, link: { paddingVertical: 8 }, linkText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#5F4DB2'
  }, inline: {
    flexDirection: 'row', alignItems: 'center', gap: 14, flexWrap: 'wrap'
  }, secondary: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: '#DDD6C7', backgroundColor: '#fff'
  }, upload: {
    flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 14, padding: 16, marginTop: 4
  }, footer: {
    flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 10, borderTopWidth: 1, borderTopColor: '#F0EBDF', backgroundColor: '#fff'
  }, primary: {
    flex: 1, minHeight: 50, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 25, backgroundColor: '#5F4DB2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10
  }, primaryText: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 15, lineHeight: 21, color: '#fff', textAlign: 'center', flexShrink: 1
  }, previous: {
    width: 50, height: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#DDD6C7', borderRadius: 25
  }, disabled: { opacity: 0.65 }, skillList: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8
  }, skill: {
    maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#F1EAF7'
  }, skillText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#5F4DB2', flexShrink: 1
  }, reset: {
    flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44
  }, modalHeader: {
    paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F0EBDF'
  }, previewContent: {
    padding: 16, gap: 24, backgroundColor: '#F1EFF4'
  }
});
