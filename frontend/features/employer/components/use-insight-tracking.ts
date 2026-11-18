"use client";
import {useRecordRecruiterActionMutation} from '@/features/student/insights/api';
/** Telemetry never delays a contact link or a completed file transfer. */
export function useInsightTracking(){
 const [record]=useRecordRecruiterActionMutation();
 return (candidateId:string,action:'CV_DOWNLOAD'|'EMAIL_OPENED'|'CALL_OPENED',applicationId?:string)=>{
  void record({candidate_id:candidateId,action,event_id:crypto.randomUUID(),...(applicationId?{application_id:applicationId}:{})}).unwrap().catch(()=>{});
 };
}
