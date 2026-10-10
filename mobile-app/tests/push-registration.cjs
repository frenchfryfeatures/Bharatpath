const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');

const filename = path.resolve(__dirname, '../services/notifications/device.ts');
const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const stored = new Map();
const calls = [];
let permission = { granted: false, canAskAgain: true };
const Notifications = {
  AndroidImportance: { HIGH: 4 },
  setNotificationHandler: () => undefined,
  setNotificationChannelAsync: async (id) => { calls.push(['channel', id]); },
  getPermissionsAsync: async () => permission,
  requestPermissionsAsync: async () => { permission = { granted: true, canAskAgain: true }; return permission; },
  getExpoPushTokenAsync: async ({ projectId }) => {
    calls.push(['token', projectId]);
    return { data: 'ExpoPushToken[abcdefghijklmnop]' };
  },
};
const dependencies = {
  'react-native': { Platform: { OS: 'android' } },
  'expo-constants': { __esModule: true, default: { expoConfig: { extra: { eas: { projectId: 'project-1' } } } }, ExecutionEnvironment: { StoreClient: 'store' } },
  'expo': { isRunningInExpoGo: () => false },
  'expo-notifications': Notifications,
  '@react-native-async-storage/async-storage': { __esModule: true, default: {
    getItem: async (key) => stored.get(key) ?? null,
    setItem: async (key, value) => { stored.set(key, value); },
    removeItem: async (key) => { stored.delete(key); },
  } },
  '@/services/api/notifications': {
    registerPushDevice: async (token, platform) => { calls.push(['register', token, platform]); },
    unregisterPushDevice: async (token) => { calls.push(['unregister', token]); },
    updatePushPreference: async (enabled) => { calls.push(['preference', enabled]); },
  },
};
const loaded = new Module(filename, module);
loaded.require = (name) => dependencies[name] ?? require(name);
loaded._compile(code, filename);

(async () => {
  const device = loaded.exports;
  assert.equal((await device.getDeviceNotificationStatus()).status, 'denied');
  assert.equal((await device.enablePushNotifications()).status, 'granted');
  assert.ok(calls.some(([kind, id]) => kind === 'channel' && id === 'default'));
  assert.ok(calls.some(([kind, id]) => kind === 'token' && id === 'project-1'));
  assert.ok(calls.some(([kind, token, platform]) => kind === 'register' && token === 'ExpoPushToken[abcdefghijklmnop]' && platform === 'android'));
  permission = { granted: false, canAskAgain: false };
  assert.equal(await device.syncPushDevice(), false);
  assert.ok(calls.some(([kind]) => kind === 'unregister'));
  dependencies['react-native'].Platform.OS = 'ios';
  permission = { granted: false, canAskAgain: true };
  calls.length = 0;
  assert.equal((await device.enablePushNotifications()).status, 'granted');
  assert.ok(calls.some(([kind, token, platform]) => kind === 'register' && token === 'ExpoPushToken[abcdefghijklmnop]' && platform === 'ios'));
  assert.equal(calls.some(([kind]) => kind === 'channel'), false);
  console.log('Android and iOS push permission, registration, and revocation checks passed.');
})().catch((error) => { console.error(error); process.exitCode = 1; });
