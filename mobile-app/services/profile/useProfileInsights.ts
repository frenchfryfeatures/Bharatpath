import {useCallback,useEffect,useState} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAuthContext} from '@/context/AuthContext';
import {getBaseUrl} from '@/services/api/client';
import {getProfileInsights} from '@/services/api/insights';
import type {ProfileInsights} from './insightTypes';
export function useProfileInsights(days:7|30){
 const {session}=useAuthContext();const scope=session?.userId||session?.subject||session?.email;
 const key=scope?`profile-insights:v2:${getBaseUrl()}:${scope}:${days}`:null;
 const [cached,setCached]=useState<{key:string;data:ProfileInsights}|null>(null);
 const [loading,setLoading]=useState(true);const [error,setError]=useState('');const [revision,setRevision]=useState(0);
 const refresh=useCallback(()=>setRevision(value=>value+1),[]);
 useEffect(()=>{let active=true;setLoading(true);setError('');if(!key){setLoading(false);return;}
 void (async()=>{try{const stored=await AsyncStorage.getItem(key);if(stored&&active){const saved=JSON.parse(stored);if(saved.data?.days===days&&Date.now()-saved.loadedAt<24*60*60*1000)setCached({key,data:saved.data});}}catch{}
 try{const fresh=await getProfileInsights(days);if(active){setCached({key,data:fresh});await AsyncStorage.setItem(key,JSON.stringify({data:fresh,loadedAt:Date.now()})).catch(()=>{});}}catch(failure){if(active)setError(failure instanceof Error?failure.message:'Insights could not be loaded. Please retry.');}finally{if(active)setLoading(false);}})();return()=>{active=false;};
 },[key,days,revision]);
 return {data:cached?.key===key?cached.data:null,loading,error,refresh};
}
