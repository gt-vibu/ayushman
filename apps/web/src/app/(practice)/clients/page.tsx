'use client';

import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { AudioLines, CalendarDays, FileText, GitMerge, Link2, Pencil, Plus, ReceiptText, Search, UserRound, Users } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { api, API_BASE, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import { appointmentStatusLabel, type Appointment, type Client } from '@/lib/types';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/app-shell';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';
import { Dialog } from '@/components/dialog';
import { PhoneField } from '@/components/ui/phone-field';

export default function ClientsPage() {
  const { practice, permissions, session, branchId } = usePractice();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [applied, setApplied] = useState(params.get('q') ?? '');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Client | null>(null);
  const [historyClient, setHistoryClient] = useState<Client | null>(null);
  const [mergeSource, setMergeSource] = useState<Client | null>(null);
  const [linkSource, setLinkSource] = useState<Client | null>(null);
  const canMerge = permissions['clients.update'] && session.practices.some((item) => item.practiceId === practice.id && item.roles.includes('owner'));
  const query = new URLSearchParams({ limit: '100' });
  if (applied.trim().length >= 2) query.set('q', applied.trim());
  if (branchId) query.set('locationId', branchId);
  const url = useMemo(() => practicePath(practice.id, `/clients?${query.toString()}`), [practice.id, applied, branchId]);
  const { data, loading, error, reload } = useApiData<Client[]>(url);
  const pagination = usePaginatedItems(data ?? [], applied);

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setApplied(search); }

  return <><PageHeader eyebrow="CLIENT RELATIONSHIPS" title="Client directory" description="Add a client now, then record a visit whenever you need to." action={<div className="inline-actions"><span className="count-pill">{data?.length ?? '—'} shown</span>{permissions['clients.create'] && <button className="button button-primary" type="button" onClick={() => setAddOpen(true)}><Plus size={15}/> Add client</button>}</div>}/>
    <section className="section-card resource-card"><form className="filter-bar" onSubmit={submit}><label className="field-search"><Search size={17}/><input placeholder="Search name, email, or phone" value={search} onChange={(event) => setSearch(event.target.value)}/></label><button className="button button-secondary">Search directory</button></form>
      {loading ? <LoadingState/> : error ? <ErrorState message={error}/> : !data?.length ? <EmptyState title="No clients found" description="Add a client record for an online booking or an in-person visit. They do not need an Ayushman account." icon={Users}/> : <><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Added</th>{permissions['clients.update'] && <th>Manage</th>}</tr></thead><tbody>{pagination.pageItems.map((client) => <tr key={client.id}><td data-label="Name"><button type="button" className="client-history-trigger" onClick={() => setHistoryClient(client)} aria-label={`View history for ${client.fullName}`}><strong>{client.fullName}</strong><span>View history</span></button></td><td data-label="Email">{client.email || '—'}</td><td data-label="Phone">{client.phone || '—'}</td><td data-label="Added">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: practice.timezone }).format(new Date(client.createdAt))}</td>{permissions['clients.update'] && <td data-label="Manage"><div className="inline-actions"><button type="button" className="button button-secondary" onClick={() => setEditing(client)}><Pencil size={14}/> Edit</button>{canMerge && <><button type="button" className="button button-secondary" onClick={() => setMergeSource(client)}><GitMerge size={14}/> Merge duplicate</button><button type="button" className="button button-secondary" onClick={() => setLinkSource(client)}><Link2 size={14}/> Link account</button></>}</div></td>}</tr>)}</tbody></table></div><Pagination total={data.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/></>}
    </section>
    {historyClient && <ClientHistoryDialog client={historyClient} practiceId={practice.id} timezone={practice.timezone} userId={session.user.id} branchId={branchId} permissions={permissions} onClose={() => setHistoryClient(null)}/>}
    {permissions['clients.create'] && <AddClientDialog open={addOpen} practiceId={practice.id} branchId={branchId} onClose={() => setAddOpen(false)} onCreated={() => { setAddOpen(false); setApplied(''); setSearch(''); reload(); }} />}
    <EditClientDialog client={editing} practiceId={practice.id} branchId={branchId} onClose={() => setEditing(null)} onUpdated={() => { setEditing(null); reload(); }}/>
    <MergeClientDialog source={mergeSource} candidates={data ?? []} practiceId={practice.id} onClose={() => setMergeSource(null)} onMerged={() => { setMergeSource(null); reload(); }}/>
    <LinkClientAccountDialog source={linkSource} practiceId={practice.id} onClose={() => setLinkSource(null)} onLinked={() => { setLinkSource(null); reload(); }}/>
  </>;
}

