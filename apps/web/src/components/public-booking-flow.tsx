'use client';

import { SpaLink as Link } from '@/components/spa-link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock3, MapPin, UserRound } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { BrandLoader } from '@/components/ui/branded-loader';
import { CustomerSessionLink } from '@/components/customer-session-link';
import { useCustomerSession } from '@/lib/customer-session';
import { PhoneField } from '@/components/ui/phone-field';

type PublicPerson = { id: string; name: string; headline: string | null; bio: string | null };
type PublicLocation = { id: string; name: string; professionals?: PublicPerson[] };
type PublicService = { id: string; practiceProfessionId: string; name: string; description: string | null; durationMinutes: number; priceMinor: number | null; currency: string; locations: PublicLocation[] };
type PublicProfession = { id: string; name: string; termOverrides: Record<string, string> };
type PublicPractice = { practice: { id: string; name: string; description: string | null; timezone: string; currency: string; publicBookingEnabled: boolean; guestBookingEnabled: boolean }; professions: PublicProfession[]; locations: PublicLocation[]; services: PublicService[] };
type Slot = { startsAt: string; endsAt: string; professional: { id: string; name: string } };
type CustomerProfile = { fullName: string; email: string; phone: string | null };
type BookingDraft = { expiresAt: number; step: number; professionId: string; serviceId: string; locationId: string; professionalId: string; date: string; slotStart?: string; guestName: string; guestEmail: string; guestPhone: string };

function defaultProfessionId(data: PublicPractice) {
  // Start with a profession that actually has a listed service and provider.
  // The first profession can be an incomplete setup (for example, no schedule
  // yet), which otherwise makes the booking flow look empty on its first step.
  return data.services.find((service) => service.locations.some((location) => (location.professionals?.length ?? 0) > 0))?.practiceProfessionId
    ?? data.services[0]?.practiceProfessionId
    ?? data.professions[0]?.id
    ?? '';
}

const localDate = (timeZone: string, date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const value = (name: string) => parts.find((part) => part.type === name)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
};
const addDays = (value: string, days: number) => { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + days); return date.toISOString().slice(0, 10); };
const fallbackIdempotencyKeys = new Map<string, string>();

function newIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

async function idempotencyKeyFor(purpose: string, payload: unknown): Promise<{ key: string; storageKey: string; fallbackKey?: string }> {
  const fingerprint = JSON.stringify(payload);
  let digest = fingerprint;
  if (globalThis.crypto?.subtle) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(fingerprint));
    digest = Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  const storageKey = `ayushman.booking-idempotency.${purpose}.${digest}`;
  try {
    const existing = sessionStorage.getItem(storageKey);
    if (existing) return { key: existing, storageKey };
    const key = newIdempotencyKey();
    sessionStorage.setItem(storageKey, key);
    return { key, storageKey };
  } catch {
    // Storage can be disabled in private browsing; retain the key for retries in this page instance.
    const key = fallbackIdempotencyKeys.get(`${purpose}.${digest}`) ?? newIdempotencyKey();
    fallbackIdempotencyKeys.set(`${purpose}.${digest}`, key);
    return { key, storageKey: '', fallbackKey: `${purpose}.${digest}` };
  }
}

