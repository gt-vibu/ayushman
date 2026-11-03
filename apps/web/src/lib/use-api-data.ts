'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, invalidateApiGet, peekApiCache } from './api';

export function useApiData<T>(url: string | null) {
  const [data, setData] = useState<T | null>(() => {
    return url ? peekApiCache<T>(url) : null;
  });
  const [loading, setLoading] = useState(() => {
    return Boolean(url && peekApiCache<T>(url) === null);
  });
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!url) { setData(null); setLoading(false); setError(''); return; }
    let active = true;
    const cached = peekApiCache<T>(url);
    const hasFreshCache = cached !== null;
    if (hasFreshCache) setData(cached);
    setLoading(!hasFreshCache); setError('');
    api<T>(url).then((value) => {
      if (active) setData(value);
    })
      .catch((cause: unknown) => { if (active && !hasFreshCache) setError(cause instanceof Error ? cause.message : 'Could not load data.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [url, revision]);

  const reload = useCallback(() => {
    if (!url) return;
    invalidateApiGet(url);
    setRevision((value) => value + 1);
  }, [url]);
  return { data, loading, error, reload };
}
