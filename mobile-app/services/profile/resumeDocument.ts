import contract from './resume-editor-contract.json';
import type {ResumeBuilderContent} from '@/services/api/resumeBuilder';
const record=(value:unknown):Record<string,any>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,any>:{};
const pick=(value:Record<string,any>,keys:string[])=>Object.fromEntries(keys.filter(key=>value[key]!=null).map(key=>[key,value[key]]));
export const resumeSections=[
 {key:'personal',label:'Personal Information'},{key:'experience',label:'Experience'},{key:'education',label:'Education'},
 {key:'skills',label:'Skills'},{key:'projects',label:'Projects'},{key:'certifications',label:'Certifications'},
 {key:'languages',label:'Languages'},{key:'achievements',label:'Achievements'},{key:'interests',label:'Interests'},{key:'other_sections',label:'Additional Information'},
] as const;
export type ResumeEditorSection=typeof resumeSections[number]['key'];
export function normaliseResumeDocument(value:unknown):ResumeBuilderContent {
 const source=record(value);const document:any=JSON.parse(JSON.stringify(contract.document));
 for(const key of Object.keys(document))if(source[key]!=null)document[key]=source[key];
 document.contacts={...contract.document.contacts,...pick(record(source.contacts),Object.keys(contract.document.contacts))};
 document.contacts.others=(document.contacts.others||[]).map((item:unknown)=>({...contract.entries.others,...pick(record(item),Object.keys(contract.entries.others))}));
 for(const [key,blank] of Object.entries(contract.entries)){
  if(key==='others')continue;
  document[key]=(Array.isArray(source[key])?source[key]:[]).map((item:unknown)=>({...blank,...pick(typeof item==='string'?{name:item}:record(item),Object.keys(blank))}));
 }
 for(const key of ['skills','achievements','interests'])document[key]=(Array.isArray(source[key])?source[key]:[]).map((item:unknown)=>typeof item==='string'?item:String(record(item).name||record(item).text||'')).filter(Boolean);
 return document;
}
/** Compatibility for old manual submissions; all new editor writes use the full document. */
export function legacyResumeDocument(value:unknown):ResumeBuilderContent {
 const source=record(value);
 if(source.structured_resume)return normaliseResumeDocument(source.structured_resume);
 const document=normaliseResumeDocument(source);
 document.experience=(Array.isArray(source.experience)?source.experience:[]).map((row:any)=>({...contract.entries.experience,...row,job_title:row.job_title||row.title||'',company:row.company||row.employer||'',start_date:row.start_date||String(row.start_year||''),end_date:row.end_date||String(row.end_year||''),is_current:row.is_current??Boolean(row.start_year&&!row.end_year),description:row.description||row.summary||''}));
 document.education=(Array.isArray(source.education)?source.education:[]).map((row:any)=>({...contract.entries.education,...row,end_date:row.end_date||String(row.completed_year||'')}));
 if(typeof source.raw_text==='string'&&source.raw_text.trim()&&!source.structured_resume){
  const chunks=source.raw_text.match(/[\s\S]{1,5000}/g)||[];
  document.other_sections=[...(document.other_sections||[]),{heading:'Imported resume text',items:chunks}];
 }
 return normaliseResumeDocument(document);
}
export function editorSectionForKind(kind:string):ResumeEditorSection {
 if(['header','summary','contacts'].includes(kind))return 'personal';
 if(kind==='activities')return 'interests';
 return resumeSections.some(section=>section.key===kind)?kind as ResumeEditorSection:'other_sections';
}
