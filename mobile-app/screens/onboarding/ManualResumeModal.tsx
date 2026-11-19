import React,{useMemo} from 'react';
import {ResumeDocumentEditor} from '@/components/resume-builder/ResumeDocumentEditor';
import {legacyResumeDocument} from '@/services/profile/resumeDocument';
import type {ResumeBuilderContent} from '@/services/api/resumeBuilder';
export interface ManualExperienceItem {
  id: string;
  employer: string;
  title: string;
  start_year: string;
  end_year: string;
  is_current: boolean;
  summary: string;
}

export interface ManualEducationItem {
  id: string;
  institution: string;
  qualification: string;
  completed_year: string;
}

export interface ManualResumeData {
  structured_resume?: ResumeBuilderContent;
  full_name: string;
  headline?: string;
  experience: {
    employer: string;
    title: string;
    start_year: number;
    end_year?: number | null;
    summary?: string | null;
  }[];
  education: {
    institution: string;
    qualification: string;
    completed_year?: number | null;
  }[];
  skills: string[];
}

export interface ManualResumeModalProps {
  visible: boolean;
  initialFullName?: string;
  initialData?: ManualResumeData;
  onClose: () => void;
  onSubmit: (data: ManualResumeData) => void;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
}


export function ManualResumeModal({visible,initialFullName='',initialData,onClose,onSubmit,title='Create resume',isSubmitting=false}:ManualResumeModalProps) {
 const document=useMemo(()=>legacyResumeDocument(initialData||{full_name:initialFullName}),[initialData,initialFullName]);
 return <ResumeDocumentEditor visible={visible} title={title} initial={document} saving={isSubmitting} onClose={onClose} onSave={value=>onSubmit({
  full_name:value.full_name||'',headline:value.headline||'',skills:value.skills||[],
  experience:(value.experience||[]).map(item=>({employer:item.company||'',title:item.job_title||'',start_year:Number.parseInt(item.start_date||'',10)||0,end_year:item.is_current?null:Number.parseInt(item.end_date||'',10)||null,summary:item.description})),
  education:(value.education||[]).map(item=>({institution:item.institution||'',qualification:item.qualification||'',completed_year:Number.parseInt(item.end_date||'',10)||null})),
  structured_resume:value,
 })}/>;
}
