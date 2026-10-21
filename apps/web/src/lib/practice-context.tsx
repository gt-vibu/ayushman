'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { api, ApiError } from './api';
import type { Branch, Practice, PracticeProfession, Session } from './types';
import { BrandLoader } from '@/components/ui/branded-loader';

type ContextValue = {
  session: Session;
  practice: Practice;
  branches: Branch[];
  professions: PracticeProfession[];
  permissions: Record<string, boolean>;
  branchId: string;
  setBranchId: (id: string) => void;
  updatePractice: (next: Partial<Practice>) => void;
  refreshBranches: () => Promise<void>;
  refreshProfessions: () => Promise<PracticeProfession[]>;
  logout: () => Promise<void>;
};

const PracticeContext = createContext<ContextValue | null>(null);
const SAVED_PRACTICE = 'ayushman.practice_id';
const SAVED_BRANCH = 'ayushman.branch_id';

export function PracticeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const pathname = usePathname();
  const practiceRoutes = ['/dashboard', '/appointments', '/calendar', '/availability', '/clients', '/services', '/staff', '/branches', '/billing', '/records', '/reports', '/settings', '/follow-ups', '/consultations', '/cancellation-requests', '/policy-overrides', '/setup'];
  const shouldLoadWorkspace = practiceRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  const [session, setSession] = useState<Session | null>(null);
  const [practice, setPractice] = useState<Practice | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [professions, setProfessions] = useState<PracticeProfession[]>([]);
  const [permissions, setPermissions] = useState<Record<string, boolean>>({});
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [practiceId, setPracticeId] = useState('');
  const [branchId, setBranchIdState] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const sessionLoaded = useRef(false);

  useEffect(() => {
    if (!shouldLoadWorkspace || sessionLoaded.current) return;
    sessionLoaded.current = true;
    let active = true;
    let settled = false;
    api<Session>('/auth/me').then((value) => {
      if (!active) return;
      setSession(value);
      const saved = localStorage.getItem(SAVED_PRACTICE);
      const selected = value.practices.find((item) => item.practiceId === saved) ?? value.practices[0];
      if (!selected) throw new Error('Your account is not assigned to an active practice. Ask a practice owner for an invitation.');
      setPracticeId(selected.practiceId);
    }).catch((cause: unknown) => {
      if (!active) return;
      if (cause instanceof ApiError && cause.status === 401) { sessionLoaded.current = false; router.replace('/login'); }
      else { sessionLoaded.current = false; setError(cause instanceof Error ? cause.message : 'Could not load your account.'); }
    }).finally(() => { settled = true; if (active) setLoading(false); });
    // In React Strict Mode, development intentionally runs effect setup,
    // cleanup, then setup again. Allow that second setup to subscribe to the
    // same in-flight cached request instead of leaving the workspace stuck.
    return () => { active = false; if (!settled) sessionLoaded.current = false; };
  }, [pathname, router, shouldLoadWorkspace]);

  useEffect(() => {
    if (!practiceId) return;
    localStorage.setItem(SAVED_PRACTICE, practiceId);
    let active = true;
    Promise.all([
      api<Practice>(`/practices/${practiceId}`),
      api<Branch[]>(`/practices/${practiceId}/locations`),
      api<PracticeProfession[]>(`/practices/${practiceId}/professions`),
    ]).then(([nextPractice, nextBranches, nextProfessions]) => {
      if (!active) return;
      setPractice(nextPractice);
      setBranches(nextBranches);
      setProfessions(nextProfessions);
      const storedBranch = localStorage.getItem(SAVED_BRANCH);
      const nextBranch = nextBranches.find((branch) => branch.id === storedBranch)?.id ?? nextBranches[0]?.id ?? '';
      setBranchIdState(nextBranch);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load practice settings.');
    });
    return () => { active = false; };
  }, [practiceId]);

  useEffect(() => {
    if (!practiceId || !practice) return;
    let active = true;
    const query = branchId ? `?locationId=${encodeURIComponent(branchId)}` : '';
    api<Record<string, boolean>>(`/practices/${practiceId}/me/permissions${query}`).then((value) => {
      if (active) setPermissions(value);
    }).catch(() => {
      if (active) setPermissions({});
    }).finally(() => { if (active) setPermissionsReady(true); });
    return () => { active = false; };
  }, [practiceId, practice, branchId]);

  const setBranchId = (id: string) => {
    setBranchIdState(id);
    if (id) localStorage.setItem(SAVED_BRANCH, id);
    else localStorage.removeItem(SAVED_BRANCH);
  };
  const updatePractice = useCallback((next: Partial<Practice>) => setPractice((current) => current ? { ...current, ...next } : current), []);

  async function refreshBranches() {
    if (!practiceId) return;
    const nextBranches = await api<Branch[]>(`/practices/${practiceId}/locations`);
    setBranches(nextBranches);
    if (branchId && !nextBranches.some((branch) => branch.id === branchId)) setBranchId('');
    if (!branchId && nextBranches[0]) setBranchId(nextBranches[0].id);
  }

  const refreshProfessions = useCallback(async () => {
    if (!practiceId) return [];
    const nextProfessions = await api<PracticeProfession[]>(`/practices/${practiceId}/professions`);
    setProfessions(nextProfessions);
    return nextProfessions;
  }, [practiceId]);

  async function logout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
    localStorage.removeItem(SAVED_PRACTICE);
    sessionLoaded.current = false;
    setSession(null); setPractice(null); setBranches([]); setProfessions([]); setPermissions({}); setPracticeId(''); setBranchIdState(''); setLoading(true);
    router.replace('/login');
  }

  const membershipList = session?.practices ?? [];
  const value = useMemo(() => session && practice ? {
    session, practice, branches, professions, permissions, branchId, setBranchId, updatePractice, refreshBranches, refreshProfessions, logout,
  } : null, [session, practice, branches, professions, permissions, branchId, updatePractice, refreshProfessions]);

  if (!shouldLoadWorkspace) return <PracticeContext.Provider value={null}>{children}</PracticeContext.Provider>;
  if (loading || (session && !practice && !error) || (practice && !permissionsReady)) return <div className="app-loading"><BrandLoader label="Loading your practice…"/></div>;
  if (!session) return <div className="app-loading">{error || 'Redirecting to sign in…'}</div>;
  if (membershipList.length > 1 && !practiceId) return <div className="app-loading">Choose a practice to continue.</div>;
  if (error && !practice) return <div className="app-loading"><div><strong>Practice could not load</strong><p>{error}</p><button className="button button-secondary" onClick={() => router.refresh()}>Try again</button></div></div>;
  if (!value) return <div className="app-loading"><BrandLoader label="Loading workspace…"/></div>;
  return <PracticeContext.Provider value={value}>{children}</PracticeContext.Provider>;
}

export function usePractice() {
  const value = useContext(PracticeContext);
  if (!value) throw new Error('usePractice must be used inside PracticeProvider');
  return value;
}
