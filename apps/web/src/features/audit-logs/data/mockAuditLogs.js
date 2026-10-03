/*
 * DEMO DATA — NOT REAL AUDIT EVENTS.
 *
 * A fictional history built from the Schools and School Owners demo sets, so names, schools and
 * dates agree with every other page (and the dashboard's Recent Platform Activity). The events
 * only describe history; they are not proof that the workflows behind them exist.
 * IP addresses come from the documentation ranges (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24).
 * Replace the source in loadAuditLogs.js with the real API in Phase 9.
 *
 * Shape:
 * {
 *   isDemo, generatedAt,
 *   events: [{                                   newest first
 *     id, occurredAt, action, result: 'success' | 'failure',
 *     actor:  { id, name, role: 'SUPER_ADMIN' | 'OWNER' },
 *     target: { type: 'school' | 'owner' | 'system', id | null, name, code?, location?, schoolName? },
 *     school: { id, name } | null,              the school the event belongs to (for filtering)
 *     description,
 *     change: { field, from, to } | null,       for status changes
 *     context: { ipAddress, browser, device },
 *   }]
 * }
 * Never put credentials, tokens, session identifiers or passwords in audit events.
 */
import { createMockOwners } from '../../school-owners/data/mockOwners.js';
import { createMockSchools } from '../../schools/data/mockSchools.js';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// The demo session's Super Admin (features/auth/mockSession.js).
const ADMIN = { id: 'demo-super-admin', name: 'Demo Administrator', role: 'SUPER_ADMIN' };
const ADMIN_CONTEXT = { ipAddress: '203.0.113.24', browser: 'Chrome 141', device: 'Windows 11' };

const CLIENTS = [
  { browser: 'Chrome 141', device: 'Android 15' },
  { browser: 'Chrome 141', device: 'Windows 11' },
  { browser: 'Safari 18', device: 'iPhone (iOS 18)' },
  { browser: 'Edge 141', device: 'Windows 10' },
  { browser: 'Firefox 143', device: 'macOS 15' },
];

// Events the dashboard's Recent Platform Activity also shows (school name → how long ago).
const DASHBOARD_EVENTS = {
  approved: { 'Sunrise School': 6 * HOUR, 'Somali Education Center': 2 * DAY },
  updated: [['Al-Noor Academy', 1 * DAY]],
};

