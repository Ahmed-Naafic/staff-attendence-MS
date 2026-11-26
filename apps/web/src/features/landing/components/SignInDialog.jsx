import { Modal } from '../../../components/ui';
import { SignInForm } from '../../auth';
import { EduTrackMark } from './LandingArt.jsx';

/**
 * Sign In on the landing page: the sign-in form in a dialog over the page (no separate page). Follows the
 * light or dark theme. After signing in, the app opens `next` or the role's start page.
 */
export function SignInDialog({ open, onClose, name, next }) {
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Sign in" description={`${name} — school management`}>
      <div className="flex flex-col gap-5">
        <span className="mx-auto grid size-12 place-items-center rounded-md border border-accent/50 bg-primary" aria-hidden="true">
          <EduTrackMark className="size-8" />
        </span>
        {open && <SignInForm next={next} />}
      </div>
    </Modal>
  );
}
