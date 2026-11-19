import React, { useEffect, useState } from 'react';
import { View, Text, Image, ScrollView, Pressable, ActivityIndicator, StyleSheet, useWindowDimensions } from 'react-native';
import { Check } from 'phosphor-react-native';
import { previewResumeDraft, type ResumeTemplateKey, type ResumeTemplateInfo, type ResumeBuilderContent } from '@/services/api/resumeBuilder';
// These previews use the real server renderer with fictional content, never the saved draft.
const example: ResumeBuilderContent = {
  full_name: 'Priya Sharma', headline: 'Product Designer', location: 'Bengaluru, India', summary: 'Thoughtful designer turning complex challenges into clear, useful experiences.', contacts: {
    email: 'priya@example.com', phone: '+91 90000 00000', website: 'example.com'
  }, experience: [{
    job_title: 'Product Designer', company: 'Studio North', start_date: '2022-06', is_current: true, description: 'Designed accessible mobile experiences and worked closely with product and engineering teams.', highlights: ['Improved the onboarding experience', 'Built a consistent design system']
  }, {
    job_title: 'Design Intern', company: 'Design Collective', start_date: '2021-06', end_date: '2022-04', description: 'Research, prototyping and usability testing.'
  }], education: [{
    qualification: 'Bachelor of Design', institution: 'National Design Institute', start_date: '2017', end_date: '2021', field_of_study: 'Communication Design'
  }], skills: ['Product design', 'User research', 'Figma', 'Prototyping'], projects: [{
    name: 'Community Connect', description: 'A mobile experience helping local communities share useful resources.', technologies: ['Research', 'Interaction design']
  }], languages: [{ name: 'English', proficiency: 'Fluent' }, { name: 'Hindi', proficiency: 'Native' }]
};
const cache = new Map<string, Promise<string>>();
function preview(key: ResumeTemplateKey, version: string, render: typeof previewResumeDraft) {
  const id = `${version}:${key}`;
  if (!cache.has(id))
    cache.set(id, render(key, example).then(result => {
      if (!result.pages[0])
        throw new Error('No preview');
      return `data:${result.mime};base64,${result.pages[0]}`;
    }).catch(error => { cache.delete(id); throw error; }));
  return cache.get(id)!;
}
function TemplateCard({ template, selected, onSelect, version, width, renderPreview }: {
  renderPreview: typeof previewResumeDraft;
  template: ResumeTemplateInfo;
  selected: boolean;
  onSelect: () => void;
  version: string;
  width: number;
}) {
  const [uri, setUri] = useState('');
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true; setError(false); void preview(template.key, version, renderPreview).then(value => {
      if (active)
        setUri(value);
    }).catch(() => {
      if (active)
        setError(true);
    }); return () => { active = false; };
  }, [template.key, version, retry, renderPreview]);
  return <View style={{ width }}><Pressable onPress={onSelect} accessibilityRole="radio" accessibilityLabel={`${template.name} template`} accessibilityState={{ checked: selected }} style={[styles.card, selected && styles.selected]}>
    <View style={{
      width: width - 18, aspectRatio: 210 / 297, backgroundColor: '#fff'
    }}>{uri ? <Image source={{ uri }} style={styles.image} resizeMode="contain" /> : error ? <Pressable accessibilityRole="button" accessibilityLabel={`Retry ${template.name} preview`} onPress={() => setRetry(v => v + 1)} style={styles.state}><Text style={styles.retry}>Preview unavailable. Tap to retry.</Text></Pressable> : <View style={styles.state}><ActivityIndicator color="#5F4DB2" accessibilityLabel={`Loading ${template.name} preview`} /></View>}</View>
    {selected && <View style={styles.check}><Check size={14} color="#fff" weight="bold" /></View>}
  </Pressable><Text style={[styles.name, selected && { color: '#5F4DB2' }]}>{template.name}</Text></View>;
}
export function TemplateSelector({ templates, value, onChange, version, renderPreview = previewResumeDraft }: {
  renderPreview?: typeof previewResumeDraft;
  templates: ResumeTemplateInfo[];
  value: ResumeTemplateKey;
  onChange: (key: ResumeTemplateKey) => void;
  version: string;
}) {
  const { width } = useWindowDimensions();
  const cardWidth = Math.min(176, Math.max(140, (width - 44) / 1.9));
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.list} decelerationRate="fast" snapToInterval={cardWidth + 12}>
    {templates.map(template => <TemplateCard key={template.key} template={template} selected={value === template.key} onSelect={() => onChange(template.key)} version={version} width={cardWidth} renderPreview={renderPreview} />)}
  </ScrollView>;
}
const styles = StyleSheet.create({
  list: {
    gap: 12, paddingHorizontal: 20, paddingVertical: 6
  }, card: {
    padding: 8, borderRadius: 14, borderWidth: 1, borderColor: '#E7E0D4', backgroundColor: '#fff'
  }, selected: { borderColor: '#5F4DB2', backgroundColor: '#F5F1FC' }, image: { width: '100%', height: '100%' }, state: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 12
  }, retry: {
    fontFamily: 'GeneralSans-Regular', fontSize: 12, lineHeight: 17, color: '#5F6B80', textAlign: 'center'
  }, check: {
    position: 'absolute', top: 12, right: 12, width: 23, height: 23, borderRadius: 12, backgroundColor: '#5F4DB2', alignItems: 'center', justifyContent: 'center'
  }, name: {
    fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#3A4761', paddingTop: 9, paddingBottom: 4, textAlign: 'center'
  }
});
