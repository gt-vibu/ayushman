'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Settings2 } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { PageHeader } from '@/components/app-shell';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { PhoneField } from '@/components/ui/phone-field';

export default function SettingsPage() {
  const { practice, permissions, updatePractice } = usePractice();
  const [name, setName] = useState(practice.name);
  const [phone, setPhone] = useState(practice.phone ?? '');
  const [timezone, setTimezone] = useState(practice.timezone);
  const [publicBookingEnabled, setPublicBookingEnabled] = useState(practice.publicBookingEnabled);
  const [publicListingEnabled, setPublicListingEnabled] = useState(practice.publicListingEnabled);
  const [sessionRecordingEnabled, setSessionRecordingEnabled] = useState(practice.sessionRecordingEnabled ?? false);
  const [sessionRecordingRetentionDays, setSessionRecordingRetentionDays] = useState(practice.sessionRecordingRetentionDays ?? 90);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault(); setBusy(true); setSuccess(''); setError('');
    try {
      const updated = await api<Partial<typeof practice>>(practicePath(practice.id), { method: 'PATCH', body: JSON.stringify({ name, phone: phone || null, timezone, publicBookingEnabled, publicListingEnabled, sessionRecordingEnabled, sessionRecordingRetentionDays }) });
      updatePractice(updated);
      setSuccess('Practice settings saved.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save settings.'); }
    finally { setBusy(false); }
  }

  return <><PageHeader eyebrow="PRACTICE CONFIGURATION" title="Settings" description="Practice identity and regional defaults used across branches and bookings."/>
    <section className="section-card settings-card"><div className="section-heading"><div><p className="eyebrow">GENERAL</p><h2><Settings2 size={18}/> Practice profile</h2></div></div>
      <form className="settings-form" onSubmit={save}><label>Practice name<input disabled={!permissions['practice.update']} required minLength={2} maxLength={180} value={name} onChange={(event) => setName(event.target.value)}/></label><label>Contact phone<PhoneField disabled={!permissions['practice.update']} value={phone} onChange={setPhone}/></label><label>Practice timezone<SearchableSelect endpoint="/geography/timezones" value={timezone} valueLabel={timezone} onChange={setTimezone} disabled={!permissions['practice.update']} searchPlaceholder="Search timezone, city, or UTC offset…"/><small>Branch bookings can use each location’s own timezone.</small></label>
        {permissions['practice.update'] && <div className="settings-actions">{success && <span className="save-success"><Check size={15}/>{success}</span>}{error && <span className="form-error" role="alert">{error}</span>}<button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button></div>}
      </form>
    </section>
    {permissions['practice.update'] && <section className="section-card settings-card"><p className="eyebrow">CUSTOMER BOOKING</p><h2><Settings2 size={18}/> Discovery and booking</h2><p className="page-description">New practices are discoverable and bookable by default. Turn either option off whenever you need. Your location hours and practitioner availability still apply. Customers access booking from the customer portal.</p><div className="settings-toggles"><label><input type="checkbox" checked={publicListingEnabled} onChange={(event) => setPublicListingEnabled(event.target.checked)}/> Show this practice in search</label><label><input type="checkbox" checked={publicBookingEnabled} onChange={(event) => setPublicBookingEnabled(event.target.checked)}/> Accept online bookings</label></div>{success && <p className="save-success"><Check size={15}/>{success}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save booking settings'}</button></section>}
    {permissions['practice.update'] && <section className="section-card settings-card"><p className="eyebrow">SESSION PRIVACY</p><h2><Settings2 size={18}/> Session recording & replay</h2><p className="page-description">Recording is optional for every appointment. The assigned practitioner and customer must agree before capture starts. Saved audio stays private until reviewed and shared by the practitioner.</p><div className="settings-toggles"><label><input type="checkbox" checked={sessionRecordingEnabled} onChange={(event) => setSessionRecordingEnabled(event.target.checked)}/> Allow practitioners to request session recording consent</label></div><div className="settings-form"><label>Audio retention (days)<input type="number" min={1} max={3650} disabled={!sessionRecordingEnabled} value={sessionRecordingRetentionDays} onChange={(event) => setSessionRecordingRetentionDays(Number(event.target.value))}/><small>Shared or reviewed audio is automatically removed after this period (1–3650 days). Choose a period appropriate to your profession and policy.</small></label></div>{success && <p className="save-success"><Check size={15}/>{success}</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save recording settings'}</button></section>}
    {permissions['booking_policy.manage'] && <BookingPolicySettings practiceId={practice.id}/>}
  </>;
}

type BookingPolicy = { maxAdvanceDays: number; minNoticeMinutes: number; cancellationCutoffMinutes: number; reschedulingCutoffMinutes: number; guestBookingEnabled: boolean; patientCancellationEnabled: boolean; patientReschedulingEnabled: boolean; emailNotificationsEnabled: boolean; requirePrepayment: boolean; confirmationMode: 'immediate' | 'approval' };
function BookingPolicySettings({ practiceId }: { practiceId: string }) {
  const { practice } = usePractice();
  const [policy, setPolicy] = useState<BookingPolicy | null>(null); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  useEffect(() => { let active = true; void api<BookingPolicy>(practicePath(practiceId, '/booking-policy')).then((value) => { if (active) setPolicy(value); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load booking policy.'); }); return () => { active = false; }; }, [practiceId]);
  function update<K extends keyof BookingPolicy>(key: K, value: BookingPolicy[K]) { setPolicy((current) => current ? { ...current, [key]: value } : current); setSuccess(''); }
  async function save(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!policy) return; setBusy(true); setError(''); setSuccess(''); try { const result = await api<BookingPolicy>(practicePath(practiceId, '/booking-policy'), { method: 'POST', body: JSON.stringify(policy) }); setPolicy(result); setSuccess('Booking and change policies saved.'); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save booking policy.'); } finally { setBusy(false); } }
  if (!policy && !error) return <section className="section-card settings-card"><p>Loading booking policy…</p></section>;
  return <section className="section-card settings-card"><p className="eyebrow">CUSTOMER CHANGE RULES</p><h2><Settings2 size={18}/> Booking, cancellation & rescheduling</h2><p className="page-description">These rules apply to customer bookings and self-service changes. All times use {practice.timezone}.</p>{error && <p className="form-error" role="alert">{error}</p>}{policy && <form className="settings-form" onSubmit={save}>
    <label>Book up to (days ahead)<input type="number" min={1} max={365} value={policy.maxAdvanceDays} onChange={(event) => update('maxAdvanceDays', Number(event.target.value))}/><small>Maximum booking horizon (1–365 days).</small></label>
    <label>Minimum notice (minutes)<input type="number" min={0} max={525600} value={policy.minNoticeMinutes} onChange={(event) => update('minNoticeMinutes', Number(event.target.value))}/><small>How soon before a slot customers may book.</small></label>
    <label className="settings-toggle-field"><input type="checkbox" checked={policy.patientCancellationEnabled} onChange={(event) => update('patientCancellationEnabled', event.target.checked)}/> Allow customers to cancel online</label>
    <label>Cancellation cutoff (minutes before appointment)<input type="number" min={0} max={525600} disabled={!policy.patientCancellationEnabled} value={policy.cancellationCutoffMinutes} onChange={(event) => update('cancellationCutoffMinutes', Number(event.target.value))}/></label>
    <label className="settings-toggle-field"><input type="checkbox" checked={policy.patientReschedulingEnabled} onChange={(event) => update('patientReschedulingEnabled', event.target.checked)}/> Allow customers to reschedule online</label>
    <label>Rescheduling cutoff (minutes before appointment)<input type="number" min={0} max={525600} disabled={!policy.patientReschedulingEnabled} value={policy.reschedulingCutoffMinutes} onChange={(event) => update('reschedulingCutoffMinutes', Number(event.target.value))}/></label>
    <label>Booking confirmation<DropdownSelect value={policy.confirmationMode} onChange={(event) => update('confirmationMode', event.target.value as BookingPolicy['confirmationMode'])}><option value="immediate">Confirm automatically</option><option value="approval">Require practitioner approval</option></DropdownSelect></label>
    <div className="settings-actions">{success && <span className="save-success"><Check size={15}/>{success}</span>}<button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : 'Save change rules'}</button></div>
  </form>}</section>;
}
