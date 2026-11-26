import { Check, Smartphone } from 'lucide-react';
import { EduTrackMark, FingerprintArt } from './LandingArt.jsx';

/**
 * Promotional illustration of a teacher checking in with the EduTrack mobile app: a phone in 3D with a
 * gold orbit, a scanning fingerprint and the success message. Only a picture: no biometric feature is
 * implied beyond what the mobile app does.
 */
export function PhoneCheckIn() {
  return (
    <figure className="m-0">
      <div className="lp-phone-wrap" aria-hidden="true">
        <span className="lp-orbit lp-orbit--back" />
        <div className="lp-phone">
          <div className="lp-phone__screen">
            <div className="lp-phone__brand">
              <EduTrackMark />
              EduTrack
            </div>
            <div className="lp-phone__label">
              <Smartphone />
              Teacher Check-In
            </div>
            <div className="lp-finger">
              <FingerprintArt />
              <span className="lp-finger__scan" />
            </div>
            <div className="lp-success">
              <i>
                <Check />
              </i>
              <span>
                Check-In
                <br />
                Successful!
              </span>
            </div>
            <span className="lp-phone__home" />
          </div>
        </div>
        <span className="lp-orbit lp-orbit--front" />
      </div>
      <figcaption className="lp-illustration-note">Staff check in from the EduTrack mobile app (illustration).</figcaption>
    </figure>
  );
}
