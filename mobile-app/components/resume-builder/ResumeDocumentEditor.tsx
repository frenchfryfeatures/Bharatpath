import React,{useEffect,useState} from 'react';
import { AppModal as Modal } from '@/components/layout/AppModal';
import {View,Text,Pressable,StyleSheet,ScrollView,KeyboardAvoidingView,Platform,ActivityIndicator} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {X} from 'phosphor-react-native';
import {BuilderField,BuilderRepeater,BuilderScroll} from './BuilderFields';
import {contacts,steps,stepErrors,rowErrors,type Row} from '@/screens/onboarding/resume-builder/model';
import {normaliseResumeDocument,resumeSections,type ResumeEditorSection} from '@/services/profile/resumeDocument';
import type {ResumeBuilderContent} from '@/services/api/resumeBuilder';
export function ResumeDocumentEditor({visible,initial,initialSection='personal',title='Edit resume',saving=false,serverError,onClose,onSave}:{visible:boolean;initial:ResumeBuilderContent;initialSection?:ResumeEditorSection;title?:string;saving?:boolean;serverError?:string|null;onClose:()=>void;onSave:(document:ResumeBuilderContent)=>void|Promise<void>}) {
 const [draft,setDraft]=useState(()=>normaliseResumeDocument(initial));const [section,setSection]=useState<ResumeEditorSection>(initialSection);const [errors,setErrors]=useState<string[]>([]);
 useEffect(()=>{if(visible){setDraft(normaliseResumeDocument(initial));setSection(initialSection);setErrors([]);}},[visible,initial,initialSection]);
 const patch=(values:Partial<ResumeBuilderContent>)=>{setDraft(previous=>({...previous,...values}));setErrors([]);};
 const save=()=>{
  const messages=steps.flatMap((_,index)=>stepErrors(index,draft));
  setErrors(messages);
  if(messages.length){
   const invalidStep=steps.findIndex((_,index)=>stepErrors(index,draft).length>0);
   if(invalidStep===5){
    const invalidSection=(['certifications','languages','other_sections'] as const).find(key=>(draft[key]||[]).some(row=>Object.keys(rowErrors(key,{...row})).length));
    setSection(invalidSection||'certifications');
   }else setSection((['personal','experience','education','skills','projects'] as const)[invalidStep]||'personal');
   return;
  }
  void onSave(draft);
 };
 return <Modal visible={visible} animationType="slide" onRequestClose={()=>!saving&&onClose()}><SafeAreaView style={styles.screen}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':'height'}>
 <View style={styles.header}><Text style={styles.title}>{title}</Text><Pressable disabled={saving} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close resume editor" style={styles.icon}><X size={22} color="#0A1931"/></Pressable></View>
 <View><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>{resumeSections.map(item=><Pressable key={item.key} disabled={saving} accessibilityRole="tab" accessibilityState={{selected:section===item.key}} onPress={()=>{setSection(item.key);setErrors([]);}} style={[styles.tab,section===item.key&&styles.selected]}><Text style={styles.tabText}>{item.label}</Text></Pressable>)}</ScrollView></View>
 <View style={{flex:1}} pointerEvents={saving?'none':'auto'}><BuilderScroll key={section}>
 {!!serverError&&<Text accessibilityRole="alert" style={styles.error}>{serverError}</Text>}
 <Text style={styles.heading}>{resumeSections.find(item=>item.key===section)?.label}</Text>
 {!!errors.length&&<View accessibilityRole="alert">{errors.map((error,index)=><Text key={index} style={styles.error}>{error}</Text>)}</View>}
 {section==='personal'?<>
 {[{key:'full_name',label:'Full name',required:true},{key:'headline',label:'Professional headline'},{key:'location',label:'Location'},{key:'summary',label:'Summary / Bio',kind:'long' as const}].map(field=><BuilderField key={field.key} field={field} value={draft[field.key as keyof ResumeBuilderContent]} onChange={value=>patch({[field.key]:value})}/>)}
 {contacts.map(field=><BuilderField key={field.key} field={field} value={draft.contacts?.[field.key as keyof NonNullable<ResumeBuilderContent['contacts']>]} onChange={value=>patch({contacts:{...draft.contacts,[field.key]:value}})}/>)}
 <BuilderRepeater section="contact_links" items={(draft.contacts?.others||[]) as unknown as Row[]} onChange={items=>patch({contacts:{...draft.contacts,others:items as unknown as {label:string;url:string}[]}})}/>
 </>:['skills','achievements','interests'].includes(section)?<BuilderField field={{key:section,label:resumeSections.find(item=>item.key===section)!.label,kind:section==='achievements'?'lines':'list'}} value={draft[section as keyof ResumeBuilderContent]} onChange={value=>patch({[section]:value})}/>:<BuilderRepeater section={section} items={(draft[section as keyof ResumeBuilderContent]||[]) as Row[]} onChange={items=>patch({[section]:items})}/>}
 </BuilderScroll></View>
 <View style={styles.footer}><Pressable disabled={saving} onPress={onClose} style={styles.cancel}><Text style={styles.tabText}>Cancel</Text></Pressable><Pressable disabled={saving} onPress={save} accessibilityRole="button" style={styles.save}>{saving?<ActivityIndicator color="#fff"/>:<Text style={styles.saveText}>Save resume changes</Text>}</Pressable></View>
 </KeyboardAvoidingView></SafeAreaView></Modal>;
}
const styles=StyleSheet.create({screen:{flex:1,backgroundColor:'#FFFCF7'},header:{paddingHorizontal:20,paddingVertical:10,flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},title:{fontFamily:'GeneralSans-Semibold',fontSize:20,color:'#0A1931',flex:1},icon:{width:44,height:44,alignItems:'center',justifyContent:'center'},tabs:{paddingHorizontal:20,paddingBottom:12,gap:8},tab:{paddingHorizontal:14,minHeight:40,justifyContent:'center',borderWidth:1,borderColor:'#E7E0D4',borderRadius:22},selected:{borderColor:'#5F4DB2',backgroundColor:'#F1EAF7'},tabText:{fontFamily:'GeneralSans-Medium',fontSize:14,color:'#5F4DB2'},heading:{fontFamily:'GeneralSans-Semibold',fontSize:24,lineHeight:30,color:'#0A1931'},error:{fontFamily:'GeneralSans-Regular',fontSize:13,color:'#993A22'},footer:{padding:16,flexDirection:'row',gap:12,borderTopWidth:1,borderTopColor:'#F0EBDF'},cancel:{paddingHorizontal:16,minHeight:48,justifyContent:'center'},save:{flex:1,minHeight:48,backgroundColor:'#5F4DB2',borderRadius:24,alignItems:'center',justifyContent:'center'},saveText:{fontFamily:'GeneralSans-Semibold',fontSize:14,color:'#fff'}});
