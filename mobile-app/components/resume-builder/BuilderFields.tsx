import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, ScrollView, Pressable, StyleSheet, Keyboard, Modal, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Plus, PencilSimple, Trash, X } from 'phosphor-react-native';
import { sections, rowErrors, type Field, type Row } from '@/screens/onboarding/resume-builder/model';
const FocusContext = createContext<(input: TextInput | null) => void>(() => { });
export function BuilderScroll({ children }: {
  children: React.ReactNode;
}) {
  const scroll = useRef<ScrollView>(null), offset = useRef(0), active = useRef<TextInput | null>(null);
  const reveal = () => {
    const input = active.current;
    requestAnimationFrame(() => input?.measureInWindow((_x, y, _w, h) => {
      scroll.current?.getNativeScrollRef()?.measureInWindow((_sx, top) => {
        if (h)
          scroll.current?.scrollTo({ y: Math.max(0, offset.current + y - top - 36), animated: true });
      });
    }));
  };
  useEffect(() => { const listener = Keyboard.addListener('keyboardDidShow', reveal); return () => listener.remove(); }, []);
  return <FocusContext.Provider value={input => { active.current = input; reveal(); }}><ScrollView ref={scroll} style={{ flex: 1 }} contentContainerStyle={styles.form} onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16} keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS === 'web' ? 'none' : 'on-drag'} showsVerticalScrollIndicator={false}>{children}</ScrollView></FocusContext.Provider>;
}
export function BuilderField({ field, value, onChange, error }: {
  field: Field;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
}) {
  const list = field.kind === 'list' || field.kind === 'lines';
  const separator = field.kind === 'lines' ? '\n' : ', ';
  const display = Array.isArray(value) ? value.join(separator) : String(value ?? '');
  const [raw, setRaw] = useState(display);
  const own = useRef(JSON.stringify(value));
  const input = useRef<TextInput>(null);
  const reveal = useContext(FocusContext);
  const signature = JSON.stringify(value);
  useEffect(() => {
    if (own.current !== signature) {
      setRaw(display);
      own.current = signature;
    }
  }, [signature, display]);
  if (field.kind === 'boolean')
    return <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: Boolean(value) }} onPress={() => onChange(!value)} style={styles.checkboxRow}>
      <View style={[styles.checkbox, !!value && styles.checkboxActive]}>{!!value && <Check size={14} color="#fff" />}</View><Text style={styles.label}>{field.label}</Text></Pressable>;
  return <View style={styles.field}><Text style={styles.label}>{field.label}{field.required ? ' *' : ''}</Text>
    <TextInput ref={input} accessibilityLabel={field.label} style={[styles.input, (field.kind === 'long' || field.kind === 'lines') && styles.textArea, !!error && styles.invalid]} value={list ? raw : display} onFocus={() => reveal(input.current)} onChangeText={text => {
      if (list) {
        setRaw(text);
        const next = text.split(field.kind === 'lines' ? '\n' : ',').map(item => item.trim()).filter(Boolean);
        own.current = JSON.stringify(next);
        onChange(next);
      }
      else
        onChange(text);
    }} multiline={field.kind === 'long' || field.kind === 'lines'} maxLength={list ? undefined : field.kind === 'long' ? 5000 : field.kind === 'date' ? 7 : field.kind === 'url' ? 500 : 300} keyboardType={field.kind === 'email' ? 'email-address' : field.kind === 'phone' ? 'phone-pad' : 'default'} autoCapitalize={field.kind === 'email' || field.kind === 'url' ? 'none' : 'sentences'} placeholder={field.kind === 'date' ? 'YYYY or YYYY-MM' : field.kind === 'lines' ? 'One item per line' : field.kind === 'list' ? 'Separate with commas' : field.label} placeholderTextColor="#9AA1AE" />
    {field.kind === 'date' && <Text style={styles.hint}>Use a year or month, for example 2024 or 2024-06.</Text>}
    {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}</View>;
}
const limits: Record<string, number> = {
  experience: 40, education: 20, projects: 40, certifications: 40, languages: 20, other_sections: 20, contact_links: 20
};
export function BuilderRepeater({ section, items, onChange, primary = false }: {
  primary?: boolean;
  section: string;
  items: Row[];
  onChange: (items: Row[]) => void;
}) {
  const config = sections[section];
  const [editing, setEditing] = useState<number | null | undefined>(undefined);
  const [row, setRow] = useState<Row>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const open = (index: number | null) => { setEditing(index); setRow(index === null ? {} : { ...items[index] }); setErrors({}); };
  const close = () => setEditing(undefined);
  return <View style={styles.repeater}>
    <View style={styles.sectionRow}><Text accessibilityRole="header" style={[styles.subheading, primary && styles.primaryHeading]}>{config.title}</Text><Pressable accessibilityRole="button" accessibilityLabel={`Add ${config.singular}`} disabled={items.length >= limits[section]} onPress={() => open(null)} style={styles.add}><Plus size={16} color="#5F4DB2" /><Text style={styles.addText}>Add {config.singular}</Text></Pressable></View>
    {!items.length && <View style={styles.empty}><Text style={styles.emptyTitle}>No {config.title.toLowerCase()} added yet</Text><Text style={styles.hint}>Add an entry if it is relevant to your resume. You can leave this section empty.</Text></View>}
    {items.map((item, index) => <View key={index} style={styles.card}><View style={styles.cardTop}><View style={{ flex: 1, gap: 4 }}><Text style={styles.cardTitle}>{String(item.job_title || item.qualification || item.name || item.heading || item.label || `${config.singular} ${index + 1}`)}</Text>
      <Text style={styles.hint}>{[item.company, item.institution, item.issuer, item.proficiency, item.role].filter(Boolean).join(' · ')}</Text>
      {(!!item.start_date || !!item.end_date) && <Text style={styles.hint}>{String(item.start_date || '')} — {item.is_current ? 'Present' : String(item.end_date || '')}</Text>}</View>
      <Pressable accessibilityRole="button" accessibilityLabel={`Edit ${config.singular} ${index + 1}`} onPress={() => open(index)} style={styles.icon}><PencilSimple size={19} color="#5F4DB2" /></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${config.singular} ${index + 1}`} onPress={() => onChange(items.filter((_, i) => i !== index))} style={styles.icon}><Trash size={19} color="#993A22" /></Pressable></View>
      {!!item.description && <Text style={styles.body} numberOfLines={3}>{String(item.description)}</Text>}</View>)}
    <Modal visible={editing !== undefined} animationType="slide" onRequestClose={close}>
      <SafeAreaView style={styles.modal}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={styles.modalHeader}><Text style={styles.subheading}>{editing === null ? 'Add' : 'Edit'} {config.singular}</Text><Pressable accessibilityRole="button" accessibilityLabel="Close entry editor" onPress={close} style={styles.icon}><X size={22} color="#0A1931" /></Pressable></View>
        <BuilderScroll>{config.fields.filter(field => !(section === 'experience' && row.is_current && field.key === 'end_date')).map(field => <BuilderField key={field.key} field={field} value={row[field.key]} error={errors[field.key]} onChange={value => { setRow(previous => ({ ...previous, [field.key]: value })); setErrors(previous => ({ ...previous, [field.key]: '' })); }} />)}</BuilderScroll>
        <View style={styles.modalFooter}><Pressable onPress={close} style={styles.cancel}><Text style={styles.addText}>Cancel</Text></Pressable><Pressable accessibilityRole="button" onPress={() => {
          const nextErrors = rowErrors(section, row); setErrors(nextErrors); if (Object.keys(nextErrors).length)
            return; const next = [...items]; const saved = section === 'experience' && row.is_current ? { ...row, end_date: '' } : row; if (editing === null)
            next.push(saved);
          else if (editing !== undefined)
            next[editing] = saved; onChange(next); close();
        }} style={styles.save}><Text style={styles.saveText}>Save {config.singular}</Text></Pressable></View>
      </KeyboardAvoidingView></SafeAreaView></Modal>
  </View>;
}
const styles = StyleSheet.create({
  form: {
    padding: 20, gap: 18, paddingBottom: 28
  }, field: { gap: 7 }, label: {
    fontFamily: 'GeneralSans-Medium', fontSize: 14, lineHeight: 20, color: '#0A1931'
  }, input: {
    minHeight: 52, borderWidth: 1, borderColor: '#DDD6C7', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 13, fontFamily: 'GeneralSans-Regular', fontSize: 15, color: '#0A1931', backgroundColor: '#fff'
  }, textArea: { minHeight: 104, textAlignVertical: 'top' }, invalid: { borderColor: '#993A22' }, error: {
    fontFamily: 'GeneralSans-Regular', fontSize: 13, color: '#993A22', lineHeight: 19
  }, hint: {
    fontFamily: 'GeneralSans-Regular', fontSize: 13, lineHeight: 19, color: '#5F6B80'
  }, checkboxRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44
  }, checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: '#C9BEEB', alignItems: 'center', justifyContent: 'center'
  }, checkboxActive: { backgroundColor: '#5F4DB2' }, repeater: { gap: 12 }, sectionRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap'
  }, primaryHeading: {
    fontSize: 24, lineHeight: 30, letterSpacing: -0.3
  }, subheading: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 18, lineHeight: 25, color: '#0A1931'
  }, add: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 6
  }, addText: {
    fontFamily: 'GeneralSans-Medium', fontSize: 14, color: '#5F4DB2'
  }, empty: {
    padding: 18, borderWidth: 1, borderColor: '#EBE7EF', borderRadius: 14, gap: 6, backgroundColor: '#FAF9FC'
  }, emptyTitle: {
    fontFamily: 'GeneralSans-Medium', fontSize: 15, color: '#3A4761'
  }, card: {
    borderWidth: 1, borderColor: '#E7E0D4', borderRadius: 14, padding: 16, gap: 10, backgroundColor: '#fff'
  }, cardTop: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6
  }, cardTitle: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#0A1931'
  }, body: {
    fontFamily: 'GeneralSans-Regular', fontSize: 14, lineHeight: 21, color: '#3A4761'
  }, icon: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center'
  }, modal: { flex: 1, backgroundColor: '#fff' }, modalHeader: {
    paddingHorizontal: 20, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: 1, borderBottomColor: '#F0EBDF'
  }, modalFooter: {
    padding: 16, flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: '#F0EBDF'
  }, cancel: {
    paddingHorizontal: 18, minHeight: 48, justifyContent: 'center'
  }, save: {
    flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5F4DB2'
  }, saveText: {
    fontFamily: 'GeneralSans-Semibold', fontSize: 15, color: '#fff'
  }
});
