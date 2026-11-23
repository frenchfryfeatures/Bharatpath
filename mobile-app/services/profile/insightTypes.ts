export interface InsightCounter {current:number;previous:number;change:number;percent_change:number|null}
export interface InsightApplication {id:string;title:string;company:string;current_stage:string;timeline:{stage:string;at:string}[]}
export interface InsightApplications {items:InsightApplication[];next_offset:number|null}
export interface ProfileInsights {
 coverage_note?:string;enabled:boolean;days:number;metrics:Record<string,boolean>;period_start?:string;period_end?:string;aggregated_at?:string|null;
 views?:InsightCounter;search?:InsightCounter;actions?:InsightCounter;
 action_breakdown?:({action:string}&InsightCounter)[];
 keywords?:{keyword:string;count:number}[];
 companies?:{name:string;industry:string|null;city:string|null;actions:number}[];companies_truncated?:boolean;
 strength?:{score:number;earned_weight:number;total_weight:number;next_steps:{key:string;label:string;benefit:string;optional?:boolean}[]};
 applications?:InsightApplications;
}
export const insightLabels:Record<string,string>={PROFILE_VIEW:'Profile views',SEARCH_APPEARANCE:'Search appearances',CV_DOWNLOAD:'CV downloads',SAVED:'Saved profiles',SHORTLISTED:'Shortlisted',INVITED:'Job invitations',MESSAGE_SENT:'Messages sent',EMAIL_OPENED:'Email links opened',CALL_OPENED:'Call links opened',APPLICATION_VIEW:'Application opens',SUBMITTED:'Applied',VIEWED:'Viewed',INTERVIEW:'Interview',DECISION:'Decision',HIRED:'Hired',REJECTED:'Rejected',WITHDRAWN:'Withdrawn',EXPIRED:'Expired'};