type ClientFile = { id: string; originalName: string; category: string; description: string | null; customerVisible: boolean; createdAt: string; sizeBytes: number };
type ClientInvoice = { id: string; invoiceNumber: string; status: string; currency: string; issueDate: string; totalMinor: number; amountPaidMinor: number; clientId: string };
type ClientRecording = { id: string; status: string; sharingStatus: string; durationSeconds: number | null; createdAt: string };
type ClientHistoryTab = 'overview' | 'visits' | 'files' | 'invoices';

function ClientHistoryDialog({ client, practiceId, timezone, userId, branchId, permissions, onClose }: { client: Client; practiceId: string; timezone: string; userId: string; branchId: string; permissions: Record<string, boolean>; onClose: () => void }) {
  const [tab, setTab] = useState<ClientHistoryTab>('overview');
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [files, setFiles] = useState<ClientFile[]>([]);
  const [invoices, setInvoices] = useState<ClientInvoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const canReadVisits = permissions['appointments.read'];
  const canReadFiles = permissions['records.read'];
  const canReadInvoices = permissions['billing.read'];

  useEffect(() => {
    let active = true;
    const tasks: Array<Promise<void>> = [];
    if (canReadVisits) tasks.push(api<Appointment[]>(practicePath(practiceId, `/appointments?clientId=${encodeURIComponent(client.id)}&limit=200${branchId ? `&locationId=${encodeURIComponent(branchId)}` : ''}`)).then((items) => { if (active) setAppointments(items); }).catch((cause: unknown) => { if (active) setErrors((current) => ({ ...current, visits: cause instanceof Error ? cause.message : 'Could not load visits.' })); }));
    if (canReadFiles) tasks.push(api<ClientFile[]>(practicePath(practiceId, `/records?clientId=${encodeURIComponent(client.id)}${branchId ? `&locationId=${encodeURIComponent(branchId)}` : ''}`)).then((items) => { if (active) setFiles(items); }).catch((cause: unknown) => { if (active) setErrors((current) => ({ ...current, files: cause instanceof Error ? cause.message : 'Could not load files.' })); }));
    if (canReadInvoices) tasks.push(api<ClientInvoice[]>(practicePath(practiceId, '/billing/invoices')).then((items) => { if (active) setInvoices(items.filter((invoice) => invoice.clientId === client.id)); }).catch((cause: unknown) => { if (active) setErrors((current) => ({ ...current, invoices: cause instanceof Error ? cause.message : 'Could not load invoices.' })); }));
    void Promise.all(tasks).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [client.id, practiceId, branchId, canReadVisits, canReadFiles, canReadInvoices]);

  const tabs: Array<{ id: ClientHistoryTab; label: string; count?: number }> = [
    { id: 'overview', label: 'Overview' },
    ...(canReadVisits ? [{ id: 'visits' as const, label: 'Visits', count: appointments.length }] : []),
    ...(canReadFiles ? [{ id: 'files' as const, label: 'Files', count: files.length }] : []),
    ...(canReadInvoices ? [{ id: 'invoices' as const, label: 'Invoices', count: invoices.length }] : []),
  ];
  const dateFormat = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: timezone }).format(new Date(value));
  const moneyFormat = (amount: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(amount / 100);

  return <Dialog open title="Client history" description="Contact details and practice history for this client." onClose={onClose}>
    <div className="client-history-dialog">
      <section className="client-history-profile"><span className="client-history-avatar"><UserRound size={20}/></span><div><h3>{client.fullName}</h3><p>Client since {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: timezone }).format(new Date(client.createdAt))}</p></div></section>
      <div className="client-history-contact"><div><span>Email</span><strong>{client.email || 'Not provided'}</strong></div><div><span>Phone</span><strong>{client.phone || 'Not provided'}</strong></div><div><span>Customer account</span><strong>{client.hasPortalAccount ? 'Linked' : 'Not linked'}</strong></div></div>
      <div className="client-history-tabs" role="tablist" aria-label="Client history sections">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? 'client-history-tab active' : 'client-history-tab'} onClick={() => setTab(item.id)}>{item.label}{item.count !== undefined && <span>{item.count}</span>}</button>)}</div>
      <div className="client-history-panel" role="tabpanel">
        {loading && <LoadingState/>}
        {!loading && tab === 'overview' && <div className="client-history-summary">{canReadVisits && <p><CalendarDays size={16}/>{errors.visits ? 'Visits could not load' : `${appointments.length} visit${appointments.length === 1 ? '' : 's'} on record`}</p>}{canReadFiles && <p><FileText size={16}/>{errors.files ? 'Files could not load' : `${files.length} file${files.length === 1 ? '' : 's'} attached`}</p>}{canReadInvoices && <p><ReceiptText size={16}/>{errors.invoices ? 'Invoices could not load' : `${invoices.length} invoice${invoices.length === 1 ? '' : 's'} on record`}</p>}</div>}
        {!loading && tab === 'visits' && (errors.visits ? <ErrorState message={errors.visits}/> : appointments.length ? <div className="client-history-list">{appointments.map((appointment) => <AppointmentHistoryItem key={appointment.id} appointment={appointment} practiceId={practiceId} userId={userId} dateFormat={dateFormat} moneyFormat={moneyFormat}/>)}</div> : <EmptyState title="No visits yet" description="Appointments and walk-in visits will appear here." icon={CalendarDays}/>)}
        {!loading && tab === 'files' && (errors.files ? <ErrorState message={errors.files}/> : files.length ? <div className="client-history-list">{files.map((file) => <article key={file.id}><div className="client-history-item-heading"><strong><FileText size={15}/>{file.originalName}</strong><span className={`client-history-status ${file.customerVisible ? 'status-shared' : 'status-private'}`}>{file.customerVisible ? 'Shared with client' : 'Private'}</span></div><time>{dateFormat(file.createdAt)}</time><small>{file.category.replaceAll('_', ' ')} · {(file.sizeBytes / 1024).toFixed(0)} KB</small>{file.description && <p>{file.description}</p>}<button type="button" className="button button-secondary client-file-open" onClick={() => window.open(`${API_BASE}${practicePath(practiceId, `/records/files/${file.id}/content?inline=1`)}`, '_blank', 'noopener,noreferrer')}>Open file</button></article>)}</div> : <EmptyState title="No files yet" description="Files attached to this client will appear here." icon={FileText}/>)}
        {!loading && tab === 'invoices' && (errors.invoices ? <ErrorState message={errors.invoices}/> : invoices.length ? <div className="client-history-list">{invoices.map((invoice) => <article key={invoice.id}><div className="client-history-item-heading"><strong>{invoice.invoiceNumber}</strong><span className={`client-history-status status-${invoice.status}`}>{invoice.status.replaceAll('_', ' ')}</span></div><time>Issued {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: timezone }).format(new Date(`${invoice.issueDate}T12:00:00`))}</time><p>{moneyFormat(invoice.totalMinor, invoice.currency)} total · {moneyFormat(invoice.amountPaidMinor, invoice.currency)} paid</p></article>)}</div> : <EmptyState title="No invoices yet" description="Invoices for this client will appear here." icon={ReceiptText}/>)}
      </div>
    </div>
  </Dialog>;
}

