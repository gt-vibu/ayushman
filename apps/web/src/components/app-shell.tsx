'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  Activity, CalendarDays, ClipboardList, FileText, LayoutDashboard,
  Clock3, Leaf, MapPin, Menu, Search, Settings, Users, WalletCards, BriefcaseBusiness, X, Moon, Sun, ChevronDown, UserRound, LogOut,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { usePractice } from '@/lib/practice-context';
import { api } from '@/lib/api';
import { AppointmentNotifications } from '@/components/appointment-notifications';
import { Select } from '@/components/ui/select';
import { BrandLoader } from '@/components/ui/branded-loader';
import { appointmentsQuery } from '@/lib/url';

const navigation = [
  { group: 'OVERVIEW', label: 'Dashboard', href: '/dashboard', icon: LayoutDashboard, permission: 'practice.read' },
  { group: 'SCHEDULING', label: 'Appointments', href: '/appointments', icon: CalendarDays, permission: 'appointments.read' },
  { group: 'SCHEDULING', label: 'Calendar', href: '/calendar', icon: CalendarDays, permission: 'appointments.read' },
  { group: 'SCHEDULING', label: 'Availability', href: '/availability', icon: Clock3, permission: 'availability.read' },
  { group: 'PEOPLE & SERVICES', label: 'Clients', href: '/clients', icon: Users, permission: 'clients.read' },
  { group: 'PEOPLE & SERVICES', label: 'Services', href: '/services', icon: BriefcaseBusiness, permission: 'services.read' },
  { group: 'PEOPLE & SERVICES', label: 'Staff', href: '/staff', icon: Users, permission: 'staff.read' },
  { group: 'PEOPLE & SERVICES', label: 'Locations', href: '/branches', icon: MapPin, permission: 'locations.read' },
  { group: 'MANAGE', label: 'Billing', href: '/billing', icon: WalletCards, permission: 'billing.read' },
  { group: 'MANAGE', label: 'Records', href: '/records', icon: FileText, permission: 'records.read' },
  { group: 'MANAGE', label: 'Reports', href: '/reports', icon: Activity, permission: 'reports.read', later: true },
  { group: 'MANAGE', label: 'Settings', href: '/settings', icon: Settings, permission: 'practice.read' },
];

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return <PracticeFrame>{children}</PracticeFrame>;
}

