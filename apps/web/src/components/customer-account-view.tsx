'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';
import { DatePicker } from '@/components/ui/date-picker';
import { CustomerSessionReplays } from '@/components/customer-session-replays';

import { SpaLink as Link } from '@/components/spa-link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Building2, CalendarDays, Check, Clock3, Compass, Download, FileText, House, Leaf, MapPin, Moon, Search, Settings, SlidersHorizontal, Sun, UserRound, WalletCards } from 'lucide-react';
import { api, API_BASE, ApiError } from '@/lib/api';
import { PhoneField } from '@/components/ui/phone-field';
import { Select } from '@/components/ui/select';
import { BrandLoader } from '@/components/ui/branded-loader';
import { CustomerSessionLink } from '@/components/customer-session-link';
import { useCustomerSession } from '@/lib/customer-session';
import { CustomerProfileUpdateInput } from '@ayushman-v2/contracts';

type Profile = { fullName: string; email: string; phone: string | null };
type LinkedPractice = { clientId: string; practiceId: string; practiceName: string; fullName: string; email: string | null; phone: string | null; linkedAt: string };
type CustomerAppointment = { id: string; practiceId: string; practiceName: string; professionalName: string; locationName: string; professionName: string; termOverrides: Record<string, string>; serviceName: string; serviceId: string; locationId: string; professionalUserId: string; startsAt: string; endsAt: string; timezone: string; status: string; followUpToAppointmentId: string | null; followUpSource: { id: string; serviceName: string; startsAt: string; timezone: string } | null; followUps: Array<{ id: string; serviceName: string; startsAt: string; timezone: string }>; priceMinor: number | null; currency: string; canCustomerCancel: boolean; canCustomerReschedule: boolean };
type CustomerDocument = { id: string; practiceId: string; practiceName: string; originalName: string; mediaType: string; sizeBytes: number; category: string; description: string | null; createdAt: string };
type CustomerInvoice = { id: string; practiceId: string; practiceName: string; invoiceNumber: string; kind: string; status: string; currency: string; issueDate: string; dueDate: string | null; subtotalMinor: number; discountMinor: number; taxMinor: number; centralTaxMinor: number; stateTaxMinor: number; integratedTaxMinor: number; totalMinor: number; amountPaidMinor: number; appointmentId: string | null; locationName: string | null; supplierSnapshot: Record<string, string | null>; recipientSnapshot: Record<string, string | null>; placeOfSupply: string | null; notes: string | null; lines: Array<{ id: string; description: string; quantityMilli: number; unitPriceMinor: number; lineTotalMinor: number; taxRateBps: number; taxMinor: number }>; payments: Array<{ id: string; amountMinor: number; method: string; reference: string | null; receivedAt: string }> };
type CustomerRecords = { practices: LinkedPractice[]; appointments: CustomerAppointment[]; documents: CustomerDocument[]; invoices: CustomerInvoice[]; notifications: Array<{ id: string; appointmentId: string; kind: string; createdAt: string; serviceName: string; startsAt: string; timezone: string; practiceName: string }> };

const appointmentDate = (value: string, timezone?: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timezone ? { timeZone: timezone } : {}) }).format(new Date(value));
const localDateAt = (timezone: string) => { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); return `${parts.find((part) => part.type === 'year')?.value}-${parts.find((part) => part.type === 'month')?.value}-${parts.find((part) => part.type === 'day')?.value}`; };

