/**
 * Save a downloaded file to the phone (2026-11-23).
 *
 * "Download" used to open the share sheet on every platform, so it looked
 * like Share. Now:
 * - Android: written into a folder the user picks once (Downloads offered
 *   first, via the Storage Access Framework) and remembered after that. No
 *   share sheet.
 * - iOS: apps cannot write to a "Downloads" folder; the system sheet's
 *   "Save to Files" is the platform's save, so that is what opens, titled as
 *   a save rather than a share.
 * Sharing stays a separate action wherever a screen offers it.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SAVE_DIRECTORY_KEY = '@bharatpath:save_directory_uri';

export type SaveOutcome = 'saved' | 'handed-to-system';

function baseName(filename: string): string {
  return filename.replace(/\.[^.]+$/, '');
}

async function androidDirectory(): Promise<string> {
  const SAF = FileSystem.StorageAccessFramework;
  const remembered = await AsyncStorage.getItem(SAVE_DIRECTORY_KEY);
  if (remembered) {
    try {
      // Still writable? A revoked grant throws here.
      await SAF.readDirectoryAsync(remembered);
      return remembered;
    } catch {
      await AsyncStorage.removeItem(SAVE_DIRECTORY_KEY);
    }
  }
  const permission = await SAF.requestDirectoryPermissionsAsync(
    SAF.getUriForDirectoryInRoot('Download'),
  );
  if (!permission.granted) throw new Error('Choose a folder to save your resume in.');
  await AsyncStorage.setItem(SAVE_DIRECTORY_KEY, permission.directoryUri);
  return permission.directoryUri;
}

/** `localUri` must be a file in the app's cache or document directory. */
export async function saveFileToDevice(
  localUri: string,
  filename: string,
  mimeType: string,
): Promise<SaveOutcome> {
  if (Platform.OS === 'android') {
    const directory = await androidDirectory();
    const target = await FileSystem.StorageAccessFramework.createFileAsync(
      directory,
      baseName(filename),
      mimeType,
    );
    const data = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    await FileSystem.writeAsStringAsync(target, data, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return 'saved';
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Saving files is not available on this device.');
  await Sharing.shareAsync(localUri, {
    mimeType,
    UTI: mimeType === 'application/pdf' ? 'com.adobe.pdf' : undefined,
    dialogTitle: 'Save your resume',
  });
  return 'handed-to-system';
}

/** Extension and MIME type for a file the server sent. */
export function describeDownload(contentType: string | undefined, fallbackName: string) {
  const type = (contentType || '').split(';')[0].trim().toLowerCase();
  if (type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    return { mimeType: type, filename: `${baseName(fallbackName)}.docx` };
  }
  if (type === 'application/msword') return { mimeType: type, filename: `${baseName(fallbackName)}.doc` };
  return { mimeType: 'application/pdf', filename: `${baseName(fallbackName)}.pdf` };
}
