/* global __dirname */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(
  __dirname,
  '../services/api/profilePhoto.ts',
);
const source = fs.readFileSync(filename, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;

const apiCalls = [];

const loaded = new Module(filename, module);
loaded.require = function (id) {
  if (id === './client') {
    return {
      apiRequest: async (endpoint, options = {}) => {
        apiCalls.push({ endpoint, options });
        if (endpoint === '/profile/photo' && options.method === 'DELETE') {
          return {
            url: null,
            mime: null,
            width: null,
            height: null,
            updated_at: null,
            expires_in_seconds: null,
          };
        }
        if (endpoint === '/profile/photo/upload') {
          return {
            upload_id: 'upl_test_123',
            url: 'http://localhost:4566/bharatpath/photo.raw',
            expires_in_seconds: 900,
            max_bytes: 5242880,
            accepted_types: ['image/jpeg', 'image/png', 'image/webp'],
          };
        }
        if (endpoint === '/profile/photo/confirm') {
          return {
            url: 'https://cdn.bharatpath.in/users/u-1/photo.webp',
            mime: 'image/webp',
            width: 512,
            height: 512,
            updated_at: '2026-10-12T14:30:00Z',
            expires_in_seconds: 900,
          };
        }
        if (endpoint === '/profile/photo') {
          return {
            url: 'https://cdn.bharatpath.in/users/u-1/photo.webp',
            mime: 'image/webp',
            width: 512,
            height: 512,
            updated_at: '2026-10-12T14:30:00Z',
            expires_in_seconds: 900,
          };
        }
        return {};
      },
      ApiError: class ApiError extends Error {},
      getBaseUrl: () => 'http://192.168.1.50:8099/api/v1',
    };
  }
  if (id === 'react-native') {
    return {
      Platform: { OS: 'ios' },
    };
  }
  if (id === 'expo-file-system/legacy') {
    return {
      FileSystemUploadType: { BINARY_CONTENT: 1 },
      uploadAsync: async () => ({ status: 200, body: '' }),
    };
  }
  return Module._load(id, loaded);
};

loaded._compile(compiled, filename);
const {
  getProfilePhoto,
  createProfilePhotoUpload,
  confirmProfilePhoto,
  deleteProfilePhoto,
  reachableStorageUrl,
} = loaded.exports;

async function runTests() {
  console.log('1. Testing reachableStorageUrl rewrite for device LAN...');
  const originalUrl = 'http://localhost:4566/bharatpath-dev/test-key';
  const resolved = reachableStorageUrl(originalUrl);
  assert.equal(
    resolved,
    'http://192.168.1.50:4566/bharatpath-dev/test-key',
    'Localhost port 4566 should be rewritten to backend host LAN IP on mobile devices',
  );

  console.log('2. Testing getProfilePhoto calls GET /profile/photo...');
  apiCalls.length = 0;
  const photo = await getProfilePhoto();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].endpoint, '/profile/photo');
  assert.equal(photo.url, 'https://cdn.bharatpath.in/users/u-1/photo.webp');
  assert.equal(photo.mime, 'image/webp');
  assert.equal(photo.width, 512);

  console.log('3. Testing createProfilePhotoUpload calls POST /profile/photo/upload...');
  apiCalls.length = 0;
  const ticket = await createProfilePhotoUpload();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].endpoint, '/profile/photo/upload');
  assert.equal(apiCalls[0].options.method, 'POST');
  assert.equal(ticket.upload_id, 'upl_test_123');
  assert.equal(ticket.max_bytes, 5242880);

  console.log('4. Testing confirmProfilePhoto calls POST /profile/photo/confirm with upload_id...');
  apiCalls.length = 0;
  const confirmed = await confirmProfilePhoto('upl_test_123');
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].endpoint, '/profile/photo/confirm');
  assert.equal(apiCalls[0].options.method, 'POST');
  assert.deepEqual(apiCalls[0].options.body, { upload_id: 'upl_test_123' });
  assert.equal(confirmed.url, 'https://cdn.bharatpath.in/users/u-1/photo.webp');

  console.log('5. Testing deleteProfilePhoto calls DELETE /profile/photo...');
  apiCalls.length = 0;
  const removed = await deleteProfilePhoto();
  assert.equal(apiCalls.length, 1);
  assert.equal(apiCalls[0].endpoint, '/profile/photo');
  assert.equal(apiCalls[0].options.method, 'DELETE');
  assert.equal(removed.url, null);

  console.log('All profile photo service tests passed successfully!');
}

runTests().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
