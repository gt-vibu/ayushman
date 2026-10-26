'use client';

import { SpaLink as Link } from '@/components/spa-link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Leaf } from 'lucide-react';
import { api } from '@/lib/api';
import { PhoneField } from '@/components/ui/phone-field';
import { CustomerRegistrationInput, LoginInput } from '@ayushman-v2/contracts';

export function CustomerAuthForm({ mode }: { mode: 'login' | 'register' }) {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnQuery, setReturnQuery] = useState('');
  const [isRegister, setIsRegister] = useState(mode === 'register');
  useEffect(() => { setReturnQuery(new URLSearchParams(window.location.search).get('returnTo') ?? ''); }, []);
  useEffect(() => { setIsRegister(mode === 'register'); }, [mode]);
  const returnTo = () => {
    const requested = new URLSearchParams(window.location.search).get('returnTo');
    return requested?.startsWith('/') && !requested.startsWith('//') && !requested.includes('\\')
      ? requested
      : '/customer/account';
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const schema = isRegister ? CustomerRegistrationInput : LoginInput;
    const parsed = schema.safeParse(isRegister ? { fullName, email, ...(phone ? { phone } : {}), password } : { email, password });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the form fields and try again.'); return; }
    setBusy(true);
    try {
      const result = await api<{ user: { fullName: string; email: string } }>(`/auth/customer/${mode}`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      window.dispatchEvent(new CustomEvent('ayushman-customer-session-change', { detail: { fullName: result.user.fullName, email: result.user.email, phone: null } }));
      router.replace(returnTo());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign in.');
    } finally { setBusy(false); }
  }

  const switchHref = `/customer/${isRegister ? 'login' : 'register'}${returnQuery ? `?returnTo=${encodeURIComponent(returnQuery)}` : ''}`;
  function switchMode() {
    setError(''); setIsRegister((value) => !value);
    router.replace(switchHref, { scroll: false });
  }
  return <main className={`auth-page customer-auth-page ${isRegister ? 'customer-auth-register' : 'customer-auth-login'}`}>
    <div className="customer-auth-shell">
    <section className="auth-card customer-auth-card">
    <Link className="brand auth-brand" href="/book"><span className="brand-icon"><Leaf size={20}/></span>Ayushman</Link>
    <p className="eyebrow">YOUR APPOINTMENTS, IN ONE PLACE</p>
    <h1>{isRegister ? 'Create your customer account' : 'Welcome back'}</h1>
    <p className="auth-intro">{isRegister ? 'Save your details once and keep bookings and shared records together.' : 'Sign in to manage bookings and see information shared by your service providers.'}</p>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {isRegister && <label>Your name<input suppressHydrationWarning required minLength={2} maxLength={160} autoComplete="name" value={fullName} onChange={(event) => setFullName(event.target.value)}/></label>}
      <label>Email address<input suppressHydrationWarning type="email" required maxLength={320} autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      {isRegister && <label>Phone number <span className="optional">Optional</span><PhoneField value={phone} onChange={setPhone}/></label>}
      <label>Password<input suppressHydrationWarning type="password" required minLength={isRegister ? 12 : 1} maxLength={128} autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)}/>{isRegister && <small>Use at least 12 characters.</small>}</label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Please wait…' : isRegister ? 'Create account' : 'Sign in'}</button>
    </form>
    <p className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Ayushman?'} <button type="button" onClick={switchMode}>{isRegister ? 'Sign in' : 'Create an account'}</button></p>
  </section><aside className="auth-aside customer-auth-aside"><span className="aside-mark">✳</span><p className="eyebrow">{isRegister ? 'A BETTER WAY TO GET STARTED' : 'CARE THAT STAYS CONNECTED'}</p><h2>{isRegister ? <>One account.<br/><em>Every appointment.</em></> : <>Your details,<br/><em>appointments, and history.</em></>}</h2><p>{isRegister ? 'Create your customer account once. Book with participating practices and find every appointment and shared record together.' : 'Book with participating practices and keep your appointment history connected to your customer account.'}</p><span className="auth-aside-caption">Private to you · Connected across your practices</span></aside>
    </div></main>;
}
