/*
 * Sign out with confirmation. When events are still waiting to upload, the dialog says so: they
 * stay on this phone and are sent when the same account signs in again (within 24 hours).
 */
import { useState } from 'react';
import { useAttendance } from '../../attendance/AttendanceProvider';
import { useSession } from '../../auth/SessionProvider';
import { ConfirmDialog } from '../../components/ui';

export function useSignOut() {
  const { signOut } = useSession();
  const { pendingCount } = useAttendance();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const dialog = (
    <ConfirmDialog
      visible={open}
      title="Sign out?"
      message={
        pendingCount
          ? `${pendingCount} attendance event${pendingCount > 1 ? 's have' : ' has'} not been uploaded yet. ${pendingCount > 1 ? 'They stay' : 'It stays'} on this phone and will be sent when you sign in again — within 24 hours of the event, or the server will refuse ${pendingCount > 1 ? 'them' : 'it'}.`
          : 'You will need your phone number and password to sign in again.'
      }
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
