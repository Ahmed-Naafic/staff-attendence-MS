import { useEffect, useState } from 'react';
import { createSingleFlight } from '../lib/singleFlight.js';

/**
 * Form state for one dialog: values, field errors, a form-level error, saving, and one request at a
 * time (a second Enter or click during a save sends nothing). Reset each time the dialog opens.
 *
 *   const form = useDialogForm(open, initial, failureMessage);
 *   form.set('name', value);
 *   form.submit(problems, ['name'], () => api(...), onDone);
 *
 * `submit` shows `problems` and stops when there are any; otherwise runs `request`, calls
 * `onDone(result)`, or shows the API's field problems (for `fields`) and `failureMessage(error)`.
 */
export function useDialogForm(open, initial, failureMessage) {
  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [once] = useState(createSingleFlight);
  useEffect(() => {
    if (!open) return;
    setValues(initial);
    setErrors({});
    setFormError('');
    setSaving(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const set = (field, value) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors(({ [field]: _removed, ...rest }) => rest);
  };
  const submit = (problems, fields, request, onDone) =>
    once(async () => {
      setFormError('');
      setErrors(problems);
      if (Object.keys(problems).length) return;
      setSaving(true);
      try {
        const result = await request();
        setSaving(false);
        onDone(result);
      } catch (error) {
        setSaving(false);
        const fieldProblems = error.details && Object.fromEntries(Object.entries(error.details).filter(([key]) => fields.includes(key)));
        if (fieldProblems && Object.keys(fieldProblems).length) setErrors(fieldProblems);
        setFormError(failureMessage(error));
      }
    });
  return { values, set, errors, formError, saving, submit };
}

/** The usual message for a failed request: the server's own for business conflicts and access, else a generic one. */
export function requestFailure(error, { codes = [], notFound = 'This item no longer exists, or is not part of your school.' } = {}) {
  if (error.status === 0 || error.status === 403 || error.status === 409 || codes.includes(error.code)) return error.message;
  if (error.status === 404) return notFound;
  return 'The change could not be saved. Try again.';
}
