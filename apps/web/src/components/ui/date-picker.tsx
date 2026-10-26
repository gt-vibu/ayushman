'use client';

import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

function parseDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year, month - 1, day);
}
function serializeDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

export function DatePicker({ value, onChange, min, max, today, disabledDates, placeholder = 'Choose a date', ariaLabel = 'Choose a date' }: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  today?: string;
  disabledDates?: string[];
  placeholder?: string;
  ariaLabel?: string;
}) {
  const selectedDate = parseDate(value);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => {
    const date = selectedDate ?? new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1);
  });
  useEffect(() => {
    if (!open || !selectedDate) return;
    setMonth(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
  }, [open, value]);
  const days = useMemo(() => {
    const firstWeekday = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
    const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
    return Array.from({ length: Math.ceil((firstWeekday + daysInMonth) / 7) * 7 }, (_, index) => index - firstWeekday + 1);
  }, [month]);
  const minDate = parseDate(min ?? '');
  const maxDate = parseDate(max ?? '');
  const formatted = selectedDate ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(selectedDate) : '';

  return <Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button type="button" className="ui-date-trigger" aria-label={ariaLabel} aria-haspopup="dialog" aria-expanded={open}>
      <span className={formatted ? '' : 'ui-date-placeholder'}>{formatted || placeholder}</span><CalendarDays size={16} aria-hidden="true"/>
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="ui-calendar-popover" align="start" sideOffset={5} onOpenAutoFocus={(event) => event.preventDefault()}>
      <div className="ui-calendar-header"><button type="button" className="ui-calendar-nav" aria-label="Previous month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeft size={16}/></button><strong>{new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}</strong><button type="button" className="ui-calendar-nav" aria-label="Next month" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRight size={16}/></button></div>
      <div className="ui-calendar-grid" role="grid" aria-label={new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month)}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((day) => <span className="ui-calendar-weekday" role="columnheader" key={day}>{day}</span>)}
        {days.map((day, index) => {
          const date = new Date(month.getFullYear(), month.getMonth(), day);
          const inMonth = date.getMonth() === month.getMonth();
          const isoDate = serializeDate(date);
          const disabled = !inMonth || Boolean((minDate && date < minDate) || (maxDate && date > maxDate) || disabledDates?.includes(isoDate));
          const selected = isoDate === value;
          return <button type="button" role="gridcell" key={`${month.getFullYear()}-${month.getMonth()}-${index}`} className={`ui-calendar-day${selected ? ' selected' : ''}${!inMonth ? ' outside' : ''}`} disabled={disabled} aria-label={new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)} aria-selected={selected} onClick={() => { onChange(isoDate); setOpen(false); }}>
            {inMonth ? day : ''}
          </button>;
        })}
      </div>
      <div className="ui-calendar-footer"><button type="button" disabled={Boolean(disabledDates?.includes(today ?? serializeDate(new Date())))} onClick={() => { const iso = today ?? serializeDate(new Date()); const todayDate = parseDate(iso); if (todayDate && (!minDate || todayDate >= minDate) && (!maxDate || todayDate <= maxDate) && !disabledDates?.includes(iso)) onChange(iso); setOpen(false); }}>Today</button>{value && <button type="button" onClick={() => { onChange(''); setOpen(false); }}>Clear</button>}</div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
