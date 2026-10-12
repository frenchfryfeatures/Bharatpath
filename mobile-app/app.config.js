const fs = require('node:fs');

module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON || './google-services.json';
  return {
    ...config,
    android: {
      ...config.android,
      ...(fs.existsSync(googleServicesFile) ? { googleServicesFile } : {}),
    },
  };
};
