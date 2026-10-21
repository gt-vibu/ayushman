'use client';

import { SpaLink as Link } from '@/components/spa-link';
import { useEffect, useState } from 'react';
import { ArrowRight, BriefcaseBusiness, Clock3, Search, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { CustomerSessionLink } from '@/components/customer-session-link';
import { CustomerAccountView } from '@/components/customer-account-view';

type PracticeResult = { id: string; name: string; slug: string; description: string | null; timezone: string; services: Array<{ id: string; name: string; durationMinutes: number; priceMinor: number | null; currency: string }> };

export default function BookDiscoveryPage() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PracticeResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState('');
  const [accountSection, setAccountSection] = useState<'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings' | null>(null);

  useEffect(() => { void search('', true); }, []);

  async function search(value = query, initial = false) {
    if (value.trim().length === 1) { setError('Type at least two characters, or clear the search to browse all practices.'); return; }
    setBusy(true); setSearched(true); setError('');
    try { setResults(await api<PracticeResult[]>(`/public/directory${value.trim() ? `?q=${encodeURIComponent(value.trim())}` : ''}`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Search is unavailable right now.'); }
    finally { setBusy(false); if (initial) setInitialLoading(false); }
  }

  function prefetchPractice(practiceId: string) {
    void api(`/public/practices/${practiceId}`).catch(() => undefined);
  }

  if (accountSection) return <CustomerAccountView initialSection={accountSection} onExploreClick={() => setAccountSection(null)} />;

  return <main className="booking-discovery">
    <header className="booking-nav"><Link className="booking-brand" href="/book"><span>✳</span> Ayushman</Link><div className="booking-nav-actions"><CustomerSessionLink activeSection="explore" onSectionSelect={(section) => setAccountSection(section)} onProfileClick={() => setAccountSection('profile')}/></div></header>
    <section className="booking-hero"><p className="eyebrow">FIND YOUR NEXT SESSION</p><h1>Good work starts<br/><em>with a conversation.</em></h1><p>Search for a practice, service, or professional. Choose the right place, person, and time in a few clear steps.</p>
      <form className="booking-search" onSubmit={(event) => { event.preventDefault(); void search(); }}><Search size={18}/><input value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (!value.trim()) void search('', true); }} placeholder="Practice, service, or professional" aria-label="Search practices, services, or professionals"/><button className="button button-primary" disabled={busy}>{busy ? 'Searching…' : 'Search'}</button></form>
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    {searched && <section className="booking-results"><div className="booking-results-heading"><div><p className="eyebrow">{query.trim() ? 'MATCHING PRACTICES' : 'BOOK A SERVICE'}</p><h2>{query.trim() ? results.length ? 'Choose where to begin' : 'No matches yet' : 'Available near you'}</h2></div><span>{busy || initialLoading ? 'Loading…' : `${results.length} ${results.length === 1 ? 'practice' : 'practices'}`}</span></div>
      {results.length ? <div className="booking-practice-grid">{results.map((practice) => <article className="booking-practice-card" key={practice.id}><span className="booking-card-icon"><BriefcaseBusiness size={19}/></span><h3>{practice.name}</h3><p>{practice.description || 'Explore available professionals and services at this practice.'}</p><small><UserRound size={14}/>{practice.timezone}</small><div className="booking-service-preview"><strong>Bookable services</strong>{practice.services.length ? practice.services.slice(0, 3).map((service) => <div className="booking-service-preview-row" key={service.id}><span>{service.name}<small><Clock3 size={12}/>{service.durationMinutes} min</small></span><b>{service.priceMinor === null ? 'Price on request' : new Intl.NumberFormat(undefined, { style: 'currency', currency: service.currency, maximumFractionDigits: 0 }).format(service.priceMinor / 100)}</b></div>) : <p className="booking-no-services">No online services are available yet.</p>}</div><Link href={`/book/${practice.id}`} className="button button-secondary" onPointerEnter={() => prefetchPractice(practice.id)} onFocus={() => prefetchPractice(practice.id)} onTouchStart={() => prefetchPractice(practice.id)}>{practice.services.length ? 'Choose a service' : 'View practice'} <ArrowRight size={15}/></Link></article>)}</div> : !busy && !initialLoading && <p className="booking-empty">{query.trim() ? 'Try a different name or search for a service or professional.' : 'There are no practices listed for online booking yet. Please check back soon.'}</p>}
    </section>}
    <footer className="booking-footer"><CustomerSessionLink variant="footer" activeSection="explore" onSectionSelect={(section) => setAccountSection(section)} onProfileClick={() => setAccountSection('profile')}/></footer>
  </main>;
}
