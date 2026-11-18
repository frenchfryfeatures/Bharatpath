import {apiRequest} from './client';
import type {ProfileInsights,InsightApplications} from '@/services/profile/insightTypes';
export const getProfileInsights=(days:7|30)=>apiRequest<ProfileInsights>(`/candidate/insights?days=${days}`);
export const getInsightApplications=(offset:number)=>apiRequest<InsightApplications>(`/candidate/insights/applications?offset=${offset}`);
