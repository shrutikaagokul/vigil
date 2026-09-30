/**
 * Desk — primary fraud-review screen.
 *
 * Structure:
 *  1. Editorial headline derived from live data ("3 need you now.")
 *  2. Sub-counts ("14 flagged today, 9 waiting, 4 cleared, 1 reviewed")
 *  3. Filter bar: risk tier + review status
 *  4. "N new" banner when new transactions arrive while scrolled down
 *  5. Group 1: "Waiting for review"  (pending)
 *  6. Group 2: "Resolved"            (approved / declined / escalated)
 *
 * Polling: every 4 s via usePollTransactions.
 * On poll failure: keeps existing data, shows "Engine unreachable" banner.
 *
 * Props:
 *  reviewer        – analyst name from App (passed to future ReviewForm)
 *  registerRefresh – App calls this to receive the refresh fn so
 *                    SimulatorTray can trigger an immediate re-poll
 */

import React, {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import { usePollTransactions } from '../../hooks/usePollTransactions.ts';
import type { Transaction, RiskLevel, ReviewStatus } from '../../api/transactions.ts';

import { LoadingPane } from '../../components/LoadingSpinner/index.ts';
import { ErrorState } from '../../components/ErrorState/index.ts';
import { EmptyState } from '../../components/EmptyState/index.ts';
import { TransactionRow } from '../../components/TransactionRow/index.ts';

import './Desk.css';

// ── Types ──────────────────────────────────────────────────────────
interface Props {
  reviewer: string;
  registerRefresh: (fn: () => void) => void;
}

type TierFilter   = '' | RiskLevel;
type StatusFilter = '' | 'pending' | 'resolved';

// ── Helpers ────────────────────────────────────────────────────────
const RISK_ORDER: Record<string, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

function sortByRiskThenDate(a: Transaction, b: Transaction): number {
  const riskDiff = (RISK_ORDER[b.risk_level] ?? 0) - (RISK_ORDER[a.risk_level] ?? 0);
  if (riskDiff !== 0) return riskDiff;
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

const RESOLVED_STATUSES: ReviewStatus[] = ['approved', 'declined', 'escalated'];

function isResolved(tx: Transaction): boolean {
  return RESOLVED_STATUSES.includes(tx.review_status);
}

/** Derive the editorial headline from live data */
function buildHeadline(pending: number, total: number): string {
  if (total === 0) return 'All clear.';
  if (pending === 0) return 'Nothing new to review.';
  if (pending === 1) return '1 needs you now.';
  return `${pending} need you now.`;
}

/** Derive the sub-count sentence */
function buildSubline(
  transactions: Transaction[],
  totalCount: number,
): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const flaggedToday = transactions.filter(
    tx => new Date(tx.created_at) >= today,
  ).length;
  const waiting  = transactions.filter(tx => tx.review_status === 'pending').length;
  const cleared  = transactions.filter(tx => tx.review_status === 'approved').length;
  const reviewed = transactions.filter(tx =>
    tx.review_status === 'declined' || tx.review_status === 'escalated',
  ).length;

  const parts: string[] = [];
  if (totalCount > 0)    parts.push(`${totalCount} total`);
  if (flaggedToday > 0)  parts.push(`${flaggedToday} flagged today`);
  if (waiting > 0)       parts.push(`${waiting} waiting`);
  if (cleared > 0)       parts.push(`${cleared} cleared`);
  if (reviewed > 0)      parts.push(`${reviewed} reviewed`);
  return parts.join(', ') + '.';
}

// ── Component ──────────────────────────────────────────────────────
export const Desk: React.FC<Props> = ({ registerRefresh }) => {
  const { transactions, totalCount, loading, pollError, newIds, refresh } =
    usePollTransactions();

  // Register refresh with App so SimulatorTray can trigger it
  useEffect(() => {
    registerRefresh(refresh);
  }, [registerRefresh, refresh]);

  // ── Filters ──────────────────────────────────────────────────────
  const [tierFilter, setTierFilter]     = useState<TierFilter>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');

  // ── "N new" indicator while scrolled ─────────────────────────────
  const listRef       = useRef<HTMLDivElement>(null);
  const [pendingNew, setPendingNew] = useState(0);
  const isScrolledDown = useRef(false);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onScroll = () => {
      isScrolledDown.current = el.scrollTop > 120;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (newIds.size === 0) return;
    if (isScrolledDown.current) {
      setPendingNew(n => n + newIds.size);
    }
  }, [newIds]);

  // ── Filter logic ──────────────────────────────────────────────────
  const filtered = transactions.filter(tx => {
    if (tierFilter && tx.risk_level !== tierFilter) return false;
    if (statusFilter === 'pending'  && tx.review_status !== 'pending') return false;
    if (statusFilter === 'resolved' && !isResolved(tx)) return false;
    return true;
  });

  const waitingGroup  = filtered.filter(tx => !isResolved(tx)).sort(sortByRiskThenDate);
  const resolvedGroup = filtered.filter(tx => isResolved(tx)).sort(sortByRiskThenDate);

  // Counts for headline (unfiltered, from full data)
  const pendingCount = transactions.filter(tx => tx.review_status === 'pending').length;

  // ── Initial load ─────────────────────────────────────────────────
  if (loading) return <LoadingPane label="Loading transactions…" />;

  // ── First-load hard failure ───────────────────────────────────────
  if (pollError && transactions.length === 0) {
    return (
      <div className="desk__state-wrap">
        <ErrorState
          error={new Error('Engine unreachable')}
          onRetry={refresh}
          title="Engine unreachable"
        />
      </div>
    );
  }

  return (
    <section className="desk" aria-label="Fraud review desk">

      {/* ── Engine unreachable banner (keeps data visible) ──────── */}
      {pollError && (
        <div className="desk__poll-error" role="alert">
          <span>Engine unreachable, retrying…</span>
          <button type="button" onClick={refresh} className="desk__poll-retry">
            Retry now
          </button>
        </div>
      )}

      {/* ── "N new" float indicator ──────────────────────────────── */}
      {pendingNew > 0 && (
        <button
          type="button"
          className="desk__new-banner"
          onClick={() => {
            listRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            setPendingNew(0);
          }}
        >
          ↑ {pendingNew} new transaction{pendingNew !== 1 ? 's' : ''}
        </button>
      )}

      {/* ── Editorial headline ───────────────────────────────────── */}
      <header className="desk__header">
        <h1 className="desk__headline display">
          {buildHeadline(pendingCount, totalCount)}
        </h1>
        {transactions.length > 0 && (
          <p className="desk__subline muted">
            {buildSubline(transactions, totalCount)}
          </p>
        )}
      </header>

      {/* ── Filter bar ───────────────────────────────────────────── */}
      <div className="desk__filters" role="group" aria-label="Filter transactions">
        {/* Tier filter */}
        <div className="desk__filter-group">
          <span className="desk__filter-label">Risk</span>
          {(['', 'critical', 'high', 'medium', 'low'] as TierFilter[]).map(t => (
            <button
              key={t || 'all'}
              type="button"
              className={[
                'desk__filter-pill',
                tierFilter === t ? 'desk__filter-pill--active' : '',
                t ? `desk__filter-pill--${t}` : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setTierFilter(t)}
              aria-pressed={tierFilter === t}
            >
              {t ? t.charAt(0).toUpperCase() + t.slice(1) : 'All'}
            </button>
          ))}
        </div>

        {/* Status filter */}
        <div className="desk__filter-group">
          <span className="desk__filter-label">Status</span>
          {([
            { v: '' as StatusFilter,         label: 'All' },
            { v: 'pending' as StatusFilter,  label: 'Waiting' },
            { v: 'resolved' as StatusFilter, label: 'Resolved' },
          ]).map(({ v, label }) => (
            <button
              key={v || 'all'}
              type="button"
              className={[
                'desk__filter-pill',
                statusFilter === v ? 'desk__filter-pill--active' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => setStatusFilter(v)}
              aria-pressed={statusFilter === v}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Queue ────────────────────────────────────────────────── */}
      <div className="desk__queue" ref={listRef}>

        {/* ── Empty ─────────────────────────────────────────────── */}
        {filtered.length === 0 && (
          <EmptyState
            title={transactions.length === 0
              ? 'No transactions yet'
              : 'Nothing matches your filters'}
            description={transactions.length === 0
              ? 'Transactions will appear here as the engine processes them.'
              : 'Try adjusting the risk or status filters above.'}
          />
        )}

        {/* ── Group 1: Waiting for review ───────────────────────── */}
        {waitingGroup.length > 0 && (
          <div className="desk__group">
            <div className="desk__group-header">
              <span className="desk__group-title">Waiting for review</span>
              <span className="desk__group-count mono">{waitingGroup.length}</span>
            </div>
            <div className="desk__rows" role="table" aria-label="Waiting transactions">
              <RowHeader />
              {waitingGroup.map(tx => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  isNew={newIds.has(tx.id)}
                />
              ))}
            </div>
          </div>
        )}

        {/* ── Group 2: Resolved ─────────────────────────────────── */}
        {resolvedGroup.length > 0 && (
          <div className="desk__group desk__group--resolved">
            <div className="desk__group-header">
              <span className="desk__group-title">Resolved</span>
              <span className="desk__group-count mono">{resolvedGroup.length}</span>
            </div>
            <div className="desk__rows desk__rows--resolved" role="table" aria-label="Resolved transactions">
              <RowHeader />
              {resolvedGroup.map(tx => (
                <TransactionRow
                  key={tx.id}
                  transaction={tx}
                  isNew={newIds.has(tx.id)}
                />
              ))}
            </div>
          </div>
        )}
      </div>

    </section>
  );
};

/** Column header row for screen reader context */
const RowHeader: React.FC = () => (
  <div className="desk__row-header" role="row" aria-hidden="true">
    <span />
    <span>Score</span>
    <span>Risk</span>
    <span>Transaction</span>
    <span className="desk__col-right">Amount</span>
    <span className="desk__col-right">Time</span>
    <span />
  </div>
);
