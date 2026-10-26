'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowLeft, ArrowRight, Check, Leaf } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { POPULAR_PROFESSIONS, professionCodeFor } from '@/lib/popular-professions';
import { PhoneField } from '@/components/ui/phone-field';
import { DropdownSelect } from '@/components/ui/dropdown-select';
import type { Branch, PracticeProfession } from '@/lib/types';

type SetupDraft = { step: number; mode: 'appointments'|'walk_ins'|'both'; locationId: string; professionId: string; serviceId: string; ownerIsPractitioner?: boolean; practiceName?: string; phone?: string; locationName?: string; address?: typeof addressEmpty; professionName?: string; serviceName?: string; description?: string; duration?: string; price?: string; days?: number[]; start?: string; end?: string };
const DRAFT_KEY = 'ayushman.practice_setup_v1';
const addressEmpty = { line1: '', city: '', state: '', postalCode: '', countryCode: 'IN' };

export default function SetupPage() {
  const { practice, session, branches, professions, refreshBranches, refreshProfessions, updatePractice } = usePractice();
  const [draft] = useState<SetupDraft>(() => { try { return { step: 0, mode: 'both', locationId: '', professionId: '', serviceId: '', ...(typeof window === 'undefined' ? {} : JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')) }; } catch { return { step: 0, mode: 'both', locationId: '', professionId: '', serviceId: '' }; } });
  const [step, setStep] = useState(draft.step);
  const [ownerIsPractitioner, setOwnerIsPractitioner] = useState(draft.ownerIsPractitioner ?? true);
  const [mode, setMode] = useState<SetupDraft['mode']>(practice.serviceMode ?? draft.mode);
  const [practiceName, setPracticeName] = useState(draft.practiceName ?? practice.name);
  const [phone, setPhone] = useState(draft.phone ?? practice.phone ?? '');
  const [locationName, setLocationName] = useState(draft.locationName ?? branches[0]?.name ?? 'Main location');
  const [address, setAddress] = useState(draft.address ?? addressEmpty);
  const [locationId, setLocationId] = useState(draft.locationId || branches[0]?.id || '');
  const [professionId, setProfessionId] = useState(draft.professionId || professions[0]?.id || '');
  const [serviceId, setServiceId] = useState(draft.serviceId);
  const [professionName, setProfessionName] = useState(draft.professionName ?? '');
  const [serviceName, setServiceName] = useState(draft.serviceName ?? '');
  const [description, setDescription] = useState(draft.description ?? '');
  const [duration, setDuration] = useState(draft.duration ?? '30');
  const [price, setPrice] = useState(draft.price ?? '');
  const [days, setDays] = useState(draft.days ?? [1, 2, 3, 4, 5]);
  const [start, setStart] = useState(draft.start ?? '09:00');
  const [end, setEnd] = useState(draft.end ?? '17:00');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const saved = { step, mode, locationId, professionId, serviceId, ownerIsPractitioner, practiceName, phone, locationName, address, professionName, serviceName, description, duration, price, days, start, end };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(saved));
  }, [step, mode, locationId, professionId, serviceId, ownerIsPractitioner, practiceName, phone, locationName, address, professionName, serviceName, description, duration, price, days, start, end]);
  useEffect(() => { if (!locationId && branches[0]) { setLocationId(branches[0].id); setLocationName(branches[0].name); } }, [branches, locationId]);
  useEffect(() => { if (!professionId && professions[0]) setProfessionId(professions[0].id); }, [professions, professionId]);
  const needsOnlineHours = mode !== 'walk_ins';
  const steps = ['Practice', 'Location', 'Profession', 'First service', ...(needsOnlineHours ? ['Availability'] : []), 'Review'];
  const reviewStep = steps.length - 1;
  const minute = (value: string) => { const [h, m] = value.split(':').map(Number); return h * 60 + m; };
  function saveDraft(next: Partial<SetupDraft>) {
    const value = { step, mode, locationId, professionId, serviceId, ...next };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(value));
  }
  function setStepAndSave(next: number) { setStep(next); saveDraft({ step: next }); }
  function later() { localStorage.setItem('ayushman.practice_setup_skipped', '1'); window.location.assign('/dashboard'); }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      if (step === 0) {
        await api(practicePath(practice.id, ''), { method: 'PATCH', body: JSON.stringify({ name: practiceName, phone: phone || null, serviceMode: mode, publicBookingEnabled: needsOnlineHours, publicListingEnabled: true }) });
        updatePractice({ name: practiceName, phone: phone || null, serviceMode: mode, publicBookingEnabled: needsOnlineHours, publicListingEnabled: true });
        setStepAndSave(1);
      } else if (step === 1) {
        let id = locationId || branches[0]?.id;
        if (!id) {
          const created = await api<Branch>(practicePath(practice.id, '/locations'), { method: 'POST', body: JSON.stringify({ name: locationName, address: { ...address, ...(address.state ? {} : { state: undefined }), ...(address.postalCode ? {} : { postalCode: undefined }) }, timezone: practice.timezone }) });
          id = created.id;
            saveDraft({ locationId: id, step: 2 });
        }
        if (!id) throw new Error('Save a location to continue.');
          setLocationId(id); await refreshBranches(); setStepAndSave(2); saveDraft({ locationId: id, step: 2 });
      } else if (step === 2) {
        if (!ownerIsPractitioner) {
          localStorage.removeItem(DRAFT_KEY);
          localStorage.removeItem('ayushman.practice_setup_skipped');
          window.location.assign('/staff');
          return;
        }
        if (!locationId) throw new Error('Add a location first.');
        let id = professionId || professions[0]?.id;
        let created: PracticeProfession | undefined;
        if (!id) {
          const name = professionName.trim();
          if (!name) throw new Error('Choose a popular profession or enter one.');
          created = await api<PracticeProfession>(practicePath(practice.id, '/professions/quick-add'), { method: 'POST', body: JSON.stringify({ professionCode: professionCodeFor(name), name, termOverrides: {}, locationIds: [locationId] }) });
          id = created.id;
            saveDraft({ professionId: id, step: 2 });
        }
        if (!created) await api(practicePath(practice.id, `/locations/${locationId}/professions`), { method: 'POST', body: JSON.stringify({ practiceProfessionId: id, enabled: true }) });
        await api(practicePath(practice.id, `/staff/${session.user.id}/professional-profile`), { method: 'POST', body: JSON.stringify({ practiceProfessionId: id, locationIds: [locationId], publicProfile: false, profileAttributes: {} }) });
        await refreshProfessions(); setProfessionId(id); saveDraft({ professionId: id, step: 2 }); setStepAndSave(3); saveDraft({ professionId: id, step: 3 });
      } else if (step === 3) {
        if (!professionId || !locationId) throw new Error('Complete the profession and location steps first.');
        const payload = { practiceProfessionId: professionId, name: serviceName, description, durationMinutes: Number(duration), bufferBeforeMinutes: 0, bufferAfterMinutes: 0, priceMinor: price ? Math.round(Number(price) * 100) : null, currency: practice.currency, onlineBookable: needsOnlineHours, active: true, professionalUserIds: [session.user.id], locationIds: [locationId] };
        let savedServiceId = serviceId;
        try { savedServiceId = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}').serviceId || savedServiceId; } catch { /* use the current setup draft */ }
        const savedService = savedServiceId
          ? await api<{ id: string }>(practicePath(practice.id, `/services/${savedServiceId}`), { method: 'PATCH', body: JSON.stringify(payload) })
          : await api<{ id: string }>(practicePath(practice.id, '/services'), { method: 'POST', body: JSON.stringify(payload) });
        saveDraft({ serviceId: savedService.id, step: needsOnlineHours ? 4 : reviewStep });
        setServiceId(savedService.id);
        if (needsOnlineHours) { setStep(4); saveDraft({ serviceId: savedService.id, step: 4 }); }
        else { setStep(reviewStep); saveDraft({ serviceId: savedService.id, step: reviewStep }); }
      } else if (needsOnlineHours && step === 4) {
        if (!days.length) throw new Error('Select at least one day you are available.');
        await api(practicePath(practice.id, '/availability/professional-schedule'), { method: 'PUT', body: JSON.stringify({ practiceProfessionId: professionId, locationId, rules: days.map((weekday) => ({ weekday, startMinute: minute(start), endMinute: minute(end), slotIntervalMinutes: 30 })) }) });
        setStep(reviewStep); saveDraft({ step: reviewStep });
      } else {
        localStorage.removeItem(DRAFT_KEY); localStorage.removeItem('ayushman.practice_setup_skipped'); window.location.assign('/dashboard');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this setup step.'); }
    finally { setBusy(false); }
  }

  return <main className="setup-wizard"><header><Link href="/dashboard" className="brand"><span className="brand-icon"><Leaf size={19}/></span>Ayushman</Link><button type="button" className="button button-secondary" onClick={later}>Finish later</button></header><section className="setup-wizard-card"><p className="eyebrow">YOUR PRACTICE, READY TO RUN</p><h1>Let’s set up {practiceName || 'your practice'}.</h1><p className="setup-wizard-intro">A few essentials now. You can change everything later in Settings.</p><div className="setup-progress">{steps.map((label, index) => <span key={label} className={index <= step ? 'current' : ''}><i>{index < step ? <Check size={13}/> : index + 1}</i>{label}</span>)}</div>
    <form className="setup-step-form" onSubmit={submit}>
      {step === 0 && <><h2>How do clients visit?</h2><label>Practice name<input required minLength={2} maxLength={180} value={practiceName} onChange={(event) => setPracticeName(event.target.value)}/></label><label>Practice phone <small>Optional</small><PhoneField value={phone} onChange={setPhone}/></label><fieldset className="choice-fieldset"><legend>Ways to serve clients</legend>{([['both', 'Appointments and walk-ins'], ['appointments', 'Appointments only'], ['walk_ins', 'Walk-ins only']] as const).map(([value, label]) => <label className="check-row" key={value}><input type="radio" name="mode" checked={mode === value} onChange={() => setMode(value)}/>{label}</label>)}</fieldset></>}
      {step === 1 && <><h2>Where do you meet clients?</h2><label>Location name<input required minLength={2} maxLength={140} value={locationName} onChange={(event) => setLocationName(event.target.value)}/></label><label>Street address<input required value={address.line1} onChange={(event) => setAddress({ ...address, line1: event.target.value })}/></label><div className="form-grid"><label>City<input required value={address.city} onChange={(event) => setAddress({ ...address, city: event.target.value })}/></label><label>State<input value={address.state} onChange={(event) => setAddress({ ...address, state: event.target.value })}/></label></div><label>Postal code<input value={address.postalCode} onChange={(event) => setAddress({ ...address, postalCode: event.target.value })}/></label><p className="field-hint">Your practice timezone is {practice.timezone}. You can add more branches later.</p></>}
      {step === 2 && <><h2>Who will provide the services?</h2><fieldset className="choice-fieldset"><legend>Practitioner setup</legend><label className="check-row"><input type="radio" name="ownerIsPractitioner" checked={ownerIsPractitioner} onChange={() => setOwnerIsPractitioner(true)}/>I’m a practitioner and will provide services</label><label className="check-row"><input type="radio" name="ownerIsPractitioner" checked={!ownerIsPractitioner} onChange={() => setOwnerIsPractitioner(false)}/>I manage the practice; I’ll invite practitioners first</label></fieldset>{ownerIsPractitioner && <><p className="field-hint">This connects your profile, service, and schedule so clients can find the right appointment.</p>{professions.length > 0 && <label>Existing profession<DropdownSelect value={professionId} onChange={(event) => { setProfessionId(event.target.value); setProfessionName(''); }}><option value="">Choose an existing profession</option>{professions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</DropdownSelect></label>}<div className="profession-suggestions">{POPULAR_PROFESSIONS.map((name) => <button type="button" className={`profession-suggestion${professionName === name ? ' selected' : ''}`} key={name} onClick={() => { setProfessionName(name); setProfessionId(''); }}>{name}</button>)}</div><label>Or enter a profession<input minLength={2} maxLength={120} value={professionName} onChange={(event) => { setProfessionName(event.target.value); setProfessionId(''); }} placeholder="e.g. Speech therapist"/></label></>}{!ownerIsPractitioner && <p className="field-hint">You can invite a practitioner now. They can add their profession and availability after accepting the invitation; this owner account won’t be assigned as the provider.</p>}</>}
      {step === 3 && <><h2>Add your first service</h2><p className="field-hint">Examples: Initial consultation, Follow-up session, or First visit.</p><label>Service name<input required minLength={2} maxLength={160} value={serviceName} onChange={(event) => setServiceName(event.target.value)}/></label><label>Description <small>Optional</small><textarea rows={3} maxLength={2000} value={description} onChange={(event) => setDescription(event.target.value)}/></label><div className="form-grid"><label>Duration<input required type="number" min={5} max={720} value={duration} onChange={(event) => setDuration(event.target.value)}/></label><label>Rate ({practice.currency})<input type="number" min={0} max="21474836.47" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)}/></label></div></>}
      {needsOnlineHours && step === 4 && <><h2>When can clients book?</h2><p className="field-hint">Choose your usual weekly hours. Appointment availability also respects branch hours and service duration.</p><div className="setup-weekdays">{[['Mon',1],['Tue',2],['Wed',3],['Thu',4],['Fri',5],['Sat',6],['Sun',0]].map(([label, value]) => <label key={value}><input type="checkbox" checked={days.includes(Number(value))} onChange={() => setDays((current) => current.includes(Number(value)) ? current.filter((day) => day !== Number(value)) : [...current, Number(value)])}/>{label}</label>)}</div><div className="form-grid"><label>From<input type="time" required value={start} onChange={(event) => setStart(event.target.value)}/></label><label>Until<input type="time" required value={end} onChange={(event) => setEnd(event.target.value)}/></label></div><p className="field-hint">You can fine-tune hours, breaks, and time off in Availability.</p></>}
      {step === reviewStep && <><h2>Review your practice setup</h2><p className="field-hint">Your essentials are saved. Go back to change anything before opening the dashboard.</p><dl className="setup-review"><div><dt>Practice</dt><dd>{practiceName} · {mode === 'both' ? 'Appointments and walk-ins' : mode === 'appointments' ? 'Appointments' : 'Walk-ins'}</dd></div><div><dt>Location</dt><dd>{locationName || branches.find((item) => item.id === locationId)?.name || 'Saved location'}</dd></div><div><dt>Profession</dt><dd>{professions.find((item) => item.id === professionId)?.name || professionName}</dd></div><div><dt>First service</dt><dd>{serviceName} · {duration} min{price ? ` · ${practice.currency} ${price}` : ''}</dd></div>{needsOnlineHours && <div><dt>Availability</dt><dd>{days.length} days · {start}–{end}</dd></div>}</dl>{needsOnlineHours && <button type="button" className="button button-secondary" onClick={() => window.location.assign(`/book?practiceId=${practice.id}`)}>Preview booking page</button>}</>}
      {error && <p className="form-error" role="alert">{error}</p>}<footer className="setup-step-actions">{step > 0 && <button type="button" className="button button-secondary" onClick={() => setStepAndSave(step - 1)}><ArrowLeft size={15}/>Back</button>}<button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : step === 2 && !ownerIsPractitioner ? 'Finish and invite practitioners' : step === reviewStep ? 'Open dashboard' : <>Save and continue<ArrowRight size={15}/></>}</button></footer>
    </form></section><p className="setup-wizard-footnote">You can invite your team and add more services after setup.</p></main>;
}
