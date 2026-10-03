/*
 * DEMO DATA — NOT REAL PLATFORM CONFIGURATION.
 *
 * Shapes the platform settings response so the page can be built before the backend exists.
 * Values are safe placeholders: no environment variables, URLs of real services, credentials or
 * infrastructure details. Replace the source in loadSettings.js with the real API in Phase 9.
 *
 * Shape:
 * {
 *   isDemo,
 *   settings: {
 *     information:   { platformName, description, supportEmail, supportPhone, websiteUrl },
 *     localization:  { timezone, language, dateFormat, timeFormat, firstDayOfWeek },
 *     configuration: { allowSchoolRegistration, requireSchoolApproval, allowOwnerCreation,
 *                      auditLogging, emailNotifications, smsNotifications, maintenanceMode },   booleans
 *   },
 *   system: { version, database },
 * }
 * Localization defaults match how the web app formats dates and times today.
 */

export function createMockSettings() {
  return {
    isDemo: true,
    settings: {
      information: {
        platformName: 'EduTrack',
        description: 'A staff attendance management platform for schools.',
        supportEmail: 'support@edutrack.example',
        supportPhone: '+252 61 2345678',
        websiteUrl: 'https://edutrack.example',
      },
      localization: {
        timezone: 'Africa/Mogadishu',
        language: 'en',
        dateFormat: 'MMM DD, YYYY',
        timeFormat: '24h',
        firstDayOfWeek: 'saturday',
      },
      configuration: {
        allowSchoolRegistration: true,
        requireSchoolApproval: true,
        allowOwnerCreation: true,
        auditLogging: true,
        emailNotifications: true,
        smsNotifications: false,
        maintenanceMode: false,
      },
    },
    system: { version: '0.1.0', database: 'PostgreSQL (Neon)' },
  };
}
