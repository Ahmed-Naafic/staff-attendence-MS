import { readFileSync } from 'node:fs';
import { getPrisma } from '../../config/prisma.js';

const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));

/**
 * Platform settings, read-only. Values come from the single PlatformSettings row (empty when it
 * does not exist). Platform Configuration switches are not stored: their rules are not approved,
 * so `configuration` is null. Nothing here can be changed through the API yet.
 */
export async function getSettings() {
  const row = await getPrisma().platformSettings.findUnique({ where: { id: 'platform' } });
  const value = (key) => row?.[key] ?? '';
  return {
    isDemo: false,
    settings: {
      information: {
        platformName: value('platformName'),
        description: value('description'),
        supportEmail: value('supportEmail'),
        supportPhone: value('supportPhone'),
        websiteUrl: value('websiteUrl'),
      },
      localization: {
        timezone: value('timezone'),
        language: value('language'),
        dateFormat: value('dateFormat'),
        timeFormat: value('timeFormat'),
        firstDayOfWeek: value('firstDayOfWeek'),
      },
      configuration: null,
    },
    system: { version, database: 'PostgreSQL (Neon)' },
  };
}
