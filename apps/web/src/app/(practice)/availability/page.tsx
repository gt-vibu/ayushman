'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, Clock3, Trash2 } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import { ErrorState, LoadingState, PageHeader } from '@/components/app-shell';
import { DatePicker } from '@/components/ui/date-picker';
import { ProfessionalScheduleInput } from '@ayushman-v2/contracts';

type Profession = { id: string; name: string };
type AvailabilityRule = { id: string; scope: string; practiceProfessionId: string | null; locationId: string | null; professionalUserId: string | null; weekday: number; startMinute: number; endMinute: number; slotIntervalMinutes: number };
type DayRule = { weekday: number; enabled: boolean; start: string; end: string; interval: number };
const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const minuteOf = (time: string) => { const [hours, minutes] = time.split(':').map(Number); return hours * 60 + minutes; };
const timeOf = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
const localDateAt = (timezone: string) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`; };

export default function AvailabilityPage() {
  const { practice, branches, branchId, setBranchId, session, permissions } = usePractice();
  const professionsUrl = practicePath(practice.id, '/professions');
  const rulesUrl = practicePath(practice.id, `/availability/rules${branchId ? `?locationId=${encodeURIComponent(branchId)}` : ''}`);
  const { data: professions, loading: loadingProfessions, error: professionError } = useApiData<Profession[]>(professionsUrl);
  const { data: rules, loading: loadingRules, error: rulesError } = useApiData<AvailabilityRule[]>(rulesUrl);
  const professionPreferenceKey = `availability-profession:${practice.id}:${session.user.id}`;
  const [professionId, setProfessionId] = useState('');
  const [days, setDays] = useState<DayRule[]>(weekdays.map((_, weekday) => ({ weekday, enabled: weekday >= 1 && weekday <= 5, start: '09:00', end: '17:00', interval: 30 })));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const activeBranchId = branchId || branches[0]?.id || '';

  useEffect(() => {
    if (!professions?.length) return;
    setProfessionId((current) => {
      if (current && professions.some((profession) => profession.id === current)) return current;
      let preferred = '';
      try { preferred = window.localStorage.getItem(professionPreferenceKey) ?? ''; } catch { /* Storage may be unavailable; fall back to the first profession. */ }
      return professions.some((profession) => profession.id === preferred) ? preferred : professions[0].id;
    });
  }, [professions, professionPreferenceKey]);
  useEffect(() => {
    if (!professionId || !professions?.some((profession) => profession.id === professionId)) return;
    try { window.localStorage.setItem(professionPreferenceKey, professionId); } catch { /* The saved schedule remains on the server if storage is unavailable. */ }
  }, [professionId, professions, professionPreferenceKey]);
  useEffect(() => {
    if (!rules || !professionId) return;
    const own = rules.filter((rule) => rule.scope === 'professional_location' && rule.professionalUserId === session.user.id && rule.practiceProfessionId === professionId && rule.locationId === activeBranchId);
    setDays(weekdays.map((_, weekday) => {
      const saved = own.find((rule) => rule.weekday === weekday);
      return { weekday, enabled: Boolean(saved), start: saved ? timeOf(saved.startMinute) : '09:00', end: saved ? timeOf(saved.endMinute) : '17:00', interval: saved?.slotIntervalMinutes ?? 30 };
    }));
  }, [rules, professionId, activeBranchId, session.user.id]);

  const selectedProfession = useMemo(() => professions?.find((item) => item.id === professionId), [professions, professionId]);
  function updateDay(weekday: number, changes: Partial<DayRule>) {
    setDays((current) => current.map((day) => day.weekday === weekday ? { ...day, ...changes } : day));
  }
  function applyAvailabilityPreset(includeWeekends: boolean) {
    setDays(weekdays.map((_, weekday) => ({
      weekday,
      enabled: includeWeekends || (weekday >= 1 && weekday <= 5),
      start: '09:00',
      end: '17:00',
      interval: 30,
    })));
    setMessage('Preset applied. Save availability to make it bookable.');
    setError('');
  }
  async function save() {
    if (!days.some((day) => day.enabled)) {
      setError('Select at least one available day before saving.');
      setMessage('');
      return;
    }
    const payload = {
      practiceProfessionId: professionId,
      locationId: activeBranchId,
      rules: days.filter((day) => day.enabled).map((day) => ({ weekday: day.weekday, startMinute: minuteOf(day.start), endMinute: minuteOf(day.end), slotIntervalMinutes: day.interval })),
    };
    const parsed = ProfessionalScheduleInput.safeParse(payload);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check your availability times.'); setMessage(''); return; }
    setBusy(true); setMessage(''); setError('');
    try {
      await api(practicePath(practice.id, '/availability/professional-schedule'), {
        method: 'PUT',
        body: JSON.stringify(parsed.data),
      });
      setMessage('Your availability is saved. Customers can now see eligible start times.');
    } catch (cause) {
      const isOwner = session.practices.find((membership) => membership.practiceId === practice.id)?.roles.includes('owner') ?? false;
      const needsAssignment = cause instanceof Error && cause.message.toLowerCase().includes('not assigned to this profession and location');
      if (isOwner && needsAssignment) {
        try {
          const members = await api<Array<{ userId: string; professionalProfiles?: Array<{ professionId: string; headline: string | null; bio: string | null; profileAttributes: Record<string, string | string[]>; publicProfile: boolean; locationIds: string[] }> }>>(practicePath(practice.id, '/staff'));
          const ownProfile = members.find((member) => member.userId === session.user.id)?.professionalProfiles?.find((profile) => profile.professionId === professionId);
          const locationIds = [...new Set([...(ownProfile?.locationIds ?? []), activeBranchId])];
          await api(practicePath(practice.id, `/staff/${session.user.id}/professional-profile`), {
            method: 'POST',
            body: JSON.stringify({ practiceProfessionId: professionId, locationIds, headline: ownProfile?.headline ?? null, bio: ownProfile?.bio ?? null, profileAttributes: ownProfile?.profileAttributes ?? {}, publicProfile: ownProfile?.publicProfile ?? false }),
          });
          await api(practicePath(practice.id, '/availability/professional-schedule'), { method: 'PUT', body: JSON.stringify(parsed.data) });
          setMessage('Your practitioner profile is now assigned to this branch and your availability is saved. Existing branch assignments were kept.');
        } catch (assignmentCause) {
          setError(assignmentCause instanceof Error ? assignmentCause.message : 'Could not assign your practitioner profile and save availability.');
        }
      } else setError(cause instanceof Error ? cause.message : 'Could not save availability.');
    }
    finally { setBusy(false); }
  }

  return <>
    <PageHeader eyebrow="SCHEDULING" title="Your availability" description="Set the times customers can book with you. Location operating hours still apply." action={<button className="button button-primary" onClick={() => void save()} disabled={busy || !professionId || !activeBranchId}><Check size={15}/>{busy ? 'Saving…' : 'Save availability'}</button>}/>
    <section className="section-card schedule-settings">
      <div className="schedule-scope"><label>Profession<DropdownSelect value={professionId} onChange={(event) => setProfessionId(event.target.value)} disabled={!professions?.length}>{professions?.map((profession) => <option value={profession.id} key={profession.id}>{profession.name}</option>)}</DropdownSelect></label><label>Location<DropdownSelect value={activeBranchId} onChange={(event) => setBranchId(event.target.value)}>{branches.map((branch) => <option value={branch.id} key={branch.id}>{branch.name}</option>)}</DropdownSelect></label></div>
      <div className="availability-presets"><span>Start with a common schedule</span><button type="button" className="button button-secondary compact-button" onClick={() => applyAvailabilityPreset(false)}>Weekdays · 9–5</button><button type="button" className="button button-secondary compact-button" onClick={() => applyAvailabilityPreset(true)}>Every day · 9–5</button></div>
      {loadingProfessions || loadingRules ? <LoadingState/> : professionError || rulesError ? <ErrorState message={professionError || rulesError || 'Availability could not load.'}/> : !branches.length ? <ErrorState message="Add a location before setting availability."/> : <div className="schedule-days">{days.map((day) => <article className={`schedule-day ${day.enabled ? '' : 'schedule-day-closed'}`} key={day.weekday}>
        <label className="schedule-day-toggle"><input type="checkbox" checked={day.enabled} onChange={(event) => updateDay(day.weekday, { enabled: event.target.checked })}/><strong>{weekdays[day.weekday]}</strong><span>{day.enabled ? 'Available' : 'Unavailable'}</span></label>
        {day.enabled && <div className="schedule-day-fields"><label>From<input type="time" value={day.start} onChange={(event) => updateDay(day.weekday, { start: event.target.value })}/></label><label>To<input type="time" value={day.end} onChange={(event) => updateDay(day.weekday, { end: event.target.value })}/></label><label>Start times every<DropdownSelect value={day.interval} onChange={(event) => updateDay(day.weekday, { interval: Number(event.target.value) })}><option value={15}>15 minutes</option><option value={20}>20 minutes</option><option value={30}>30 minutes</option><option value={60}>60 minutes</option></DropdownSelect></label></div>}
      </article>)}</div>}
      {message && <p className="schedule-message"><Check size={15}/>{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}
      <p className="schedule-help"><Clock3 size={15}/>Slot length comes from each service. The interval controls how often a customer can choose a start time.</p>
      {selectedProfession && <p className="page-note">Availability is scoped to you, {selectedProfession.name}, and the selected location.</p>}
    </section>
    {permissions['availability.manage'] && activeBranchId && <TimeOffManager practiceId={practice.id} branchId={activeBranchId} professionId={professionId} userId={session.user.id} timezone={practice.timezone} />}
  </>;
}

type AvailabilityException = { id: string; date: string; kind: 'closed' | 'extra_hours'; startMinute: number | null; endMinute: number | null; reason: string | null; professionalUserId: string | null };
function TimeOffManager({ practiceId, branchId, professionId, userId, timezone }: { practiceId: string; branchId: string; professionId: string; userId: string; timezone: string }) {
  const today = localDateAt(timezone); const [date, setDate] = useState(today); const [scope, setScope] = useState<'professional' | 'location'>('professional'); const [kind, setKind] = useState<'closed' | 'extra_hours'>('closed');
  const [fullDay, setFullDay] = useState(true); const [from, setFrom] = useState('13:00'); const [to, setTo] = useState('14:00'); const [reason, setReason] = useState('');
  const [items, setItems] = useState<AvailabilityException[]>([]); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const [conflicts, setConflicts] = useState<Array<{ id: string; clientName: string; serviceName: string; startsAt: string }>>([]);
  const url = practicePath(practiceId, `/availability/exceptions?locationId=${encodeURIComponent(branchId)}&from=${date}&to=${date}`);
  useEffect(() => { let active = true; void api<AvailabilityException[]>(url).then((data) => { if (active) setItems(data); }).catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Could not load schedule exceptions.'); }); return () => { active = false; }; }, [url]);
  const mins = (value: string) => { const [hour, minute] = value.split(':').map(Number); return hour * 60 + minute; };
  async function add(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setBusy(true); setError(''); setMessage(''); setConflicts([]); try { const result = await api<{ exception: AvailabilityException; conflicts: typeof conflicts }>(practicePath(practiceId, '/availability/exceptions'), { method: 'POST', body: JSON.stringify({ locationId: branchId, professionalUserId: scope === 'professional' ? userId : null, practiceProfessionId: scope === 'professional' ? professionId : null, date, kind, startMinute: fullDay && kind === 'closed' ? null : mins(from), endMinute: fullDay && kind === 'closed' ? null : mins(to), reason: reason.trim() || undefined }) }); setConflicts(result.conflicts); setMessage(kind === 'closed' ? result.conflicts.length ? `Closure saved. ${result.conflicts.length} future appointment${result.conflicts.length === 1 ? '' : 's'} overlap and need a new time.` : 'Closure saved.' : 'Extra hours saved. Customers can now see those slots.'); setReason(''); const latest = await api<AvailabilityException[]>(url); setItems(latest); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save this schedule change.'); } finally { setBusy(false); } }
  async function remove(id: string) { setError(''); try { await api(practicePath(practiceId, `/availability/exceptions/${id}`), { method: 'DELETE' }); setItems((current) => current.filter((item) => item.id !== id)); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove this schedule change.'); } }
  const timeText = (minute: number | null) => minute === null ? 'All day' : `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
  return <section className="section-card settings-card"><p className="eyebrow">DATE-SPECIFIC SCHEDULE</p><h2>Time off, closures & extra hours</h2><p className="page-description">Block a full day or time range, or open extra hours for the selected location. Existing bookings are never silently removed.</p><form className="settings-form" onSubmit={(event) => void add(event)}>
    <label>Date<DatePicker min={today} value={date} onChange={setDate} ariaLabel="Choose schedule change date"/></label>
    <label>Apply to<DropdownSelect value={scope} onChange={(event) => setScope(event.target.value as 'professional' | 'location')}><option value="professional">My availability only</option><option value="location">Entire location (requires permission)</option></DropdownSelect></label>
    <label>Change type<DropdownSelect value={kind} onChange={(event) => { const next = event.target.value as 'closed' | 'extra_hours'; setKind(next); if (next === 'extra_hours') setFullDay(false); }}><option value="closed">Unavailable / time off</option><option value="extra_hours">Add extra hours</option></DropdownSelect></label>
    {kind === 'closed' && <label className="settings-toggle-field"><input type="checkbox" checked={fullDay} onChange={(event) => setFullDay(event.target.checked)}/> Block the entire day</label>}
    {(kind === 'extra_hours' || !fullDay) && <><label>From<input type="time" required value={from} onChange={(event) => setFrom(event.target.value)}/></label><label>To<input type="time" required value={to} onChange={(event) => setTo(event.target.value)}/></label></>}
    <label>Reason (optional)<input maxLength={240} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Personal leave"/></label>
    <div className="settings-actions"><button className="button button-primary" disabled={busy || !date || (scope === 'professional' && !professionId)}>{busy ? 'Saving…' : 'Save schedule change'}</button></div>
  </form>{message && <p className={conflicts.length ? 'form-warning' : 'save-success'}>{conflicts.length ? null : <Check size={14} />}{message}</p>}{conflicts.length > 0 && <><ul className="exception-conflicts">{conflicts.map((item) => <li key={item.id}><b>{item.clientName}</b> · {item.serviceName} · {new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone }).format(new Date(item.startsAt))}</li>)}</ul><BulkMoveBookings practiceId={practiceId} conflicts={conflicts} timezone={timezone} onComplete={(count) => { setConflicts([]); setMessage(`Closure saved and ${count} affected booking${count === 1 ? '' : 's'} moved. Customers can see the new times in their account.`); }}/></>}{error && <p className="form-error" role="alert">{error}</p>}
    <div className="exception-list">{items.map((item) => <article key={item.id}><span><b>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${item.date}T12:00:00Z`))}</b><small>{item.professionalUserId ? 'Your schedule' : 'Location'} · {item.kind === 'closed' ? 'Unavailable' : 'Extra hours'} · {timeText(item.startMinute)}{item.endMinute !== null ? `–${timeText(item.endMinute)}` : ''}{item.reason ? ` · ${item.reason}` : ''}</small></span><button className="button button-secondary" type="button" aria-label="Remove schedule change" onClick={() => void remove(item.id)}><Trash2 size={14}/> Remove</button></article>)}{date && !items.length && <p className="field-hint">No schedule changes recorded for this date.</p>}</div>
  </section>;
}

type BulkConflict = { id: string; clientName: string; serviceName: string; startsAt: string };
type BulkSlot = { startsAt: string; endsAt: string; professional: { id: string; name: string } };
type BulkOption = { appointmentId: string; currentProfessionalUserId: string; clientName: string; serviceName: string; originalStartsAt: string; timezone: string; slots: BulkSlot[] };
function BulkMoveBookings({ practiceId, conflicts, timezone, onComplete }: { practiceId: string; conflicts: BulkConflict[]; timezone: string; onComplete: (count: number) => void }) {
  const today = localDateAt(timezone);
  const [open, setOpen] = useState(false); const [date, setDate] = useState(''); const [reason, setReason] = useState('Practitioner unavailable'); const [allowPractitionerChange, setAllowPractitionerChange] = useState(false); const [options, setOptions] = useState<BulkOption[]>([]); const [selected, setSelected] = useState<Record<string, string>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [success, setSuccess] = useState('');
  async function load() { setBusy(true); setError(''); setSuccess(''); setOptions([]); setSelected({}); try { const result = await api<{ appointments: BulkOption[] }>(practicePath(practiceId, '/appointments/bulk-reschedule-options'), { method: 'POST', body: JSON.stringify({ appointmentIds: conflicts.map((item) => item.id), date, allowPractitionerChange }) }); setOptions(result.appointments); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not find replacement times.'); } finally { setBusy(false); } }
  async function confirm() { if (!options.length || options.some((item) => !selected[item.appointmentId])) return; setBusy(true); setError(''); try { const result = await api<{ moved: number }>(practicePath(practiceId, '/appointments/bulk-reschedule'), { method: 'POST', body: JSON.stringify({ reason: reason.trim(), moves: options.map((item) => { const [professionalUserId, startsAt] = selected[item.appointmentId]!.split('|'); return { appointmentId: item.appointmentId, startsAt, professionalUserId }; }) }) }); setSuccess(`${result.moved} appointment${result.moved === 1 ? '' : 's'} resolved.`); setOpen(false); setOptions([]); onComplete(result.moved); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not move these appointments. Review the times and try again.'); } finally { setBusy(false); } }
  return <div className="bulk-move-panel"><button className="button button-secondary" type="button" onClick={() => setOpen((value) => !value)}>{open ? 'Hide move planner' : `Reschedule ${conflicts.length} affected booking${conflicts.length === 1 ? '' : 's'}`}</button>{success && <p className="save-success"><Check size={14}/>{success}</p>}{open && <div className="bulk-move-form"><p className="field-hint">Choose a destination date. You can keep each current practitioner or assign an eligible colleague. All bookings retain the same customer, service, branch, and history; all moves are checked and saved together.</p><label>Move bookings to date<DatePicker min={today} value={date} onChange={(value) => { setDate(value); setOptions([]); setSelected({}); }} ariaLabel="Choose destination date for bookings"/></label><label>Reason<input required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)}/></label><label className="settings-toggle-field"><input type="checkbox" checked={allowPractitionerChange} onChange={(event) => { setAllowPractitionerChange(event.target.checked); setOptions([]); setSelected({}); }}/> Allow assignment to another eligible practitioner</label><button type="button" className="button button-secondary" disabled={!date || busy || reason.trim().length < 5} onClick={() => void load()}>{busy ? 'Finding times…' : 'Find available times'}</button>{options.map((item) => <label className="bulk-move-option" key={item.appointmentId}><span><b>{item.clientName}</b><small>{item.serviceName} · originally {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: item.timezone }).format(new Date(item.originalStartsAt))}</small></span><DropdownSelect value={selected[item.appointmentId] ?? ''} onChange={(event) => setSelected((current) => ({ ...current, [item.appointmentId]: event.target.value }))}><option value="">{item.slots.length ? 'Choose practitioner and time' : 'No available times'}</option>{item.slots.map((slot) => <option key={`${slot.professional.id}|${slot.startsAt}`} value={`${slot.professional.id}|${slot.startsAt}`}>{slot.professional.name} · {new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: item.timezone }).format(new Date(slot.startsAt))}</option>)}</DropdownSelect></label>)}{options.length > 0 && <button type="button" className="button button-primary" disabled={busy || reason.trim().length < 5 || options.some((item) => !selected[item.appointmentId])} onClick={() => void confirm()}>{busy ? 'Moving bookings…' : `Confirm all ${options.length} moves`}</button>}{error && <p role="alert" className="form-error">{error}</p>}</div>}</div>;
}
