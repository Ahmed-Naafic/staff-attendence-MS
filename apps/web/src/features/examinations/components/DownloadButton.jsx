import { useState } from 'react';
import { FileDown } from 'lucide-react';
import { Button } from '../../../components/ui';
import { requestFailure } from '../../../hooks/useDialogForm.js';
import { saveFile } from '../../attendance-reports/utils/exportRules.js';

/** A button that downloads a document (`load()` → { blob, filename }) and reports a failure via onError. */
export function DownloadButton({ load, children, onError, size = 'sm', variant = 'outline', disabled }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      size={size}
      variant={variant}
      leftIcon={FileDown}
      loading={busy}
      disabled={disabled}
      onClick={async () => {
        setBusy(true);
        try {
          const { blob, filename } = await load();
          saveFile(blob, filename);
        } catch (e) {
          onError?.(requestFailure(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      {children}
    </Button>
  );
}
