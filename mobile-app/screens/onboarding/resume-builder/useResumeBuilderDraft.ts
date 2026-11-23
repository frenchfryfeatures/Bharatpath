import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuthContext } from '@/context/AuthContext';
import { getBaseUrl } from '@/services/api/client';
import * as service from '@/services/api/resumeBuilder';
import type { ResumeBuilderContent, ResumeTemplateInfo } from '@/services/api/resumeBuilder';
export type ResumeBuilderApi = Pick<typeof service, 'getResumeDraft' | 'getResumeTemplates' | 'saveResumeDraft' | 'previewResumeDraft' | 'downloadAndShareResumePdf' | 'pushResumeDraft' | 'resetResumeDraft' | 'keepResumeDraft'> & {
  storageScope?: string;
};
import { ResumeDraftQueue, type SaveState } from '@/services/storage/resumeDraftQueue';
import type { BuilderDraft } from './model';
export function useResumeBuilderDraft(api: ResumeBuilderApi = service, initialContent?: ResumeBuilderContent) {
  const initialDocument = useRef(initialContent);
  const { session } = useAuthContext();
  const account = session?.userId || session?.subject || session?.email || 'candidate';
  const key = `resume-builder:pending:v1:${api.storageScope || getBaseUrl()}:${account}`;
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [templates, setTemplates] = useState<ResumeTemplateInfo[]>([]);
  const [templateVersion, setTemplateVersion] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<SaveState>('idle');
  const [outOfDate, setOutOfDate] = useState(false);
  const [recovery, setRecovery] = useState<BuilderDraft | null>(null);
  const queue = useRef<ResumeDraftQueue<BuilderDraft> | null>(null);
  const latest = useRef<BuilderDraft | null>(null);
  // The draft as this editing session found it: what Cancel goes back to.
  const opened = useRef<BuilderDraft | null>(null);
  const mounted = useRef(true);
  const generation = useRef(0);
  const flash = useRef<ReturnType<typeof setTimeout> | null>(null);
  const storage = useRef<Promise<unknown>>(Promise.resolve());
  const backup = useCallback((value: BuilderDraft | null) => {
    storage.current = storage.current.catch(() => { }).then(() => value ? AsyncStorage.setItem(key, JSON.stringify(value)) : AsyncStorage.removeItem(key));
    return storage.current;
  }, [key]);
  const load = useCallback(async () => {
    const loadId = ++generation.current;
    setLoading(true);
    setError('');
    setRecovery(null);
    try {
      const [response, catalogue, saved] = await Promise.all([api.getResumeDraft(), api.getResumeTemplates(), AsyncStorage.getItem(key).catch(() => null)]);
      if (!mounted.current || loadId !== generation.current)
        return;
      const initial = { template_key: response.template_key, content: initialDocument.current || response.content };
      latest.current = initial;
      opened.current = { template_key: response.template_key, content: response.content };
      setDraft(initial);
      setTemplates(catalogue.templates);
      setTemplateVersion(catalogue.version);
      setOutOfDate(Boolean(response.out_of_date));
      if (saved) {
        try {
          const local = JSON.parse(saved);
          if (local?.content && catalogue.templates.some(t => t.key === local.template_key) && JSON.stringify(local) !== JSON.stringify(initial))
            setRecovery(local);
        }
        catch { }
      }
      queue.current?.dispose();
      queue.current = new ResumeDraftQueue(initial, response.saved && !initialDocument.current, async (value) => {
        await api.saveResumeDraft(value.template_key, value.content);
        if (JSON.stringify(latest.current) === JSON.stringify(value))
          await backup(null).catch(() => { });
      }, (state) => {
        if (!mounted.current)
          return;
        if (flash.current)
          clearTimeout(flash.current);
        setStatus(state);
        if (state === 'saved') {
          setError('');
          flash.current = setTimeout(() => {
            if (mounted.current)
              setStatus('idle');
          }, 1600);
        }
        if (state === 'error')
          setError('Your changes could not be saved. They are kept on this device. Check your connection and retry.');
      });
    }
    catch {
      if (mounted.current && loadId === generation.current)
        setError('Your resume could not be loaded. Check your connection and try again.');
    }
    finally {
      if (mounted.current && loadId === generation.current)
        setLoading(false);
    }
  }, [key, backup, api]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
      generation.current++;
      if (flash.current)
        clearTimeout(flash.current);
      const current = queue.current;
      current?.dispose();
      void current?.flush().catch(() => { });
    };
  }, [load]);
  useEffect(() => {
    const listener = AppState.addEventListener('change', state => {
      if (state !== 'active')
        void queue.current?.flush().catch(() => { });
    }); return () => listener.remove();
  }, []);
  const update = useCallback((value: BuilderDraft) => {
    latest.current = value;
    setDraft(value);
    void backup(value).catch(() => { });
    queue.current?.enqueue(value);
  }, [backup]);
  const flush = useCallback(async () => { await queue.current?.flush(); }, []);
  /** Edited since this session opened the builder? */
  const hasChanges = useCallback(
    () => Boolean(latest.current && opened.current && JSON.stringify(latest.current) !== JSON.stringify(opened.current)),
    [],
  );
  /** Put the saved draft back as this session found it, and save that. The
   *  resume itself (any pushed version) is a separate record and untouched. */
  const discardChanges = useCallback(async () => {
    if (!opened.current) return;
    update(opened.current);
    await queue.current?.flush();
    await backup(null).catch(() => { });
  }, [update, backup]);
  return {
    hasChanges, discardChanges,
    draft, templates, templateVersion, loading, error, status, recovery, load, update, flush, outOfDate, setOutOfDate,
    getLatest: () => latest.current,
    restore: () => {
      if (recovery) {
        update(recovery);
        setRecovery(null);
      }
    },
    dismissRecovery: () => { setRecovery(null); void backup(null).catch(() => { }); }
  };
}
