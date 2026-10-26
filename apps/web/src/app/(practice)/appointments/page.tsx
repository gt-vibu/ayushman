'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { CalendarDays, CalendarPlus, Check, ChevronRight, Clock3, LoaderCircle, MessageSquareText, Plus, Search } from 'lucide-react';
import { appointmentsQuery } from '@/lib/url';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import type { Appointment, Branch, Client, Service, StaffMember } from '@/lib/types';
import { appointmentStatusLabel } from '@/lib/types';
import { Dialog } from '@/components/dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/app-shell';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { DatePicker } from '@/components/ui/date-picker';
import { SessionRecordingPanel } from '@/components/session-recording-panel';
import { useSearchParams } from 'next/navigation';
import { PhoneField } from '@/components/ui/phone-field';
import { ManualAppointmentInput } from '@ayushman-v2/contracts';

const nextStep: Record<string, { label: string; hint: string; status: Appointment['status']; permission: string }> = {
  pending: { label: 'Confirm appointment', hint: 'Review the request and confirm the time.', status: 'confirmed', permission: 'appointments.update' },
  confirmed: { label: 'Start visit', hint: 'Arrival is recorded automatically when you start.', status: 'in_progress', permission: 'appointments.complete' },
  checked_in: { label: 'Start visit', hint: 'The customer has arrived. Begin when ready.', status: 'in_progress', permission: 'appointments.complete' },
  in_progress: { label: 'Complete appointment', hint: 'Finish the visit and close the appointment.', status: 'completed', permission: 'appointments.complete' },
};
type Slot = { startsAt: string; endsAt: string; professional: { id: string; name: string } };
type VisitTypeFilter = 'all' | 'appointments' | 'follow_ups';
const practiceDate = (timezone: string, offsetDays = 0) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const date = new Date(`${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
};

export default function AppointmentsPage() {
  const { practice, branchId, branches, permissions, session } = usePractice();
  const [filter, setFilter] = useState('all'); const [visitType, setVisitType] = useState<VisitTypeFilter>('all'); const [search, setSearch] = useState(''); const [selected, setSelected] = useState<Appointment | null>(null); const [staff, setStaff] = useState<StaffMember[]>([]);
  const url = useMemo(() => practicePath(practice.id, appointmentsQuery(branchId, 30, 200, 365)), [practice.id, branchId]);
  const { data, loading, error, reload } = useApiData<Appointment[]>(url);
  const [updatingId, setUpdatingId] = useState(''); const [actionError, setActionError] = useState('');
  const [newVisitOpen, setNewVisitOpen] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => { if (searchParams.get('newVisit') === '1') setNewVisitOpen(true); }, [searchParams]);
  const loadTeam = useCallback(() => api<StaffMember[]>(practicePath(practice.id, '/staff')).then(setStaff).catch(() => setStaff([])), [practice.id]);
  useEffect(() => { void loadTeam(); }, [loadTeam]);
  const rows = (data ?? []).filter((row) => (filter === 'all' || row.status === filter)
    && (visitType === 'all' || (visitType === 'follow_ups' ? Boolean(row.isFollowUp || row.followUpToAppointmentId) : !row.isFollowUp && !row.followUpToAppointmentId))
    && `${row.clientName} ${row.serviceName}`.toLowerCase().includes(search.toLowerCase()));
  const pagination = usePaginatedItems(rows, `${filter}:${visitType}:${search}`);
  async function advance(row: Appointment, keepDetailsOpen = false, targetStatus?: Appointment['status']) { const action = targetStatus ? { status: targetStatus } : nextStep[row.status]; if (!action) return; setUpdatingId(row.id); setActionError(''); try { const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${row.id}/status`), { method: 'POST', body: JSON.stringify({ status: action.status }) }); if (keepDetailsOpen) setSelected((current) => current?.id === row.id ? { ...current, status: updated.status } : current); else setSelected(null); reload(); } catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Could not update this appointment.'); } finally { setUpdatingId(''); } }
  function dateTime(row: Appointment) { return new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', timeZone: row.timezone || practice.timezone }).format(new Date(row.startsAt)); }
  function time(row: Appointment) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: row.timezone || practice.timezone }).format(new Date(row.startsAt)); }
  return <><PageHeader eyebrow="SCHEDULING" title="Appointments" description="Review the customer, service, time, and next step for every booking." action={<div className="inline-actions"><span className="count-pill">{data?.length ?? '—'} loaded</span>{permissions['appointments.create'] && <button className="button button-primary" onClick={() => setNewVisitOpen(true)}><Plus size={15}/>New visit</button>}</div>}/>
    <section className="section-card resource-card"><div className="filter-bar"><label className="field-search"><Search size={17}/><input aria-label="Search appointments" placeholder="Search by customer or service" value={search} onChange={(event) => setSearch(event.target.value)}/></label><DropdownSelect className="select-control" value={visitType} onChange={(event) => setVisitType(event.target.value as VisitTypeFilter)} aria-label="Filter by visit type"><option value="all">All visit types</option><option value="appointments">Appointments</option><option value="follow_ups">Follow-ups</option></DropdownSelect><DropdownSelect className="select-control" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Filter by status"><option value="all">All statuses</option>{Object.entries(appointmentStatusLabel).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</DropdownSelect></div>
      {actionError && <p className="form-error" role="alert">{actionError}</p>}
      {loading ? <LoadingState/> : error ? <ErrorState message={error}/> : rows.length === 0 ? <EmptyState title={visitType === 'follow_ups' ? 'No follow-ups found' : 'No appointments or visits yet'} description={visitType === 'follow_ups' ? 'Scheduled follow-up visits will appear here.' : 'Record an in-person walk-in or schedule a visit. Clients do not need to create an account.'} icon={CalendarDays}/> : <><div className="table-wrap"><table className="appointments-table"><thead><tr><th>Customer</th><th>Service / visit</th><th>Date & time</th><th>Progress</th><th>Next step</th></tr></thead><tbody>{pagination.pageItems.map((row) => { const action = nextStep[row.status]; const allowedAction = action && permissions[action.permission]; const branch = branches.find((item) => item.id === row.locationId); const practitioner = staff.find((member) => member.userId === row.professionalUserId); const outstanding = row.priceMinor != null && row.amountPaidMinor != null ? Math.max(0, row.priceMinor - row.amountPaidMinor) : null; return <tr key={row.id}><td data-label="Customer"><button className="table-detail-button" onClick={() => setSelected(row)}><strong>{row.clientName}</strong><small>{row.clientEmail || row.clientPhone || 'Practice client'}</small><small className="table-subtext">Open details</small>{row.clientNote && <em><MessageSquareText size={12}/> Customer note</em>}</button></td><td data-label="Service / visit"><span className="appointment-service-label">{row.serviceName}{(row.isFollowUp || row.followUpToAppointmentId) && <span className="follow-up-tag">Follow-up</span>}{row.hasFollowUp && <span className="follow-up-tag follow-up-scheduled-tag">Follow-up scheduled</span>}</span><small className="table-subtext">{row.isWalkIn ? 'Walk-in' : 'Appointment'} · {branch?.name ?? 'Practice location'} · {practitioner?.fullName ?? 'Practitioner'}</small>{row.followUpSource && <small className="follow-up-context">For {row.followUpSource.serviceName} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: row.followUpSource.timezone || practice.timezone }).format(new Date(row.followUpSource.startsAt))}</small>}{outstanding !== null && outstanding > 0 && <small className="table-subtext">Balance due: {new Intl.NumberFormat(undefined, { style: 'currency', currency: row.currency || practice.currency, maximumFractionDigits: 2 }).format(outstanding / 100)}</small>}</td><td data-label="Date & time"><span className="time-cell"><CalendarDays size={14}/>{dateTime(row)}</span></td><td data-label="Progress"><span className="progress-cell"><StatusBadge status={appointmentStatusLabel[row.status]}/>{allowedAction && <small>{action.hint}</small>}</span></td><td data-label="Next step"><div className="appointment-next-actions">{allowedAction && <button className="button button-primary appointment-action" disabled={updatingId === row.id} onClick={() => void advance(row)}>{updatingId === row.id ? 'Saving…' : <><Check size={13}/>{action.label}<ChevronRight size={13}/></>}</button>}{row.status === 'confirmed' && permissions['appointments.check_in'] && <button className="appointment-check-in" disabled={updatingId === row.id} onClick={() => void advance(row, false, 'checked_in')}>Check in only</button>}</div></td></tr>; })}</tbody></table></div><Pagination total={rows.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/></>}
      <p className="table-footnote">Start the visit directly, or check the customer in first. Complete the appointment when the visit is finished.</p>
    </section>
    <Dialog open={Boolean(selected)} title={selected?.clientName ?? 'Appointment details'} description="The booking details and any note shared by the customer." onClose={() => setSelected(null)}>{selected && <AppointmentDetails appointment={selected} practice={practice} branches={branches} staff={staff} permissions={permissions} advance={advance} updating={updatingId === selected.id} dateTime={dateTime} time={time} onCreated={(updated) => { reload(); if (updated) setSelected((current) => current ? { ...current, ...updated } : current); }}/>}</Dialog>
    <NewVisitDialog key={newVisitOpen ? 'new-visit-open' : 'new-visit-closed'} open={newVisitOpen} practiceId={practice.id} currency={practice.currency} branchId={branchId} branches={branches} staff={staff} userId={session.user.id} onClose={() => setNewVisitOpen(false)} onCreated={() => { setNewVisitOpen(false); reload(); }}/>
  </>;
}