function AppointmentHistoryItem({ appointment, practiceId, userId, dateFormat, moneyFormat }: { appointment: Appointment; practiceId: string; userId: string; dateFormat: (value: string) => string; moneyFormat: (amount: number, currency: string) => string }) {
  const [recordings, setRecordings] = useState<ClientRecording[]>([]);
  const [recordingsOpen, setRecordingsOpen] = useState(false);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsLoaded, setRecordingsLoaded] = useState(false);
  const [recordingsError, setRecordingsError] = useState('');
  const canReadRecording = appointment.professionalUserId === userId;

  async function toggleRecordings() {
    if (recordingsOpen) { setRecordingsOpen(false); return; }
    setRecordingsOpen(true);
    if (recordingsLoaded || recordingsLoading) return;
    setRecordingsLoading(true); setRecordingsError('');
    try {
      const result = await api<ClientRecording[]>(practicePath(practiceId, `/session-recordings/appointments/${appointment.id}`));
      setRecordings(result); setRecordingsLoaded(true);
    } catch (cause) { setRecordingsError(cause instanceof Error ? cause.message : 'Could not load session recordings.'); }
    finally { setRecordingsLoading(false); }
  }

  return <article>
    <div className="client-history-item-heading"><strong>{appointment.serviceName}</strong><span className={`client-history-status status-${appointment.status}`}>{appointmentStatusLabel[appointment.status]}</span></div>
    <time>{dateFormat(appointment.startsAt)}</time>
    {appointment.isFollowUp && <span className="client-history-follow-up">Follow-up</span>}{appointment.isWalkIn && <span className="client-history-follow-up">Walk-in</span>}
    {appointment.visitDescription && <p>{appointment.visitDescription}</p>}{appointment.practitionerNote && <p><b>Practitioner note:</b> {appointment.practitionerNote}</p>}{appointment.clientNote && <p><b>Client note:</b> {appointment.clientNote}</p>}
    {appointment.amountPaidMinor !== undefined && <small>Paid {moneyFormat(appointment.amountPaidMinor, appointment.currency || 'INR')}</small>}
    {canReadRecording && <div className="client-recording-history"><button type="button" className="button button-secondary" aria-expanded={recordingsOpen} onClick={() => void toggleRecordings()}><AudioLines size={14}/>{recordingsOpen ? 'Hide session recording' : 'Session recording'}</button>{recordingsOpen && <div className="client-recording-history-content">{recordingsLoading ? <small>Loading recording details…</small> : recordingsError ? <p className="form-error" role="alert">{recordingsError}</p> : !recordings.length ? <small>No session recording for this visit.</small> : recordings.map((recording) => <div className="client-recording-history-item" key={recording.id}><span>{recording.status === 'shared' ? 'Shared with client' : recording.status === 'ready_for_review' ? 'Private · ready for review' : recording.status.replaceAll('_', ' ')}</span>{recording.durationSeconds && <small>{Math.floor(recording.durationSeconds / 60)} min {recording.durationSeconds % 60} sec</small>}{['ready_for_review', 'shared'].includes(recording.status) && <audio controls preload="none" src={`${API_BASE}${practicePath(practiceId, `/session-recordings/${recording.id}/content`)}`}/>}</div>)}</div>}</div>}
  </article>;
}

