/**
 * TransactionRow
 *
 * A single row in the Desk transaction queue.
 *
 * Layout (left → right):
 *  [4px risk heat bar] [score] [risk tier + tick] [details] [amount] [time] [alert]
 *
 * Risk is never communicated by colour alone — the tier text is always present.
 * Clicking the row navigates to /transactions/:id.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import type { Transaction } from '../../api/transactions.ts';
import './TransactionRow.css';

interface Props {
  transaction: Transaction;
  isNew?: boolean;
}

// ── Colour constants (mirroring tokens.css; kept here so JS can apply inline) ──
const RISK_COLOR: Record<string, string> = {
  low:      '#9DB2AB',
  medium:   '#D9788C',
  high:     '#C21E4C',
  critical: '#5B0F2B',
};

const RISK_LABEL: Record<string, string> = {
  low:      'Low',
  medium:   'Medium',
  high:     'High',
  critical: 'Critical',
};

const RISK_ORDER: Record<string, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

/** Four-segment risk tick: filled segments = tier ordinal */
const RiskTick: React.FC<{ level: string }> = ({ level }) => {
  const filled = RISK_ORDER[level] ?? 0;
  const color  = RISK_COLOR[level] ?? '#9DB2AB';
  return (
    <span className="risk-tick" aria-hidden="true" title={`Risk: ${RISK_LABEL[level]}`}>
      {[1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="risk-tick__seg"
          style={{ background: i <= filled ? color : undefined }}
        />
      ))}
    </span>
  );
};

/** Format minor-unit amount to display string */
function formatAmount(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

/** Relative time, e.g. "3m ago" */
function relativeTime(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  const s = Math.floor(delta / 1000);
  if (s < 60)   return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)   return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)   return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** UTC timestamp short form */
function utcShort(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    hour12: false,
  }) + ' UTC';
}

export const TransactionRow: React.FC<Props> = ({ transaction: tx, isNew = false }) => {
  const navigate = useNavigate();
  const color = RISK_COLOR[tx.risk_level] ?? '#9DB2AB';
  const hasAlert = tx.triggered_rules.length > 0;
  const topRule = tx.triggered_rules[0] ?? null;

  return (
    <div
      className={['txrow', isNew ? 'txrow--new' : ''].filter(Boolean).join(' ')}
      role="row"
      tabIndex={0}
      onClick={() => navigate(`/transactions/${tx.id}`)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') navigate(`/transactions/${tx.id}`);
      }}
      aria-label={`${tx.merchant_name} ${formatAmount(tx.amount, tx.currency)} – ${RISK_LABEL[tx.risk_level]} risk`}
    >
      {/* ── Heat bar ─────────────────────────────────────────── */}
      <span
        className="txrow__heat"
        style={{ background: color }}
        aria-hidden="true"
      />

      {/* ── Score ────────────────────────────────────────────── */}
      <div className="txrow__score" aria-label={`Risk score ${tx.risk_score}`}>
        <span className="txrow__score-num mono" style={{ color }}>
          {tx.risk_score}
        </span>
      </div>

      {/* ── Tier + tick ──────────────────────────────────────── */}
      <div className="txrow__tier">
        <span className="txrow__tier-label" style={{ color }}>
          {RISK_LABEL[tx.risk_level]}
        </span>
        <RiskTick level={tx.risk_level} />
      </div>

      {/* ── Main details ─────────────────────────────────────── */}
      <div className="txrow__details">
        <span className="txrow__merchant">{tx.merchant_name}</span>
        <div className="txrow__meta">
          {tx.cardholder_name && (
            <span className="txrow__meta-item">{tx.cardholder_name}</span>
          )}
          {tx.merchant_category && (
            <span className="txrow__meta-item txrow__category">{tx.merchant_category}</span>
          )}
          {topRule && (
            <span className="txrow__rule mono" title="Top firing rule">
              ⚑ {topRule}
            </span>
          )}
        </div>
      </div>

      {/* ── Amount ───────────────────────────────────────────── */}
      <div className="txrow__amount">
        <span className="txrow__amount-value mono">
          {formatAmount(tx.amount, tx.currency)}
        </span>
      </div>

      {/* ── Time ─────────────────────────────────────────────── */}
      <div className="txrow__time" title={new Date(tx.created_at).toISOString()}>
        <span className="txrow__rel-time">{relativeTime(tx.created_at)}</span>
        <span className="txrow__utc-time mono">{utcShort(tx.created_at)}</span>
      </div>

      {/* ── Alert pip ────────────────────────────────────────── */}
      <div className="txrow__alert" aria-label={hasAlert ? 'Has alerts' : 'No alerts'}>
        {hasAlert && (
          <span
            className="txrow__alert-pip"
            style={{ background: color }}
            aria-hidden="true"
            title={`${tx.triggered_rules.length} rule${tx.triggered_rules.length !== 1 ? 's' : ''} fired`}
          />
        )}
      </div>
    </div>
  );
};