export function CustomerAccountView({ initialSection, onExploreClick }: { initialSection?: 'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings'; onExploreClick?: () => void } = {}) {
  const router = useRouter();
  const customerSession = useCustomerSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<CustomerRecords>({ practices: [], appointments: [], documents: [], invoices: [], notifications: [] });
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [documentSearch, setDocumentSearch] = useState('');
  const [documentFrom, setDocumentFrom] = useState('');
  const [documentTo, setDocumentTo] = useState('');
  const [documentGroupBy, setDocumentGroupBy] = useState<'practice' | 'date'>('practice');
  const [appointmentFilter, setAppointmentFilter] = useState<'upcoming' | 'past' | 'cancelled'>('upcoming');
  const [appointmentSection, setAppointmentSection] = useState<'bookings' | 'recordings'>('bookings');
  const [appointmentFiltersOpen, setAppointmentFiltersOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings'>(initialSection ?? 'home');
  const [darkMode, setDarkMode] = useState(false);

  function selectSection(section: 'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings') {
    setActiveSection(section);
    const url = new URL(window.location.href);
    url.searchParams.set('section', section);
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    const onThemeChange = (event: Event) => setDarkMode((event as CustomEvent<boolean>).detail);
    window.addEventListener('ayushman-theme-change', onThemeChange);
    const savedTheme = window.localStorage.getItem('ayushman-theme') === 'dark';
    setDarkMode(savedTheme);
    document.documentElement.dataset.theme = savedTheme ? 'dark' : 'light';
    const requestedSection = new URLSearchParams(window.location.search).get('section');
    if (initialSection) setActiveSection(initialSection);
    else if (['home', 'appointments', 'records', 'billing', 'profile', 'settings'].includes(requestedSection ?? '')) {
      setActiveSection(requestedSection as 'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings');
    }
    return () => window.removeEventListener('ayushman-theme-change', onThemeChange);
  }, [initialSection]);

  function toggleTheme() {
    const enabled = !darkMode;
    setDarkMode(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    window.localStorage.setItem('ayushman-theme', enabled ? 'dark' : 'light');
    window.dispatchEvent(new CustomEvent<boolean>('ayushman-theme-change', { detail: enabled }));
  }

  const documentGroups = useMemo(() => {
    const query = documentSearch.trim().toLocaleLowerCase();
    const from = documentFrom ? new Date(`${documentFrom}T00:00:00`) : null;
    const to = documentTo ? new Date(`${documentTo}T23:59:59.999`) : null;
    const filtered = records.documents.filter((document) => {
      const createdAt = new Date(document.createdAt);
      const matchesSearch = !query || [document.originalName, document.practiceName, document.category, document.description ?? '']
        .some((value) => value.toLocaleLowerCase().includes(query));
      return matchesSearch && (!from || createdAt >= from) && (!to || createdAt <= to);
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const groups = new Map<string, { title: string; documents: CustomerDocument[] }>();
    for (const document of filtered) {
      const date = new Date(document.createdAt);
      const key = documentGroupBy === 'practice' ? document.practiceId : date.toLocaleDateString();
      const title = documentGroupBy === 'practice' ? document.practiceName : new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date);
      const group = groups.get(key) ?? { title, documents: [] };
      group.documents.push(document);
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => documentGroupBy === 'practice'
      ? a.title.localeCompare(b.title)
      : new Date(b.documents[0].createdAt).getTime() - new Date(a.documents[0].createdAt).getTime());
  }, [records.documents, documentSearch, documentFrom, documentTo, documentGroupBy]);

  const now = Date.now();
  const upcomingAppointments = records.appointments.filter((appointment) => new Date(appointment.startsAt).getTime() >= now && !['cancelled', 'no_show', 'completed', 'interrupted'].includes(appointment.status)).sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  const pastAppointments = records.appointments.filter((appointment) => (new Date(appointment.startsAt).getTime() < now || ['completed', 'no_show', 'interrupted'].includes(appointment.status)) && appointment.status !== 'cancelled').sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const cancelledAppointments = records.appointments.filter((appointment) => appointment.status === 'cancelled').sort((a, b) => b.startsAt.localeCompare(a.startsAt));
  const displayedAppointments = appointmentFilter === 'upcoming' ? upcomingAppointments : appointmentFilter === 'past' ? pastAppointments : cancelledAppointments;
  const nextAppointment = upcomingAppointments[0];
  const currencyTotal = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount / 100);

  useEffect(() => {
    if (customerSession.status === 'checking') return;
    if (customerSession.status !== 'customer' || !customerSession.customer) {
      if (customerSession.status === 'signed-out' || customerSession.status === 'practice') router.replace('/customer/login?returnTo=%2Fcustomer%2Faccount');
      if (customerSession.status === 'unavailable') { setError('Could not check your sign-in. Please retry.'); setLoading(false); }
      return;
    }
    let active = true;
    const nextProfile: Profile = { ...customerSession.customer, phone: customerSession.customer.phone ?? null };
    Promise.all([Promise.resolve(nextProfile), api<CustomerRecords>('/customer/me/records')])
      .then(([loadedProfile, nextRecords]) => {
        if (!active) return;
        setProfile(loadedProfile); setFullName(loadedProfile.fullName); setPhone(loadedProfile.phone ?? ''); setRecords(nextRecords);
      }).catch((cause) => {
        if (!active) return;
        if (cause instanceof ApiError && cause.status === 401) router.replace('/customer/login?returnTo=%2Fcustomer%2Faccount');
        else setError(cause instanceof Error ? cause.message : 'Could not load your account.');
      }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [router, customerSession.status, customerSession.customer]);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = CustomerProfileUpdateInput.safeParse({ fullName, phone: phone || null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check your profile details.'); return; }
    setSaving(true); setError(''); setSuccess('');
    try {
      const updated = await api<Profile>('/customer/me', { method: 'PATCH', body: JSON.stringify(parsed.data) });
      setProfile(updated); setFullName(updated.fullName); setPhone(updated.phone ?? '');
      setSuccess('Profile saved. Your linked provider records have been updated.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save your profile.'); }
    finally { setSaving(false); }
  }

  function printInvoice(invoice: CustomerInvoice) {
    const popup = window.open('', '_blank', 'width=850,height=900');
    if (!popup) { setError('Allow the invoice window to open, then choose Print or Save as PDF.'); return; }
    popup.opener = null;
    const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
    const lines = invoice.lines.map((line) => `<tr><td>${escape(line.description)}</td><td>${(line.quantityMilli / 1000).toFixed(2)}</td><td>${currencyTotal(line.unitPriceMinor, invoice.currency)}</td><td>${currencyTotal(line.lineTotalMinor, invoice.currency)}</td></tr>`).join('');
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escape(invoice.invoiceNumber)}</title><style>body{font:14px Arial,sans-serif;color:#171923;max-width:820px;margin:42px auto;padding:0 24px}header{display:flex;justify-content:space-between;border-bottom:2px solid #823233;padding-bottom:20px}h1{font-size:26px;color:#823233;margin:0 0 8px}h2{font-size:16px;margin:25px 0 8px}p,small{color:#555;line-height:1.5}table{width:100%;border-collapse:collapse;margin-top:24px}th,td{text-align:left;padding:12px 8px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.totals{width:300px;margin:20px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:5px}.totals .grand{font-weight:bold;border-top:1px solid #bbb;margin-top:8px;padding-top:12px}@media print{body{margin:0 auto;padding:0}}</style></head><body><header><div><h1>${escape(invoice.supplierSnapshot.legalName || invoice.practiceName)}</h1><p>${escape(invoice.supplierSnapshot.address || invoice.locationName || '')}<br>${escape(invoice.supplierSnapshot.city || '')} ${escape(invoice.supplierSnapshot.postalCode || '')}</p></div><div style="text-align:right"><h2>${invoice.kind === 'receipt' ? 'RECEIPT' : 'INVOICE'}</h2><strong>${escape(invoice.invoiceNumber)}</strong><p>Issued ${escape(invoice.issueDate)}${invoice.dueDate ? `<br>Due ${escape(invoice.dueDate)}` : ''}</p></div></header><h2>Bill to</h2><p><strong>${escape(invoice.recipientSnapshot.fullName || profile?.fullName || '')}</strong><br>${escape(invoice.recipientSnapshot.email || '')}<br>${escape(invoice.recipientSnapshot.address || '')}</p><table><thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${lines}</tbody></table><div class="totals"><div><span>Subtotal</span><span>${currencyTotal(invoice.subtotalMinor, invoice.currency)}</span></div>${invoice.discountMinor ? `<div><span>Discount</span><span>−${currencyTotal(invoice.discountMinor, invoice.currency)}</span></div>` : ''}<div><span>Tax</span><span>${currencyTotal(invoice.taxMinor, invoice.currency)}</span></div><div class="grand"><span>Total</span><span>${currencyTotal(invoice.totalMinor, invoice.currency)}</span></div><div><span>Paid</span><span>${currencyTotal(invoice.amountPaidMinor, invoice.currency)}</span></div><div><span>Balance due</span><span>${currencyTotal(invoice.totalMinor - invoice.amountPaidMinor, invoice.currency)}</span></div></div><p><strong>${escape(invoice.status.replaceAll('_', ' ').toUpperCase())}</strong></p>${invoice.notes ? `<p>${escape(invoice.notes)}</p>` : ''}<small>${escape(invoice.practiceName)} · ${escape(invoice.locationName || '')}</small></body></html>`);
    popup.document.close();
    popup.onload = () => { popup.focus(); popup.print(); };
  }

  if (loading) return <main className="customer-account-page"><header className="customer-account-header"><Link className="booking-brand" href="/book" onClick={(event) => { if (onExploreClick) { event.preventDefault(); onExploreClick(); } }}><span>✳</span> Ayushman</Link><div className="customer-account-header-actions"><CustomerSessionLink activeSection={activeSection} onExploreClick={onExploreClick} onSectionSelect={selectSection} onProfileClick={() => selectSection('profile')}/></div></header><BrandLoader label="Loading your account…"/><CustomerSessionLink variant="footer" activeSection={activeSection} onExploreClick={onExploreClick} onSectionSelect={selectSection} onProfileClick={() => selectSection('profile')}/></main>;
  if (!profile) return <main className="customer-account-page"><p className="form-error">{error || 'Could not load your customer account.'}</p><Link href="/customer/login">Sign in</Link></main>;

  return <main className="customer-account-page customer-desktop-workspace">
    <aside className="customer-desktop-sidebar" aria-label="Customer navigation">
      <Link className="customer-desktop-brand" href="/book" onClick={(event) => { if (onExploreClick) { event.preventDefault(); onExploreClick(); } }}><span><Leaf size={19}/></span>Ayushman</Link>
      <div className="customer-sidebar-context"><span><UserRound size={18}/></span><div><strong>Your account</strong><small>Bookings and records</small></div></div>
      <nav aria-label="Account sections">
        <p>MY ACCOUNT</p>
        {([{ id: 'home', label: 'Home', icon: <House size={18}/> }, { id: 'appointments', label: 'My appointments', icon: <CalendarDays size={18}/> }, { id: 'records', label: 'Records & files', icon: <FileText size={18}/> }, { id: 'billing', label: 'Billing', icon: <WalletCards size={18}/> }, { id: 'profile', label: 'Profile', icon: <UserRound size={18}/> }, { id: 'settings', label: 'Settings', icon: <Settings size={18}/> }] as const).map((section) => <button type="button" aria-current={activeSection === section.id ? 'page' : undefined} className={activeSection === section.id ? 'active' : ''} key={section.id} onClick={() => selectSection(section.id)}>{section.icon}<span>{section.label}</span></button>)}
      </nav>
      <button type="button" className="customer-sidebar-explore" onClick={() => onExploreClick ? onExploreClick() : router.push('/book', { scroll: false })}><Compass size={18}/>Explore services<ArrowRight size={15}/></button>
      <div className="customer-sidebar-user"><span>{profile.fullName.trim().charAt(0).toLocaleUpperCase()}</span><div><strong>{profile.fullName}</strong><small>Customer account</small></div></div>
    </aside>
    <header className="customer-account-header"><Link className="booking-brand" href="/book" onClick={(event) => { if (onExploreClick) { event.preventDefault(); onExploreClick(); } }}><span>✳</span><span className="customer-header-label">Customer workspace</span></Link><div className="customer-account-header-actions"><Link href="/book" className="button button-secondary" onClick={(event) => { if (onExploreClick) { event.preventDefault(); onExploreClick(); } }}><Search size={14}/> Explore services</Link><CustomerSessionLink initialCustomer={{ fullName: profile.fullName, email: profile.email }} activeSection={activeSection} onExploreClick={onExploreClick} onSectionSelect={selectSection} onProfileClick={() => selectSection('profile')}/></div></header>
    <PageHeading name={profile.fullName}/>
    {records.notifications.map((notice) => <aside className="customer-appointment-notice" key={notice.id}><span><strong>{notice.kind === 'practitioner_cancelled' ? 'Your provider cancelled this appointment' : 'Your appointment time was changed'}</strong><small>{notice.serviceName} · {notice.practiceName}{notice.kind === 'practitioner_rescheduled' ? ` · ${appointmentDate(notice.startsAt, notice.timezone)}` : ''}</small></span><button className="button button-secondary" type="button" onClick={async () => { await api(`/customer/me/notifications/${notice.id}/read`, { method: 'POST' }); setRecords((current) => ({ ...current, notifications: current.notifications.filter((item) => item.id !== notice.id) })); }}>Dismiss</button></aside>)}
    <nav className="customer-portal-nav" role="tablist" aria-label="Customer account sections">{([{ id: 'home', label: 'Home', mobileLabel: 'Home', icon: <House size={17}/> }, { id: 'appointments', label: 'My appointments', mobileLabel: 'Bookings', icon: <CalendarDays size={17}/> }, { id: 'records', label: 'Records & files', mobileLabel: 'Files', icon: <FileText size={17}/> }, { id: 'billing', label: 'Billing', mobileLabel: 'Billing', icon: <WalletCards size={17}/> }, { id: 'profile', label: 'Profile', mobileLabel: 'Profile', icon: <UserRound size={17}/> }, { id: 'settings', label: 'Settings', mobileLabel: 'Settings', icon: <Settings size={17}/> }] as const).map((section) => <button type="button" role="tab" aria-label={section.label} aria-selected={activeSection === section.id} className={`${activeSection === section.id ? 'active' : ''}${section.id === 'profile' ? ' customer-portal-profile-tab' : ''}`} key={section.id} onClick={() => selectSection(section.id)}>{section.icon}<span className="customer-nav-label-desktop">{section.label}</span><span className="customer-nav-label-mobile" aria-hidden="true">{section.mobileLabel}</span></button>)}</nav>

    {activeSection === 'home' && <><section className="customer-dashboard" id="overview"><div className="customer-dashboard-main"><p className="eyebrow">YOUR NEXT APPOINTMENT</p>{nextAppointment ? <><div className="customer-next-top"><span className="customer-appointment-icon"><CalendarDays size={19}/></span><span className={`status-badge status-${nextAppointment.status.replaceAll('_', '-')}`}>{nextAppointment.status.replaceAll('_', ' ')}</span></div><h2>{nextAppointment.serviceName}</h2><p>{nextAppointment.termOverrides.professionalSingular || 'Professional'}: {nextAppointment.professionalName} · {nextAppointment.professionName}</p><p><MapPin size={14}/>{nextAppointment.locationName} · {nextAppointment.practiceName}</p><strong className="customer-next-date"><Clock3 size={15}/>{appointmentDate(nextAppointment.startsAt, nextAppointment.timezone)}</strong><button type="button" className="text-link" onClick={() => selectSection('appointments')}>View appointment details <ArrowRight size={14}/></button></> : <><h2>You’re all caught up.</h2><p>Your upcoming appointments will appear here.</p><Link href="/book" className="button button-primary">Explore available services <ArrowRight size={15}/></Link></>}</div><div className="customer-dashboard-stats"><article><span>Upcoming</span><strong>{upcomingAppointments.length}</strong><small>Appointments ahead</small></article><article><span>Previous</span><strong>{pastAppointments.length}</strong><small>Past appointments</small></article><article><span>Shared files</span><strong>{records.documents.length}</strong><small>Available in your account</small></article></div></section>

    <section className="customer-account-grid"><article className="customer-account-card"><p className="eyebrow">YOUR SERVICE PROVIDERS</p><h2>Connected accounts</h2>{records.practices.length ? <ul className="customer-linked-practices">{records.practices.map((practice) => <li key={practice.clientId}><span><MapPin size={15}/><strong>{practice.practiceName}</strong></span><small>Account connected · {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(practice.linkedAt))}</small></li>)}</ul> : <p className="customer-empty">Service-provider accounts will appear here after your first booking.</p>}</article><article className="customer-account-card"><p className="eyebrow">QUICK LINKS</p><h2>What would you like to do?</h2><div className="customer-quick-links"><button type="button" onClick={() => selectSection('appointments')}><CalendarDays size={17}/><span><strong>Manage appointments</strong><small>See upcoming and previous bookings</small></span><ArrowRight size={15}/></button><button type="button" onClick={() => selectSection('records')}><FileText size={17}/><span><strong>Open shared files</strong><small>Only files shared with your account</small></span><ArrowRight size={15}/></button><button type="button" onClick={() => selectSection('billing')}><WalletCards size={17}/><span><strong>View invoices</strong><small>Check balances and recorded payments</small></span><ArrowRight size={15}/></button></div></article><article className="customer-account-card customer-home-option"><p className="eyebrow">YOUR BOOKINGS</p><h2>My appointments</h2><p>{upcomingAppointments.length ? `${upcomingAppointments.length} upcoming · ${pastAppointments.length} previous` : `No upcoming appointments · ${pastAppointments.length} previous`}</p><button type="button" className="button button-secondary" onClick={() => selectSection('appointments')}>Open appointments <ArrowRight size={14}/></button></article><article className="customer-account-card customer-home-option"><p className="eyebrow">YOUR DETAILS</p><h2>My profile</h2><p><strong>{profile.fullName}</strong><br/>{profile.email}{profile.phone ? ` · ${profile.phone}` : ''}</p><button type="button" className="button button-secondary" onClick={() => selectSection('profile')}>Manage profile <ArrowRight size={14}/></button></article></section></>}

    {activeSection === 'appointments' && <section className="customer-account-card customer-appointment-card customer-tab-panel" id="appointments"><div className="customer-section-heading"><div><p className="eyebrow">YOUR SCHEDULE</p><h2>{appointmentSection === 'bookings' ? 'Bookings' : 'Session recordings'}</h2></div>{appointmentSection === 'bookings' && <a className="button button-primary" href="/book"><CalendarDays size={15}/> Book a service</a>}</div>
      <div className="customer-booking-sections" role="tablist" aria-label="Bookings and recordings"><button type="button" role="tab" aria-selected={appointmentSection === 'bookings'} className={appointmentSection === 'bookings' ? 'active' : ''} onClick={() => setAppointmentSection('bookings')}><CalendarDays size={15}/>Bookings<span>{records.appointments.length}</span></button><button type="button" role="tab" aria-selected={appointmentSection === 'recordings'} className={appointmentSection === 'recordings' ? 'active' : ''} onClick={() => setAppointmentSection('recordings')}><FileText size={15}/>Session recordings</button></div>
      {appointmentSection === 'recordings' ? <CustomerSessionReplays/> : <><div className="customer-booking-filter-row"><button type="button" className="button button-secondary customer-filter-toggle" aria-expanded={appointmentFiltersOpen} aria-controls="customer-appointment-filters" onClick={() => setAppointmentFiltersOpen((open) => !open)}><SlidersHorizontal size={15}/>{appointmentFiltersOpen ? 'Hide filters' : 'Filter bookings'}</button><div id="customer-appointment-filters" className={`customer-appointment-tabs${appointmentFiltersOpen ? ' filters-open' : ''}`} role="tablist" aria-label="Filter bookings">{([{ id: 'upcoming', label: 'Upcoming', count: upcomingAppointments.length }, { id: 'past', label: 'Previous', count: pastAppointments.length }, { id: 'cancelled', label: 'Cancelled', count: cancelledAppointments.length }] as const).map((tab) => <button type="button" role="tab" aria-selected={appointmentFilter === tab.id} className={appointmentFilter === tab.id ? 'active' : ''} key={tab.id} onClick={() => { setAppointmentFilter(tab.id); setAppointmentFiltersOpen(false); }}>{tab.label}<span>{tab.count}</span></button>)}</div></div>
      {displayedAppointments.length ? <div className="customer-appointments">{displayedAppointments.map((appointment) => <CustomerAppointmentCard key={appointment.id} appointment={appointment} onChanged={async () => { const latest = await api<CustomerRecords>('/customer/me/records'); setRecords(latest); setSuccess('Appointment updated.'); }}/>)}</div> : <p className="customer-empty customer-tab-empty">{appointmentFilter === 'upcoming' ? 'No upcoming appointments. Explore services when you’re ready to book.' : appointmentFilter === 'past' ? 'Previous appointments will appear here.' : 'You have no cancelled appointments.'}</p>}</>}
    </section>}

    {activeSection === 'records' && <section className="customer-account-card customer-appointment-card customer-tab-panel" id="records"><div className="customer-section-heading"><div><p className="eyebrow">YOUR HISTORY</p><h2>Records & shared files</h2></div>{records.documents.length > 0 && <span className="customer-document-count">{documentGroups.reduce((count, group) => count + group.documents.length, 0)} of {records.documents.length} files</span>}</div>
      {records.documents.length ? <><div className="customer-document-filters"><label className="customer-document-search"><Search size={16}/><input type="search" value={documentSearch} onChange={(event) => setDocumentSearch(event.target.value)} placeholder="Search by file or provider" aria-label="Search shared files by name or provider"/></label><label className="customer-document-date">From<DatePicker value={documentFrom} max={documentTo || undefined} onChange={setDocumentFrom} ariaLabel="Filter files from date" placeholder="Any date"/></label><label className="customer-document-date">To<DatePicker value={documentTo} min={documentFrom || undefined} onChange={setDocumentTo} ariaLabel="Filter files to date" placeholder="Any date"/></label><label className="customer-document-group"><Building2 size={15}/><Select ariaLabel="Group shared files" value={documentGroupBy} onChange={(value) => setDocumentGroupBy(value as 'practice' | 'date')} options={[{ value: 'practice', label: 'Group by provider' }, { value: 'date', label: 'Group by date' }]} /></label></div>
        {documentGroups.length ? documentGroups.map((group) => <div className="customer-document-group-list" key={group.title}><h3><span>{group.title}</span><small>{group.documents.length} {group.documents.length === 1 ? 'file' : 'files'}</small></h3><div className="customer-appointments">{group.documents.map((document) => <article className="customer-appointment-row" key={document.id}><span className="customer-appointment-icon"><FileText size={17}/></span><div><strong>{document.originalName}</strong><small>{document.practiceName} · {document.category.replaceAll('_', ' ')} · {appointmentDate(document.createdAt)}</small>{document.description && <small>{document.description}</small>}</div><div className="inline-actions"><a className="button button-secondary" href={`${API_BASE}/customer/me/documents/${document.id}/content?inline=1`} target="_blank" rel="noreferrer"><FileText size={14}/> View file</a><a className="button button-secondary" href={`${API_BASE}/customer/me/documents/${document.id}/content`}><Download size={14}/> Download file</a></div></article>)}</div></div>) : <p className="customer-empty customer-document-no-results">No shared files match these filters. <button type="button" onClick={() => { setDocumentSearch(''); setDocumentFrom(''); setDocumentTo(''); }}>Clear filters</button></p>}
      </> : <p className="customer-empty">Files shared by your service providers will appear here.</p>}
    </section>}

    {activeSection === 'billing' && <section className="customer-account-card customer-appointment-card customer-tab-panel" id="billing"><div className="customer-section-heading"><div><p className="eyebrow">YOUR FINANCIAL HISTORY</p><h2>Invoices & payments</h2></div><span className="customer-document-count">{records.invoices.length} {records.invoices.length === 1 ? 'document' : 'documents'}</span></div>{records.invoices.length ? <div className="customer-invoice-list">{records.invoices.map((invoice) => <article className="customer-invoice-row" key={invoice.id}><span className="customer-appointment-icon"><WalletCards size={17}/></span><div className="customer-invoice-main"><strong>{invoice.invoiceNumber}</strong><small>{invoice.practiceName}{invoice.locationName ? ` · ${invoice.locationName}` : ''} · {invoice.issueDate}</small><small>{invoice.lines.map((line) => line.description).join(', ') || (invoice.kind === 'receipt' ? 'Receipt' : 'Invoice')}</small><details><summary>View breakdown and payments</summary><div className="customer-invoice-details"><div className="customer-invoice-lines">{invoice.lines.map((line) => <p key={line.id}><span>{line.description} <small>× {(line.quantityMilli / 1000).toFixed(2)}</small></span><b>{currencyTotal(line.lineTotalMinor, invoice.currency)}</b></p>)}</div><p><span>Subtotal</span><b>{currencyTotal(invoice.subtotalMinor, invoice.currency)}</b></p>{invoice.discountMinor > 0 && <p><span>Discount</span><b>−{currencyTotal(invoice.discountMinor, invoice.currency)}</b></p>}<p><span>Tax</span><b>{currencyTotal(invoice.taxMinor, invoice.currency)}</b></p><p className="customer-invoice-total"><span>Total</span><b>{currencyTotal(invoice.totalMinor, invoice.currency)}</b></p><p><span>Paid</span><b>{currencyTotal(invoice.amountPaidMinor, invoice.currency)}</b></p><p><span>Balance due</span><b>{currencyTotal(invoice.totalMinor - invoice.amountPaidMinor, invoice.currency)}</b></p>{invoice.payments.length > 0 && <div className="customer-payment-history"><strong>Recorded payments</strong>{invoice.payments.map((payment) => <p key={payment.id}>{currencyTotal(payment.amountMinor, invoice.currency)} · {payment.method.replaceAll('_', ' ')} · {appointmentDate(payment.receivedAt)}</p>)}</div>}</div></details></div><div className="customer-invoice-actions"><span className={`status-badge status-${invoice.status.replaceAll('_', '-')}`}>{invoice.status.replaceAll('_', ' ')}</span><strong>{currencyTotal(invoice.totalMinor, invoice.currency)}</strong><button className="button button-secondary" onClick={() => printInvoice(invoice)}><Download size={14}/> Print / save PDF</button></div></article>)}</div> : <p className="customer-empty">Invoices and receipts issued to your account will appear here. An invoice and a payment receipt are shown as separate documents.</p>}</section>}

    {activeSection === 'profile' && <section className="customer-account-card customer-appointment-card customer-tab-panel" id="profile"><div className="customer-section-heading"><div><p className="eyebrow">YOUR ACCOUNT</p><h2>Profile & contact details</h2></div></div><form className="customer-profile-form" onSubmit={(event) => void saveProfile(event)}><label>Full name<input required minLength={2} maxLength={160} value={fullName} onChange={(event) => setFullName(event.target.value)}/></label><label>Email address<input value={profile.email} readOnly/><small>Email changes require verification and are not available yet.</small></label><label>Phone number<PhoneField value={phone} onChange={setPhone}/></label>{error && <p className="form-error" role="alert">{error}</p>}{success && <p className="save-success"><Check size={14}/>{success}</p>}<button type="submit" className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save profile'}</button></form></section>}
    {activeSection === 'settings' && <section className="customer-account-card customer-appointment-card customer-tab-panel" id="settings"><div className="customer-section-heading"><div><p className="eyebrow">PREFERENCES</p><h2>Account settings</h2></div></div><div className="customer-setting-row"><span className="customer-setting-icon">{darkMode ? <Moon size={18}/> : <Sun size={18}/>}</span><span><strong>Appearance</strong><small>Choose the display theme for your account and booking pages.</small></span><button type="button" className={`customer-theme-switch-button${darkMode ? ' on' : ''}`} role="switch" aria-checked={darkMode} aria-label="Enable dark mode" onClick={toggleTheme}><i/></button></div><div className="customer-setting-row"><span className="customer-setting-icon"><UserRound size={18}/></span><span><strong>Account identity</strong><small>Signed in as {profile.email}. Your bookings and shared records are linked to this account.</small></span></div></section>}
    <p className="customer-record-note"><UserRound size={14}/> You can see only your account details and files explicitly shared with you by each provider.</p>
  </main>;
}

function CustomerAppointmentCard({ appointment, onChanged }: { appointment: CustomerAppointment; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false); const [date, setDate] = useState(''); const [slots, setSlots] = useState<Array<{ startsAt: string; endsAt: string; professional: { id: string; name: string } }>>([]);
  const [slot, setSlot] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function loadSlots(nextDate: string) {
    setDate(nextDate); setSlot(''); setError(''); setSlots([]); if (!nextDate) return;
    setBusy(true);
    try { const query = new URLSearchParams({ serviceId: appointment.serviceId, locationId: appointment.locationId, professionalUserId: appointment.professionalUserId, from: nextDate, to: nextDate }); const result = await api<{ slots: typeof slots }>(`/customer/me/appointments/${appointment.id}/availability?${query}`); setSlots(result.slots); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not load available times.'); }
    finally { setBusy(false); }
  }
  async function cancel() {
    if (!window.confirm(`Cancel your ${appointment.serviceName} appointment on ${appointmentDate(appointment.startsAt, appointment.timezone)}?`)) return;
    setBusy(true); setError(''); try { await api(`/customer/me/appointments/${appointment.id}/cancel`, { method: 'POST', body: JSON.stringify({}) }); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not cancel this appointment.'); } finally { setBusy(false); }
  }
  async function reschedule() {
    if (!slot) return; setBusy(true); setError(''); try { await api(`/customer/me/appointments/${appointment.id}/reschedule`, { method: 'POST', body: JSON.stringify({ startsAt: slot }) }); setOpen(false); await onChanged(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not reschedule this appointment.'); } finally { setBusy(false); }
  }
  const canManage = (appointment.canCustomerCancel || appointment.canCustomerReschedule) && ['pending', 'confirmed'].includes(appointment.status) && new Date(appointment.startsAt).getTime() > Date.now();
  return <article className="customer-appointment-row"><span className="customer-appointment-icon"><CalendarDays size={17}/></span><div><strong>{appointment.serviceName}{appointment.followUpToAppointmentId && <span className="follow-up-tag">Follow-up</span>}{appointment.followUps?.length > 0 && <span className="follow-up-tag follow-up-scheduled-tag">Follow-up scheduled</span>}</strong><small>{appointment.practiceName} · {appointment.termOverrides.professionalSingular || 'Professional'}: {appointment.professionalName}</small><small><MapPin size={12}/>{appointment.locationName} · {appointmentDate(appointment.startsAt, appointment.timezone)}</small>{appointment.followUpSource && <small className="customer-follow-up-context">Follow-up to {appointment.followUpSource.serviceName} · {appointmentDate(appointment.followUpSource.startsAt, appointment.followUpSource.timezone)}</small>}{appointment.followUps?.map((followUp) => <small className="customer-follow-up-context" key={followUp.id}>Next follow-up · {followUp.serviceName} · {appointmentDate(followUp.startsAt, followUp.timezone)}</small>)}</div><span className={`status-badge status-${appointment.status.replaceAll('_', '-')}`}>{appointment.status.replaceAll('_', ' ')}</span><details className="customer-appointment-details"><summary>View details</summary><div><span><b>Service</b>{appointment.serviceName}</span><span><b>{appointment.termOverrides.professionalSingular || 'Professional'}</b>{appointment.professionalName}</span><span><b>Provider</b>{appointment.practiceName}</span><span><b>Location</b>{appointment.locationName}</span><span><b>Date & time</b>{appointmentDate(appointment.startsAt, appointment.timezone)} · {appointment.timezone}</span><span><b>Booking reference</b>{appointment.id.slice(0, 8).toUpperCase()}</span>{appointment.priceMinor !== null && <span><b>Service price</b>{new Intl.NumberFormat(undefined, { style: 'currency', currency: appointment.currency }).format(appointment.priceMinor / 100)}</span>}</div></details>
    {canManage && <div className="customer-appointment-actions">{appointment.canCustomerReschedule && <button className="button button-secondary" type="button" onClick={() => { setOpen((value) => !value); setError(''); }}>{open ? 'Close rescheduling' : 'Reschedule'}</button>}{appointment.canCustomerCancel && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void cancel()}>{busy ? 'Please wait…' : 'Cancel appointment'}</button>}</div>}
    {open && <div className="customer-reschedule-form"><label>Choose a new date<DatePicker min={localDateAt(appointment.timezone)} value={date} onChange={(value) => void loadSlots(value)} ariaLabel="Choose a new appointment date"/></label>{busy ? <small>Checking availability…</small> : date && (slots.length ? <label>Available time<DropdownSelect value={slot} onChange={(event) => setSlot(event.target.value)}><option value="">Choose a time</option>{slots.map((item) => <option key={item.startsAt} value={item.startsAt}>{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: appointment.timezone }).format(new Date(item.startsAt))}</option>)}</DropdownSelect></label> : <small>No available times on this date.</small>)}{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" type="button" disabled={!slot || busy} onClick={() => void reschedule()}>{busy ? 'Saving…' : 'Confirm new time'}</button></div>}
    {error && !open && <p className="form-error" role="alert">{error}</p>}</article>;
}

function PageHeading({ name }: { name: string }) {
  return <div className="customer-account-title"><p className="eyebrow">YOUR ACCOUNT</p><h1>Welcome back, {name}</h1><p>Manage your bookings, shared information, and services in one place.</p></div>;
}