function AddClientDialog({ open, practiceId, branchId, onClose, onCreated }: { open: boolean; practiceId: string; branchId: string; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSaving(true); setError('');
    try {
      await api(practicePath(practiceId, '/clients'), { method: 'POST', body: JSON.stringify({ fullName: name, ...(email.trim() ? { email: email.trim() } : {}), ...(phone ? { phone } : {}), ...(branchId ? { locationId: branchId } : {}) }) });
      setName(''); setEmail(''); setPhone(''); onCreated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not add this client.'); }
    finally { setSaving(false); }
  }
  return <Dialog open={open} title="Add a client" description="Create a private practice record. The client does not need to register online." onClose={onClose}>
    <form className="form-stack" onSubmit={submit}>
      <label>Client name<input autoComplete="name" required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)}/></label>
      <label>Email address <span className="field-hint">Optional</span><input type="email" autoComplete="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Phone number <span className="field-hint">Optional</span><PhoneField value={phone} onChange={setPhone}/></label>
      <p className="field-hint">Contact details are optional. Search for an existing client first to avoid duplicates.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Add client'}</button></div>
    </form>
  </Dialog>;
}

function EditClientDialog({ client, practiceId, branchId, onClose, onUpdated }: { client: Client | null; practiceId: string; branchId: string; onClose: () => void; onUpdated: () => void }) {
  const [name, setName] = useState(client?.fullName ?? ''); const [email, setEmail] = useState(client?.email ?? ''); const [phone, setPhone] = useState(client?.phone ?? '');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setName(client?.fullName ?? ''); setEmail(client?.email ?? ''); setPhone(client?.phone ?? ''); setError(''); }, [client]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!client) return; setSaving(true); setError('');
    try {
      await api(practicePath(practiceId, `/clients/${client.id}`), { method: 'PATCH', body: JSON.stringify({ fullName: name, email: email.trim() || null, phone: phone || null, ...(branchId ? { locationId: branchId } : {}) }) });
      onUpdated();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update this client.'); }
    finally { setSaving(false); }
  }
  return <Dialog open={Boolean(client)} title="Edit client details" description="Correct this practice record. Existing appointments and invoices stay linked; login ownership is not changed." onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      <label>Client name<input required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)}/></label>
      <label>Email address <span className="field-hint">Optional · this does not change the account login</span><input type="email" maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Phone number <span className="field-hint">Optional</span><PhoneField value={phone} onChange={setPhone}/></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={saving}>{saving ? 'Saving…' : 'Save details'}</button></div>
    </form>
  </Dialog>;
}

