'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { MapPin, Navigation, Pencil, Plus } from 'lucide-react';
import { api, peekApiCache, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import type { Branch } from '@/lib/types';
import { Dialog } from '@/components/dialog';
import { EmptyState, ErrorState, LoadingState, PageHeader, StatusBadge } from '@/components/app-shell';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';

type BranchForm = { name: string; line1: string; line2: string; city: string; state: string; postalCode: string; countryCode: string; timezone: string; latitude: string; longitude: string; active: boolean };
const blank = (timezone: string): BranchForm => ({ name: '', line1: '', line2: '', city: '', state: '', postalCode: '', countryCode: 'IN', timezone, latitude: '', longitude: '', active: true });
const countryNames = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => countryNames.of(code.toUpperCase()) ?? code;

export default function BranchesPage() {
  const { practice, professions, permissions, refreshBranches } = usePractice();
  const locationsUrl = practicePath(practice.id, '/locations');
  const [data, setData] = useState<Branch[]>(() => peekApiCache<Branch[]>(locationsUrl) ?? []);
  const [loading, setLoading] = useState(() => peekApiCache<Branch[]>(locationsUrl) === null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(blank(practice.timezone));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const pagination = usePaginatedItems(data);
  const load = useCallback(async () => { if (peekApiCache<Branch[]>(locationsUrl) === null) setLoading(true); setError(''); try { setData(await api<Branch[]>(locationsUrl)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load locations.'); } finally { setLoading(false); } }, [locationsUrl]);
  useEffect(() => { void load(); }, [load]);
  function open(branch?: Branch) {
    setEditing(branch ?? null); setMessage('');
    setForm(branch ? { name: branch.name, line1: branch.address?.line1 ?? '', line2: branch.address?.line2 ?? '', city: branch.address?.city ?? '', state: branch.address?.state ?? '', postalCode: branch.address?.postalCode ?? '', countryCode: branch.address?.countryCode ?? 'IN', timezone: branch.timezone ?? practice.timezone, latitude: branch.address?.latitude?.toString() ?? '', longitude: branch.address?.longitude?.toString() ?? '', active: branch.active } : blank(practice.timezone));
    setDialog(true);
  }
  function useLocation() {
    if (!navigator.geolocation) { setMessage('This browser does not support location sharing.'); return; }
    navigator.geolocation.getCurrentPosition(({ coords }) => setForm((value) => ({ ...value, latitude: coords.latitude.toFixed(6), longitude: coords.longitude.toFixed(6) })), () => setMessage('Location was unavailable. Enter latitude and longitude below.'), { enableHighAccuracy: true, timeout: 10000 });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const address = { line1: form.line1, ...(form.line2 ? { line2: form.line2 } : {}), city: form.city, ...(form.state ? { state: form.state } : {}), ...(form.postalCode ? { postalCode: form.postalCode } : {}), countryCode: form.countryCode.toUpperCase(), ...(form.latitude ? { latitude: Number(form.latitude) } : {}), ...(form.longitude ? { longitude: Number(form.longitude) } : {}) };
    const payload = { name: form.name, address, timezone: form.timezone, ...(editing ? { active: form.active } : {}) };
    try {
      const branch = editing
        ? await api<Branch>(practicePath(practice.id, `/locations/${editing.id}`), { method: 'PATCH', body: JSON.stringify(payload) })
        : await api<Branch>(practicePath(practice.id, '/locations'), { method: 'POST', body: JSON.stringify(payload) });
      if (!editing) for (const profession of professions) await api(practicePath(practice.id, `/locations/${branch.id}/professions`), { method: 'POST', body: JSON.stringify({ practiceProfessionId: profession.id, enabled: true }) });
      setDialog(false); await load(); await refreshBranches();
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Could not save this location.'); }
    finally { setBusy(false); }
  }
  return <><PageHeader eyebrow="PRACTICE SETUP" title="Locations" description="Keep each branch address, region, and availability context current." action={permissions['locations.manage'] ? <button className="button button-primary" onClick={() => open()}><Plus size={16}/> Add location</button> : undefined}/>
    {loading ? <section className="section-card resource-card"><LoadingState/></section> : error ? <section className="section-card resource-card"><ErrorState message={error}/></section> : !data.length ? <section className="section-card resource-card"><EmptyState title={permissions['locations.manage'] ? 'Add your first location' : 'No locations assigned'} description={permissions['locations.manage'] ? 'Each location has its own address and timezone. You can capture coordinates from your device or enter them directly.' : 'Ask a practice owner to assign a location to your account.'} icon={MapPin}/></section> : <><div className="branch-grid">{pagination.pageItems.map((branch) => <article className="branch-card" key={branch.id}><div className="branch-title"><span className="stat-icon tone-blush"><MapPin size={18}/></span><div className="inline-actions"><StatusBadge status={branch.active ? 'Active' : 'Inactive'}/>{permissions['locations.manage'] && <button className="icon-button" aria-label={`Edit ${branch.name}`} onClick={() => open(branch)}><Pencil size={15}/></button>}</div></div><h2>{branch.name}</h2><p>{branch.address ? [branch.address.line1, branch.address.line2, branch.address.city, branch.address.state, branch.address.postalCode, branch.address.countryCode].filter(Boolean).join(', ') : 'Address not configured'}</p><small>{branch.timezone ?? practice.timezone}{branch.address?.latitude != null && branch.address.longitude != null ? ` · ${branch.address.latitude}, ${branch.address.longitude}` : ''}</small></article>)}</div><Pagination total={data.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/></>}
    <Dialog open={dialog} title={editing ? 'Edit location' : 'Add a location'} description="Branch details help customers find the right place and keep schedules in local time." onClose={() => setDialog(false)}>
      <form className="dialog-form" onSubmit={save}><label>Location name<input required minLength={2} maxLength={140} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}/></label><label>Address line 1<input required maxLength={160} value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })}/></label><label>Address line 2<input maxLength={160} value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })}/></label><div className="form-grid"><label>Country<SearchableSelect endpoint="/geography/countries" value={form.countryCode} valueLabel={countryName(form.countryCode)} onChange={(countryCode) => setForm((current) => ({ ...current, countryCode, state: '', city: '' }))} searchPlaceholder="Search countries…"/></label><label>State / region<SearchableSelect endpoint="/geography/states" context={{ countryCode: form.countryCode }} value={form.state} onChange={(state) => setForm((current) => ({ ...current, state, city: '' }))} disabled={!form.countryCode} placeholder="Select a state or region" searchPlaceholder="Search states and regions…" emptyMessage="No regions found for this country."/></label><label>City<SearchableSelect endpoint="/geography/cities" context={{ countryCode: form.countryCode, state: form.state }} value={form.city} onChange={(city) => setForm((current) => ({ ...current, city }))} disabled={!form.state} placeholder={form.state ? 'Select a city' : 'Choose a state first'} searchPlaceholder="Search cities…" emptyMessage="No cities found in this region."/></label><label>Postal code<input maxLength={20} value={form.postalCode} onChange={(e) => setForm({ ...form, postalCode: e.target.value })}/></label><label>Timezone<SearchableSelect endpoint="/geography/timezones" value={form.timezone} valueLabel={form.timezone} onChange={(timezone) => setForm((current) => ({ ...current, timezone }))} searchPlaceholder="Search timezone or city…"/></label></div>
        <div className="dialog-section-title"><span>Map coordinates</span><button className="text-link" type="button" onClick={useLocation}><Navigation size={14}/> Use my location</button></div><div className="form-grid"><label>Latitude<input type="number" min={-90} max={90} step="any" value={form.latitude} onChange={(e) => setForm({ ...form, latitude: e.target.value })}/></label><label>Longitude<input type="number" min={-180} max={180} step="any" value={form.longitude} onChange={(e) => setForm({ ...form, longitude: e.target.value })}/></label></div>
        {editing && <label className="check-row"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })}/> Location is active</label>}{message && <p className="form-error" role="alert">{message}</p>}<footer className="dialog-actions"><button type="button" className="button button-secondary" onClick={() => setDialog(false)}>Cancel</button><button className="button button-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save changes' : 'Add location'}</button></footer>
      </form>
    </Dialog>
  </>;
}