function NewVisitDialog({ open, practiceId, currency, branchId, branches, staff, userId, onClose, onCreated }: { open: boolean; practiceId: string; currency: string; branchId: string; branches: Branch[]; staff: StaffMember[]; userId: string; onClose: () => void; onCreated: () => void }) {
  const submissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const draftKey = `ayushman:manual-visit:${practiceId}:${userId}`;
  const [draftReady, setDraftReady] = useState(false);
  const [clients, setClients] = useState<Client[]>([]); const [services, setServices] = useState<Service[]>([]);
  const [clientId, setClientId] = useState(''); const [serviceId, setServiceId] = useState(''); const [locationId, setLocationId] = useState(branchId || branches[0]?.id || ''); const [professionalUserId, setProfessionalUserId] = useState(userId);
  const [startsAt, setStartsAt] = useState(() => { const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); return now.toISOString().slice(0, 16); });
  const [isWalkIn, setIsWalkIn] = useState(true); const [historicalEntry, setHistoricalEntry] = useState(false); const [description, setDescription] = useState(''); const [note, setNote] = useState(''); const [paid, setPaid] = useState('0'); const [paymentMethod, setPaymentMethod] = useState('cash');
  const [duration, setDuration] = useState('30'); const [price, setPrice] = useState('');
  const [newClient, setNewClient] = useState(false); const [clientName, setClientName] = useState(''); const [clientEmail, setClientEmail] = useState(''); const [clientPhone, setClientPhone] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.sessionStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { savedAt?: number; form?: Record<string, unknown>; submissionKey?: { fingerprint: string; key: string } | null };
        if (typeof draft.savedAt === 'number' && Date.now() - draft.savedAt < 2 * 60 * 60_000 && draft.form) {
          const form = draft.form;
          if (typeof form.clientId === 'string') setClientId(form.clientId);
          if (typeof form.serviceId === 'string') setServiceId(form.serviceId);
          if (typeof form.locationId === 'string') setLocationId(form.locationId);
          if (typeof form.professionalUserId === 'string') setProfessionalUserId(form.professionalUserId);
          if (typeof form.startsAt === 'string') setStartsAt(form.startsAt);
          if (typeof form.isWalkIn === 'boolean') setIsWalkIn(form.isWalkIn);
          if (typeof form.historicalEntry === 'boolean') setHistoricalEntry(form.historicalEntry);
          if (typeof form.description === 'string') setDescription(form.description);
          if (typeof form.note === 'string') setNote(form.note);
          if (typeof form.paid === 'string') setPaid(form.paid);
          if (typeof form.paymentMethod === 'string') setPaymentMethod(form.paymentMethod);
          if (typeof form.duration === 'string') setDuration(form.duration);
          if (typeof form.price === 'string') setPrice(form.price);
          if (typeof form.newClient === 'boolean') setNewClient(form.newClient);
          if (typeof form.clientName === 'string') setClientName(form.clientName);
          if (typeof form.clientEmail === 'string') setClientEmail(form.clientEmail);
          if (typeof form.clientPhone === 'string') setClientPhone(form.clientPhone);
          submissionKey.current = draft.submissionKey ?? null;
        } else {
          window.sessionStorage.removeItem(draftKey);
        }
      }
    } catch { try { window.sessionStorage.removeItem(draftKey); } catch { /* Storage is optional. */ } }
    setDraftReady(true);
  }, [draftKey, open]);
  useEffect(() => {
    if (!open || !draftReady) return;
    try {
      window.sessionStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), form: { clientId, serviceId, locationId, professionalUserId, startsAt, isWalkIn, historicalEntry, description, note, paid, paymentMethod, duration, price, newClient, clientName, clientEmail, clientPhone }, submissionKey: submissionKey.current }));
    } catch { /* Private browsing may disable session storage; the form remains usable. */ }
  }, [clientId, serviceId, locationId, professionalUserId, startsAt, isWalkIn, historicalEntry, description, note, paid, paymentMethod, duration, price, newClient, clientName, clientEmail, clientPhone, draftKey, draftReady, open]);
  function resetForm() {
    try { window.sessionStorage.removeItem(draftKey); } catch { /* Storage is optional. */ } submissionKey.current = null; setDraftReady(false);
    setClientId(''); setNewClient(false); setClientName(''); setClientEmail(''); setClientPhone('');
    setServiceId(services[0]?.id ?? ''); setDuration(String(services[0]?.durationMinutes ?? 30)); setPrice('');
    setLocationId(branchId || branches[0]?.id || ''); setProfessionalUserId(userId);
    const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000); setStartsAt(now.toISOString().slice(0, 16));
    setIsWalkIn(true); setHistoricalEntry(false); setDescription(''); setNote(''); setPaid('0'); setPaymentMethod('cash'); setError('');
  }
  useEffect(() => { if (!open) return; void Promise.all([api<Client[]>(practicePath(practiceId, '/clients?limit=200')), api<Service[]>(practicePath(practiceId, '/services'))]).then(([nextClients, nextServices]) => { const active = nextServices.filter((item) => item.active); setClients(nextClients); setServices(active); if (!serviceId && active[0]) { setServiceId(active[0].id); setDuration(String(active[0].durationMinutes)); } }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Could not load clients and services.')); }, [open, practiceId]);
  const eligibleStaff = staff.filter((item) => item.roles.includes('professional'));
  const service = services.find((item) => item.id === serviceId);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      if ((!newClient && !clientId) || (newClient && !clientName.trim()) || !serviceId || !locationId || !professionalUserId) throw new Error('Choose a client, service, location, and practitioner.');
      const amountPaidMinor = Math.round((Number(paid || 0)) * 100);
      const start = new Date(startsAt);
      if (!Number.isFinite(start.getTime())) throw new Error('Enter a valid visit date and time.');
      const payload = { ...(newClient ? { newClient: { fullName: clientName, ...(clientEmail.trim() ? { email: clientEmail.trim() } : {}), ...(clientPhone ? { phone: clientPhone } : {}) } } : { clientId }), serviceId, locationId, professionalUserId, startsAt: start.toISOString(), isWalkIn, historicalEntry, durationMinutes: Number(duration), priceMinor: price.trim() ? Math.round(Number(price) * 100) : service?.priceMinor ?? null, ...(description.trim() ? { visitDescription: description.trim() } : {}), amountPaidMinor, ...(amountPaidMinor ? { paymentMethod } : {}), ...(note.trim() ? { note: note.trim() } : {}) };
      const parsed = ManualAppointmentInput.safeParse(payload);
      if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? 'Check the visit details and try again.');
      const visitPrice = parsed.data.priceMinor ?? service?.priceMinor ?? null;
      if (visitPrice !== null && parsed.data.amountPaidMinor > visitPrice) throw new Error('Payment received cannot exceed the visit rate.');
      const fingerprint = JSON.stringify(parsed.data);
      if (!submissionKey.current || submissionKey.current.fingerprint !== fingerprint) submissionKey.current = { fingerprint, key: crypto.randomUUID() };
      try { window.sessionStorage.setItem(draftKey, JSON.stringify({ savedAt: Date.now(), form: { clientId, serviceId, locationId, professionalUserId, startsAt, isWalkIn, historicalEntry, description, note, paid, paymentMethod, duration, price, newClient, clientName, clientEmail, clientPhone }, submissionKey: submissionKey.current })); } catch { /* Continue; the API request still has an in-memory retry key. */ }
      await api(practicePath(practiceId, '/appointments/manual'), { method: 'POST', headers: { 'Idempotency-Key': submissionKey.current.key }, body: fingerprint });
      submissionKey.current = null;
      resetForm();
      onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not record this visit.'); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} title="Record a visit" description="Add a walk-in or schedule a visit. The client does not need an Ayushman account. An unfinished draft stays in this browser tab for up to two hours." onClose={onClose}>
    <form className="dialog-form" onSubmit={submit}>
      <label className="check-row"><input type="checkbox" checked={newClient} onChange={(event) => { setNewClient(event.target.checked); setError(''); }}/>Add a new client</label>
      {newClient ? <><label>Client name<input required minLength={2} maxLength={160} value={clientName} onChange={(event) => setClientName(event.target.value)}/></label><div className="form-grid"><label>Email (optional)<input type="email" maxLength={320} value={clientEmail} onChange={(event) => setClientEmail(event.target.value)}/></label><label>Phone (optional)<PhoneField value={clientPhone} onChange={setClientPhone}/></label></div><p className="field-hint">Contact details are optional. Search by name next time if they do not have a phone or email.</p></> : <label>Client<DropdownSelect required value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Choose an existing client</option>{clients.map((item) => <option value={item.id} key={item.id}>{item.fullName}{item.email || item.phone ? ` · ${item.email || item.phone}` : ''}</option>)}</DropdownSelect></label>}
      <div className="form-grid"><label>Service<DropdownSelect required value={serviceId} onChange={(event) => { setServiceId(event.target.value); const chosen = services.find((item) => item.id === event.target.value); if (chosen) setDuration(String(chosen.durationMinutes)); setPrice(''); }}><option value="">Choose a service</option>{services.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</DropdownSelect></label><label>Practitioner<DropdownSelect required value={professionalUserId} onChange={(event) => setProfessionalUserId(event.target.value)}>{eligibleStaff.map((item) => <option value={item.userId} key={item.userId}>{item.fullName}</option>)}</DropdownSelect></label></div>
      <label>Location<DropdownSelect required value={locationId} onChange={(event) => setLocationId(event.target.value)}>{branches.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</DropdownSelect></label>
      <label className="check-row"><input type="checkbox" checked={isWalkIn} onChange={(event) => { setIsWalkIn(event.target.checked); if (!event.target.checked) setHistoricalEntry(false); }}/>This is a walk-in</label>
      {isWalkIn && <label className="check-row"><input type="checkbox" checked={historicalEntry} onChange={(event) => setHistoricalEntry(event.target.checked)}/>This visit already happened <small>Save as completed with actual visit times.</small></label>}
      <label>{isWalkIn ? 'Visit time' : 'Appointment time'}<input required type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)}/></label>
      <div className="form-grid"><label>Duration (minutes)<input type="number" min={5} max={720} required value={duration} onChange={(event) => setDuration(event.target.value)}/></label><label>Visit rate ({currency})<input type="number" min={0} max="21474836.47" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} placeholder={service?.priceMinor == null ? 'No set rate' : (service.priceMinor / 100).toFixed(2)}/></label></div>
      <label>Visit details <small>Optional</small><textarea rows={2} maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Short description, e.g. blood pressure check"/></label>
      <div className="form-grid"><label>Payment received ({currency})<input type="number" min={0} max={price.trim() ? Number(price) : service?.priceMinor == null ? 21474836.47 : service.priceMinor / 100} step="0.01" value={paid} onChange={(event) => setPaid(event.target.value)}/></label>{Number(paid) > 0 && <label>Payment method<DropdownSelect value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>{[['cash','Cash'],['upi','UPI'],['card','Card'],['bank_transfer','Bank transfer'],['insurance','Insurance'],['other','Other']].map(([value,label]) => <option value={value} key={value}>{label}</option>)}</DropdownSelect></label>}</div>
      <label>Private note <small>Optional</small><textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)}/></label>
      {error && <p className="form-error" role="alert">{error}</p>}<footer className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving || !services.length || !branches.length}>{saving ? 'Saving…' : 'Record visit'}</button></footer>
    </form>
  </Dialog>;
}

