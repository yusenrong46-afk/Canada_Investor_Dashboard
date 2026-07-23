import { useEffect, useRef, useState } from "react";

export interface LatestRequestState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  isFresh: boolean;
  isDebouncing: boolean;
}

/**
 * Runs async work for debounced fetch keys while treating visible keys as the freshness contract.
 * Only the newest in-flight sequence may update loading, error, or stored data.
 */
export function useLatestRequest<TData>(
  visibleKey: string,
  fetchKey: string,
  enabled: boolean,
  fetcher: (signal: AbortSignal) => Promise<TData>,
): LatestRequestState<TData & { requestKey: string }> {
  const [data, setData] = useState<(TData & { requestKey: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sequenceRef = useRef(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const isDebouncing = visibleKey !== fetchKey;

  useEffect(() => {
    if (data != null && data.requestKey !== visibleKey) {
      setData(null);
    }
  }, [data, visibleKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      setError(null);
      return undefined;
    }

    if (isDebouncing) {
      return undefined;
    }

    const sequence = ++sequenceRef.current;
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    fetcherRef.current(controller.signal)
      .then((response) => {
        if (sequence !== sequenceRef.current) {
          return;
        }
        setData({ ...response, requestKey: fetchKey });
      })
      .catch((caughtError: Error) => {
        if (sequence !== sequenceRef.current || caughtError.name === "AbortError") {
          return;
        }
        setError(caughtError.message);
      })
      .finally(() => {
        if (sequence !== sequenceRef.current) {
          return;
        }
        setLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [enabled, fetchKey, isDebouncing]);

  const isFresh = !isDebouncing && data != null && data.requestKey === visibleKey;

  return {
    data: isFresh ? data : null,
    loading: enabled && (loading || isDebouncing),
    error,
    isFresh,
    isDebouncing,
  };
}
