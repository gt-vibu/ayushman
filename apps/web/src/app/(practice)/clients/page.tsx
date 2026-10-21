'use client';

import { useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Search, Users } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';
import { useApiData } from '@/lib/use-api-data';
import type { Client } from '@/lib/types';
import { EmptyState, ErrorState, LoadingState, PageHeader } from '@/components/app-shell';
import { Pagination, usePaginatedItems } from '@/components/ui/pagination';

export default function ClientsPage() {
  const { practice } = usePractice();
  const params = useSearchParams();
  const [search, setSearch] = useState(params.get('q') ?? '');
  const [applied, setApplied] = useState(params.get('q') ?? '');
  const query = new URLSearchParams({ limit: '100' });
  if (applied.trim().length >= 2) query.set('q', applied.trim());
  const url = useMemo(() => practicePath(practice.id, `/clients?${query.toString()}`), [practice.id, applied]);
  const { data, loading, error } = useApiData<Client[]>(url);
  const pagination = usePaginatedItems(data ?? [], applied);

  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setApplied(search); }

  return <><PageHeader eyebrow="CLIENT RELATIONSHIPS" title="Client directory" description="A practice-wide client directory, connected to their appointment history." action={<span className="count-pill">{data?.length ?? '—'} shown</span>}/>
    <section className="section-card resource-card"><form className="filter-bar" onSubmit={submit}><label className="field-search"><Search size={17}/><input placeholder="Search name, email, or phone" value={search} onChange={(event) => setSearch(event.target.value)}/></label><button className="button button-secondary">Search directory</button></form>
      {loading ? <LoadingState/> : error ? <ErrorState message={error}/> : !data?.length ? <EmptyState title="No clients found" description="Client records are created when an appointment is booked. Search with at least two characters to find someone." icon={Users}/> : <><div className="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Added</th></tr></thead><tbody>{pagination.pageItems.map((client) => <tr key={client.id}><td data-label="Name"><strong>{client.fullName}</strong></td><td data-label="Email">{client.email || '—'}</td><td data-label="Phone">{client.phone || '—'}</td><td data-label="Added">{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: practice.timezone }).format(new Date(client.createdAt))}</td></tr>)}</tbody></table></div><Pagination total={data.length} {...pagination} onPageChange={pagination.setPage} onPageSizeChange={pagination.setPageSize}/></>}
    </section>
  </>;
}
