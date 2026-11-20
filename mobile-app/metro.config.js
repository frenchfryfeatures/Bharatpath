const { getDefaultConfig } = require('expo/metro-config');

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

// Cap Metro transform workers so high-core machines don't spawn too many
// parallel Node jest-worker processes and exhaust system RAM (ENOMEM).
config.maxWorkers = 2;

module.exports = config;
