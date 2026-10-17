import { useApiData } from '../../../hooks/useApiData.js';
import { loadSchool, loadSchools } from '../data/loadSchools.js';

/**
 * The current page of schools for the filters: { status, data, retry }. Typing in search waits
 * briefly. Changing `version` reloads (e.g. after a school is registered or changed).
 */
export function useSchools(filters, page, version = 0) {
  return useApiData(() => loadSchools(filters, page), JSON.stringify([filters, page, version]), { delayMs: 200 });
}

/**
 * The school shown in the details panel. Uses the row already on the page when there is one,
 * otherwise asks the API (e.g. a shared link to a school on another page).
 */
export function useSchoolDetails(schoolId, rows, version = 0) {
  const fromPage = schoolId ? rows?.find((s) => s.id === schoolId) : undefined;
  const fetched = useApiData(
    () => (schoolId && !fromPage ? loadSchool(schoolId) : Promise.resolve(null)),
    `${schoolId}|${Boolean(fromPage)}|${version}`,
  );
  if (!schoolId) return { school: null, notFound: false };
  if (fromPage) return { school: fromPage, notFound: false };
  return { school: fetched.data ?? null, notFound: fetched.status === 'success' && !fetched.data, error: fetched.status === 'error' };
}