export function createMockAuditLogs({ now = new Date() } = {}) {
  const nowMs = now.getTime();
  const { schools } = createMockSchools({ now });
  const { owners } = createMockOwners({ now });
  const events = [];

  const add = (at, event) => {
    if (at <= nowMs) events.push({ change: null, school: null, result: 'success', ...event, occurredAt: at });
  };

  schools.forEach((school, index) => {
    const owner = owners.find((o) => o.school.id === school.id);
    const registered = new Date(school.registeredAt).getTime();
    const schoolRef = { id: school.id, name: school.name };
    const schoolTarget = { type: 'school', id: school.id, name: school.name, code: school.code, location: school.location };
    const ownerTarget = { type: 'owner', id: owner.id, name: owner.name, schoolName: school.name };
    const ownerActor = { id: owner.id, name: owner.name, role: 'OWNER' };
    const ownerContext = { ipAddress: `198.51.100.${11 + ((index * 37) % 230)}`, ...CLIENTS[index % CLIENTS.length] };

    add(registered - 10 * MINUTE, {
      action: 'OWNER_CREATED',
      actor: ADMIN,
      target: ownerTarget,
      school: schoolRef,
      description: `School owner account created for ${owner.name} (${school.name}).`,
      context: ADMIN_CONTEXT,
    });
    add(registered, {
      action: 'SCHOOL_REGISTERED',
      actor: ADMIN,
      target: schoolTarget,
      school: schoolRef,
      description: `${school.name} was registered on the platform and is waiting for approval.`,
      change: { field: 'Status', from: null, to: 'Pending' },
      context: ADMIN_CONTEXT,
    });

    if (school.status !== 'active') return;

    const approvedAgo = DASHBOARD_EVENTS.approved[school.name];
    const approved = approvedAgo ? nowMs - approvedAgo : registered + (1 + (index % 3)) * DAY + 3 * HOUR;
    add(approved, {
      action: 'SCHOOL_APPROVED',
      actor: ADMIN,
      target: schoolTarget,
      school: schoolRef,
      description: 'School application has been approved and activated on the platform.',
      change: { field: 'Status', from: 'Pending', to: 'Active' },
      context: ADMIN_CONTEXT,
    });

    // The owner's sign-ins: the latest matches "Last sign-in" on School Owners, then every few days.
    const lastSignIn = new Date(owner.lastSignInAt).getTime();
    for (let n = 0; n < 6; n += 1) {
      const at = lastSignIn - n * (4 + (index % 4)) * DAY - n * 47 * MINUTE;
      if (at < approved) break;
      add(at, {
        action: 'SIGN_IN',
        actor: ownerActor,
        target: ownerTarget,
        school: schoolRef,
        description: 'Signed in to the EduTrack web app.',
        context: ownerContext,
      });
    }
    if (index % 5 === 2) {
      add(lastSignIn - 6 * MINUTE, {
        action: 'SIGN_IN',
        result: 'failure',
        actor: ownerActor,
        target: ownerTarget,
        school: schoolRef,
        description: 'Sign-in failed: the password was incorrect.',
        context: ownerContext,
      });
    }
    if (index % 7 === 3) {
      add(lastSignIn - 3 * MINUTE, {
        action: 'PASSWORD_RESET',
        actor: ownerActor,
        target: ownerTarget,
        school: schoolRef,
        description: 'The account owner reset their password.',
        context: ownerContext,
      });
    }
    if (index % 4 === 1) {
      add(approved + 2 * DAY + 5 * HOUR, {
        action: 'SCHOOL_UPDATED',
        actor: ownerActor,
        target: schoolTarget,
        school: schoolRef,
        description: 'School profile updated by the school owner (contact phone number).',
        context: ownerContext,
      });
    }
    if (index % 6 === 4) {
      add(approved + 5 * DAY + 2 * HOUR, {
        action: 'OWNER_UPDATED',
        actor: ADMIN,
        target: ownerTarget,
        school: schoolRef,
        description: "School owner's contact email updated.",
        context: ADMIN_CONTEXT,
      });
    }
  });

  for (const [name, ago] of DASHBOARD_EVENTS.updated) {
    const school = schools.find((s) => s.name === name);
    add(nowMs - ago, {
      action: 'SCHOOL_UPDATED',
      actor: ADMIN,
      target: { type: 'school', id: school.id, name: school.name, code: school.code, location: school.location },
      school: { id: school.id, name: school.name },
      description: 'School contact details updated.',
      context: ADMIN_CONTEXT,
    });
  }

  for (const ago of [21 * DAY + 4 * HOUR, 140 * DAY + 2 * HOUR]) {
    add(nowMs - ago, {
      action: 'SETTINGS_UPDATED',
      actor: ADMIN,
      target: { type: 'system', id: null, name: 'Platform settings' },
      description: 'General platform settings updated.',
      context: ADMIN_CONTEXT,
    });
  }

  // The Super Admin's own sign-ins: today and every other day for four months, plus one failed attempt.
  for (let day = 0; day < 120; day += 2) {
    const at = nowMs - day * DAY - 35 * MINUTE;
    add(at, {
      action: 'SIGN_IN',
      actor: ADMIN,
      target: { type: 'system', id: null, name: 'EduTrack web app' },
      description: 'Signed in to the EduTrack web app.',
      context: ADMIN_CONTEXT,
    });
  }
  add(nowMs - 9 * DAY - 37 * MINUTE, {
    action: 'SIGN_IN',
    result: 'failure',
    actor: ADMIN,
    target: { type: 'system', id: null, name: 'EduTrack web app' },
    description: 'Sign-in failed: the password was incorrect.',
    context: { ...ADMIN_CONTEXT, ipAddress: '192.0.2.77' },
  });

  // Newest first; ids follow time order so they stay stable between loads.
  events.sort((a, b) => a.occurredAt - b.occurredAt);
  const withIds = events.map((event, index) => ({
    ...event,
    id: `evt-${String(index + 1).padStart(4, '0')}`,
    occurredAt: new Date(event.occurredAt).toISOString(),
  }));

  return { isDemo: true, generatedAt: now.toISOString(), events: withIds.reverse() };
}

/** The same shape with nothing in it — used to preview the empty state. */
export function createEmptyMockAuditLogs({ now = new Date() } = {}) {
  return { isDemo: true, generatedAt: now.toISOString(), events: [] };
}
