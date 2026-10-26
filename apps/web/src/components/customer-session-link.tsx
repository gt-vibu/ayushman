'use client';

import { SpaLink as Link } from '@/components/spa-link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CalendarDays, ChevronDown, CircleUserRound, Compass, CreditCard, FileText, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { api } from '@/lib/api';
import { useCustomerSession } from '@/lib/customer-session';
import type { CustomerProfileSummary } from '@/lib/customer-session';

export function CustomerSessionLink({ variant = 'header', initialCustomer, onProfileClick, onExploreClick, onSectionSelect, activeSection }: { variant?: 'header' | 'footer'; initialCustomer?: CustomerProfileSummary; onProfileClick?: () => void; onExploreClick?: () => void; onSectionSelect?: (section: 'home' | 'appointments' | 'records' | 'billing' | 'profile' | 'settings') => void; activeSection?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const session = useCustomerSession();
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    const onThemeChange = (event: Event) => setDarkMode((event as CustomEvent<boolean>).detail);
    window.addEventListener('ayushman-theme-change', onThemeChange);
    const savedTheme = window.localStorage.getItem('ayushman-theme') === 'dark';
    setDarkMode(savedTheme);
    document.documentElement.dataset.theme = savedTheme ? 'dark' : 'light';
    return () => window.removeEventListener('ayushman-theme-change', onThemeChange);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: PointerEvent) => { if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false); };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('pointerdown', onPointerDown); document.removeEventListener('keydown', onKeyDown); };
  }, [menuOpen]);

  function toggleTheme() {
    const enabled = !darkMode;
    setDarkMode(enabled);
    document.documentElement.dataset.theme = enabled ? 'dark' : 'light';
    window.localStorage.setItem('ayushman-theme', enabled ? 'dark' : 'light');
    window.dispatchEvent(new CustomEvent<boolean>('ayushman-theme-change', { detail: enabled }));
  }

  async function signOut() {
    setMenuOpen(false);
    session.setSignedOut();
    await api('/auth/customer/logout', { method: 'POST' }).catch(() => undefined);
    router.replace('/book');
  }

  const state = initialCustomer ? 'customer' : session.status;
  const customer = initialCustomer ?? session.customer;
  if (variant === 'header' && state === 'customer') return <>
    <div className="customer-profile-menu" ref={menuRef}>
      <button type="button" className="customer-profile-trigger" aria-label="Open profile and account options" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><span>{customer?.fullName.trim().charAt(0).toLocaleUpperCase() || <CircleUserRound size={20}/>}</span><span className="customer-profile-trigger-name">{customer?.fullName || 'Your account'}</span><ChevronDown className="customer-profile-trigger-chevron" size={15}/></button>
      {menuOpen && <div className="customer-profile-popover" role="menu" aria-label="Profile and account options">
        <div className="customer-profile-popover-heading"><span className="customer-profile-avatar">{customer?.fullName.trim().charAt(0).toLocaleUpperCase() || <CircleUserRound size={18}/>}</span><div><strong>{customer?.fullName || 'Your account'}</strong><small>{customer?.email}</small></div></div>
        <Link role="menuitem" href="/customer/account?section=profile" onClick={(event) => { setMenuOpen(false); if (onProfileClick) { event.preventDefault(); onProfileClick(); } }}><CircleUserRound size={16}/> Profile</Link>
        <button type="button" role="menuitemcheckbox" aria-checked={darkMode} onClick={toggleTheme}>{darkMode ? <Sun size={16}/> : <Moon size={16}/>}<span>{darkMode ? 'Light mode' : 'Dark mode'}</span><span className={`customer-theme-switch${darkMode ? ' on' : ''}`} aria-hidden="true"><i/></span></button>
        <div className="customer-profile-menu-divider"/>
        <button type="button" role="menuitem" className="customer-signout-item" onClick={() => void signOut()}><LogOut size={16}/> Sign out</button>
      </div>}
    </div>
    <nav className="customer-bottom-nav" aria-label="Customer navigation">
      {[
        { id: 'explore', label: 'Explore', href: '/book', icon: <Compass size={20}/> },
        { id: 'appointments', label: 'Bookings', href: '/customer/account?section=appointments', icon: <CalendarDays size={20}/> },
        { id: 'records', label: 'Files', href: '/customer/account?section=records', icon: <FileText size={20}/> },
        { id: 'billing', label: 'Billing', href: '/customer/account?section=billing', icon: <CreditCard size={20}/> },
        { id: 'settings', label: 'Settings', href: '/customer/account?section=settings', icon: <Settings size={20}/> },
      ].map((item) => {
        const active = activeSection ? activeSection === item.id || (item.id === 'explore' && activeSection === 'home') : item.id === 'explore' && pathname.startsWith('/book');
        return <Link key={item.id} href={item.href} aria-current={active ? 'page' : undefined} className={`customer-bottom-nav-link${active ? ' active' : ''}`} onClick={(event) => { if (item.id === 'explore' && onExploreClick) { event.preventDefault(); onExploreClick(); } else if (activeSection && item.id !== 'explore' && onSectionSelect) { event.preventDefault(); onSectionSelect(item.id as 'appointments' | 'records' | 'billing' | 'settings'); } }}><span className="customer-bottom-nav-icon">{item.icon}</span><span>{item.label}</span></Link>;
      })}
    </nav>
  </>;

  if (variant === 'header') return <Link className="button button-secondary customer-account-link" href={state === 'checking' || state === 'unavailable' ? '/customer/account' : '/customer/login'}>
    {state === 'checking' || state === 'unavailable' ? 'My account' : 'Customer sign in'} <CircleUserRound size={16}/>
  </Link>;

  if (state === 'checking') return <div className="booking-account-hint" role="status"><span className="spinner"/>Loading account…</div>;
  if (state === 'customer') return <div className="booking-account-hint"><span>You’re signed in to your customer account.</span><Link href="/customer/account">Open your account <ArrowRight size={14}/></Link></div>;
  if (state === 'practice') return <div className="booking-account-hint"><span>You’re signed in to a practice account. Practice and customer accounts are separate, so use a customer account to see personal bookings.</span><Link href="/customer/login">Sign in as a customer <ArrowRight size={14}/></Link></div>;
  if (state === 'unavailable') return <div className="booking-account-hint"><span>We couldn’t check your account right now. Your sign-in may still be active.</span><Link href="/customer/account">Open your account <ArrowRight size={14}/></Link></div>;
  return <div className="booking-account-hint"><span>Sign in to your customer account to see your appointments and shared records.</span><Link href="/customer/login">Customer sign in <ArrowRight size={14}/></Link></div>;
}
