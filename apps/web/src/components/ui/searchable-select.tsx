'use client';

import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronsUpDown, LoaderCircle } from 'lucide-react';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Option = { value: string; label: string };
type OptionPage = { items: Option[]; page: number; pageSize: number; total: number; hasMore: boolean };

export function SearchableSelect({
  endpoint, context, value, onChange, disabled = false, placeholder = 'Select an option',
  searchPlaceholder = 'Search…', emptyMessage = 'No matching options.', valueLabel,
}: {
  endpoint: '/geography/countries' | '/geography/states' | '/geography/cities' | '/geography/timezones';
  context?: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  valueLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Option[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const contextKey = JSON.stringify(context ?? {});
  const selected = items.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setLoading(true); setError(''); setItems([]); setPage(1); setHasMore(false);
      const params = new URLSearchParams({ page: '1', limit: '50', ...(context ?? {}) });
      if (query.trim()) params.set('q', query.trim());
      api<OptionPage>(`${endpoint}?${params}`).then((result) => {
        if (!active) return;
        setItems(result.items); setHasMore(result.hasMore);
      }).catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'Could not load options.');
      }).finally(() => { if (active) setLoading(false); });
    }, query ? 220 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [contextKey, endpoint, open, query]);

  async function loadNext() {
    if (!hasMore || loading || loadingMore) return;
    setLoadingMore(true);
    const nextPage = page + 1;
    const params = new URLSearchParams({ page: String(nextPage), limit: '50', ...(context ?? {}) });
    if (query.trim()) params.set('q', query.trim());
    try {
      const result = await api<OptionPage>(`${endpoint}?${params}`);
      setItems((current) => [...current, ...result.items.filter((item) => !current.some((option) => option.value === item.value))]);
      setPage(result.page); setHasMore(result.hasMore);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load more options.');
    } finally { setLoadingMore(false); }
  }

  return <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) setQuery(''); }}>
    <Popover.Trigger asChild><button type="button" className="ui-select-trigger" role="combobox" aria-expanded={open} disabled={disabled}>
      <span>{(selected?.label ?? valueLabel ?? value) || placeholder}</span><ChevronsUpDown size={15} aria-hidden="true"/>
    </button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="ui-select-popover" align="start" sideOffset={5} onOpenAutoFocus={(event) => event.preventDefault()}>
      <Command shouldFilter={false} className="ui-command">
        <Command.Input value={query} onValueChange={setQuery} placeholder={searchPlaceholder} className="ui-command-input" aria-label={searchPlaceholder}/>
        <Command.List className="ui-command-list" onScroll={(event) => {
          const element = event.currentTarget;
          if (element.scrollTop + element.clientHeight >= element.scrollHeight - 40) void loadNext();
        }}>
          {loading && !items.length ? <div className="ui-command-status"><LoaderCircle size={14} className="ui-spin"/> Loading options…</div> : null}
          {error ? <div className="ui-command-status ui-command-error" role="alert">{error}</div> : null}
          {!loading && !error && !items.length ? <Command.Empty className="ui-command-status">{emptyMessage}</Command.Empty> : null}
          <Command.Group>{items.map((option) => <Command.Item key={option.value} value={option.value} onSelect={() => { onChange(option.value); setOpen(false); }} className="ui-command-item">
            <Check size={15} aria-hidden="true" className={option.value === value ? 'ui-command-check selected' : 'ui-command-check'}/>{highlight(option.label, query)}
          </Command.Item>)}</Command.Group>
          {loadingMore ? <div className="ui-command-status"><LoaderCircle size={14} className="ui-spin"/> Loading more…</div> : null}
          {!loading && hasMore && !loadingMore ? <div className="ui-command-more">Scroll to load more</div> : null}
        </Command.List>
      </Command>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}

function highlight(label: string, query: string) {
  const term = query.trim();
  if (!term) return label;
  const index = label.toLocaleLowerCase().indexOf(term.toLocaleLowerCase());
  if (index < 0) return label;
  return <>{label.slice(0, index)}<mark className="ui-command-highlight">{label.slice(index, index + term.length)}</mark>{label.slice(index + term.length)}</>;
}