function AppointmentDetails({ appointment, practice, branches, staff, permissions, advance, updating, dateTime, time, onCreated }: {
  appointment: Appointment; practice: ReturnType<typeof usePractice>['practice']; branches: ReturnType<typeof usePractice>['branches']; staff: StaffMember[]; permissions: Record<string, boolean>;
  advance: (row: Appointment, keepDetailsOpen?: boolean, targetStatus?: Appointment['status']) => Promise<void>; updating: boolean; dateTime: (row: Appointment) => string; time: (row: Appointment) => string; onCreated: (updated?: Appointment) => void;
}) {
  const followUpSubmissionKey = useRef<{ fingerprint: string; key: string } | null>(null);
  const canSchedule = permissions['appointments.create'] && ['checked_in', 'in_progress', 'completed', 'interrupted'].includes(appointment.status);
  const canChangeDeliveredService = permissions['appointments.complete'] && ['checked_in', 'in_progress'].includes(appointment.status);
  const [open, setOpen] = useState(false); const [services, setServices] = useState<Service[]>([]); const [serviceId, setServiceId] = useState(appointment.serviceId); const [locationId, setLocationId] = useState(appointment.locationId);
  const [serviceChangeId, setServiceChangeId] = useState(''); const [serviceChangeReason, setServiceChangeReason] = useState(''); const [interruptionReason, setInterruptionReason] = useState('');
  const [moveOpen, setMoveOpen] = useState(false); const [moveDate, setMoveDate] = useState(''); const [moveSlots, setMoveSlots] = useState<Slot[]>([]); const [moveSlot, setMoveSlot] = useState(''); const [moveBusy, setMoveBusy] = useState(false);
  const [reassignOpen, setReassignOpen] = useState(false); const [reassignProfessionalId, setReassignProfessionalId] = useState(''); const [reassignDate, setReassignDate] = useState(''); const [reassignSlots, setReassignSlots] = useState<Slot[]>([]); const [reassignSlot, setReassignSlot] = useState(''); const [reassignReason, setReassignReason] = useState(''); const [reassignBusy, setReassignBusy] = useState(false);
  const [date, setDate] = useState(practiceDate(practice.timezone, 7)); const [slots, setSlots] = useState<Slot[]>([]); const [slot, setSlot] = useState(''); const [note, setNote] = useState(''); const [loadingSlots, setLoadingSlots] = useState(false); const [loadingServices, setLoadingServices] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  const [paidAmount, setPaidAmount] = useState(((appointment.amountPaidMinor ?? 0) / 100).toFixed(2)); const [paidMethod, setPaidMethod] = useState(appointment.paymentMethod ?? 'cash');
  const [followUpConfirmation, setFollowUpConfirmation] = useState<{ serviceName: string; startsAt: string } | null>(null);
  const [linkFollowUpOpen, setLinkFollowUpOpen] = useState(false); const [followUpSources, setFollowUpSources] = useState<Array<{ id: string; serviceName: string; startsAt: string; timezone: string }>>([]); const [sourceAppointmentId, setSourceAppointmentId] = useState(''); const [loadingSources, setLoadingSources] = useState(false);
  const [correctionOpen, setCorrectionOpen] = useState(false); const [correctionStatus, setCorrectionStatus] = useState<'confirmed'|'checked_in'|'in_progress'|'completed'>(appointment.status === 'no_show' ? 'checked_in' : 'in_progress'); const [correctionReason, setCorrectionReason] = useState('');
  const followUpDraftKey = `ayushman:follow-up:${practice.id}:${appointment.id}`;
  const [followUpDraftReady, setFollowUpDraftReady] = useState(false);
  useEffect(() => {
    if (!open) return;
    try {
      const raw = window.sessionStorage.getItem(followUpDraftKey);
      if (raw) {
        const draft = JSON.parse(raw) as { savedAt?: number; serviceId?: string; locationId?: string; date?: string; slot?: string; note?: string; submissionKey?: { fingerprint: string; key: string } | null };
        if (typeof draft.savedAt === 'number' && Date.now() - draft.savedAt < 2 * 60 * 60_000) {
          if (draft.serviceId) setServiceId(draft.serviceId);
          if (draft.locationId) setLocationId(draft.locationId);
          if (draft.date) setDate(draft.date);
          if (draft.slot) setSlot(draft.slot);
          if (typeof draft.note === 'string') setNote(draft.note);
          followUpSubmissionKey.current = draft.submissionKey ?? null;
        } else window.sessionStorage.removeItem(followUpDraftKey);
      }
    } catch { try { window.sessionStorage.removeItem(followUpDraftKey); } catch { /* Storage is optional. */ } }
    setFollowUpDraftReady(true);
  }, [followUpDraftKey, open]);
  useEffect(() => {
    if (!open || !followUpDraftReady) return;
    try { window.sessionStorage.setItem(followUpDraftKey, JSON.stringify({ savedAt: Date.now(), serviceId, locationId, date, slot, note, submissionKey: followUpSubmissionKey.current })); }
    catch { /* Private browsing may disable session storage; keep the form usable. */ }
  }, [open, followUpDraftReady, followUpDraftKey, serviceId, locationId, date, slot, note]);
  useEffect(() => {
    if (!open && !canChangeDeliveredService) return;
    let active = true;
    setLoadingServices(true);
    void api<Service[]>(practicePath(practice.id, '/services'))
      .then((result) => { if (active) setServices(result); })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load services.'); })
      .finally(() => { if (active) setLoadingServices(false); });
    return () => { active = false; };
  }, [open, canChangeDeliveredService, practice.id]);
  const eligibleServices = services.filter((service) => service.active && (!service.professionalUserIds?.length || service.professionalUserIds.includes(appointment.professionalUserId)));
  const deliveredServiceOptions = eligibleServices.filter((item) => item.id !== appointment.serviceId && item.practiceProfessionId === services.find((candidate) => candidate.id === appointment.serviceId)?.practiceProfessionId && (!item.locationIds?.length || item.locationIds.includes(appointment.locationId))).map((item) => ({ value: item.id, label: `${item.name} · ${item.durationMinutes} min · ${item.priceMinor == null ? 'price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: item.currency, maximumFractionDigits: 2 }).format(item.priceMinor / 100)}` }));
  const eligibleLocations = branches.filter((branch) => !eligibleServices.find((service) => service.id === serviceId)?.locationIds?.length || eligibleServices.find((service) => service.id === serviceId)?.locationIds?.includes(branch.id));
  const selectedFollowUpPayload = slot ? JSON.stringify({ sourceAppointmentId: appointment.id, clientId: appointment.clientId, serviceId, locationId, professionalUserId: appointment.professionalUserId, startsAt: slot, ...(note.trim() ? { note: note.trim() } : {}) }) : '';
  const retryingSavedFollowUp = Boolean(selectedFollowUpPayload && followUpSubmissionKey.current?.fingerprint === selectedFollowUpPayload);
  useEffect(() => {
    if (!open || !serviceId || !locationId || !date) return;
    let active = true; setLoadingSlots(true); setSlots([]); setError('');
    const query = new URLSearchParams({ serviceId, locationId, professionalUserId: appointment.professionalUserId, from: date, to: date });
    void api<{ slots: Slot[] }>(practicePath(practice.id, `/appointments/follow-up-availability?${query}`)).then((result) => { if (active) setSlots(result.slots); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load available times.'); }).finally(() => { if (active) setLoadingSlots(false); });
    return () => { active = false; };
  }, [open, serviceId, locationId, date, appointment.professionalUserId, practice.id]);
  async function create() {
    if (!slot) return; setSaving(true); setError('');
    try { const payload = { sourceAppointmentId: appointment.id, clientId: appointment.clientId, serviceId, locationId, professionalUserId: appointment.professionalUserId, startsAt: slot, ...(note.trim() ? { note: note.trim() } : {}) }; const fingerprint = JSON.stringify(payload); if (!followUpSubmissionKey.current || followUpSubmissionKey.current.fingerprint !== fingerprint) followUpSubmissionKey.current = { fingerprint, key: crypto.randomUUID() }; try { window.sessionStorage.setItem(followUpDraftKey, JSON.stringify({ savedAt: Date.now(), serviceId, locationId, date, slot, note, submissionKey: followUpSubmissionKey.current })); } catch { /* The API still receives an in-memory retry key. */ } const result = await api<{ appointment: { startsAt: string } }>(practicePath(practice.id, '/appointments/follow-up'), { method: 'POST', headers: { 'Idempotency-Key': followUpSubmissionKey.current.key }, body: fingerprint }); followUpSubmissionKey.current = null; try { window.sessionStorage.removeItem(followUpDraftKey); } catch { /* Storage is optional. */ } setFollowUpDraftReady(false); setFollowUpConfirmation({ serviceName: eligibleServices.find((service) => service.id === serviceId)?.name ?? 'Follow-up visit', startsAt: result.appointment.startsAt }); setSuccess(appointment.clientEmail || appointment.clientPhone ? 'Follow-up scheduled.' : 'Follow-up scheduled. This client has no contact details, so please confirm the time with them in person.'); setOpen(false); onCreated(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not schedule the follow-up.'); }
    finally { setSaving(false); }
  }
  async function loadFollowUpSources() {
    setLinkFollowUpOpen(true); setLoadingSources(true); setError(''); setSourceAppointmentId('');
    try { const result = await api<Array<{ id: string; serviceName: string; startsAt: string; timezone: string }>>(practicePath(practice.id, `/appointments/${appointment.id}/follow-up-sources`)); setFollowUpSources(result); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load previous visits.'); }
    finally { setLoadingSources(false); }
  }
  async function linkFollowUp() {
    if (!sourceAppointmentId) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/link-follow-up`), { method: 'POST', body: JSON.stringify({ sourceAppointmentId }) });
      const source = followUpSources.find((item) => item.id === sourceAppointmentId);
      setSuccess('This booking is now linked and labeled as a follow-up.'); setLinkFollowUpOpen(false);
      onCreated({ ...appointment, ...updated, followUpToAppointmentId: sourceAppointmentId, isFollowUp: true, followUpSource: source ?? null });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link this follow-up.'); }
    finally { setSaving(false); }
  }
  async function savePayment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/payment`), { method: 'POST', body: JSON.stringify({ amountPaidMinor: Math.round(Number(paidAmount || 0) * 100), paymentMethod: Number(paidAmount) > 0 ? paidMethod : null }) });
      setSuccess('Payment record updated.'); onCreated(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update payment.'); }
    finally { setSaving(false); }
  }
  async function changeServiceAtVisit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!serviceChangeId || serviceChangeReason.trim().length < 5) return;
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/service-change`), { method: 'POST', body: JSON.stringify({ serviceId: serviceChangeId, reason: serviceChangeReason.trim() }) });
      setServiceChangeReason(''); setSuccess('Service updated. The original and new service details are in the audit history.'); onCreated(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not change this service.'); }
    finally { setSaving(false); }
  }
  async function markInterrupted() {
    const reason = interruptionReason.trim();
    if (reason.length < 5) { setError('Add at least five characters to explain why the visit stopped.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/status`), { method: 'POST', body: JSON.stringify({ status: 'interrupted', reason }) });
      setInterruptionReason(''); setSuccess('Visit marked interrupted. It remains separate from completed and no-show visits.'); onCreated(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this visit.'); }
    finally { setSaving(false); }
  }
  async function correctStatus() {
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/correct-status`), { method: 'POST', body: JSON.stringify({ status: correctionStatus, reason: correctionReason }) });
      setSuccess('Appointment outcome corrected and added to the audit history.'); setCorrectionOpen(false); onCreated(updated);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not correct this appointment outcome.'); }
    finally { setSaving(false); }
  }
  async function loadMoveSlots(nextDate: string) { setMoveDate(nextDate); setMoveSlots([]); setMoveSlot(''); setError(''); if (!nextDate) return; setMoveBusy(true); try { const query = new URLSearchParams({ serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId: appointment.professionalUserId, from: nextDate, to: nextDate }); const result = await api<{ slots: Slot[] }>(practicePath(practice.id, `/appointments/${appointment.id}/reschedule-availability?${query}`)); setMoveSlots(result.slots); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load available times.'); } finally { setMoveBusy(false); } }
  async function moveAppointment() { if (!moveSlot) return; setMoveBusy(true); setError(''); try { const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/reschedule`), { method: 'POST', body: JSON.stringify({ startsAt: moveSlot }) }); setSuccess('Appointment moved. The customer has been notified.'); setMoveOpen(false); onCreated(updated); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move this appointment.'); } finally { setMoveBusy(false); } }
  async function loadReassignmentSlots(date: string, professionalUserId = reassignProfessionalId) {
    setReassignDate(date); setReassignSlot(''); setReassignSlots([]); setError('');
    if (!date || !professionalUserId) return;
    setReassignBusy(true);
    try { const query = new URLSearchParams({ serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId, from: date, to: date }); const result = await api<{ slots: Slot[] }>(practicePath(practice.id, `/appointments/${appointment.id}/reassignment-availability?${query}`)); setReassignSlots(result.slots); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load this practitioner’s available times.'); }
    finally { setReassignBusy(false); }
  }
  async function reassignAppointment() {
    if (!reassignSlot || reassignReason.trim().length < 5) return;
    setReassignBusy(true); setError('');
    try { const updated = await api<Appointment>(practicePath(practice.id, `/appointments/${appointment.id}/reassign`), { method: 'POST', body: JSON.stringify({ professionalUserId: reassignProfessionalId, startsAt: reassignSlot, reason: reassignReason.trim() }) }); setSuccess('Practitioner and time updated. In-app alerts were added for the customer and new practitioner.'); setReassignOpen(false); setReassignReason(''); onCreated(updated); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reassign this appointment.'); }
    finally { setReassignBusy(false); }
  }
  return <div className="appointment-detail"><div className="detail-summary"><span className="stat-icon tone-blush"><CalendarDays size={19}/></span><div><strong>{appointment.serviceName}{(appointment.isFollowUp || appointment.followUpToAppointmentId) && <span className="follow-up-tag">Follow-up</span>}</strong><span>{dateTime(appointment)}</span></div><StatusBadge status={appointmentStatusLabel[appointment.status]}/></div>
    {appointment.followUpSource && <aside className="appointment-relationship-card"><strong>Follow-up visit</strong><span>Scheduled after {appointment.followUpSource.serviceName} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appointment.followUpSource.timezone || practice.timezone }).format(new Date(appointment.followUpSource.startsAt))}</span></aside>}
    {appointment.hasFollowUp && <aside className="appointment-relationship-card"><strong>Follow-up scheduled</strong><span>{appointment.nextFollowUpStartsAt ? `Next visit · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appointment.timezone || practice.timezone }).format(new Date(appointment.nextFollowUpStartsAt))}` : 'A follow-up visit is linked to this appointment.'}</span></aside>}
    {permissions['appointments.update'] && !appointment.followUpToAppointmentId && !appointment.isFollowUp && ['pending', 'confirmed'].includes(appointment.status) && new Date(appointment.startsAt) > new Date() && <section className="follow-up-card"><div><h3><CalendarPlus size={16}/> Link this booking as a follow-up</h3><p>Use this when the next visit was booked or rescheduled separately. It will appear in the follow-up filter and customer history.</p></div><button className="button button-secondary" type="button" disabled={loadingSources || saving} onClick={() => void loadFollowUpSources()}>{loadingSources ? 'Loading…' : linkFollowUpOpen ? 'Refresh visits' : 'Choose previous visit'}</button>{linkFollowUpOpen && <div className="follow-up-form"><label>Previous visit<Select value={sourceAppointmentId} options={followUpSources.map((source) => ({ value: source.id, label: `${source.serviceName} · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: source.timezone || practice.timezone }).format(new Date(source.startsAt))}` }))} onChange={setSourceAppointmentId} placeholder={loadingSources ? 'Loading previous visits…' : 'Choose a previous visit'} ariaLabel="Choose previous visit"/></label>{!loadingSources && followUpSources.length === 0 && <small>No earlier checked-in or completed visit exists for this customer and practitioner.</small>}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={saving || loadingSources || !sourceAppointmentId} onClick={() => void linkFollowUp()}>{saving ? 'Linking…' : 'Link as follow-up'}</button></div>}</section>}
    {canChangeDeliveredService && <section className="follow-up-card"><div><h3>Service delivered</h3><p>If the visit needs a different service, choose the service actually provided and record why. A longer duration is rejected if it conflicts with the next booking.</p></div><form className="follow-up-form" onSubmit={(event) => void changeServiceAtVisit(event)}><label>Actual service<Select value={serviceChangeId} onChange={setServiceChangeId} options={deliveredServiceOptions} disabled={loadingServices} placeholder={loadingServices ? 'Loading services…' : 'Choose service delivered'} ariaLabel="Choose service actually delivered"/></label>{!loadingServices && deliveredServiceOptions.length === 0 && <small>No other active services are assigned to this practitioner at this branch.</small>}<label>Reason (required)<textarea rows={2} minLength={5} maxLength={500} value={serviceChangeReason} onChange={(event) => setServiceChangeReason(event.target.value)} placeholder="For example, the customer's needs changed during the visit"/></label><button type="submit" className="button button-secondary" disabled={saving || loadingServices || !serviceChangeId || serviceChangeReason.trim().length < 5}>{saving ? 'Updating…' : 'Update service delivered'}</button></form></section>}
    {permissions['appointments.complete'] && appointment.status === 'in_progress' && <section className="follow-up-card"><div><h3>Visit stopped before completion</h3><p>Record an interruption with a reason. It will remain distinct from a completed or no-show visit.</p></div><label>Reason (required)<textarea rows={2} minLength={5} maxLength={240} value={interruptionReason} onChange={(event) => setInterruptionReason(event.target.value)} placeholder="For example, the customer needed urgent assistance elsewhere"/></label><button className="button button-secondary" type="button" disabled={saving || interruptionReason.trim().length < 5} onClick={() => void markInterrupted()}>{saving ? 'Saving…' : 'Mark visit interrupted'}</button></section>}
    <dl className="detail-list"><div><dt>Customer</dt><dd>{appointment.clientName}</dd></div><div><dt>Email</dt><dd>{appointment.clientEmail || 'Not provided'}</dd></div><div><dt>Phone</dt><dd>{appointment.clientPhone || 'Not provided'}</dd></div><div><dt>Time</dt><dd><Clock3 size={14}/>{time(appointment)} – {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: appointment.timezone || practice.timezone }).format(new Date(appointment.endsAt))}</dd></div><div><dt>Location</dt><dd>{branches.find((branch) => branch.id === appointment.locationId)?.name ?? 'Practice location'}</dd></div><div><dt>Practitioner</dt><dd>{staff.find((member) => member.userId === appointment.professionalUserId)?.fullName ?? 'Assigned practitioner'}</dd></div>{appointment.priceMinor != null && <div><dt>Rate</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: appointment.currency || practice.currency, maximumFractionDigits: 2 }).format(appointment.priceMinor / 100)}</dd></div>}{appointment.amountPaidMinor != null && <div><dt>Payment received</dt><dd>{new Intl.NumberFormat(undefined, { style: 'currency', currency: appointment.currency || practice.currency, maximumFractionDigits: 2 }).format(appointment.amountPaidMinor / 100)}{appointment.paymentMethod ? ` · ${appointment.paymentMethod.replace('_', ' ')}` : ''}</dd></div>}</dl>
    {(appointment.actualArrivedAt || appointment.actualStartedAt || appointment.actualEndedAt) && <section className="customer-note"><h3>Actual visit times</h3><p>Booked: {dateTime(appointment)}{appointment.actualArrivedAt && <>\nArrived: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appointment.timezone || practice.timezone }).format(new Date(appointment.actualArrivedAt))}</>}{appointment.actualStartedAt && <>\nStarted: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appointment.timezone || practice.timezone }).format(new Date(appointment.actualStartedAt))}</>}{appointment.actualEndedAt && <>\nEnded: {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: appointment.timezone || practice.timezone }).format(new Date(appointment.actualEndedAt))}</>}</p></section>}
    {permissions['appointments.update'] && appointment.priceMinor != null && <form className="follow-up-form" onSubmit={(event) => void savePayment(event)}><strong>Payment and balance</strong><div className="form-grid"><label>Total received ({appointment.currency || practice.currency})<input type="number" min={0} max={appointment.priceMinor / 100} step="0.01" value={paidAmount} onChange={(event) => setPaidAmount(event.target.value)}/></label>{Number(paidAmount) > 0 && <label>Method<Select value={paidMethod} onChange={setPaidMethod} options={[['cash','Cash'],['upi','UPI'],['card','Card'],['bank_transfer','Bank transfer'],['insurance','Insurance'],['other','Other']].map(([value,label]) => ({ value, label }))} ariaLabel="Payment method"/></label>}</div><button type="submit" className="button button-secondary" disabled={saving}>{saving ? 'Saving…' : 'Save payment'}</button></form>}
    {appointment.clientNote && <section className="customer-note"><h3><MessageSquareText size={15}/> Customer note</h3><p>{appointment.clientNote}</p></section>}
    {appointment.visitDescription && <section className="customer-note"><h3><MessageSquareText size={15}/> Visit details</h3><p>{appointment.visitDescription}</p></section>}
    {appointment.practitionerNote && <section className="customer-note"><h3><MessageSquareText size={15}/> Private practitioner note</h3><p>{appointment.practitionerNote}</p></section>}
    {permissions['appointments.update'] && !['cancelled', 'no_show', 'held'].includes(appointment.status) && <SessionRecordingPanel practiceId={practice.id} appointmentId={appointment.id} appointmentStatus={appointment.status} enabled={practice.sessionRecordingEnabled} retentionDays={practice.sessionRecordingRetentionDays}/>}
    {success && <p className="save-success"><Check size={14}/>{success}</p>}
    {followUpConfirmation && <aside className="follow-up-confirmation" role="status"><span><Check size={17}/></span><div><strong>Follow-up scheduled</strong><small>{followUpConfirmation.serviceName} · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: practice.timezone }).format(new Date(followUpConfirmation.startsAt))}</small><small>It is marked as a follow-up in the appointment list and calendar.</small></div></aside>}
    {permissions['appointments.correct_status'] && ['no_show', 'completed', 'interrupted'].includes(appointment.status) && <section className="follow-up-card"><div><h3>Correct an appointment outcome</h3><p>Use this only for a recording mistake. The correction and reason are kept in the audit history.</p></div><button className="button button-secondary" type="button" onClick={() => setCorrectionOpen((value) => !value)}>{correctionOpen ? 'Close' : 'Correct status'}</button>{correctionOpen && <div className="follow-up-form"><label>Correct status<Select value={correctionStatus} options={(appointment.status === 'no_show' ? [['confirmed','Confirmed'],['checked_in','Checked in']] : appointment.status === 'interrupted' ? [['in_progress','In progress']] : [['checked_in','Checked in'],['in_progress','In progress']]).map(([value,label]) => ({ value, label }))} onChange={(value) => setCorrectionStatus(value as typeof correctionStatus)} ariaLabel="Correct appointment status"/></label><label className="follow-up-note">Reason (required)<textarea rows={2} minLength={10} maxLength={500} value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="Explain what was recorded incorrectly"/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={saving || correctionReason.trim().length < 10} onClick={() => void correctStatus()}>{saving ? 'Saving…' : 'Save correction'}</button></div>}</section>}
    {permissions['appointments.update'] && ['pending', 'confirmed'].includes(appointment.status) && new Date(appointment.startsAt) > new Date() && <section className="follow-up-card"><div><h3><CalendarDays size={16}/> Reschedule appointment</h3><p>Move it earlier or later by choosing any available future date and time. The customer keeps the same service, practitioner, and location, and receives an in-app alert.</p></div><button className="button button-secondary" type="button" onClick={() => setMoveOpen((value) => !value)}>{moveOpen ? 'Close' : 'Choose a new time'}</button>{moveOpen && <div className="follow-up-form"><label>New date<DatePicker min={practiceDate(practice.timezone)} value={moveDate} onChange={(value) => void loadMoveSlots(value)} ariaLabel="Choose new appointment date"/></label>{moveBusy ? <small>Checking available times…</small> : moveDate && (moveSlots.filter((item) => item.startsAt !== appointment.startsAt).length ? <label>Available time<Select value={moveSlot} options={moveSlots.filter((item) => item.startsAt !== appointment.startsAt).map((item) => ({ value: item.startsAt, label: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: appointment.timezone || practice.timezone }).format(new Date(item.startsAt)) }))} onChange={setMoveSlot} placeholder="Choose a time" ariaLabel="New appointment time"/></label> : <small>No alternative open times on this date.</small>)}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={!moveSlot || moveBusy} onClick={() => void moveAppointment()}>{moveBusy ? 'Saving…' : 'Confirm new time'}</button></div>}</section>}
    {permissions['appointments.update'] && ['pending', 'confirmed'].includes(appointment.status) && new Date(appointment.startsAt) > new Date() && <section className="follow-up-card"><div><h3>Reassign practitioner</h3><p>Use this when the assigned practitioner is unavailable. The system checks the replacement practitioner’s service eligibility and schedule, then keeps the original booking if the selected slot is no longer free.</p></div><button className="button button-secondary" type="button" onClick={() => setReassignOpen((value) => !value)}>{reassignOpen ? 'Close' : 'Choose replacement'}</button>{reassignOpen && <div className="follow-up-form"><label>Replacement practitioner<Select value={reassignProfessionalId} options={staff.filter((member) => member.status === 'active' && member.roles.includes('professional') && member.userId !== appointment.professionalUserId && member.locations.some((location) => location.id === appointment.locationId)).map((member) => ({ value: member.userId, label: member.fullName }))} onChange={(id) => { setReassignProfessionalId(id); setReassignSlots([]); setReassignSlot(''); if (reassignDate) void loadReassignmentSlots(reassignDate, id); }} placeholder="Choose an eligible practitioner" ariaLabel="Replacement practitioner"/></label><label>New date<DatePicker min={practiceDate(practice.timezone)} value={reassignDate} onChange={(value) => void loadReassignmentSlots(value) } ariaLabel="Choose reassignment date"/></label>{reassignBusy ? <small>Checking the replacement practitioner’s schedule…</small> : reassignDate && (reassignSlots.length ? <label>Available time<Select value={reassignSlot} options={reassignSlots.map((item) => ({ value: item.startsAt, label: new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: appointment.timezone || practice.timezone }).format(new Date(item.startsAt)) }))} onChange={setReassignSlot} placeholder="Choose an available time" ariaLabel="Reassignment time"/></label> : <small>{reassignProfessionalId ? 'No available times for this practitioner on this date.' : 'Choose a practitioner to check availability.'}</small>)}<label>Reason (required)<textarea rows={2} minLength={5} maxLength={500} value={reassignReason} onChange={(event) => setReassignReason(event.target.value)} placeholder="For example, practitioner illness"/></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={!reassignSlot || reassignReason.trim().length < 5 || reassignBusy} onClick={() => void reassignAppointment()}>{reassignBusy ? 'Saving…' : 'Confirm reassignment'}</button></div>}</section>}
    {(nextStep[appointment.status] && permissions[nextStep[appointment.status].permission] || appointment.status === 'confirmed' && permissions['appointments.check_in']) && <div className="dialog-actions"><span className="field-hint">Next: {nextStep[appointment.status]?.hint ?? 'Record the customer’s arrival without starting the visit.'}</span>{appointment.status === 'confirmed' && permissions['appointments.check_in'] && <button className="button button-secondary" disabled={updating} onClick={() => void advance(appointment, true, 'checked_in')}>Check in only</button>}{nextStep[appointment.status] && permissions[nextStep[appointment.status].permission] && <button className="button button-primary" disabled={updating} onClick={() => void advance(appointment, true)}>{updating ? 'Saving…' : nextStep[appointment.status].label}</button>}</div>}
    {canSchedule && <section className="follow-up-card"><div><h3><CalendarPlus size={16}/> Schedule a follow-up</h3><p>Create the next appointment for this customer with the same practitioner.</p></div><button className="button button-secondary" type="button" onClick={() => { setOpen((value) => !value); setSuccess(''); }}>{open ? 'Close' : 'Choose a time'}</button>
      {open && <div className="follow-up-form"><label>Service<Select value={serviceId} options={eligibleServices.map((item) => ({ value: item.id, label: `${item.name} · ${item.durationMinutes} min` }))} onChange={(id) => { setServiceId(id); setSlot(''); const next = services.find((item) => item.id === id); if (next?.locationIds?.length && !next.locationIds.includes(locationId)) setLocationId(next.locationIds[0]); }} placeholder="Choose a service" ariaLabel="Follow-up service"/></label><label>Branch<Select value={locationId} options={eligibleLocations.map((item) => ({ value: item.id, label: item.name }))} onChange={(id) => { setLocationId(id); setSlot(''); }} ariaLabel="Follow-up branch"/></label><label>Date<DatePicker min={practiceDate(practice.timezone)} value={date} onChange={(next) => { setDate(next); setSlot(''); }} ariaLabel="Choose follow-up date"/></label><div className="follow-up-slot-area"><span>Available times</span>{loadingSlots ? <small><LoaderCircle size={13} className="ui-spin"/> Checking availability…</small> : slots.length ? <div>{slots.map((item) => <button type="button" key={item.startsAt} className={slot === item.startsAt ? 'selected' : ''} onClick={() => setSlot(item.startsAt)}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: practice.timezone }).format(new Date(item.startsAt))}</button>)}</div> : <small>No open times on this date.</small>}</div><label className="follow-up-note">Note for the customer (optional)<textarea rows={2} maxLength={1000} value={note} onChange={(event) => setNote(event.target.value)}/></label>{error && <p className="form-error" role="alert">{error}</p>}<button type="button" className="button button-primary" disabled={!slot || saving || !eligibleServices.length || (loadingSlots ? !retryingSavedFollowUp : !slots.some((item) => item.startsAt === slot) && !retryingSavedFollowUp)} onClick={() => void create()}>{saving ? 'Scheduling…' : 'Schedule follow-up'}</button></div>}
    </section>}
  </div>;
}
