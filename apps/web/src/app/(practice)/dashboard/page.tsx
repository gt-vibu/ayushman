'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, CalendarCheck2, CalendarDays, FileText, MapPin, Plus, Users } from 'lucide-react';
import { usePractice } from '@/lib/practice-context';
import { api, peekApiCache, practicePath } from '@/lib/api';
import type { Appointment, Service, StaffMember } from '@/lib/types';
import { appointmentStatusLabel } from '@/lib/types';
import { EmptyState, ErrorState, LoadingState, StatusBadge } from '@/components/app-shell';
import { SetupAssistant } from '@/components/setup-assistant';

type DashboardData = { appointments: Appointment[]; services: Service[]; staff: StaffMember[] };
const timeFmt = (timezone: string) => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: timezone });

export default function DashboardPage() {
  const { practice, branches, branchId, session, permissions, permissionsReady } = usePractice();
  const timezone = branches.find((item) => item.id === branchId)?.timezone ?? practice.timezone;
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [setupSkipped, setSetupSkipped] = useState(false);
  useEffect(() => { setSetupSkipped(localStorage.getItem('ayushman.practice_setup_skipped') === '1'); }, []);
  const dashboardUrls = useMemo(() => {
    const from = new Date(selectedDate); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 7);
    const to = new Date(selectedDate); to.setHours(23, 59, 59, 999); to.setDate(to.getDate() + 14);
    const query = new URLSearchParams({ from: from.toISOString(), to: to.toISOString(), limit: '100' });
    const scope = branchId ? `?locationId=${encodeURIComponent(branchId)}` : '';
    if (branchId) query.set('locationId', branchId);
    return { appointments: practicePath(practice.id, `/appointments?${query}`), services: practicePath(practice.id, `/services${scope}`), staff: practicePath(practice.id, `/staff${scope}`) };
  }, [practice.id, branchId, selectedDate]);
  const [data, setData] = useState<DashboardData>(() => ({ appointments: peekApiCache<Appointment[]>(dashboardUrls.appointments) ?? [], services: peekApiCache<Service[]>(dashboardUrls.services) ?? [], staff: peekApiCache<StaffMember[]>(dashboardUrls.staff) ?? [] }));
  const [loading, setLoading] = useState(() => peekApiCache<Appointment[]>(dashboardUrls.appointments) === null); const [error, setError] = useState('');
  const load = useCallback(async () => {
    const cached = { appointments: peekApiCache<Appointment[]>(dashboardUrls.appointments), services: peekApiCache<Service[]>(dashboardUrls.services), staff: peekApiCache<StaffMember[]>(dashboardUrls.staff) };
    if (cached.appointments === null) setLoading(true);
    setError('');
    const [appointments, services, staff] = await Promise.allSettled([
      permissions['appointments.read'] ? api<Appointment[]>(dashboardUrls.appointments) : Promise.resolve([] as Appointment[]),
      permissions['services.read'] ? api<Service[]>(dashboardUrls.services) : Promise.resolve([] as Service[]),
      permissions['staff.read'] ? api<StaffMember[]>(dashboardUrls.staff) : Promise.resolve([] as StaffMember[]),
    ]);
    if (appointments.status === 'rejected') setError(appointments.reason instanceof Error ? appointments.reason.message : 'Could not load appointments.');
    const nextData = { appointments: appointments.status === 'fulfilled' ? appointments.value : cached.appointments ?? [], services: services.status === 'fulfilled' ? services.value : cached.services ?? [], staff: staff.status === 'fulfilled' ? staff.value : cached.staff ?? [] };
    setData(nextData); setLoading(false);
  }, [dashboardUrls, permissions]);
  useEffect(() => { if (permissionsReady) void load(); }, [load, permissionsReady]);
  const firstName = session.user.fullName.split(' ')[0];
  const now = new Date();
  const localHour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: timezone }).format(now));
  const greeting = localHour < 12 ? 'Good morning' : localHour < 17 ? 'Good afternoon' : 'Good evening';
  const greetingIcon = localHour < 12 ? '☀️' : localHour < 17 ? '🌤️' : '🌙';
  const appointments = useMemo(() => data.appointments.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [data.appointments]);
  const complete = appointments.filter((item) => item.status === 'completed').length;
  const pastAppointments = appointments.filter((item) => new Date(item.startsAt) < now).reverse();
  const upcomingAppointments = appointments.filter((item) => new Date(item.startsAt) >= now && !['completed', 'interrupted', 'cancelled', 'no_show'].includes(item.status));
  const appointmentsByDate = (items: Appointment[]) => {
    const grouped = new Map<string, Appointment[]>();
    for (const appointment of items) {
      const day = new Intl.DateTimeFormat('en-CA', { timeZone: appointment.timezone || timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(appointment.startsAt));
      grouped.set(day, [...(grouped.get(day) ?? []), appointment]);
    }
    return [...grouped.entries()];
  };
  const pastByDate = appointmentsByDate(pastAppointments);
  const upcomingByDate = appointmentsByDate(upcomingAppointments);
  const stats = [
    { label: 'Appointments', value: appointments.length, note: `${complete} completed · ${upcomingAppointments.length} upcoming`, icon: CalendarCheck2, tone: 'mint', href: '/appointments' },
    { label: 'Customers', value: 'Directory', note: 'Search customer records', icon: Users, tone: 'blush', href: '/clients' },
    { label: 'Active services', value: data.services.filter((item) => item.active).length, note: 'Services and sessions', icon: BriefcaseBusiness, tone: 'apricot', href: '/services' },
    { label: 'Locations', value: branches.filter((item) => item.active).length, note: 'Practice locations', icon: MapPin, tone: 'lavender', href: '/branches' },
  ];
  const quickActions = [
    ...(setupSkipped ? [{ href: '/setup', label: 'Finish practice setup', icon: BriefcaseBusiness, permission: 'practice.update' }] : []),
    { href: '/appointments?newVisit=1', label: 'New visit', icon: CalendarDays, permission: 'appointments.create' },
    { href: '/clients', label: 'Customers', icon: Users, permission: 'clients.read' },
    { href: '/billing', label: 'Create invoice', icon: FileText, permission: 'billing.manage' },
    { href: '/services', label: 'Services', icon: BriefcaseBusiness, permission: 'services.manage' },
  ].filter((item) => permissions[item.permission]);
  const formatDay = (day: string) => new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: timezone }).format(new Date(`${day}T12:00:00`));
  const setDay = (delta: number) => setSelectedDate((current) => { const next = new Date(current); next.setDate(next.getDate() + delta); return next; });

  return <>
    <div className="dashboard-welcome"><div><p className="eyebrow">{practice.name.toUpperCase()}</p><h1>{greeting}, {firstName}. <span>{greetingIcon}</span></h1><p>Here’s what’s happening at your practice today.</p></div><div className="dashboard-date-control"><button className="icon-button" aria-label="Previous day" onClick={() => setDay(-1)}><ArrowLeft size={16}/></button><strong>{new Intl.DateTimeFormat(undefined, { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric', timeZone: timezone }).format(selectedDate)}</strong><button className="icon-button" aria-label="Next day" onClick={() => setDay(1)}><ArrowRight size={16}/></button><button className="button button-secondary" onClick={() => setSelectedDate(new Date())}>Today</button>{permissions['appointments.create'] && <Link className="button button-primary" href="/appointments?newVisit=1"><Plus size={15}/> New visit</Link>}</div></div>
    <section className="stat-grid dashboard-stat-grid" aria-label="Practice summary">{stats.map(({ label, value, note, icon: Icon, tone, href }) => <Link className="stat-card" href={href} key={label}><span className={`stat-icon tone-${tone}`}><Icon size={19}/></span><div className="stat-main"><span className="stat-label">{label}</span><strong>{value}</strong><small>{note}</small></div><ArrowRight className="stat-arrow" size={16}/></Link>)}</section>
    <SetupAssistant practice={practice} branchId={branchId} branches={branches} services={data.services} staff={data.staff}/>
    <div className="dashboard-grid dashboard-reference-grid">
      <section className="section-card schedule-card dashboard-schedule"><div className="section-heading"><div><p className="eyebrow">PAST & UPCOMING</p><h2>Schedule overview</h2><small className="dashboard-range-note">Past 7 days and next 14 days · {timezone}</small></div><div className="inline-actions"><span className="count-pill">{appointments.length} appointments</span><Link className="text-link" href="/calendar">Open calendar <ArrowRight size={14}/></Link></div></div>
        {loading ? <LoadingState/> : error ? <ErrorState message={error}/> : appointments.length === 0 ? <EmptyState title="No recent or upcoming appointments" description="Appointments from the past week and the next two weeks will appear here, grouped by date." icon={CalendarDays}/> : <div className="dashboard-appointment-groups">
          {[{ title: 'Upcoming appointments', groups: upcomingByDate }, { title: 'Past appointments', groups: pastByDate }].map(({ title, groups }) => groups.length > 0 && <section className="dashboard-date-section" key={title}><h3>{title}</h3>{groups.map(([day, dayAppointments]) => <div className="dashboard-date-group" key={day}><h4>{formatDay(day)} <span>{dayAppointments.length}</span></h4><div className="dashboard-date-items">{dayAppointments.map((appointment, index) => <article className={`timeline-appointment timeline-tone-${index % 4}`} key={appointment.id}><span className="timeline-accent"/><time>{timeFmt(appointment.timezone || timezone).format(new Date(appointment.startsAt))}</time><div className="timeline-details"><strong>{appointment.clientName}</strong><span>{appointment.serviceName} · {timeFmt(appointment.timezone || timezone).format(new Date(appointment.startsAt))}–{timeFmt(appointment.timezone || timezone).format(new Date(appointment.endsAt))}</span></div><StatusBadge status={appointmentStatusLabel[appointment.status]}/></article>)}</div></div>)}</section>)}
        </div>}
      </section>
      <aside className="right-rail dashboard-right-rail"><section className="section-card team-card today-card"><div className="section-heading"><div><p className="eyebrow">NEXT UP</p><h2>Upcoming appointments</h2></div><Link className="text-link" href="/appointments">View all <ArrowRight size={14}/></Link></div>{loading ? <div className="loading-state">Loading schedule…</div> : upcomingAppointments.length ? <div className="today-list">{upcomingAppointments.slice(0, 6).map((appointment) => <article key={appointment.id}><time>{timeFmt(appointment.timezone || timezone).format(new Date(appointment.startsAt))}</time><span className="today-dot"/><div><strong>{appointment.clientName}</strong><small>{appointment.serviceName} · {new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: appointment.timezone || timezone }).format(new Date(appointment.startsAt))}</small></div><StatusBadge status={appointmentStatusLabel[appointment.status]}/></article>)}</div> : <p className="customer-empty">No upcoming appointments in this period.</p>}</section>
        {permissions['records.read'] && <section className="section-card records-promo"><p className="eyebrow">CUSTOMER CARE</p><h2>Keep every record connected</h2><p>Attach reports and prescriptions to a customer and share them securely from their account.</p><Link className="button button-primary" href="/records"><FileText size={14}/> Open customer records <ArrowRight size={14}/></Link></section>}
        {quickActions.length > 0 && <section className="section-card quick-actions"><p className="eyebrow">QUICK ACTIONS</p><div>{quickActions.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon/><span>{label}</span></Link>)}</div></section>}
      </aside>
    </div>
  </>;
}
