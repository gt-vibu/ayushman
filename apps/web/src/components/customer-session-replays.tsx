'use client';

import { useCallback, useEffect, useState } from 'react';
import { AudioLines, Check, Clock3, MapPin, ShieldCheck } from 'lucide-react';
import { api, API_BASE } from '@/lib/api';

type CustomerRecording = { id: string; practiceId: string; appointmentId: string; status: string; sharingStatus: string; durationSeconds: number | null; startedAt: string | null; retentionExpiresAt: string | null; createdAt: string; serviceName: string; startsAt: string; timezone: string; practiceName: string; practitionerName: string; retentionDays: number; consentDecision: string | null };

export function CustomerSessionReplays() {
  const [items, setItems] = useState<CustomerRecording[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setItems(await api<CustomerRecording[]>(`/customer/me/session-recordings?refresh=${Date.now()}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load session replays.'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function decide(item: CustomerRecording, accepted: boolean) {
    setBusyId(item.id); setError('');
    try { await api(`/customer/me/session-recordings/${item.id}/consent`, { method: 'POST', body: JSON.stringify({ accepted }) }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your consent choice.'); }
    finally { setBusyId(''); }
  }
  async function restrict(item: CustomerRecording) {
    setBusyId(item.id); setError('');
    try { await api(`/customer/me/session-recordings/${item.id}/withdraw`, { method: 'POST' }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update recording access.'); }
    finally { setBusyId(''); }
  }

  return <section className="customer-session-replays">
    <div className="customer-replay-heading"><span className="customer-replay-icon"><AudioLines size={17}/></span><div><h3>Session Replay</h3><p>Recordings you agreed to, and replays your provider has shared with you.</p></div></div>
    {error && <p role="alert" className="form-error">{error}</p>}
    {loading ? <p className="customer-empty">Loading session history…</p> : !items.length ? <p className="customer-empty">No recording requests or shared session replays yet.</p> : <div className="customer-replay-list">{items.map((item) => <article key={item.id}>
      <div className="customer-replay-session"><strong>{item.serviceName}</strong><span>{item.practiceName} · {item.practitionerName}</span><small><Clock3 size={13}/>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: item.timezone }).format(new Date(item.startsAt))} <MapPin size={13}/>{item.timezone}</small></div>
      {item.status === 'awaiting_customer_consent' && item.consentDecision === 'pending' && <div className="customer-recording-consent"><p>Your practitioner would like to record this one-to-one session so you can revisit the guidance afterwards. The audio is stored privately for up to {item.retentionDays} days and is shared with you only after practitioner review. No transcription or AI processing is enabled. You can decline and still attend your appointment.</p><div><button type="button" className="button button-secondary" disabled={busyId === item.id} onClick={() => void decide(item, false)}>Decline recording</button><button type="button" className="button button-primary" disabled={busyId === item.id} onClick={() => void decide(item, true)}><Check size={14}/> Agree to recording</button></div></div>}
      {item.status === 'ready_to_record' && <div className="customer-replay-status"><ShieldCheck size={14}/><span>You agreed. Recording starts only when your practitioner begins the session.</span><button type="button" className="button button-secondary" disabled={busyId === item.id} onClick={() => void restrict(item)}>Withdraw consent</button></div>}
      {(item.status === 'recording' || item.status === 'uploading' || item.status === 'stop_requested') && <div className="customer-replay-status"><AudioLines size={14}/><span>{item.status === 'stop_requested' ? 'Your request to stop recording is being applied.' : 'The session is recording.'}</span><button type="button" className="button button-secondary" disabled={busyId === item.id} onClick={() => void restrict(item)}>Stop & restrict customer access</button></div>}
      {item.status === 'ready_for_review' && <p className="customer-replay-status"><Clock3 size={14}/> Your recording is private while your practitioner reviews it.</p>}
      {item.status === 'shared' && item.sharingStatus === 'shared' && <div className="customer-replay-audio"><div><strong>Shared session audio</strong><small>{item.durationSeconds ? `${Math.floor(item.durationSeconds / 60)} min ${item.durationSeconds % 60} sec` : 'Audio recording'} · available until {item.retentionExpiresAt ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(item.retentionExpiresAt)) : 'retention expiry'}</small></div><audio controls preload="metadata" controlsList="nodownload" src={`${API_BASE}/customer/me/session-recordings/${item.id}/content`}/><button type="button" className="text-link" disabled={busyId === item.id} onClick={() => void restrict(item)}>Restrict my access</button></div>}
      {item.status === 'declined' && <p className="customer-replay-status">Recording declined. Your appointment is not affected.</p>}
    </article>)}</div>}
    <small className="customer-replay-privacy"><ShieldCheck size={13}/> Only you and the assigned practitioner can access a shared replay. Downloads are disabled in the player.</small>
  </section>;
}
