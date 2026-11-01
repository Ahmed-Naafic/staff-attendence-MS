/*
 * Build-time additions to app.json. Firebase's google-services.json (needed for Android push
 * through FCM) is not kept in git: EAS provides it as the file environment variable
 * GOOGLE_SERVICES_JSON (see docs/notifications/push-setup.md); a local build can point the variable
 * at the file. Without it the app builds and runs, but Android cannot get a push token.
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(process.env.GOOGLE_SERVICES_JSON && { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }),
  },
});
