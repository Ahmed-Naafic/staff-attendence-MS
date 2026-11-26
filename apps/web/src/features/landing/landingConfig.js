/*
 * What the public landing page links to and claims. Nothing here is invented: links and figures appear
 * only once they are real, set through Vite environment variables at build time (apps/web/.env*):
 *
 *   VITE_CONTACT_EMAIL      the address "Get Started", Contact and Support write to (mailto)
 *   VITE_SOCIAL_YOUTUBE     full URLs of EduTrack's own social accounts; an unset one is not shown
 *   VITE_SOCIAL_LINKEDIN
 *   VITE_SOCIAL_X
 *   VITE_SOCIAL_FACEBOOK
 *   VITE_STAT_SCHOOLS       verified platform figures (e.g. "50+"); while any is unset the stats
 *   VITE_STAT_STUDENTS      band shows what EduTrack is (modules, roles, apps, branches) instead
 *   VITE_STAT_STAFF         of numbers
 *   VITE_STAT_UPTIME
 */

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const clean = (value) => (typeof value === 'string' ? value.trim() : '');
const isEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const isHttpUrl = (value) => /^https:\/\/[^\s]+$/.test(value);

/** Builds the landing configuration from environment values (exported for tests). */
export function buildLandingConfig(values = env) {
  const contactEmail = isEmail(clean(values.VITE_CONTACT_EMAIL)) ? clean(values.VITE_CONTACT_EMAIL) : '';
  const socials = [
    ['youtube', 'YouTube', values.VITE_SOCIAL_YOUTUBE],
    ['linkedin', 'LinkedIn', values.VITE_SOCIAL_LINKEDIN],
    ['x', 'X', values.VITE_SOCIAL_X],
    ['facebook', 'Facebook', values.VITE_SOCIAL_FACEBOOK],
  ]
    .map(([key, label, url]) => ({ key, label, url: clean(url) }))
    .filter((s) => isHttpUrl(s.url));
  const figures = [values.VITE_STAT_SCHOOLS, values.VITE_STAT_STUDENTS, values.VITE_STAT_STAFF, values.VITE_STAT_UPTIME].map(clean);
  const verified = figures.every(Boolean);
  const stats = verified
    ? [
        { key: 'schools', value: figures[0], label: 'Schools', icon: 'schools', accent: 'gold' },
        { key: 'students', value: figures[1], label: 'Students', icon: 'students', accent: 'blue' },
        { key: 'staff', value: figures[2], label: 'Staff Members', icon: 'staff', accent: 'green' },
        { key: 'uptime', value: figures[3], label: 'Uptime', icon: 'uptime', accent: 'green' },
      ]
    : [
        { key: 'modules', value: '7', label: 'Connected modules', icon: 'schools', accent: 'gold' },
        { key: 'roles', value: '4', label: 'Roles, one platform', icon: 'students', accent: 'blue' },
        { key: 'apps', value: 'Web + Mobile', label: 'Office and staff apps', icon: 'staff', accent: 'green' },
        { key: 'branches', value: 'Multi-branch', label: 'Schools of any size', icon: 'uptime', accent: 'green' },
      ];
  return {
    contactEmail,
    contactHref: contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent('EduTrack for our school')}` : '',
    socials,
    stats,
    verifiedStats: verified,
  };
}

export const landingConfig = buildLandingConfig();
