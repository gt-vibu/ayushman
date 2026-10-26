'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { ApiError, api } from '@/lib/api';

export type CustomerProfileSummary = { fullName: string; email: string; phone?: string | null };
export type CustomerSessionStatus = 'checking' | 'customer' | 'practice' | 'signed-out' | 'unavailable';
type CustomerSessionValue = { status: CustomerSessionStatus; customer: CustomerProfileSummary | null; refresh: () => Promise<void>; setSignedIn: (profile: CustomerProfileSummary) => void; setSignedOut: () => void };
const CustomerSessionContext = createContext<CustomerSessionValue | null>(null);

export function CustomerSessionProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [status, setStatus] = useState<CustomerSessionStatus>('checking');
  const [customer, setCustomer] = useState<CustomerProfileSummary | null>(null);
  const requestVersion = useRef(0);
  const checked = useRef(false);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    try {
      const identity = await api<{ kind: 'customer'; customer: CustomerProfileSummary } | { kind: 'practice' } | { kind: 'signed_out' }>('/auth/identity');
      if (version !== requestVersion.current) return;
      if (identity.kind === 'customer') { setCustomer(identity.customer); setStatus('customer'); }
      else { setCustomer(null); setStatus(identity.kind === 'practice' ? 'practice' : 'signed-out'); }
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setCustomer(null);
      setStatus(cause instanceof ApiError && cause.status === 401 ? 'signed-out' : 'unavailable');
    }
  }, []);

  const setSignedIn = useCallback((profile: CustomerProfileSummary) => { requestVersion.current++; setCustomer(profile); setStatus('customer'); }, []);
  const setSignedOut = useCallback(() => { requestVersion.current++; setCustomer(null); setStatus('signed-out'); }, []);

  useEffect(() => {
    const needsCustomerSession = pathname === '/book' || pathname.startsWith('/book/') || pathname === '/customer' || pathname.startsWith('/customer/');
    if (needsCustomerSession && !checked.current) { checked.current = true; void refresh(); }
    const onSessionChange = (event: Event) => {
      const detail = (event as CustomEvent<CustomerProfileSummary | null>).detail;
      if (detail) setSignedIn(detail); else if (detail === null) setSignedOut(); else void refresh();
    };
    window.addEventListener('ayushman-customer-session-change', onSessionChange);
    return () => window.removeEventListener('ayushman-customer-session-change', onSessionChange);
  }, [pathname, refresh, setSignedIn, setSignedOut]);

  return <CustomerSessionContext.Provider value={{ status, customer, refresh, setSignedIn, setSignedOut }}>{children}</CustomerSessionContext.Provider>;
}

export function useCustomerSession() {
  const session = useContext(CustomerSessionContext);
  if (!session) throw new Error('useCustomerSession must be used inside CustomerSessionProvider');
  return session;
}
