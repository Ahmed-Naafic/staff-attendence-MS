/*
 * Sign out with confirmation. When records are still waiting to upload, the dialog says how many of
 * each kind: they stay on this phone (encrypted) and are sent only when the same account signs in
 * again. Signing out is always allowed, also when the upload has not finished. Cached copies of the
 * account's data (day, profile, class lists, classes, timetable) are removed from the phone.
 */
import { useState } from 'react';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { ConfirmDialog } from '../../components/ui';

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The warning for waiting records, e.g. "2 attendance events and 14 lesson marks have not been uploaded yet." (or null). */
export function pendingWarning({ events = 0, marks = 0, drafts = 0 }) {
  const parts = [];
  if (events) parts.push(plural(events, 'attendance event', 'attendance events'));
  if (marks) parts.push(plural(marks, 'lesson mark', 'lesson marks'));
  if (drafts) parts.push(plural(drafts, 'examination mark draft', 'examination mark drafts'));
  if (!parts.length) return null;
  const total = events + marks + drafts;
  return (
    `${parts.join(' and ')} ${total === 1 ? 'has' : 'have'} not been uploaded yet. ${total === 1 ? 'It stays' : 'They stay'} on this phone and ` +
    `${total === 1 ? 'is' : 'are'} sent when you sign in again. Attendance events are refused by the server more than 24 hours after they happened, ` +
    'and lesson marks after the lesson’s upload deadline.'
  );
}

export function useSignOut() {
  const { signOut } = useSession();
  const { pendingCount, lessonPendingCount, draftPendingCount } = useAttendance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const warning = pendingWarning({ events: pendingCount, marks: lessonPendingCount, drafts: draftPendingCount });

  const dialog = (
    <ConfirmDialog
      visible={open}
      title="Sign out?"
      message={warning ?? 'You will need your phone number and password to sign in again.'}
      confirmLabel={busy ? 'Signing out…' : 'Sign out'}
      destructive
      onConfirm={async () => {
        if (busy) return;
        setBusy(true);
        await signOut();
      }}
      onCancel={() => setOpen(false)}
    />
  );
  return { requestSignOut: () => setOpen(true), dialog };
}
