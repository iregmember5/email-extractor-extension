import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './rpc';
import type { AppError, Envelope } from './types';
export function useResource<T>(path: string | null, revision = 0) {
  const [data, setData] = useState<Envelope<T> | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const count = useRef(0);
  useEffect(() => {
    const version = ++count.current;
    if (!path) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    setData(null);
    api<T>(path)
      .then((value) => {
        if (version === count.current) setData(value);
      })
      .catch((e) => {
        if (version === count.current) {
          setError(e);
          window.dispatchEvent(new Event('session-check'));
        }
      })
      .finally(() => {
        if (version === count.current) setLoading(false);
      });
    return () => {
      count.current++;
    };
  }, [path, revision, tick]);
  const reload = useCallback(() => setTick((value) => value + 1), []);
  return { data, error, loading, reload };
}
