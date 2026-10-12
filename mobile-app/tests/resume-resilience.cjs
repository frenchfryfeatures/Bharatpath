const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

function load(relative, dependencies = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.require = (name) => dependencies[name] ?? require(name);
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { resumeFileError, MAX_RESUME_BYTES } = load('services/profile/resumeFile.ts');
assert.equal(resumeFileError({ name: 'resume.pdf', size: 2048, uri: 'file:///resume.pdf' }), null);
assert.match(resumeFileError({ name: 'old.doc', size: 2048, uri: 'file:///old.doc' }), /PDF or DOCX/);
assert.match(resumeFileError({ name: 'empty.pdf', size: 0, uri: 'file:///empty.pdf' }), /empty/);
assert.match(resumeFileError({ name: 'large.pdf', size: MAX_RESUME_BYTES + 1, uri: 'file:///large.pdf' }), /5 MB/);
assert.match(resumeFileError({ name: 'resume.pdf', size: 2048 }), /unavailable/);

const { normalizeResumeVersionDetails } = load('services/api/resume.ts', {
  'react-native': { Platform: { OS: 'web' } },
  'expo-file-system/legacy': {},
  './client': {},
});
assert.throws(() => normalizeResumeVersionDetails(null), /incomplete resume details/);
assert.throws(() => normalizeResumeVersionDetails({ parsed: {} }), /incomplete resume details/);
const safe = normalizeResumeVersionDetails({
  resume_version_id: 'v1',
  parsed: { full_name: null, skills: 'broken', education: [null, { institution: 'School' }] },
  sections: [null, { kind: 'skills', body: null, items: [null, { text: 'React', unclear: true }] }],
});
assert.equal(safe.parsed.full_name, '');
assert.deepEqual(safe.parsed.skills, []);
assert.equal(safe.parsed.education.length, 1);
assert.equal(safe.sections.length, 1);
assert.equal(safe.sections[0].body, '');
assert.deepEqual(safe.sections[0].items, [{ text: 'React', unclear: true, suggestion: null }]);
console.log('Resume file and malformed API response resilience checks passed.');

const apiClient = load('services/api/client.ts', {
  'react-native': { Platform: { OS: 'web' } },
  'expo-constants': { default: { expoConfig: null } },
  'expo/fetch': { fetch: () => {} },
});
const originalFetch = global.fetch;
process.env.EXPO_PUBLIC_API_BASE_URL = 'https://example.test/api/v1';
(async () => {
  try {
    global.fetch = async () => ({
      status: 200, ok: true,
      headers: { get: () => 'application/json' },
      json: async () => { throw new SyntaxError('broken JSON'); },
    });
    await assert.rejects(apiClient.apiRequest('/candidate/resume/versions/v1'),
      (error) => error.code === 'invalid_response');
    global.fetch = async () => { throw new Error('offline'); };
    await assert.rejects(apiClient.apiRequest('/candidate/resume/versions/v1'),
      (error) => error.code === 'network_error' && /Check your connection/.test(error.message));
    console.log('API malformed JSON and offline recovery errors passed.');
  } finally {
    global.fetch = originalFetch;
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