function PracticeFrame({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const { session, practice, branches, professions, permissions, branchId, setBranchId, logout } = usePractice();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [darkMode, setDarkMode] = useState(false);
  const warmedRoutes = useRef(new Set<string>());
  const activeBranch = branches.find((branch) => branch.id === branchId);
  const activeMembership = session.practices.find((item) => item.practiceId === practice.id);
  const canViewEveryBranch = activeMembership?.roles.some((role) => role === 'owner' || role === 'admin') ?? false;

  useEffect(() => {
    const enabled = window.localStorage.getItem('ayushman-theme') === 'dark';
    setDarkMode(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setMobileOpen(false);
    }
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [mobileOpen]);

  function toggleTheme() {
    const enabled = !darkMode;
    setDarkMode(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    window.localStorage.setItem('ayushman-theme', enabled ? 'dark' : 'light');
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (search.trim()) router.push(`/clients?q=${encodeURIComponent(search.trim())}`);
  }

  const warmRoute = useCallback((href: string) => {
    router.prefetch(href);
    if (warmedRoutes.current.has(href)) return;
    warmedRoutes.current.add(href);
    if (process.env.NODE_ENV === 'development') {
      void fetch(href, { credentials: 'same-origin', cache: 'no-store' }).then((response) => response.arrayBuffer()).catch(() => undefined);
    }
    const scope = branchId ? `?locationId=${encodeURIComponent(branchId)}` : '';
    const root = `/practices/${encodeURIComponent(practice.id)}`;
    const dashboardFrom = new Date(); dashboardFrom.setHours(0, 0, 0, 0); dashboardFrom.setDate(dashboardFrom.getDate() - 7);
    const dashboardTo = new Date(); dashboardTo.setHours(23, 59, 59, 999); dashboardTo.setDate(dashboardTo.getDate() + 14);
    const dashboardQuery = new URLSearchParams({ from: dashboardFrom.toISOString(), to: dashboardTo.toISOString(), limit: '100' });
    if (branchId) dashboardQuery.set('locationId', branchId);
    const routeData: Record<string, string[]> = {
      '/dashboard': [`${root}/appointments?${dashboardQuery}`, `${root}/services${scope}`, `${root}/staff${scope}`],
      '/appointments': [`${root}${appointmentsQuery(branchId)}`, `${root}/staff${scope}`],
      '/calendar': [`${root}${appointmentsQuery(branchId, 7, 100)}`],
      '/availability': [`${root}/professions`, `${root}/availability/rules${scope}`],
      '/clients': [`${root}/clients?limit=100`],
      '/services': [`${root}/services${scope}`, `${root}/staff${scope}`],
      '/staff': [`${root}/staff${scope}`],
      '/branches': [`${root}/locations`],
      '/records': [`${root}/clients?limit=100`, `${root}/records`],
      '/billing': [`${root}/billing/profile`, `${root}/billing/invoices`],
      '/settings': [`${root}`, `${root}/booking-policy`],
    };
    const requests = (routeData[href] ?? []).map((path) => api(path).catch(() => undefined));
    void Promise.all(requests).then(() => {
      if (!requests.length) warmedRoutes.current.delete(href);
    });
  }, [branchId, practice.id, router]);

  // Next.js disables router prefetching in development. Request each permitted
  // route in the background so its page and client chunks compile before the
  // first click. API data is warmed on hover or touch instead of loading every
  // screen's data at startup.
  useEffect(() => {
    if (process.env.NODE_ENV !== 'development') return;
    const routes = navigation.filter((item) => permissions[item.permission] && !item.later).map((item) => item.href);
    let index = 0;
    let timer = 0;
    let cancelled = false;
    const prefetchNext = async () => {
      const href = routes[index++];
      if (!href) return;
      try {
        const response = await fetch(href, { credentials: 'same-origin', cache: 'no-store' });
        await response.arrayBuffer();
      } catch {
        // Route prewarming is best-effort; normal navigation reports errors.
      }
      if (!cancelled) timer = window.setTimeout(prefetchNext, 100);
    };
    timer = window.setTimeout(prefetchNext, 300);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [permissions]);

  return <div className="app-frame">
    {mobileOpen && <button className="mobile-backdrop" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside id="practice-navigation" className={`sidebar ${mobileOpen ? 'sidebar-open' : ''}`} aria-label="Practice navigation">
      <Link className="brand" href="/dashboard" onClick={() => setMobileOpen(false)}><span className="brand-icon"><Leaf size={20}/></span><span>Ayushman</span></Link>
      <div className="practice-switcher">
        <div className="practice-emblem"><Leaf size={20}/></div>
        <div className="practice-switcher-copy"><strong>{practice.name}</strong><span>{activeBranch?.name ?? 'All branches'}</span></div>
      </div>
      <nav className="side-nav" aria-label="Practice navigation">
        {navigation.filter((item) => permissions[item.permission]).map(({ group, label, href, icon: Icon, later }, index, visibleNavigation) => {
          const selected = pathname === href || (href !== '/dashboard' && pathname.startsWith(`${href}/`));
          const clientTerm = professions[0]?.termOverrides.clientPlural;
          const visibleLabel = href === '/clients' && clientTerm ? clientTerm[0].toUpperCase() + clientTerm.slice(1) : label;
          return <div key={href}>{(index === 0 || visibleNavigation[index - 1].group !== group) && <span className="nav-section-label nav-group-label">{group}</span>}<Link prefetch={false} scroll={false} className={`nav-link ${selected ? 'nav-link-active' : ''}`} href={href} aria-current={selected ? 'page' : undefined} onMouseEnter={() => warmRoute(href)} onFocus={() => warmRoute(href)} onTouchStart={() => warmRoute(href)} onClick={(event) => {
            setMobileOpen(false);
            // Keep workspace tab changes in the App Router instead of a
            // document request, which previously caused a full reload.
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            router.push(href, { scroll: false });
          }}>
            <Icon size={18} strokeWidth={1.8}/><span>{visibleLabel}</span>{later && <span className="nav-soon">Soon</span>}
          </Link></div>;
        })}
      </nav>
    </aside>
    <section className="app-main">
      <header className="topbar">
        <button className="icon-button mobile-menu" aria-label={mobileOpen ? 'Close menu' : 'Open menu'} aria-expanded={mobileOpen} aria-controls="practice-navigation" onClick={() => setMobileOpen((value) => !value)}>{mobileOpen ? <X size={19}/> : <Menu size={19}/>}</button>
        <form className="global-search" onSubmit={submitSearch}><Search size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search clients or appointments…" aria-label="Search clients"/></form>
        <div className="topbar-right">
          <button type="button" className="icon-button theme-toggle" onClick={toggleTheme} aria-label={`Switch to ${darkMode ? 'light' : 'dark'} theme`} title={`Switch to ${darkMode ? 'light' : 'dark'} theme`}>{darkMode ? <Sun size={16}/> : <Moon size={16}/>}</button>
          {permissions['appointments.read'] && <AppointmentNotifications/>}
          {branches.length ? <div className="branch-context"><MapPin size={15}/><Select ariaLabel="Select branch" value={branchId} onChange={setBranchId} searchPlaceholder="Find a location…" options={[...(canViewEveryBranch ? [{ value: '', label: 'All branches' }] : []), ...branches.map((branch) => ({ value: branch.id, label: branch.name }))]} /></div> : <div className="context-pill"><span className="context-dot"/>{practice.name}</div>}
          <details className="account-menu">
            <summary className="top-user" aria-label="Open account menu">
              <span className="avatar avatar-small">{session.user.fullName.slice(0, 1).toUpperCase()}</span>
              <span><strong>{session.user.fullName}</strong><small>{activeMembership?.roles.includes('owner') ? 'Practice owner' : activeMembership?.roles.includes('admin') ? 'Practice administrator' : 'Practice team'}</small></span>
              <ChevronDown size={15} className="account-menu-chevron" aria-hidden="true"/>
            </summary>
            <div className="account-menu-popover" role="menu">
              <div className="account-menu-identity"><strong>{session.user.fullName}</strong><small>{session.user.email}</small></div>
              <button type="button" role="menuitem" onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); router.push('/profile', { scroll: false }); }}><UserRound size={16}/>Profile</button>
              <button type="button" role="menuitem" className="account-menu-signout" onClick={() => void logout()}><LogOut size={16}/>Sign out</button>
            </div>
          </details>
        </div>
      </header>
      <main className="page-content">{children}</main>
    </section>
  </div>;
}

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="page-description">{description}</p>}</div>{action && <div className="page-heading-action">{action}</div>}</div>;
}

export function StatusBadge({ status }: { status: string }) {
  const key = status.toLowerCase().replaceAll('_', '-');
  return <span className={`status-badge status-${key}`}>{status.replaceAll('_', ' ')}</span>;
}

export function EmptyState({ title, description, icon: Icon = ClipboardList }: { title: string; description: string; icon?: typeof ClipboardList }) {
  return <div className="empty-state"><span className="empty-icon"><Icon size={22}/></span><strong>{title}</strong><p>{description}</p></div>;
}

export function LoadingState() { return <div className="loading-state"><BrandLoader label="Loading from your practice…"/></div>; }
export function ErrorState({ message }: { message: string }) { return <div className="error-state"><strong>Could not load this page</strong><p>{message}</p></div>; }

