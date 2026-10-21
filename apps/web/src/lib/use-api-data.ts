'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, invalidateApiGet, peekApiCache } from './api';

export function useApiData<T>(url: string) {
  const [data, setData] = useState<T | null>(() => {
    return peekApiCache<T>(url);
  });
  const [loading, setLoading] = useState(() => {
    return peekApiCache<T>(url) === null;
  });
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
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
    invalidateApiGet(url);
    setRevision((value) => value + 1);
  }, [url]);
  return { data, loading, error, reload };
}
