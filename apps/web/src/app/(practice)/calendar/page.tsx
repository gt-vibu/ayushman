'use client';

import { useMemo } from 'react';
import { CalendarDays } from 'lucide-react';
import { PageHeader, EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/app-shell';
import { practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { appointmentsQuery } from '@/lib/url';
import { useApiData } from '@/lib/use-api-data';
import type { Appointment } from '@/lib/types';
import { appointmentStatusLabel } from '@/lib/types';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';

export default function CalendarPage() {
  const { practice, branchId } = usePractice();
  const suffix = appointmentsQuery(branchId, 7, 100);
  const url = useMemo(() => practicePath(practice.id, suffix), [practice.id, suffix]);
  const { data, loading, error } = useApiData<Appointment[]>(url);
  const pagination = usePaginatedItems(data ?? []);
  return <><PageHeader eyebrow="SCHEDULE" title="Calendar" description="A seven-day agenda of upcoming appointments for the selected branch." action={<span className="count-pill">Next 7 days</span>}/>
    <section className="section-card resource-card">{loading ? <LoadingState/> : error ? <ErrorState message={error}/> : !data?.length ? <EmptyState title="No appointments this week" description="New bookings will appear in this agenda as soon as they are confirmed." icon={CalendarDays}/> : <><div className="agenda-list">{pagination.pageItems.map((item) => <article className="agenda-row" key={item.id}><div className="agenda-date"><strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', timeZone: practice.timezone }).format(new Date(item.startsAt))}</strong><span>{new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: practice.timezone }).format(new Date(item.startsAt))}</span></div><div className="agenda-time">{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: practice.timezone }).format(new Date(item.startsAt))}</div><div className="agenda-person"><strong>{item.clientName}</strong><span>{item.serviceName}</span></div><StatusBadge status={appointmentStatusLabel[item.status]}/></article>)}</div><Pagination total={data.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/></>}</section>
  </>;
}
