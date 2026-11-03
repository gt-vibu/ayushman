'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';

type WaitlistDetails = {
  serviceName: string;
  locationName: string;
  requestedDate: string;
  status: string;
  offeredStartsAt: string | null;
  offerExpiresAt: string | null;
};

export default function WaitlistPage() {
  const [token, setToken] = useState('');
  const [details, setDetails] = useState<WaitlistDetails | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh(value = token) {
    if (!value) return;
    try { setDetails(await api<WaitlistDetails>(`/public/waitlist/${encodeURIComponent(value)}`)); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'This waitlist link could not be loaded.'); }
  }

  useEffect(() => {
    const value = new URL(window.location.href).searchParams.get('token') ?? '';
    setToken(value);
    if (value) void refresh(value);
    else setError('This link is missing its private request token.');
    // Avoid sending the private token as a referrer if the page ever gains external links.
    const meta = document.createElement('meta'); meta.name = 'referrer'; meta.content = 'no-referrer'; document.head.appendChild(meta);
    return () => meta.remove();
  }, []);

  async function act(action: 'accept' | 'withdraw') {
    setBusy(true); setError(''); setMessage('');
    try {
      if (action === 'accept') {
        const result = await api<{ appointment?: { status: string } }>(`/public/waitlist/${encodeURIComponent(token)}/accept`, { method: 'POST' });
        setMessage(result.appointment?.status === 'pending' ? 'Your request was sent to the practice for confirmation.' : 'Your offered time has been booked.');
      } else {
        await api(`/public/waitlist/${encodeURIComponent(token)}`, { method: 'DELETE' });
        setMessage('Your waitlist request has been withdrawn.');
      }
      await refresh(token);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'That action could not be completed. Refresh and try again.'); await refresh(token); }
    finally { setBusy(false); }
  }

  const offeredAt = details?.offeredStartsAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }).format(new Date(details.offeredStartsAt)) : null;
  const expiresAt = details?.offerExpiresAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(details.offerExpiresAt)) : null;
  return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book"><span>✳</span> Ayushman</Link></header><section className="booking-confirmation"><p className="eyebrow">WAITLIST REQUEST</p><h1>Manage your request</h1>{error && <p className="form-error" role="alert">{error}</p>}{details && <><article className="booking-summary"><strong>{details.serviceName}</strong><span>{details.locationName}</span><span>Requested date · {new Date(`${details.requestedDate}T12:00:00`).toLocaleDateString()}</span><span>Status · {details.status.replaceAll('_', ' ')}</span>{offeredAt && <><b>Time offered · {offeredAt}</b><small>Accept by {expiresAt}</small></>}</article>{details.status === 'accepting' && <p className="booking-helper" role="status">Your acceptance is being processed. Refresh this page in a moment to see the final status.</p>}{message && <p className="form-success" role="status">{message}</p>}{details.status === 'offered' && <button className="button button-primary" disabled={busy} onClick={() => void act('accept')}>{busy ? 'Booking…' : 'Accept this time'}</button>}{['waiting', 'contacted', 'offered'].includes(details.status) && <button className="button button-secondary" disabled={busy} onClick={() => void act('withdraw')}>{busy ? 'Updating…' : 'Withdraw request'}</button>}<p className="booking-confirm-footnote">This private link can manage the waitlist request. Keep it to yourself.</p></>}</section></main>;
}
