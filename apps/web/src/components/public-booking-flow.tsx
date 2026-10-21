'use client';

import { SpaLink as Link } from '@/components/spa-link';
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, MapPin, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { BrandLoader } from '@/components/ui/branded-loader';
import { CustomerSessionLink } from '@/components/customer-session-link';
import { useCustomerSession } from '@/lib/customer-session';

type PublicPerson = { id: string; name: string; headline: string | null; bio: string | null };
type PublicLocation = { id: string; name: string };
type PublicService = { id: string; practiceProfessionId: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string; locations: PublicLocation[]; professionals: PublicPerson[] };
type PublicProfession = { id: string; name: string; termOverrides: Record<string, string> };
type PublicPractice = { practice: { id: string; name: string; description: string | null; timezone: string; currency: string; publicBookingEnabled: boolean }; professions: PublicProfession[]; locations: PublicLocation[]; services: PublicService[] };
type Slot = { startsAt: string; endsAt: string; professional: { id: string; name: string } };
type CustomerProfile = { fullName: string; email: string; phone: string | null };

const localDate = (timeZone: string, date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };

export function PublicBookingFlow({ practiceId }: { practiceId: string }) {
  const [data, setData] = useState<PublicPractice | null>(null);
  const [loading, setLoading] = useState(true);
  const { customer: sessionCustomer, status: customerStatus, refresh: refreshCustomerSession } = useCustomerSession();
  const customer = sessionCustomer as CustomerProfile | null;
  const [error, setError] = useState('');
  const [step, setStep] = useState(1);
  const [professionId, setProfessionId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [professionalId, setProfessionalId] = useState('');
  const [date, setDate] = useState('');
  const [dateManuallySet, setDateManuallySet] = useState(false);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [hold, setHold] = useState<{ id: string; startsAt: string; expiresAt: string; serviceName: string } | null>(null);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [confirmation, setConfirmation] = useState<{ id: string; status: string; startsAt: string } | null>(null);

  useEffect(() => { let active = true; api<PublicPractice>(`/public/practices/${practiceId}`).then((value) => { if (!active) return; setData(value); setProfessionId(value.professions[0]?.id ?? ''); setDate(addDays(localDate(value.practice.timezone), 1)); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'This practice is unavailable.'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [practiceId]);
  const services = useMemo(() => (data?.services ?? []).filter((item) => !professionId || item.practiceProfessionId === professionId), [data, professionId]);
  const selectedService = data?.services.find((item) => item.id === serviceId);
  const selectedLocation = selectedService?.locations.find((item) => item.id === locationId);
  const selectedProfession = data?.professions.find((item) => item.id === professionId);
  const professionalTerm = selectedProfession?.termOverrides.professionalSingular || 'professional';

  useEffect(() => {
    if (!selectedService || !locationId || !date) { setSlots([]); return; }
    let active = true; setLoadingSlots(true); setError('');
    const query = new URLSearchParams({ serviceId, locationId, from: date, to: date });
    if (professionalId) query.set('professionalUserId', professionalId);
    api<{ slots: Slot[] }>(`/public/practices/${practiceId}/availability?${query}`).then(async (result) => {
      if (!active) return;
      if (result.slots.length || dateManuallySet) { setSlots(result.slots); setSlot(null); return; }
      const lastDate = addDays(date, 6);
      const nextQuery = new URLSearchParams({ serviceId, locationId, from: date, to: lastDate });
      if (professionalId) nextQuery.set('professionalUserId', professionalId);
      const next = await api<{ slots: Slot[] }>(`/public/practices/${practiceId}/availability?${nextQuery}`);
      if (!active) return;
      const firstSlot = next.slots[0];
      if (firstSlot) {
        const nextDate = localDate(data?.practice.timezone ?? 'Asia/Kolkata', new Date(firstSlot.startsAt));
        if (nextDate !== date) { setDate(nextDate); return; }
      }
      setSlots(result.slots); setSlot(null);
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load available times.'); }).finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [practiceId, selectedService, serviceId, locationId, professionalId, date, dateManuallySet, data?.practice.timezone]);

  function chooseService(id: string) {
    const chosen = data?.services.find((item) => item.id === id);
    if (!chosen) return;
    setServiceId(chosen.id); setProfessionId(chosen.practiceProfessionId); setLocationId(chosen.locations[0]?.id ?? ''); setProfessionalId(''); setSlot(null); setDateManuallySet(false); setDate(addDays(localDate(data?.practice.timezone ?? 'Asia/Kolkata'), 1)); setStep(2);
  }

  useEffect(() => {
    if (!hold) { setHoldSeconds(0); return; }
    const update = () => setHoldSeconds(Math.max(0, Math.ceil((new Date(hold.expiresAt).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [hold]);

  async function acquireBookingHold() {
    if (!slot || !customer) { setError('Sign in to your customer account before booking.'); return; }
    setSaving(true); setError('');
    try {
      const result = await api<{ hold: { id: string; startsAt: string; expiresAt: string; serviceName: string } }>(`/public/practices/${practiceId}/booking-holds`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ serviceId, locationId, professionalUserId: slot.professional.id, startsAt: slot.startsAt }),
      });
      setHold(result.hold);
      setStep(4);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reserve that time. Please choose another.'); }
    finally { setSaving(false); }
  }

  async function releaseBookingHold() {
    const current = hold;
    setHold(null);
    if (current) {
      try { await api(`/public/practices/${practiceId}/booking-holds/${current.id}`, { method: 'DELETE' }); } catch { /* The server expires abandoned holds automatically. */ }
    }
  }

  async function returnToTimeSelection(message?: string) {
    await releaseBookingHold();
    setError(message ?? '');
    setStep(3);
    setDateManuallySet(true);
  }

  async function submitBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedService || !slot || !customer || !hold || holdSeconds <= 0) { setError('Your time hold has expired. Choose an available time again.'); return; }
    setSaving(true); setError('');
    try {
      const result = await api<{ appointment: { id: string; status: string; startsAt: string } }>(`/public/practices/${practiceId}/bookings`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ serviceId, locationId, professionalUserId: slot.professional.id, startsAt: slot.startsAt, holdId: hold.id, ...(note ? { note } : {}) }),
      });
      setHold(null);
      setConfirmation(result.appointment);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) await returnToTimeSelection(cause.message);
      else setError(cause instanceof Error ? cause.message : 'Could not complete your booking.');
    }
    finally { setSaving(false); }
  }

  const money = selectedService?.priceMinor === null || selectedService?.priceMinor === undefined ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: selectedService.currency, maximumFractionDigits: 0 }).format(selectedService.priceMinor / 100);
  const timeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: data?.practice.timezone }).format(new Date(value));

  if (loading) return <main className="booking-page"><BrandLoader label="Loading practice and available services…"/></main>;
  if (error && !data) return <main className="booking-page"><p className="form-error">{error}</p><Link href="/book">Search practices</Link></main>;
  if (!data || !data.practice.publicBookingEnabled) return <main className="booking-page"><h1>Online booking is unavailable</h1><p>This practice is not accepting online bookings right now.</p><Link href="/book">Find another practice</Link></main>;
  if (!customer && customerStatus === 'unavailable') return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link><span>{data.practice.name}</span></header><section className="booking-confirmation"><p className="eyebrow">CUSTOMER ACCOUNT</p><h1>We couldn’t check your sign-in.</h1><p>Your account may still be active. Retry the check, or continue to customer sign in if the problem persists.</p><div className="customer-auth-actions"><button className="button button-primary" type="button" onClick={() => void refreshCustomerSession()}>Try again</button><Link className="button button-secondary" href={`/customer/login?returnTo=${encodeURIComponent(`/book/${practiceId}`)}`}>Customer sign in</Link></div></section></main>;
  if (!customer && customerStatus !== 'checking') {
    const returnTo = encodeURIComponent(`/book/${practiceId}`);
    return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link></header><section className="booking-confirmation"><p className="eyebrow">CUSTOMER ACCOUNT</p><h1>{customerStatus === 'practice' ? 'Use a customer account to book' : 'Sign in before booking'}</h1><p>{customerStatus === 'practice' ? 'You’re signed in to a practice account. Customer bookings use a separate account; sign in or create one to continue.' : 'Sign in or create a customer account to book and keep appointments linked to your records.'}</p><div className="customer-auth-actions"><Link className="button button-primary" href={`/customer/login?returnTo=${returnTo}`}>Customer sign in</Link><Link className="button button-secondary" href={`/customer/register?returnTo=${returnTo}`}>Create customer account</Link></div></section></main>;
  }
  if (confirmation) return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link><span>{data.practice.name}</span></header><section className="booking-confirmation"><span className="booking-confirm-icon"><Check size={24}/></span><p className="eyebrow">{confirmation.status === 'pending' ? 'REQUEST SENT' : 'BOOKING CONFIRMED'}</p><h1>{confirmation.status === 'pending' ? 'Your request is with the practice.' : 'Your session is booked.'}</h1><p>{confirmation.status === 'pending' ? `${data.practice.name} will confirm this appointment. We’ll show its status in your account.` : `Your appointment at ${data.practice.name} is confirmed.`}</p><article className="booking-summary"><strong>{selectedService?.name}</strong><span><CalendarDays size={15}/>{timeLabel(confirmation.startsAt)}</span><span><UserRound size={15}/>{slot?.professional.name}</span><span><MapPin size={15}/>{selectedLocation?.name}</span><span><Clock3 size={15}/>{selectedService?.durationMinutes} minutes · {money}</span><small>Reference · {confirmation.id.slice(0, 8).toUpperCase()}</small></article><div className="booking-confirm-actions"><Link href="/customer/account" className="button button-primary">View my appointments <ArrowRight size={15}/></Link><Link href="/book" className="button button-secondary">Book another service</Link></div><p className="booking-confirm-footnote">You can review this booking and any shared files from your customer account.</p></section></main>;

  return <main className="booking-page">
    <header className="booking-nav"><Link className="booking-brand" href="/book"><span>✳</span> Ayushman</Link><div className="booking-nav-actions"><CustomerSessionLink/></div></header>
    <section className="booking-practice-head"><Link href="/book" className="booking-back"><ArrowLeft size={15}/> All practices</Link><p className="eyebrow">BOOK ONLINE</p><h1>{data.practice.name}</h1><p>{data.practice.description || 'Choose the service, location, professional, and time that work for you.'}</p></section>
    <div className="booking-layout"><nav className="booking-steps" aria-label="Booking steps">{['Service', 'Location & person', 'Date & time', 'Your details'].map((name, index) => <span className={step === index + 1 ? 'booking-step-active' : step > index + 1 ? 'booking-step-done' : ''} key={name}><b>{step > index + 1 ? '✓' : index + 1}</b>{name}</span>)}</nav>
      <section className="booking-panel">
        {step === 1 && <><p className="eyebrow">STEP 1 OF 4</p><h2>What would you like to book?</h2>{data.professions.length > 1 && <div className="booking-profession-tabs">{data.professions.map((profession) => <button className={profession.id === professionId ? 'selected' : ''} onClick={() => { setProfessionId(profession.id); setServiceId(''); }} key={profession.id}>{profession.name}</button>)}</div>}{services.length ? <div className="booking-service-list">{services.map((service) => <button className="booking-option-card" key={service.id} onClick={() => chooseService(service.id)}><span><strong>{service.name}</strong><small>{service.description || `${service.durationMinutes} minute session`}</small></span><span className="booking-option-meta"><b>{service.priceMinor === null ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: service.currency, maximumFractionDigits: 0 }).format(service.priceMinor / 100)}</b><ArrowRight size={17}/></span></button>)}</div> : <div className="booking-empty"><p>No services are available to book online right now.</p><small>The practice may need to publish an assigned professional profile or finish its service and location setup. Contact the practice or browse other services.</small><Link href="/book" className="button button-secondary">Browse other practices</Link></div>}</>}
        {step === 2 && selectedService && <><p className="eyebrow">STEP 2 OF 4</p><h2>Choose a location and {professionalTerm}</h2><label className="booking-field"><span><MapPin size={15}/> Location</span><Select value={locationId} onChange={setLocationId} options={selectedService.locations.map((location) => ({ value: location.id, label: location.name }))} placeholder="Choose a location" ariaLabel="Choose a location"/></label><label className="booking-field"><span><UserRound size={15}/> {professionalTerm}</span><Select value={professionalId} onChange={setProfessionalId} options={[{ value: '', label: `Any available ${professionalTerm}` }, ...selectedService.professionals.map((person) => ({ value: person.id, label: `${person.name}${person.headline ? ` · ${person.headline}` : ''}` }))]} placeholder={`Choose a ${professionalTerm}`} ariaLabel={`Choose a ${professionalTerm}`}/></label><div className="booking-summary compact"><strong>{selectedService.name}</strong><span><Clock3 size={15}/>{selectedService.durationMinutes} minutes · {money}</span></div><button className="button button-primary" onClick={() => setStep(3)} disabled={!locationId}>Choose date and time <ArrowRight size={15}/></button></>}
        {step === 3 && selectedService && <><p className="eyebrow">STEP 3 OF 4</p><h2>Pick a time that works</h2><label className="booking-field"><span><CalendarDays size={15}/> Date</span><DatePicker min={localDate(data.practice.timezone)} max={addDays(localDate(data.practice.timezone), 30)} value={date} onChange={(value) => { setDateManuallySet(true); setDate(value); }} ariaLabel="Choose appointment date"/></label><p className="booking-timezone">Times shown in {data.practice.timezone}</p>{loadingSlots ? <p className="booking-empty">Finding available times…</p> : slots.length ? <div className="booking-slot-grid">{slots.map((item) => <button className={slot?.startsAt === item.startsAt ? 'selected' : ''} key={`${item.professional.id}-${item.startsAt}`} onClick={() => setSlot(item)}><strong>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: data.practice.timezone }).format(new Date(item.startsAt))}</strong>{professionalId === '' && <small>{item.professional.name}</small>}</button>)}</div> : <p className="booking-empty">No times are available on this date. Try another date or choose a different {professionalTerm}.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" onClick={() => void acquireBookingHold()} disabled={!slot || saving}>{saving ? 'Reserving this time…' : `Continue with ${slot ? timeLabel(slot.startsAt) : 'a selected time'}`} <ArrowRight size={15}/></button></>}
        {step === 4 && selectedService && slot && hold && <><p className="eyebrow">STEP 4 OF 4</p><h2>Review your appointment</h2>{holdSeconds > 0 ? <p className="booking-hold-banner" role="timer"><Clock3 size={16}/> This time is held for you for <strong>{Math.floor(holdSeconds / 60)}:{String(holdSeconds % 60).padStart(2, '0')}</strong>. Confirm before the timer ends.</p> : <div className="booking-hold-expired" role="alert"><strong>Your time hold has expired.</strong><span>This time may now be available to someone else. Choose a time again to continue.</span><button className="button button-secondary" type="button" onClick={() => void returnToTimeSelection()}>Choose another time</button></div>}{customer ? <p className="booking-helper">Booking for {customer.fullName} · {customer.email}. Update your contact details in <Link href="/customer/account">your customer profile</Link>.</p> : <p className="booking-helper" role="status">Checking your customer account…</p>}<form className="booking-form" onSubmit={(event) => void submitBooking(event)}><label>Note for the practice <span className="optional">Optional</span><textarea maxLength={1000} rows={3} value={note} onChange={(event) => setNote(event.target.value)}/></label><div className="booking-summary compact"><strong>{selectedService.name}</strong><span><CalendarDays size={15}/>{timeLabel(slot.startsAt)}</span><span><UserRound size={15}/>{slot.professional.name}</span><span><MapPin size={15}/>{selectedLocation?.name}</span><b>{money}</b></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={saving || !customer || holdSeconds <= 0}>{saving ? 'Confirming booking…' : 'Confirm booking'} <Check size={16}/></button><button className="booking-hold-release" type="button" onClick={() => void returnToTimeSelection()}>Release this time and choose another</button></form></>}
        {error && step !== 3 && step !== 4 && <p className="form-error" role="alert">{error}</p>}
        {step > 1 && !confirmation && !(step === 4 && hold && holdSeconds <= 0) && <button className="booking-back-button" onClick={() => { if (step === 4 && hold) void releaseBookingHold(); setError(''); setStep((value) => value - 1); }}><ArrowLeft size={15}/> Back</button>}
      </section>
    </div>
    <footer className="booking-footer"><Link href="/book">Find another service</Link></footer>
  </main>;
}
