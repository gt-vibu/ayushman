'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? '/api/v1';
type AdminSession = { user: { email: string; fullName: string; roles: string[] } };
type Overview = { activePractices: number; activeUsers: number; platformOperators: number };

export default function AdminHome() {
  const [session, setSession] = useState<AdminSession | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const loadOverview = useCallback(async () => {
    const response = await fetch(`${API}/platform/overview`, { credentials: 'include' });
    if (!response.ok) throw new Error('Your platform session expired. Sign in again.');
    setOverview(await response.json() as Overview);
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${API}/auth/platform-me`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) return;
        const result = await response.json() as AdminSession;
        if (active) setSession(result);
        await loadOverview();
      })
      .catch(() => { if (active) setError('Platform API is unavailable. Check that the API is running.'); });
    return () => { active = false; };
  }, [loadOverview]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${API}/auth/platform-login`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) throw new Error('Sign-in failed. Check your platform administrator credentials.');
      setSession(await response.json() as AdminSession);
      setPassword('');
      await loadOverview();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    await fetch(`${API}/auth/platform-logout`, { method: 'POST', credentials: 'include' });
    setSession(null);
    setOverview(null);
  }

  if (!session) {
    return <main className="login-shell">
      <section className="login-card">
        <div className="brand-mark">A</div>
        <p className="eyebrow">AYUSHMAN · PLATFORM</p>
        <h1>Platform administration</h1>
        <p className="subheading">Sign in with a platform administrator account.</p>
        <form onSubmit={signIn} className="login-form">
          <label>Email<input autoComplete="username" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>
          <label>Password<input autoComplete="current-password" type="password" required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
          {error && <p className="error" role="alert">{error}</p>}
          <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in securely'}</button>
        </form>
        <p className="footnote">Platform access is separate from practice accounts.</p>
      </section>
    </main>;
  }

  return <main className="admin-shell">
    <aside className="sidebar"><div className="brand-row"><span className="brand-mark small">A</span><span>Ayushman<span className="brand-sub">Platform</span></span></div><div className="nav-label">ADMINISTRATION</div><div className="nav-item active">Overview</div><div className="sidebar-note">Platform permissions are checked by the API on every request.</div><button className="signout" onClick={signOut}>Sign out</button></aside>
    <section className="content"><header className="topbar"><div><p className="eyebrow">PLATFORM CONSOLE</p><h1>Good day, {session.user.fullName}</h1></div><div className="account-chip"><span className="avatar">{session.user.fullName.slice(0, 1).toUpperCase()}</span><span>{session.user.email}<small>{session.user.roles.join(' · ')}</small></span></div></header>
      <div className="welcome"><div><p className="eyebrow">SYSTEM OVERVIEW</p><h2>Platform health at a glance</h2><p>Manage Ayushman as a platform without entering any practice workspace.</p></div><button className="refresh" onClick={() => void loadOverview()}>Refresh</button></div>
      <div className="metrics">{[
        ['Active practices', overview?.activePractices], ['Active users', overview?.activeUsers], ['Platform operators', overview?.platformOperators],
      ].map(([label, value]) => <article className="metric" key={label}><span>{label}</span><strong>{value ?? '—'}</strong><small>Current database total</small></article>)}</div>
      <article className="security-card"><div className="status-dot"/><div><h3>Platform session is active</h3><p>This admin app uses its own HttpOnly session cookie and platform permissions. Organization sign-in is handled by the separate practice application.</p></div></article>
    </section>
  </main>;
}
