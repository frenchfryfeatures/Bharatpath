import contract from './editor-contract.json';
import type {StructuredResume} from '@/components/resume/structured-resume';
import type {ManualResume} from '@/store/student/resume.api';
export function emptyResumeDocument():StructuredResume {return structuredClone(contract.document) as StructuredResume;}
export function fromManualResume(value?:ManualResume,defaultName=''):StructuredResume {
 const document=emptyResumeDocument();document.full_name=value?.full_name||defaultName;document.headline=value?.headline||'';document.skills=value?.skills||[];
 document.experience=(value?.experience||[]).map(row=>({...contract.entries.experience,job_title:row.title,company:row.employer,start_date:String(row.start_year||''),end_date:String(row.end_year||''),is_current:!row.end_year,description:row.summary||''}));
 document.education=(value?.education||[]).map(row=>({...contract.entries.education,institution:row.institution,qualification:row.qualification,end_date:String(row.completed_year||'')}));
 return document;
}