function clearIdempotencyKey(storageKey: string, fallbackKey?: string) {
  if (storageKey) try { sessionStorage.removeItem(storageKey); } catch { /* Storage may be disabled. */ }
  if (fallbackKey) fallbackIdempotencyKeys.delete(fallbackKey);
}

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
  const [calendarDates, setCalendarDates] = useState<{ key: string; dates: string[] } | null>(null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [note, setNote] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [hold, setHold] = useState<{ id: string; startsAt: string; expiresAt: string; serviceName: string } | null>(null);
  const [holdSeconds, setHoldSeconds] = useState(0);
  const [confirmation, setConfirmation] = useState<{ id: string; status: string; startsAt: string } | null>(null);
  const [draftReady, setDraftReady] = useState(false);
  const [draftSlotStart, setDraftSlotStart] = useState('');
  const restoredSlotHandled = useRef(false);

  useEffect(() => { let active = true; api<PublicPractice>(`/public/practices/${practiceId}`).then((value) => {
    if (!active) return;
    setData(value);
    const todayPlusOne = addDays(localDate(value.practice.timezone), 1);
    try {
      const stored = sessionStorage.getItem(`ayushman.booking-draft.${practiceId}`);
      const draft = stored ? JSON.parse(stored) as BookingDraft : null;
      if (draft && draft.expiresAt > Date.now()) {
        const service = value.services.find((item) => item.id === draft.serviceId);
        const location = service?.locations.find((item) => item.id === draft.locationId);
        const person = location?.professionals?.find((item) => item.id === draft.professionalId);
        if (service && location) {
          setProfessionId(service.practiceProfessionId); setServiceId(service.id); setLocationId(location.id);
          setProfessionalId(person?.id ?? ''); setDate(/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ? draft.date : todayPlusOne);
          setDateManuallySet(true); setStep(Math.max(1, Math.min(draft.step, 3)));
          setGuestName(draft.guestName.slice(0, 160)); setGuestEmail(draft.guestEmail.slice(0, 320)); setGuestPhone(draft.guestPhone.slice(0, 32));
          setDraftSlotStart(draft.slotStart ?? ''); setError('Your booking details were restored. Please review the time before continuing.');
        } else {
          setProfessionId(defaultProfessionId(value)); setDate(todayPlusOne);
        }
      } else {
        if (stored) sessionStorage.removeItem(`ayushman.booking-draft.${practiceId}`);
        setProfessionId(defaultProfessionId(value)); setDate(todayPlusOne);
      }
    } catch {
      setProfessionId(defaultProfessionId(value)); setDate(todayPlusOne);
    }
    setDraftReady(true);
  }).catch((cause) => { if (active) { setError(cause instanceof Error ? cause.message : 'This practice is unavailable.'); setDraftReady(true); } }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, [practiceId]);
  const services = useMemo(() => (data?.services ?? []).filter((item) => !professionId || item.practiceProfessionId === professionId), [data, professionId]);
  const selectedService = data?.services.find((item) => item.id === serviceId);
  const selectedLocation = selectedService?.locations.find((item) => item.id === locationId);
  const eligibleProfessionals = selectedLocation?.professionals ?? [];
  const selectedProfession = data?.professions.find((item) => item.id === professionId);
  const professionalTerm = selectedProfession?.termOverrides.professionalSingular || 'professional';
  const bookingToday = data ? localDate(data.practice.timezone) : '';
  const bookingLastDate = bookingToday ? addDays(bookingToday, 30) : '';
  const calendarKey = [serviceId, locationId, professionalId, bookingToday].join(':');
  const availableBookingDates = calendarDates?.key === calendarKey ? calendarDates.dates : undefined;

  // Load the selected service's actual bookable dates so weekly days off,
  // closures, and fully booked dates can be disabled in the calendar itself.
  useEffect(() => {
    const timezone = data?.practice.timezone;
    if (step !== 3 || !selectedService || !locationId || !bookingToday || !bookingLastDate || !timezone) return;
    let active = true;
    const query = new URLSearchParams({ serviceId, locationId, from: bookingToday, to: bookingLastDate });
    if (professionalId) query.set('professionalUserId', professionalId);
    api<{ slots: Slot[] }>(`/public/practices/${practiceId}/availability?${query}`).then((result) => {
      if (!active) return;
      const dates = [...new Set(result.slots.map((item) => localDate(timezone, new Date(item.startsAt))))].sort();
      setCalendarDates({ key: calendarKey, dates });
    }).catch(() => {
      // Per-date slot loading still works if this optional calendar prefetch fails.
      if (active) setCalendarDates(null);
    });
    return () => { active = false; };
  }, [step, selectedService, serviceId, locationId, professionalId, bookingToday, bookingLastDate, calendarKey, practiceId, data?.practice.timezone]);

  useEffect(() => {
    if (!availableBookingDates?.length || !date || availableBookingDates.includes(date)) return;
    const nextAvailable = availableBookingDates.find((item) => item >= date) ?? availableBookingDates[0];
    setDate(nextAvailable);
    setSlot(null);
  }, [availableBookingDates, date]);

  useEffect(() => {
    if (!selectedService || !locationId || !date) { setSlots([]); return; }
    let active = true; setLoadingSlots(true); setError('');
    const query = new URLSearchParams({ serviceId, locationId, from: date, to: date });
    if (professionalId) query.set('professionalUserId', professionalId);
    api<{ slots: Slot[] }>(`/public/practices/${practiceId}/availability?${query}`).then(async (result) => {
      if (!active) return;
      if (result.slots.length || dateManuallySet) { setSlots(result.slots); setSlot((current) => current && result.slots.some((item) => item.startsAt === current.startsAt) ? current : null); if (!restoredSlotHandled.current && draftSlotStart) { const restored = result.slots.find((item) => item.startsAt === draftSlotStart); if (restored) setSlot(restored); setDraftSlotStart(''); restoredSlotHandled.current = true; } return; }
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
      setSlots(result.slots); setSlot(null); if (!restoredSlotHandled.current && draftSlotStart) { const restored = result.slots.find((item) => item.startsAt === draftSlotStart); if (restored) setSlot(restored); setDraftSlotStart(''); restoredSlotHandled.current = true; }
    }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load available times.'); }).finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [practiceId, selectedService, serviceId, locationId, professionalId, date, dateManuallySet, data?.practice.timezone, draftSlotStart]);

  useEffect(() => {
    if (!draftReady || !data || confirmation) return;
    const draft: BookingDraft = { expiresAt: Date.now() + 30 * 60_000, step, professionId, serviceId, locationId, professionalId, date, slotStart: slot?.startsAt ?? draftSlotStart, guestName, guestEmail, guestPhone };
    try { sessionStorage.setItem(`ayushman.booking-draft.${practiceId}`, JSON.stringify(draft)); } catch { /* Continue without recovery when browser storage is disabled. */ }
  }, [draftReady, data, confirmation, practiceId, step, professionId, serviceId, locationId, professionalId, date, slot, draftSlotStart, guestName, guestEmail, guestPhone]);

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
    if (!slot) { setError('Choose an available time first.'); return; }
    if (!customer) {
      if (!data?.practice.guestBookingEnabled) { setError('Sign in to your customer account before booking.'); return; }
      setError(''); setStep(4); return;
    }
    setSaving(true); setError('');
    try {
      const payload = { serviceId, locationId, professionalUserId: slot.professional.id, startsAt: slot.startsAt };
      const idempotency = await idempotencyKeyFor('hold', payload);
      const result = await api<{ hold: { id: string; startsAt: string; expiresAt: string; serviceName: string } }>(`/public/practices/${practiceId}/booking-holds`, {
        method: 'POST', headers: { 'Idempotency-Key': idempotency.key },
        body: JSON.stringify(payload),
      });
      clearIdempotencyKey(idempotency.storageKey, idempotency.fallbackKey);
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
    const guest = !customer && Boolean(data?.practice.guestBookingEnabled);
    if (!selectedService || !slot || (!guest && (!customer || !hold || holdSeconds <= 0))) { setError('Your time hold has expired. Choose an available time again.'); return; }
    if (guest && !guestEmail.trim() && !guestPhone) { setError('Add an email address or phone number so the practice can contact you.'); return; }
    if (guest && guestName.trim().length < 2) { setError('Enter your name to continue.'); return; }
    setSaving(true); setError('');
    const payload = { serviceId, locationId, professionalUserId: slot.professional.id, startsAt: slot.startsAt, ...(!guest && hold ? { holdId: hold.id } : {}), ...(guest ? { fullName: guestName.trim(), ...(guestEmail.trim() ? { email: guestEmail.trim() } : {}), ...(guestPhone ? { phone: guestPhone } : {}) } : {}), ...(note ? { note } : {}) };
    let idempotency: { key: string; storageKey: string; fallbackKey?: string } | undefined;
    try {
      idempotency = await idempotencyKeyFor('booking', payload);
      const result = await api<{ appointment: { id: string; status: string; startsAt: string } }>(`/public/practices/${practiceId}/${guest ? 'guest-bookings' : 'bookings'}`, {
        method: 'POST', headers: { 'Idempotency-Key': idempotency.key },
        body: JSON.stringify(payload),
      });
      clearIdempotencyKey(idempotency.storageKey, idempotency.fallbackKey);
      setHold(null);
      setConfirmation(result.appointment);
      try { sessionStorage.removeItem(`ayushman.booking-draft.${practiceId}`); } catch { /* Storage can be disabled. */ }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 409) {
        if (idempotency) clearIdempotencyKey(idempotency.storageKey, idempotency.fallbackKey);
        await returnToTimeSelection(cause.message);
      }
      else setError(cause instanceof Error ? cause.message : 'Could not complete your booking.');
    }
    finally { setSaving(false); }
  }

  const money = selectedService?.priceMinor === null || selectedService?.priceMinor === undefined ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: selectedService.currency, maximumFractionDigits: 0 }).format(selectedService.priceMinor / 100);
  const timeLabel = (value: string) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: data?.practice.timezone }).format(new Date(value));

  if (loading) return <main className="booking-page"><BrandLoader label="Loading practice and available services…"/></main>;
  if (error && !data) return <main className="booking-page"><p className="form-error">{error}</p><Link href="/book">Search practices</Link></main>;
  if (!data || !data.practice.publicBookingEnabled) return <main className="booking-page"><h1>Online booking is unavailable</h1><p>This practice is not accepting online bookings right now.</p><Link href="/book">Find another practice</Link></main>;
  if (!customer && customerStatus === 'unavailable' && !data.practice.guestBookingEnabled) return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link><span>{data.practice.name}</span></header><section className="booking-confirmation"><p className="eyebrow">CUSTOMER ACCOUNT</p><h1>We couldn’t check your sign-in.</h1><p>Your account may still be active. Retry the check, or continue to customer sign in if the problem persists.</p><div className="customer-auth-actions"><button className="button button-primary" type="button" onClick={() => void refreshCustomerSession()}>Try again</button><Link className="button button-secondary" href={`/customer/login?returnTo=${encodeURIComponent(`/book?practiceId=${practiceId}`)}`}>Customer sign in</Link></div></section></main>;
  if (!customer && customerStatus !== 'checking' && !data.practice.guestBookingEnabled) {
    const returnTo = encodeURIComponent(`/book?practiceId=${practiceId}`);
    return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link></header><section className="booking-confirmation"><p className="eyebrow">CUSTOMER ACCOUNT</p><h1>{customerStatus === 'practice' ? 'Use a customer account to book' : 'Sign in before booking'}</h1><p>{customerStatus === 'practice' ? 'You’re signed in to a practice account. Customer bookings use a separate account; sign in or create one to continue.' : 'Sign in or create a customer account to book and keep appointments linked to your records.'}</p><div className="customer-auth-actions"><Link className="button button-primary" href={`/customer/login?returnTo=${returnTo}`}>Customer sign in</Link><Link className="button button-secondary" href={`/customer/register?returnTo=${returnTo}`}>Create customer account</Link></div></section></main>;
  }
  if (confirmation) return <main className="booking-page"><header className="booking-nav"><Link className="booking-brand" href="/book">✳ Ayushman</Link><span>{data.practice.name}</span></header><section className="booking-confirmation"><span className="booking-confirm-icon"><Check size={24}/></span><p className="eyebrow">{confirmation.status === 'pending' ? 'REQUEST SENT' : 'BOOKING CONFIRMED'}</p><h1>{confirmation.status === 'pending' ? 'Your request is with the practice.' : 'Your session is booked.'}</h1><p>{customer ? confirmation.status === 'pending' ? `${data.practice.name} will confirm this appointment. We’ll show its status in your account.` : `Your appointment at ${data.practice.name} is confirmed.` : confirmation.status === 'pending' ? `${data.practice.name} will confirm this appointment. Keep the reference below if you need to contact the practice.` : `Your appointment at ${data.practice.name} is confirmed. No customer account was created.`}</p><article className="booking-summary"><strong>{selectedService?.name}</strong><span><CalendarDays size={15}/>{timeLabel(confirmation.startsAt)}</span><span><UserRound size={15}/>{slot?.professional.name}</span><span><MapPin size={15}/>{selectedLocation?.name}</span><span><Clock3 size={15}/>{selectedService?.durationMinutes} minutes · {money}</span><small>Reference · {confirmation.id.slice(0, 8).toUpperCase()}</small></article><div className="booking-confirm-actions">{customer && <Link href="/customer/account" className="button button-primary">View my appointments <ArrowRight size={15}/></Link>}<Link href="/book" className="button button-secondary">Book another service</Link></div><p className="booking-confirm-footnote">{customer ? 'You can review this booking and any shared files from your customer account.' : 'Contact the practice directly if you need to change this booking.'}</p></section></main>;

  return <main className="booking-page">
    <header className="booking-nav"><Link className="booking-brand" href="/book"><span>✳</span> Ayushman</Link><div className="booking-nav-actions"><CustomerSessionLink/></div></header>
    <section className="booking-practice-head"><Link href="/book" className="booking-back"><ArrowLeft size={15}/> All practices</Link><p className="eyebrow">BOOK ONLINE</p><h1>{data.practice.name}</h1><p>{data.practice.description || 'Choose the service, location, professional, and time that work for you.'}</p></section>
    <div className="booking-layout"><nav className="booking-steps" aria-label="Booking steps">{['Service', 'Location & person', 'Date & time', 'Your details'].map((name, index) => <span className={step === index + 1 ? 'booking-step-active' : step > index + 1 ? 'booking-step-done' : ''} key={name}><b>{step > index + 1 ? '✓' : index + 1}</b>{name}</span>)}</nav>
      <section className="booking-panel">
        {step === 1 && <><p className="eyebrow">STEP 1 OF 4</p><h2>What would you like to book?</h2>{data.professions.length > 1 && <div className="booking-profession-tabs">{data.professions.map((profession) => <button className={profession.id === professionId ? 'selected' : ''} onClick={() => { setProfessionId(profession.id); setServiceId(''); }} key={profession.id}>{profession.name}</button>)}</div>}{services.length ? <div className="booking-service-list">{services.map((service) => <button className="booking-option-card" key={service.id} onClick={() => chooseService(service.id)}><span><strong>{service.name}</strong><small>{service.description || `${service.durationMinutes} minute session`}</small></span><span className="booking-option-meta"><b>{service.priceMinor === null ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: service.currency, maximumFractionDigits: 0 }).format(service.priceMinor / 100)}</b><ArrowRight size={17}/></span></button>)}</div> : <div className="booking-empty"><p>No services are available to book online right now.</p><small>The practice has no active online services at this branch right now. Contact the practice or browse other services.</small><Link href="/book" className="button button-secondary">Browse other practices</Link></div>}</>}
        {step === 2 && selectedService && <><p className="eyebrow">STEP 2 OF 4</p><h2>Choose a location and {professionalTerm}</h2><label className="booking-field"><span><MapPin size={15}/> Location</span><Select value={locationId} onChange={(value) => { setLocationId(value); setProfessionalId(''); setSlot(null); }} options={selectedService.locations.map((location) => ({ value: location.id, label: location.name }))} placeholder="Choose a location" ariaLabel="Choose a location"/></label><label className="booking-field"><span><UserRound size={15}/> {professionalTerm}</span><Select value={professionalId} onChange={(value) => { setProfessionalId(value); setSlot(null); }} options={[{ value: '', label: `Any available ${professionalTerm}` }, ...eligibleProfessionals.map((person) => ({ value: person.id, label: `${person.name}${person.headline ? ` · ${person.headline}` : ''}` }))]} placeholder={`Choose a ${professionalTerm}`} ariaLabel={`Choose a ${professionalTerm}`}/></label><div className="booking-summary compact"><strong>{selectedService.name}</strong><span><Clock3 size={15}/>{selectedService.durationMinutes} minutes · {money}</span></div><button className="button button-primary" onClick={() => setStep(3)} disabled={!locationId || eligibleProfessionals.length === 0}>Choose date and time <ArrowRight size={15}/></button></>}
        {step === 3 && selectedService && <><p className="eyebrow">STEP 3 OF 4</p><h2>Pick a time that works</h2><label className="booking-field"><span><CalendarDays size={15}/> Date</span><DatePicker min={bookingToday} max={bookingLastDate} today={bookingToday} disabledDates={availableBookingDates ? Array.from({ length: 31 }, (_, index) => addDays(bookingToday, index)).filter((item) => !availableBookingDates.includes(item)) : undefined} value={date} onChange={(value) => { setDateManuallySet(true); setDate(value); }} ariaLabel="Choose appointment date"/></label><p className="booking-timezone">Times shown in {data.practice.timezone}</p>{loadingSlots ? <p className="booking-empty">Finding available times…</p> : slots.length ? <div className="booking-slot-grid">{slots.map((item) => <button className={slot?.startsAt === item.startsAt ? 'selected' : ''} key={`${item.professional.id}-${item.startsAt}`} onClick={() => setSlot(item)}><strong>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: data.practice.timezone }).format(new Date(item.startsAt))}</strong>{professionalId === '' && <small>{item.professional.name}</small>}</button>)}</div> : <p className="booking-empty">No times are available on this date. Try another date or choose a different {professionalTerm}.</p>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" onClick={() => void acquireBookingHold()} disabled={!slot || saving}>{saving ? 'Reserving this time…' : `Continue with ${slot ? timeLabel(slot.startsAt) : 'a selected time'}`} <ArrowRight size={15}/></button></>}
        {step === 4 && selectedService && slot && (hold || (!customer && data.practice.guestBookingEnabled)) && <form className="booking-form" onSubmit={(event) => void submitBooking(event)}><p className="eyebrow">STEP 4 OF 4</p><h2>Review your appointment</h2>{hold ? holdSeconds > 0 ? <p className="booking-hold-banner" role="timer"><Clock3 size={16}/> This time is held for you for <strong>{Math.floor(holdSeconds / 60)}:{String(holdSeconds % 60).padStart(2, '0')}</strong>. Confirm before the timer ends.</p> : <div className="booking-hold-expired" role="alert"><strong>Your time hold has expired.</strong><span>This time may now be available to someone else. Choose a time again to continue.</span><button className="button button-secondary" type="button" onClick={() => void returnToTimeSelection()}>Choose another time</button></div> : <p className="booking-helper">No account is needed. Your contact details are used to create this booking only. The time is checked again when you confirm.</p>}{customer ? <p className="booking-helper">Booking for {customer.fullName} · {customer.email}. Update your contact details in <Link href="/customer/account">your customer profile</Link>.</p> : <><label>Your name<input required minLength={2} maxLength={160} autoComplete="name" value={guestName} onChange={(event) => setGuestName(event.target.value)}/></label><label>Email address <span className="optional">Add email or phone</span><input type="email" maxLength={320} autoComplete="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)}/></label><label>Phone number <span className="optional">Add email or phone</span><PhoneField value={guestPhone} onChange={setGuestPhone}/></label></>}<label>Note for the practice <span className="optional">Optional</span><textarea maxLength={1000} rows={3} value={note} onChange={(event) => setNote(event.target.value)}/></label><div className="booking-summary compact"><strong>{selectedService.name}</strong><span><CalendarDays size={15}/>{timeLabel(slot.startsAt)}</span><span><UserRound size={15}/>{slot.professional.name}</span><span><MapPin size={15}/>{selectedLocation?.name}</span><b>{money}</b></div>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={saving || (hold ? holdSeconds <= 0 : false)}>{saving ? 'Confirming booking…' : 'Confirm booking'} <Check size={16}/></button>{hold ? <button className="booking-hold-release" type="button" onClick={() => void returnToTimeSelection()}>Release this time and choose another</button> : <button className="booking-hold-release" type="button" onClick={() => { setError(''); setStep(3); }}>Choose another time</button>}</form>}
        {error && step !== 3 && step !== 4 && <p className="form-error" role="alert">{error}</p>}
        {step > 1 && !confirmation && !(step === 4 && hold && holdSeconds <= 0) && <button className="booking-back-button" onClick={() => { if (step === 4 && hold) void releaseBookingHold(); setError(''); setStep((value) => value - 1); }}><ArrowLeft size={15}/> Back</button>}
      </section>
    </div>
    <footer className="booking-footer"><Link href="/book">Find another service</Link></footer>
  </main>;
}
