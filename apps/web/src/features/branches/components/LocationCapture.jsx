import { Crosshair, MapPin } from 'lucide-react';
import { Alert, Button, Checkbox, Spinner } from '../../../components/ui';
import { ACCURACY_MAX, formatPosition, formatUtc } from '../utils/branchRules.js';

/**
 * Captures the branch GPS position from this device (`capture` from useCurrentPosition), shows
 * it for review, and asks for explicit confirmation. The device's position is where the owner
 * is standing, not proof of the branch location: the confirmation says so.
 */
export function LocationCapture({ id, capture, confirmed, onConfirmedChange, error, disabled = false }) {
  const { status, position, problem } = capture;
  const usable = status === 'captured' && !problem;

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-border p-4" aria-describedby={`${id}-why`}>
      <legend className="px-1 text-label text-fg">
        Branch location <span className="text-error" aria-hidden="true">*</span>
        <span className="sr-only">(required)</span>
      </legend>
      <p id={`${id}-why`} className="text-small text-fg-secondary">
        Attendance check-ins are accepted only within 100 m of this location. Stand at the branch and use your device&apos;s location services; your
        browser will ask for permission. The position is captured once, not tracked.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button id={id} variant="outline" leftIcon={Crosshair} onClick={capture.capture} disabled={disabled || status === 'locating'}>
          {status === 'captured' || status === 'error' ? 'Capture Again' : 'Use My Current Location'}
        </Button>
        {status === 'locating' && (
          <span role="status" className="flex items-center gap-2 text-small text-fg-muted">
            <Spinner size="sm" /> Finding your location…
          </span>
        )}
      </div>

      {status === 'error' && (
        <Alert variant="error" title="No location captured">
          {capture.error}
        </Alert>
      )}

      {status === 'captured' && (
        <div role="status" className="flex gap-3 rounded-md bg-muted px-4 py-3">
          <MapPin aria-hidden="true" className="mt-0.5 size-[1.125rem] shrink-0 text-fg-muted" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-small">
            <dt className="text-fg-muted">Position</dt>
            <dd className="tabular-nums text-fg">{formatPosition(position)}</dd>
            <dt className="text-fg-muted">Accuracy</dt>
            <dd className={problem ? 'font-medium text-error' : 'text-fg'}>
              ±{Math.round(position.accuracy)} m {problem ? `(must be ${ACCURACY_MAX} m or better)` : ''}
            </dd>
            <dt className="text-fg-muted">Captured</dt>
            <dd className="text-fg">{formatUtc(position.capturedAt)}</dd>
          </dl>
        </div>
      )}
      {problem && <Alert variant="warning">{problem}</Alert>}

      {usable && (
        <Checkbox
          id={`${id}-confirm`}
          checked={confirmed}
          onChange={(event) => onConfirmedChange(event.target.checked)}
          disabled={disabled}
          label="I am at this branch, and this position is its location."
          description="Check the position before confirming: a device position can be wrong, for example indoors."
        />
      )}
      {/* The form repeats the capture problem when saving is refused; show it only once. */}
      {error && error !== problem && (
        <p role="alert" className="text-small text-error">
          {error}
        </p>
      )}
    </fieldset>
  );
}
