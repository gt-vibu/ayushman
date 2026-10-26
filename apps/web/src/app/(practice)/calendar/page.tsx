'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CalendarDays } from 'lucide-react';
import { PageHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/app-shell';
import { practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import type { Appointment } from '@/lib/types';
import { appointmentStatusLabel } from '@/lib/types';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';
import { DatePicker } from '@/components/ui/date-picker';
import { DropdownSelect } from '@/components/ui/dropdown-select';

type SortOrder = 'client-asc' | 'client-desc' | 'newest' | 'oldest';
type VisitTypeFilter = 'all' | 'appointments' | 'follow_ups';

function dateInTimezone(timezone: string, instant = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant);
  return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`;
}

function startOfDateInTimezone(date: string, timezone: string) {
  const [year, month, day] = date.split('-').map(Number);
  const targetWallTime = Date.UTC(year, month - 1, day);
  let instant = targetWallTime;
  const formatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
    const wallTime = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    const correction = targetWallTime - wallTime;
    instant += correction;
    if (correction === 0) break;
  }
  return instant;
}

function nextCalendarDate(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}-${String(next.getUTCDate()).padStart(2, '0')}`;
}

export default function CalendarPage() {
  const { practice, branchId, permissions } = usePractice();
  const [selectedDate, setSelectedDate] = useState(() => dateInTimezone(practice.timezone));
  const [sortOrder, setSortOrder] = useState<SortOrder>('oldest');
  const [visitType, setVisitType] = useState<VisitTypeFilter>('all');
  const url = useMemo(() => {
    const start = startOfDateInTimezone(selectedDate, practice.timezone);
    const end = startOfDateInTimezone(nextCalendarDate(selectedDate), practice.timezone) - 1;
    const query = new URLSearchParams({ from: new Date(start).toISOString(), to: new Date(end).toISOString(), limit: '200' });
    if (branchId) query.set('locationId', branchId);
    return practicePath(practice.id, `/appointments?${query.toString()}`);
  }, [practice.id, practice.timezone, branchId, selectedDate]);
  const { data, loading, error } = useApiData<Appointment[]>(url);
  const sortedAppointments = useMemo(() => (data ?? []).filter((appointment) => visitType === 'all' || (visitType === 'follow_ups' ? Boolean(appointment.isFollowUp || appointment.followUpToAppointmentId) : !appointment.isFollowUp && !appointment.followUpToAppointmentId)).sort((a, b) => {
    if (sortOrder === 'client-asc') return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' }) || a.startsAt.localeCompare(b.startsAt);
    if (sortOrder === 'client-desc') return b.clientName.localeCompare(a.clientName, undefined, { sensitivity: 'base' }) || a.startsAt.localeCompare(b.startsAt);
    return sortOrder === 'newest' ? b.startsAt.localeCompare(a.startsAt) : a.startsAt.localeCompare(b.startsAt);
  }), [data, sortOrder, visitType]);
  const pagination = usePaginatedItems(sortedAppointments, `${selectedDate}:${sortOrder}:${visitType}`);
  const dateLabel = useMemo(() => {
    const [year, month, day] = selectedDate.split('-').map(Number);
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date(year, month - 1, day));
  }, [selectedDate]);

  return <>
    <PageHeader eyebrow="SCHEDULE" title="Calendar" description="Choose a date to review appointments at the selected branch." action={<div className="inline-actions"><span className="count-pill">{sortedAppointments.length} {sortedAppointments.length === 1 ? 'visit' : 'visits'}</span>{permissions['appointments.create'] && <Link className="button button-primary" href="/appointments?newVisit=1">New visit</Link>}</div>}/>
    <section className="section-card resource-card calendar-card">
      <div className="calendar-toolbar">
        <label className="calendar-date-field">Appointment date<DatePicker value={selectedDate} onChange={(value) => { if (value) setSelectedDate(value); }} ariaLabel="Choose appointment date"/></label>
        <label className="calendar-sort-field">Visit type<DropdownSelect value={visitType} onChange={(event) => setVisitType(event.target.value as VisitTypeFilter)} aria-label="Filter by visit type"><option value="all">All visits</option><option value="appointments">Appointments</option><option value="follow_ups">Follow-ups</option></DropdownSelect></label>
        <label className="calendar-sort-field">Sort appointments<DropdownSelect value={sortOrder} onChange={(event) => setSortOrder(event.target.value as SortOrder)} aria-label="Sort appointments"><option value="oldest">Oldest first</option><option value="newest">Latest first</option><option value="client-asc">Client name A–Z</option><option value="client-desc">Client name Z–A</option></DropdownSelect></label>
        <span className="calendar-selected-date">{dateLabel}</span>
      </div>
      {loading ? <LoadingState/> : error ? <ErrorState message={error}/> : !sortedAppointments.length ? <EmptyState title="No appointments on this date" description="Choose another date to see its appointments." icon={CalendarDays}/> : <>
        <div className="agenda-list">{pagination.pageItems.map((item) => <article className="agenda-row" key={item.id}>
          <div className="agenda-date"><strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', timeZone: practice.timezone }).format(new Date(item.startsAt))}</strong><span>{new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: practice.timezone }).format(new Date(item.startsAt))}</span></div>
          <div className="agenda-time">{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: practice.timezone }).format(new Date(item.startsAt))}</div>
          <div className="agenda-person"><strong>{item.clientName}</strong><span>{item.serviceName}{(item.isFollowUp || item.followUpToAppointmentId) && <span className="follow-up-tag">Follow-up</span>}{item.hasFollowUp && <span className="follow-up-tag follow-up-scheduled-tag">Follow-up scheduled</span>}</span>{item.followUpSource && <small className="follow-up-context">For {item.followUpSource.serviceName}</small>}</div>
          <StatusBadge status={appointmentStatusLabel[item.status]}/>
        </article>)}</div>
        <Pagination total={sortedAppointments.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/>
      </>}
    </section>
  </>;
}
