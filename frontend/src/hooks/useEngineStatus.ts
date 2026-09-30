/**
 * useEngineStatus — polls /api/engine/status/ every 30 s and returns
 * the current engine state for display in the Masthead.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { engineApi } from '../api/engine.ts';
import type { EngineStatus } from '../api/engine.ts';

const POLL_INTERVAL_MS = 30_000;

export interface EngineStatusState {
  status: EngineStatus | null;
  loading: boolean;
  error: Error | null;
}

export function useEngineStatus(): EngineStatusState {
  const [status, setStatus]   = useState<EngineStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<Error | null>(null);
  const timerRef              = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetch = useCallback(async () => {
    try {
      const result = await engineApi.status();
      setStatus(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch();
    timerRef.current = setInterval(() => void fetch(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [fetch]);

  return { status, loading, error };
}
