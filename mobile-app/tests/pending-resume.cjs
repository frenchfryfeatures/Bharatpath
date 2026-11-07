const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const files = new Set(['file:///picker/resume.pdf', 'file:///picker/other.docx']);
const storage = new Map();
class Directory {
  constructor(...parts) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/'); }
  create() {}
}
class File {
  constructor(...parts) { this.uri = parts.map((part) => typeof part === 'string' ? part : part.uri).join('/'); }
  get exists() { return files.has(this.uri); }
  copy(target) { files.add(target.uri); }
  delete() { files.delete(this.uri); }
}
const filename = path.resolve(__dirname, '../services/storage/pendingResume.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
}).outputText;
const loaded = new Module(filename, module);
loaded.require = (name) => {
  if (name === '@react-native-async-storage/async-storage') return {
    getItem: async (key) => storage.get(key) ?? null,
    setItem: async (key, value) => { storage.set(key, value); },
    removeItem: async (key) => { storage.delete(key); },
  };
  if (name === 'expo-file-system') return { File, Directory, Paths: { document: 'file:///documents' } };
  if (name === 'react-native') return { Platform: { OS: 'ios' } };
  return require(name);
};
loaded._compile(compiled, filename);

(async () => {
  const { keepPendingResume, getPendingResume, updatePendingResume, clearPendingResume } = loaded.exports;
  const first = await keepPendingResume({ fileName: 'resume.pdf', fileUri: 'file:///picker/resume.pdf', fileSize: '1 KB' });
  assert.notEqual(first.file.fileUri, 'file:///picker/resume.pdf');
  assert.ok(files.has(first.file.fileUri));
  await updatePendingResume({ email: 'candidate@example.com', versionId: 'v1', origin: 'resume-required' });
  assert.equal((await getPendingResume()).versionId, 'v1');
  assert.equal((await getPendingResume()).origin, 'resume-required');
  const second = await keepPendingResume({ fileName: 'other.docx', fileUri: 'file:///picker/other.docx', fileSize: '2 KB' });
  assert.ok(!files.has(first.file.fileUri), 'Replacing the selection removes only the old private copy');
  assert.ok(files.has(second.file.fileUri));
  await clearPendingResume();
  assert.equal(await getPendingResume(), null);
  assert.ok(!files.has(second.file.fileUri));
  assert.ok(files.has('file:///picker/resume.pdf'), 'The original picker file is never deleted');
  console.log('Pending resume persistence and cleanup checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
