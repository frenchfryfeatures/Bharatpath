import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import type { UploadedFileMeta } from '@/screens/onboarding/ResumeIntakeScreen';
import type { CareerDetails } from '@/services/api/career';

const KEY = '@bharatpath:pending_resume';

export interface PendingResume {
  file: UploadedFileMeta;
  origin?: 'signup' | 'resume-required' | 'resume-decision' | 'resume-builder';
  email?: string;
  versionId?: string;
  fullName?: string;
  details?: CareerDetails;
  referralCode?: string;
}

/** Keep the actual bytes outside the picker cache until scoring has finished. */
export async function keepPendingResume(file: UploadedFileMeta): Promise<PendingResume> {
  if (!file.fileUri) throw new Error('The selected resume is unavailable. Choose it again.');
  const previous = await getPendingResume();
  let stored = file;
  if (Platform.OS !== 'web') {
    const source = new File(file.fileUri);
    if (!source.exists) throw new Error('The selected resume is unavailable. Choose it again.');
    const directory = new Directory(Paths.document, 'pending-resumes');
    directory.create({ idempotent: true, intermediates: true });
    const extension = file.fileName.toLowerCase().endsWith('.docx') ? '.docx' : '.pdf';
    const destination = new File(directory, `${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`);
    source.copy(destination);
    stored = { ...file, fileUri: destination.uri };
  }
  const pending = { file: stored };
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(pending));
  } catch (error) {
    if (stored.fileUri !== file.fileUri) new File(stored.fileUri!).delete();
    throw error;
  }
  if (previous?.file.fileUri && previous.file.fileUri !== stored.fileUri) removeOwnedFile(previous.file.fileUri);
  return pending;
}

export async function getPendingResume(): Promise<PendingResume | null> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as PendingResume;
    if (!pending.file?.fileUri) return null;
    if (Platform.OS !== 'web' && !new File(pending.file.fileUri).exists) return null;
    return pending;
  } catch {
    return null;
  }
}

export async function updatePendingResume(change: Partial<Omit<PendingResume, 'file'>>): Promise<void> {
  const pending = await getPendingResume();
  if (pending) await AsyncStorage.setItem(KEY, JSON.stringify({ ...pending, ...change }));
}

function removeOwnedFile(uri: string): void {
  if (Platform.OS === 'web') return;
  const directory = new Directory(Paths.document, 'pending-resumes');
  if (!uri.startsWith(`${directory.uri}/`)) return;
  const file = new File(uri);
  if (file.exists) file.delete();
}

export async function clearPendingResume(): Promise<void> {
  const pending = await getPendingResume();
  await AsyncStorage.removeItem(KEY);
  if (pending?.file.fileUri) removeOwnedFile(pending.file.fileUri);
}
