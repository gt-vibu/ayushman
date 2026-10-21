'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, CalendarDays, Check, LoaderCircle } from 'lucide-react';
import { api, practicePath } from '@/lib/api';
import { usePractice } from '@/lib/practice-context';

type BookingNotice = {
  id: string; appointmentId: string; kind: string; readAt: string | null; createdAt: string;
  startsAt: string; timezone: string; status: string; serviceName: string; customerName: string; locationName: string;
};
type NoticeResponse = { items: BookingNotice[]; unreadCount: number };

export function AppointmentNotifications() {
  const router = useRouter();
  const { practice } = usePractice();
  const [items, setItems] = useState<BookingNotice[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const endpoint = practicePath(practice.id, '/notifications');

  const refresh = useCallback(async () => {
    try {
      const response = await api<NoticeResponse>(endpoint);
      setItems(response.items);
      setUnreadCount(response.unreadCount);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load booking alerts.');
    } finally { setLoading(false); }
  }, [endpoint]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function openAppointment(item: BookingNotice) {
    if (!item.readAt) {
      setItems((current) => current.map((notice) => notice.id === item.id ? { ...notice, readAt: new Date().toISOString() } : notice));
      setUnreadCount((value) => Math.max(0, value - 1));
      void api(practicePath(practice.id, `/notifications/${item.id}/read`), { method: 'POST' }).catch(() => void refresh());
    }
    setOpen(false);
    router.push('/appointments');
  }

  return <div className="booking-notifications">
    <button className="icon-button notification-trigger" type="button" aria-label={unreadCount ? `${unreadCount} new booking notifications` : 'Booking notifications'} aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <Bell size={16}/>{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
    </button>
    {open && <>
      <button className="notification-dismiss" aria-label="Close notifications" onClick={() => setOpen(false)}/>
      <section className="notification-panel" aria-label="Booking notifications">
        <header><div><strong>Booking alerts</strong><span>{unreadCount ? `${unreadCount} new` : 'You’re all caught up'}</span></div><button type="button" className="notification-close" onClick={() => setOpen(false)}>Close</button></header>
        {loading ? <p className="notification-empty"><LoaderCircle size={15} className="ui-spin"/> Checking for new bookings…</p>
          : error ? <p className="notification-error" role="alert">{error}</p>
            : items.length ? <ul>{items.map((item) => <li key={item.id}>
              <button type="button" className={`notification-item${item.readAt ? '' : ' notification-item-unread'}`} onClick={() => void openAppointment(item)}>
                <span className="notification-icon"><CalendarDays size={16}/></span>
                <span className="notification-copy"><strong>{item.kind === 'customer_cancellation' ? `${item.customerName} cancelled ${item.serviceName}` : item.kind === 'customer_rescheduled' ? `${item.customerName} rescheduled ${item.serviceName}` : `${item.customerName} booked ${item.serviceName}`}</strong><small>{new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: item.timezone }).format(new Date(item.startsAt))} · {item.locationName}</small><em>{item.kind === 'customer_cancellation' ? 'Appointment cancelled' : item.kind === 'customer_rescheduled' ? 'New appointment time selected' : item.status === 'pending' ? 'Needs your confirmation' : 'Appointment confirmed'}</em></span>
                {!item.readAt && <span className="notification-unread-dot" aria-label="Unread"/>}
              </button>
            </li>)}</ul>
            : <p className="notification-empty"><Check size={15}/> No new bookings yet. New customer bookings will appear here.</p>}
        <footer><button type="button" onClick={() => { setOpen(false); router.push('/appointments'); }}>Open appointments</button></footer>
      </section>
    </>}
  </div>;
}
