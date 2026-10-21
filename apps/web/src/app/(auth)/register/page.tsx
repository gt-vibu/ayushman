'use client';

import Link from 'next/link';
import { useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Leaf } from 'lucide-react';
import { api } from '@/lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState({ name: '', email: '', password: '', practice: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const update = (field: keyof typeof form) => (event: ChangeEvent<HTMLInputElement>) => setForm((value) => ({ ...value, [field]: event.target.value }));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const response = await api<{ practiceId: string }>('/auth/register', {
        method: 'POST', body: JSON.stringify({
          fullName: form.name, email: form.email, password: form.password,
          practice: { name: form.practice, timezone: 'Asia/Kolkata', currency: 'INR' },
        }),
      });
      localStorage.setItem('ayushman.practice_id', response.practiceId);
      router.replace('/dashboard');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Account setup failed.');
    } finally { setBusy(false); }
  }

  return <main className="auth-page"><section className="auth-card">
    <Link className="brand auth-brand" href="/"><span className="brand-icon"><Leaf size={20}/></span>Ayushman</Link>
    <p className="eyebrow">A BETTER WAY TO RUN YOUR PRACTICE</p><h1>Create your workspace</h1>
    <p className="auth-intro">Start with your account and practice name. You can configure branches, team, and services next.</p>
    <form className="form-stack" onSubmit={submit}>
      <label>Your name<input suppressHydrationWarning autoComplete="name" required minLength={2} maxLength={160} value={form.name} onChange={update('name')} /></label>
      <label>Email address<input suppressHydrationWarning autoComplete="email" type="email" required maxLength={320} value={form.email} onChange={update('email')} /></label>
      <label>Practice name<input suppressHydrationWarning autoComplete="organization" required minLength={2} maxLength={180} value={form.practice} onChange={update('practice')} /></label>
      <label>Password<input suppressHydrationWarning autoComplete="new-password" type="password" required minLength={12} maxLength={128} value={form.password} onChange={update('password')} /><small>Use at least 12 characters.</small></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Creating workspace…' : 'Create practice'}</button>
    </form>
    <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
  </section><aside className="auth-aside"><span className="aside-mark">✳</span><p className="eyebrow">A CALMER START</p><h2>Your work deserves<br/><em>a well-run home.</em></h2><p>Begin with one workspace. Add the people, places, and services that make your practice yours.</p></aside></main>;
}