function MergeClientDialog({ source, candidates, practiceId, onClose, onMerged }: { source: Client | null; candidates: Client[]; practiceId: string; onClose: () => void; onMerged: () => void }) {
  const [targetClientId, setTargetClientId] = useState(''); const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const possibleTargets = candidates.filter((item) => item.id !== source?.id);
  useEffect(() => { setTargetClientId(''); setReason(''); setError(''); }, [source]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!source) return; setBusy(true); setError('');
    try { await api(practicePath(practiceId, `/clients/${source.id}/merge`), { method: 'POST', body: JSON.stringify({ targetClientId, reason: reason.trim() }) }); onMerged(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not merge these records.'); }
    finally { setBusy(false); }
  }
  return <Dialog open={Boolean(source)} title="Merge duplicate client history" description="Choose the surviving record. Appointments, files, recordings, and invoices will be moved together and the duplicate will be archived. This cannot be undone from the app." onClose={onClose}>
    <form className="form-stack merge-client-form" onSubmit={(event) => void submit(event)}>
      {source && <section className="merge-source-card" aria-label="Duplicate client to archive"><span className="eyebrow">DUPLICATE · WILL BE ARCHIVED</span><strong>{source.fullName}</strong><span>{[source.email, source.phone].filter(Boolean).join(' · ') || 'No contact details'}</span></section>}
      <fieldset className="merge-targets"><legend>Choose the record to keep</legend><p>All history from the duplicate above will be added to this client record.</p>{possibleTargets.map((item) => <label className={`merge-target ${targetClientId === item.id ? 'merge-target-selected' : ''}`} key={item.id}><input type="radio" name="merge-target" required value={item.id} checked={targetClientId === item.id} onChange={() => setTargetClientId(item.id)}/><span className="merge-target-copy"><strong>{item.fullName}</strong><small>{[item.email, item.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></span><span className="merge-target-added">Added {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(item.createdAt))}</span></label>)}{!possibleTargets.length && <p className="merge-empty-note">There are no other client records available to keep. Add or find the matching client record first.</p>}</fieldset>
      <label>Reason for merging<textarea required minLength={10} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Briefly explain how you verified these records belong to the same person."/><small>Enter at least 10 characters. This will be kept with the merge history.</small></label>
      <p className="merge-safety-note">Verify the person’s identity first. Records linked to different customer accounts cannot be merged.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !possibleTargets.length || !targetClientId || reason.trim().length < 10}>{busy ? 'Merging history…' : 'Merge records'}</button></div>
    </form>
  </Dialog>;
}

function LinkClientAccountDialog({ source, practiceId, onClose, onLinked }: { source: Client | null; practiceId: string; onClose: () => void; onLinked: () => void }) {
  const [email, setEmail] = useState(''); const [reason, setReason] = useState(''); const [verified, setVerified] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  useEffect(() => { setEmail(''); setReason(''); setVerified(false); setError(''); }, [source]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!source) return; setBusy(true); setError('');
    try { await api(practicePath(practiceId, `/clients/${source.id}/account-link`), { method: 'PUT', body: JSON.stringify({ accountEmail: email.trim(), reason: reason.trim(), identityAndConsentVerified: verified }) }); onLinked(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not link this account.'); }
    finally { setBusy(false); }
  }
  return <Dialog open={Boolean(source)} title="Link this client to an account" description="This lets the customer see this practice’s visit history and shared records in their account." onClose={onClose}>
    <form className="form-stack" onSubmit={(event) => void submit(event)}>
      {source && <p className="field-hint">Client record: <strong>{source.fullName}</strong></p>}
      <label>Customer account email<input type="email" autoComplete="email" required maxLength={320} value={email} onChange={(event) => setEmail(event.target.value)}/></label>
      <label>Verification notes<textarea required minLength={10} maxLength={500} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="How identity and consent were confirmed"/></label>
      <label className="check-row"><input type="checkbox" checked={verified} onChange={(event) => setVerified(event.target.checked)}/> I verified the customer’s identity and consent to link these records.</label>
      <p className="field-hint">Only link an account after confirming it with the customer. The account must already be registered as a customer and must not already have a different client record here.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy || !verified || reason.trim().length < 10}>{busy ? 'Linking account…' : 'Confirm account link'}</button></div>
    </form>
  </Dialog>;
}
