import {baseApi} from '@/store/api/base-api';
import type {ProfileInsights,InsightApplications} from './types';
export const insightsApi=baseApi.injectEndpoints({endpoints:builder=>({
 profileInsights:builder.query<ProfileInsights,7|30>({query:days=>`/candidate/insights?days=${days}`,keepUnusedDataFor:300}),
 insightApplications:builder.query<InsightApplications,number>({query:offset=>`/candidate/insights/applications?offset=${offset}`}),
 insightConfig:builder.query<InsightsConfig,void>({query:()=>'/admin/insights/config',providesTags:[{type:'Admin',id:'INSIGHTS'}]}),
 insightVolumes:builder.query<{events:{metric:string;retained:number;pending:number}[];aggregated_at:string|null},void>({query:()=>'/admin/insights/volumes'}),
 saveInsightConfig:builder.mutation<InsightsConfig,InsightsConfig>({query:body=>({url:'/admin/insights/config',method:'PUT',body}),invalidatesTags:[{type:'Admin',id:'INSIGHTS'}]}),
 recordRecruiterAction:builder.mutation<unknown,{candidate_id:string;action:'CV_DOWNLOAD'|'EMAIL_OPENED'|'CALL_OPENED';event_id:string;application_id?:string}>({query:body=>({url:'/employer/insights/actions',method:'POST',body,keepalive:true})}),
 recordSearchImpressions:builder.mutation<unknown,{receipts:string[]}>({query:body=>({url:'/employer/insights/impressions',method:'POST',body})}),
})});
export interface InsightsConfig {version:number;rollout_percent:number;metrics:Record<string,boolean>;rules:{key:string;label:string;benefit:string;weight:number;enabled:boolean;order:number}[]}
export const {useProfileInsightsQuery,useLazyInsightApplicationsQuery,useInsightConfigQuery,useInsightVolumesQuery,useSaveInsightConfigMutation,useRecordRecruiterActionMutation,useRecordSearchImpressionsMutation}=insightsApi;
