'use client';

import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import type { FormEvent } from 'react';
import { Leaf } from 'lucide-react';
import { api } from '@/lib/api';

function InvitationForm() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get('token') ?? '';
  const [mode, setMode] = useState<'new' | 'existing'>('new');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!token) { setError('This invitation link is missing its token. Ask the practice owner to send a new invitation.'); return; }
    setBusy(true);
    try {
      if (mode === 'new') {
        const result = await api<{ practiceId: string }>('/invitations/accept', {
          method: 'POST', body: JSON.stringify({ token, fullName: fullName.trim(), password }),
        });
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
        localStorage.setItem('ayushman.practice_id', result.practiceId);
        router.replace('/dashboard');
      } else {
        await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: email.trim(), password }) });
        const result = await api<{ practiceId: string }>('/invitations/accept-existing', {
          method: 'POST', body: JSON.stringify({ token }),
        });
        localStorage.setItem('ayushman.practice_id', result.practiceId);
        router.replace('/dashboard');
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Could not accept this invitation.';
      if (mode === 'new' && /account already exists/i.test(message)) setMode('existing');
      setError(message);
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-icon"><Leaf size={20}/></span>Ayushman</Link>
    <p className="eyebrow">PRACTICE TEAM</p>
    <h1>{mode === 'new' ? 'Accept your invitation' : 'Sign in to join'}</h1>
    <p className="auth-intro">{mode === 'new' ? 'Create your staff account to join this practice. Use the email address the invitation was sent to.' : 'Sign in with the account that received this invitation to add the practice to your workspace.'}</p>
    {!token ? <p className="form-error" role="alert">This invitation link is missing its token. Ask the practice owner to create a new link.</p> : <form className="form-stack" onSubmit={submit}>
      {mode === 'new' && <label>Your name<input autoComplete="name" required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)}/></label>}
      <label>Invitation email<input autoComplete="username" type="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Password<input autoComplete={mode === 'new' ? 'new-password' : 'current-password'} type="password" required minLength={mode === 'new' ? 12 : 1} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)}/>{mode === 'new' && <small>Use at least 12 characters.</small>}</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Accepting invitation…' : mode === 'new' ? 'Create account and join' : 'Sign in and join practice'}</button>
    </form>}
    <p className="auth-switch">{mode === 'new' ? 'Already have an account?' : 'Need a new staff account?'} <button type="button" className="text-link" onClick={() => { setMode(mode === 'new' ? 'existing' : 'new'); setError(''); }}>{mode === 'new' ? 'Sign in to accept' : 'Create account'}</button></p>
  </section><aside className="auth-aside"><span className="aside-mark">✳</span><p className="eyebrow">A BETTER WAY TO WORK TOGETHER</p><h2>One team.<br/><em>One shared workspace.</em></h2><p>Your practice owner has invited you to collaborate. Accept the invitation to get started.</p></aside></main>;
}

export default function AcceptInvitationPage() {
  return <Suspense fallback={<main className="auth-page"><section className="auth-card">Loading invitation…</section></main>}><InvitationForm/></Suspense>;
}
