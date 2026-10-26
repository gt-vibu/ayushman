'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Leaf } from 'lucide-react';
import { api } from '@/lib/api';
import { LoginInput } from '@ayushman-v2/contracts';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const parsed = LoginInput.safeParse({ email, password });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check your email and password.'); return; }
    setBusy(true);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify(parsed.data) });
      router.replace('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign in failed.');
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-icon"><Leaf size={20}/></span>Ayushman</Link>
    <p className="eyebrow">YOUR PRACTICE, IN RHYTHM</p><h1>Welcome back</h1>
    <p className="auth-intro">Sign in to manage your practice and care for the people you serve.</p>
    <form className="form-stack" onSubmit={submit}>
      <label>Email address<input suppressHydrationWarning autoComplete="username" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label>Password<input suppressHydrationWarning autoComplete="current-password" type="password" required maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    <p className="auth-switch">Setting up a new practice? <Link href="/register">Create an account</Link></p>
  </section><aside className="auth-aside"><span className="aside-mark">✳</span><p className="eyebrow">MADE FOR THE WORK THAT MATTERS</p><h2>More time for people.<br/><em>Less time coordinating.</em></h2><p>Bring your branches, team, services, schedules, and appointments together in one thoughtful workspace.</p></aside></main>;
}
