export const MAX_RESUME_BYTES = 5 * 1024 * 1024;

export function resumeFileError(file: { name?: string; size?: number; uri?: string }): string | null {
  if (!file.uri) return 'The selected file is unavailable. Please choose it again.';
  const name = (file.name ?? '').toLowerCase();
  if (!name.endsWith('.pdf') && !name.endsWith('.docx')) {
    return 'Choose a PDF or DOCX file, or paste your resume text.';
  }
  if (file.size === 0) return 'The selected file is empty. Choose another file.';
  if (typeof file.size === 'number' && file.size > MAX_RESUME_BYTES) {
    return 'The file is larger than 5 MB. Choose a smaller PDF or DOCX file.';
  }
  return null;
}
