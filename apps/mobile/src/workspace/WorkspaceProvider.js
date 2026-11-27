/*
 * The open workspace and branch (docs/mobile/workspaces.md). Both are remembered on this phone for
 * the account (device keys, so they survive signing out) and shared by every screen. Choosing
 * another branch only changes what the screens show: the account's home branch never changes,
 * waiting records keep the branch they were made in, and the server checks branch access on every
 * request. Screens reload their data when `version` changes (a new branch or workspace).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAttendance } from '../attendance/AttendanceProvider';
import { useSession } from '../auth/SessionProvider';
import { fetchMyTeaching } from '../api/endpoints';
import { getDatabase, readValue, writeValue } from '../db/database';
import { branchList, chooseBranch, chooseWorkspace, workspacesFor } from './workspaces';

const WorkspaceContext = createContext(null);
const memoryKey = (userId) => `device:workspace:${userId}`;

/** Loads a workspace's branches from the server: [{ id, code, name, home }]. */
async function loadBranches(workspace, { api, profile }) {
  if (workspace === 'manager') return branchList((await api.request('/api/manager/branch')).data.branch);
  if (workspace === 'accountant') return branchList((await api.request('/api/accountant/branch')).data.branch);
  const teaching = await fetchMyTeaching(api).catch(() => null);
  return branchList(profile?.branch, (teaching?.items ?? []).map((i) => i.branch).filter(Boolean));
}

export function WorkspaceProvider({ children, openDatabase = getDatabase }) {
  const { api, user } = useSession();
  const { profile, pendingCount, lessonPendingCount, draftPendingCount } = useAttendance();
  const userId = user?.id;
  const available = useMemo(() => workspacesFor(user), [user]);
  const [memory, setMemory] = useState({ loaded: false, workspace: null, branchId: null });
  const [branches, setBranches] = useState([]);
  const [branchesOffline, setBranchesOffline] = useState(false);
  const [version, setVersion] = useState(0);

  // The remembered choice for this account.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    openDatabase()
      .then((db) => readValue(db, memoryKey(userId)))
      .catch(() => null)
      .then((saved) => {
        if (!cancelled) setMemory({ loaded: true, workspace: saved?.workspace ?? null, branchId: saved?.branchId ?? null });
      });
    return () => {
      cancelled = true;
    };
  }, [userId, openDatabase]);

  const workspace = memory.loaded ? chooseWorkspace(available, memory.workspace) : null;
  const homeBranchKey = profile?.branch?.id ?? profile?.branch?.code ?? null;

  // The workspace's branches (from the server; the last copy on this phone when offline).
  useEffect(() => {
    if (!userId || !workspace) return undefined;
    let cancelled = false;
    const cacheKey = `branches:${userId}:${workspace}`;
    (async () => {
      const db = await openDatabase();
      try {
        const list = await loadBranches(workspace, { api, profile });
        if (!list.length) throw new Error('no branches');
        await writeValue(db, cacheKey, list);
        if (!cancelled) {
          setBranches(list);
          setBranchesOffline(false);
        }
      } catch {
        const saved = await readValue(db, cacheKey);
        if (!cancelled && saved) {
          setBranches(saved);
          setBranchesOffline(true);
        }
      }
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
    // The profile matters only through the home branch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, workspace, api, homeBranchKey, openDatabase]);

  const branchId = chooseBranch(branches, memory.branchId);
  const branch = branches.find((b) => b.id === branchId) ?? null;

  const remember = useCallback(
    async (next) => {
      setMemory((m) => ({ ...m, ...next }));
      setVersion((v) => v + 1);
      const db = await openDatabase();
      const saved = (await readValue(db, memoryKey(userId))) ?? {};
      await writeValue(db, memoryKey(userId), { ...saved, ...next });
    },
    [openDatabase, userId],
  );

  const switchWorkspace = useCallback((next) => (available.includes(next) ? remember({ workspace: next }) : Promise.resolve()), [available, remember]);
  const switchBranch = useCallback((next) => (branches.some((b) => b.id === next) ? remember({ branchId: next }) : Promise.resolve()), [branches, remember]);
  const refreshAll = useCallback(() => setVersion((v) => v + 1), []);

  const events = pendingCount ?? 0;
  const marks = lessonPendingCount ?? 0;
  const drafts = draftPendingCount ?? 0;
  const value = useMemo(
    () => ({ available, workspace, branches, branch, branchId, branchesOffline, version, pending: { events, marks, drafts }, switchWorkspace, switchBranch, refreshAll }),
    [available, workspace, branches, branch, branchId, branchesOffline, version, events, marks, drafts, switchWorkspace, switchBranch, refreshAll],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

const NONE = { available: [], workspace: null, branches: [], branch: null, branchId: null, branchesOffline: false, version: 0, pending: { events: 0, marks: 0 }, switchWorkspace: async () => {}, switchBranch: async () => {}, refreshAll: () => {} };

/** The open workspace and branch (outside a WorkspaceProvider: none, so screens show everything). */
export function useWorkspace() {
  return useContext(WorkspaceContext) ?? NONE;
}
