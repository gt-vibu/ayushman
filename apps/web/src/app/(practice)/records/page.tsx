'use client';

import { DropdownSelect } from '@/components/ui/dropdown-select';

import { useMemo, useState } from 'react';
import { Download, FileText, Search, Trash2, UploadCloud } from 'lucide-react';
import { api, API_BASE, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import type { Client } from '@/lib/types';
import { EmptyState, ErrorState, PageHeader, StatusBadge } from '@/components/app-shell';

type DocumentRow = { id: string; clientId: string; originalName: string; mediaType: string; sizeBytes: number; category: string; description: string | null; customerVisible: boolean; createdAt: string; clientName: string; clientEmail: string | null };
const categories = ['prescription', 'lab_result', 'report', 'referral', 'consent', 'insurance', 'other'];

export default function RecordsPage() {
  const { practice, permissions } = usePractice();
  const [clientId, setClientId] = useState('');
  const [category, setCategory] = useState('prescription');
  const [description, setDescription] = useState('');
  const [customerVisible, setCustomerVisible] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const { data: clientData } = useApiData<Client[]>(practicePath(practice.id, '/clients?limit=100'));
  const clients = clientData ?? [];
  const url = useMemo(() => practicePath(practice.id, `/records${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ''}`), [practice.id, clientId]);
  const { data, loading, error: loadError, reload } = useApiData<DocumentRow[]>(url);
  const rows = (data ?? []).filter((row) => !search || `${row.clientName} ${row.clientEmail ?? ''} ${row.originalName}`.toLowerCase().includes(search.toLowerCase()));

  async function upload(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setNotice('');
    if (!clientId || !file) { setError('Choose a customer and a file first.'); return; }
    const form = new FormData(); form.set('clientId', clientId); form.set('category', category); form.set('description', description); form.set('customerVisible', String(customerVisible)); form.set('file', file);
    setBusy(true);
    try { await api(practicePath(practice.id, '/records/files'), { method: 'POST', body: form }); setFile(null); setDescription(''); const fileInput = document.getElementById('record-file') as HTMLInputElement | null; if (fileInput) fileInput.value = ''; setNotice('File saved to this customer’s record.'); await reload(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Upload failed.'); } finally { setBusy(false); }
  }

  async function remove(id: string) { if (!window.confirm('Remove this file from the customer record?')) return; try { await api(practicePath(practice.id, `/records/files/${id}`), { method: 'DELETE' }); await reload(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not remove file.'); } }
  function download(id: string, inline = false) { window.open(`${API_BASE}${practicePath(practice.id, `/records/files/${id}/content${inline ? '?inline=1' : ''}`)}`, '_blank', 'noopener,noreferrer'); }

  return <><PageHeader eyebrow="CLIENT RECORDS" title="Records & files" description="Keep reports, prescriptions and shared documents attached to the right customer." action={permissions['records.write'] ? <span className="count-pill">Private storage · up to 20 MB</span> : undefined}/>
    {permissions['records.write'] && <section className="section-card resource-card records-upload"><h2><UploadCloud size={18}/> Add a customer file</h2><p className="page-description">Only the selected customer and authorized practice staff can access this file.</p><form className="records-form" onSubmit={(event) => void upload(event)}>
      <label>Customer<DropdownSelect required value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">Select a customer</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.fullName}{client.email ? ` · ${client.email}` : ''}</option>)}</DropdownSelect></label>
      <label>File category<DropdownSelect value={category} onChange={(event) => setCategory(event.target.value)}>{categories.map((item) => <option key={item} value={item}>{item.replace('_', ' ')}</option>)}</DropdownSelect></label>
      <label className="records-file">File (PDF, JPG, PNG or WebP)<input id="record-file" type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} required/></label>
      <label>Description<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional note for this file"/></label>
      <label className="check-row records-share"><input type="checkbox" checked={customerVisible} onChange={(event) => setCustomerVisible(event.target.checked)}/> Share with customer in their account</label>
      {error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="save-success">{notice}</p>}
      <button className="button button-primary" disabled={busy}>{busy ? 'Uploading securely…' : 'Upload file'}</button>
    </form></section>}
    <section className="section-card resource-card records-list"><div className="section-heading"><div><p className="eyebrow">CUSTOMER FILES</p><h2>Document library</h2></div><span className="count-pill">{rows.length} files</span></div>
      <div className="filter-bar"><label className="field-search"><Search size={16}/><input placeholder="Search customer or file" value={search} onChange={(event) => setSearch(event.target.value)}/></label><DropdownSelect className="select-control" value={clientId} onChange={(event) => setClientId(event.target.value)}><option value="">All customers</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.fullName}</option>)}</DropdownSelect></div>
      {loading ? <div className="loading-state">Loading customer files…</div> : loadError ? <ErrorState message={loadError}/> : rows.length ? <div className="table-wrap"><table><thead><tr><th>File</th><th>Customer</th><th>Category</th><th>Shared</th><th>Added</th><th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td data-label="File"><strong className="record-file-name"><FileText size={15}/>{row.originalName}</strong>{row.description && <small className="table-subtext">{row.description}</small>}<small className="table-subtext">{(row.sizeBytes / 1024).toFixed(0)} KB</small></td><td data-label="Customer"><strong>{row.clientName}</strong><small className="table-subtext">{row.clientEmail || ''}</small></td><td data-label="Category">{row.category.replace('_', ' ')}</td><td data-label="Shared"><StatusBadge status={row.customerVisible ? 'Shared' : 'Private'}/></td><td data-label="Added">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: practice.timezone }).format(new Date(row.createdAt))}</td><td data-label="Actions"><div className="inline-actions"><button className="icon-button" title="View" aria-label={`View ${row.originalName}`} onClick={() => download(row.id, true)}><FileText size={14}/></button><button className="icon-button" title="Download" aria-label={`Download ${row.originalName}`} onClick={() => download(row.id)}><Download size={14}/></button>{permissions['records.write'] && <button className="icon-button" title="Remove" aria-label={`Remove ${row.originalName}`} onClick={() => void remove(row.id)}><Trash2 size={14}/></button>}</div></td></tr>)}</tbody></table></div> : <EmptyState title="No customer files yet" description="Upload a prescription, report or other document to a specific customer record." icon={FileText}/>}
    </section>
  </>;
}

