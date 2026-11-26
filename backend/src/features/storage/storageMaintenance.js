import { sweepExamPaperFiles } from '../examinations/examFiles.service.js';

/*
 * Storage maintenance (docs/storage/supabase-storage.md → Consistency), run by the daily job
 * (features/notifications/jobs.js). Each module that keeps files sweeps its own records: uploads
 * never confirmed, and bytes still in storage for records that were removed, replaced or rejected
 * (a delete that failed at the time). A new module adds its sweeper to SWEEPERS.
 */
const SWEEPERS = [['examPaperFiles', sweepExamPaperFiles]];

export async function runStorageMaintenance({ now = new Date(), stop = () => false } = {}) {
  const result = {};
  for (const [name, sweep] of SWEEPERS) {
    if (stop()) {
      result[name] = { skipped: 'time budget spent; the next run continues' };
      continue;
    }
    result[name] = await sweep({ now });
  }
  return result;
}
