/**
 * usePollTransactions
 *
 * Polls GET /api/transactions/ every POLL_INTERVAL_MS.
 * - On first load, sets data and clears loading.
 * - On subsequent polls, if the fetch fails: keeps existing data visible,
 *   sets `pollError` so the UI can show "Engine unreachable, retrying".
 * - Tracks newly seen transaction IDs since the last render cycle so the
 *   UI can animate incoming rows.
 * - Exposes `refresh()` so the SimulatorTray can trigger an immediate poll.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { transactionsApi } from '../api/transactions.ts';
import type { Transaction, TransactionQuery } from '../api/transactions.ts';

const POLL_INTERVAL_MS = 4_000;

export interface PollState {
  transactions: Transaction[];
  totalCount: number;
  loading: boolean;
  /** True only when a subsequent poll fails (initial error keeps loading=false) */
  pollError: boolean;
  newIds: Set<string>;
  refresh: () => void;
}

export function usePollTransactions(query: TransactionQuery = {}): PollState {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalCount, setTotalCount]     = useState(0);
  const [loading, setLoading]           = useState(true);
  const [pollError, setPollError]       = useState(false);
  const [newIds, setNewIds]             = useState<Set<string>>(new Set());
  const [tick, setTick]                 = useState(0);

  // Keep a ref to the known IDs so the effect closure always sees current value
  const knownIds = useRef<Set<string>>(new Set());

  const refresh = useCallback(() => setTick(t => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let timerId: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async () => {
      try {
        const data = await transactionsApi.list({
          ...query,
          ordering: '-risk_score,-created_at',
          page_size: 200,
        });

        if (cancelled) return;

        const results = data.results ?? [];

        // Detect genuinely new IDs (not on very first load — that would flag everything)
        const incoming = new Set<string>();
        if (knownIds.current.size > 0) {
          for (const tx of results) {
            if (!knownIds.current.has(tx.id)) incoming.add(tx.id);
          }
        }

        // Update known set
        knownIds.current = new Set(results.map(tx => tx.id));

        setTransactions(results);
        setTotalCount(data.count ?? results.length);
        setNewIds(incoming);
        setPollError(false);
        setLoading(false);
      } catch {
        if (cancelled) return;
        // First-ever load failure: stay in loading=false but show pollError
        setLoading(false);
        setPollError(true);
        // Don't wipe existing data — keep displaying last good state
      }
    };

    // Run immediately, then schedule repeating poll
    void fetchOnce().then(() => {
      if (cancelled) return;
      timerId = setInterval(() => void fetchOnce(), POLL_INTERVAL_MS);
    });

    return () => {
      cancelled = true;
      if (timerId) clearInterval(timerId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { transactions, totalCount, loading, pollError, newIds, refresh };
}
