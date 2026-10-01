/**
 * EvidenceRenderer — extensible, generic evidence display.
 *
 * Dispatches to specialised renderers based on rule_id / evidence shape:
 *   - "impossible_travel" / travel evidence fields → GeographyEvidence
 *   - "velocity_burst" / velocity evidence fields  → VelocityEvidence
 *   - "huge_amount" / amount evidence fields       → AmountEvidence
 *   - anything else                                → GenericEvidence
 *
 * Adding support for a new rule requires only adding a new specialised
 * renderer and a detection heuristic below — no other files change.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import type { RuleResult, Transaction } from '../../api/transactions.ts';
import './EvidenceRenderer.css';

// ── Helper: format distance ────────────────────────────────────────
function fmtKm(km: number): string {
  return km >= 1000
    ? `${(km / 1000).toFixed(1)} Mm`
    : `${Math.round(km).toLocaleString()} km`;
}

function fmtSpeed(kmh: number): string {
  return `${Math.round(kmh).toLocaleString()} km/h`;
}

function fmtDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ── 1. Geography evidence ──────────────────────────────────────────
interface GeoProps {
  rule: RuleResult;
  tx: Transaction;
}

const GeographyEvidence: React.FC<GeoProps> = ({ rule, tx }) => {
  const ev = rule.evidence ?? {};
  const origin      = (ev.origin      as string | undefined) ?? tx.travel_origin      ?? '—';
  const destination = (ev.destination as string | undefined) ?? tx.travel_destination ?? '—';
  const distKm      = (ev.distance_km  as number | undefined) ?? tx.travel_distance_km;
  const timeMins    = (ev.time_gap_minutes as number | undefined) ?? tx.travel_time_minutes;
  const speedKmh    = (ev.implied_speed_kmh as number | undefined) ?? tx.implied_speed_kmh;

  return (
    <div className="evidence evidence--geo">
      {/* SVG route visual (pure CSS/SVG, no external tiles) */}
      <div className="evidence-geo__route" aria-hidden="true">
        <svg viewBox="0 0 320 64" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* dotted path */}
          <path
            d="M 24 32 C 80 8, 240 56, 296 32"
            stroke="var(--color-risk-high)"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />
          {/* origin dot */}
          <circle cx="24" cy="32" r="5" fill="var(--color-pine)" />
          {/* destination dot */}
          <circle cx="296" cy="32" r="5" fill="var(--color-risk-high)" />
          {/* midpoint arrow */}
          <polygon
            points="160,27 167,32 160,37"
            fill="var(--color-risk-high)"
            opacity="0.6"
          />
        </svg>
      </div>

      <div className="evidence-geo__labels">
        <span className="evidence-geo__place">
          <span className="evidence-geo__dot evidence-geo__dot--origin" aria-hidden="true" />
          <span className="evidence-geo__place-name">{origin}</span>
          <span className="evidence-geo__place-role muted">Origin</span>
        </span>
        <span className="evidence-geo__place evidence-geo__place--dest">
          <span className="evidence-geo__dot evidence-geo__dot--dest" aria-hidden="true" />
          <span className="evidence-geo__place-name">{destination}</span>
          <span className="evidence-geo__place-role muted">Destination</span>
        </span>
      </div>

      <dl className="evidence-geo__stats">
        {distKm !== undefined && (
          <>
            <dt>Distance</dt>
            <dd className="mono">{fmtKm(distKm)}</dd>
          </>
        )}
        {timeMins !== undefined && (
          <>
            <dt>Time gap</dt>
            <dd className="mono">{fmtDuration(timeMins)}</dd>
          </>
        )}
        {speedKmh !== undefined && (
          <>
            <dt>Implied speed</dt>
            <dd className="mono evidence-geo__speed">{fmtSpeed(speedKmh)}</dd>
          </>
        )}
      </dl>
    </div>
  );
};

// ── 2. Velocity evidence ───────────────────────────────────────────
interface VelocityProps {
  rule: RuleResult;
  tx: Transaction;
}

const VelocityEvidence: React.FC<VelocityProps> = ({ rule, tx }) => {
  const ev = rule.evidence ?? {};
  const count   = (ev.count   as number | undefined) ?? tx.velocity_count;
  const limit   = (ev.limit   as number | undefined);
  const windowS = (ev.window_seconds as number | undefined) ?? tx.velocity_window_s;

  if (count === undefined) return null;

  const tickCount = Math.min(count, 30); // cap visual ticks
  const overLimit = limit !== undefined ? Math.max(0, count - limit) : 0;

  return (
    <div className="evidence evidence--velocity">
      <div className="evidence-velocity__header">
        <span className="evidence-velocity__count mono">{count}</span>
        <span className="evidence-velocity__label muted">
          events{windowS !== undefined ? ` in ${fmtDuration(windowS / 60)}` : ''}
          {limit !== undefined ? ` (limit: ${limit})` : ''}
        </span>
      </div>

      {/* Tick strip */}
      <div
        className="evidence-velocity__ticks"
        aria-label={`${count} velocity events${limit !== undefined ? `, ${overLimit} over limit` : ''}`}
      >
        {Array.from({ length: tickCount }, (_, i) => {
          const isOver = limit !== undefined && i >= (count - overLimit);
          return (
            <span
              key={i}
              className={['evidence-velocity__tick', isOver ? 'evidence-velocity__tick--over' : ''].filter(Boolean).join(' ')}
              aria-hidden="true"
            />
          );
        })}
        {count > 30 && (
          <span className="evidence-velocity__overflow mono">+{count - 30}</span>
        )}
      </div>
      {limit !== undefined && overLimit > 0 && (
        <p className="evidence-velocity__note">
          <span className="evidence-velocity__over-label">{overLimit} event{overLimit !== 1 ? 's' : ''} above the configured limit.</span>
        </p>
      )}
    </div>
  );
};

// ── 3. Amount evidence ─────────────────────────────────────────────
interface AmountProps {
  rule: RuleResult;
  tx: Transaction;
}

function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency,
      minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

const AmountEvidence: React.FC<AmountProps> = ({ rule, tx }) => {
  const ev = rule.evidence ?? {};
  const median  = (ev.median  as number | undefined) ?? tx.amount_median;
  const mad     = (ev.mad     as number | undefined) ?? tx.amount_mad;
  const zscore  = (ev.zscore  as number | undefined) ?? tx.amount_zscore;
  const amount  = tx.amount;
  const cur     = tx.currency;

  // Build a simple band visual if we have enough data
  const hasBand = median !== undefined && mad !== undefined;
  let bandPct   = 50; // default: center
  if (hasBand) {
    // Place the dot: how many MADs away?
    const deviation = Math.abs(amount - median);
    const mads      = mad > 0 ? deviation / mad : 0;
    // Map 0–5 MADs onto 0–100% with this transaction always to the right
    bandPct = Math.min(95, 50 + (mads / 5) * 45);
    if (amount < median) bandPct = Math.max(5, 50 - (mads / 5) * 45);
  }

  return (
    <div className="evidence evidence--amount">
      <dl className="evidence-amount__stats">
        <dt>Amount</dt>
        <dd className="mono">{fmtCurrency(amount, cur)}</dd>
        {median !== undefined && (
          <>
            <dt>Median (historical)</dt>
            <dd className="mono">{fmtCurrency(median, cur)}</dd>
          </>
        )}
        {mad !== undefined && (
          <>
            <dt>MAD</dt>
            <dd className="mono">{fmtCurrency(mad, cur)}</dd>
          </>
        )}
        {zscore !== undefined && (
          <>
            <dt>Z-score</dt>
            <dd className="mono">{zscore.toFixed(2)}</dd>
          </>
        )}
      </dl>

      {hasBand && (
        <div className="evidence-amount__band" aria-hidden="true">
          <div className="evidence-amount__band-track">
            {/* Normal reference band */}
            <div className="evidence-amount__band-normal" />
            {/* This transaction marker */}
            <div
              className="evidence-amount__band-marker"
              style={{ left: `${bandPct}%` }}
              title={`This transaction: ${fmtCurrency(amount, cur)}`}
            />
          </div>
          <div className="evidence-amount__band-labels">
            <span className="muted">Normal range</span>
            <span className="evidence-amount__this-label">This transaction →</span>
          </div>
        </div>
      )}
    </div>
  );
};

// ── 4. Duplicate claim evidence ───────────────────────────────────
function fmtDollar(amount: number, currency: string = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

interface DuplicateClaimProps {
  rule: RuleResult;
  tx: Transaction;
}

const DuplicateClaimEvidence: React.FC<DuplicateClaimProps> = ({ rule, tx }) => {
  const ev = rule.evidence ?? {};
  const dupCount = (ev.duplicate_count as number | undefined) ?? (tx.is_duplicate_claim ? 1 : 0);
  const exactMatches = ev.exact_amount_matches as number | undefined;
  const duplicateIds = Array.isArray(ev.duplicate_txn_ids)
    ? (ev.duplicate_txn_ids as string[]).filter(Boolean)
    : [];
  const providerId = (ev.provider_id as string | undefined) ?? tx.merchant_name;
  const category = (ev.category as string | undefined) ?? tx.merchant_category;
  const windowDays = ev.window_days as number | undefined;

  const currentAmountStr = typeof ev.current_amount === 'number'
    ? fmtDollar(ev.current_amount, tx.currency)
    : fmtCurrency(tx.amount, tx.currency);

  return (
    <div className="evidence evidence--duplicate">
      <div className="evidence-dup__hero">
        <div className="evidence-dup__headline">
          <span className="evidence-dup__count mono">{dupCount}</span>
          <span className="evidence-dup__label">
            potential duplicate claim{dupCount !== 1 ? 's' : ''} detected
            {windowDays !== undefined ? ` within ${windowDays} days` : ''}
          </span>
        </div>
        {exactMatches !== undefined && exactMatches > 0 && (
          <span className="evidence-dup__tag evidence-dup__tag--exact">
            ⚠ {exactMatches} Exact Amount Match{exactMatches !== 1 ? 'es' : ''}
          </span>
        )}
      </div>

      <dl className="evidence-dup__stats">
        {category && (
          <>
            <dt>Procedure / Category</dt>
            <dd className="mono">{category.replace(/_/g, ' ')}</dd>
          </>
        )}
        {providerId && (
          <>
            <dt>Provider ID</dt>
            <dd className="mono">{providerId}</dd>
          </>
        )}
        <dt>Claim Amount</dt>
        <dd className="mono">{currentAmountStr}</dd>
        {windowDays !== undefined && (
          <>
            <dt>Lookback Window</dt>
            <dd className="mono">{windowDays} days</dd>
          </>
        )}
      </dl>

      {duplicateIds.length > 0 && (
        <div className="evidence-dup__section">
          <span className="evidence-dup__section-title">
            Matched Prior Claims ({duplicateIds.length})
          </span>
          <div className="evidence-dup__links" role="group" aria-label="Prior duplicate claims">
            {duplicateIds.map(id => (
              <Link
                key={id}
                to={`/transactions/${encodeURIComponent(id)}`}
                className="evidence-dup__txn-link mono"
                title={`Open matched claim ${id}`}
              >
                <span className="evidence-dup__txn-id">{id}</span>
                <span className="evidence-dup__txn-arrow" aria-hidden="true">→</span>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// ── 5. Generic fallback ────────────────────────────────────────────
const GenericEvidence: React.FC<{ rule: RuleResult }> = ({ rule }) => {
  const ev = rule.evidence;
  if (!ev || Object.keys(ev).length === 0) {
    if (!rule.reason) return null;
    return (
      <p className="evidence evidence--generic muted" style={{ fontSize: 'var(--text-sm)' }}>
        {rule.reason}
      </p>
    );
  }

  return (
    <dl className="evidence evidence--generic">
      {Object.entries(ev).map(([k, v]) => (
        <React.Fragment key={k}>
          <dt>{k.replace(/_/g, ' ')}</dt>
          <dd className="mono">
            {typeof v === 'object' ? JSON.stringify(v) : String(v)}
          </dd>
        </React.Fragment>
      ))}
    </dl>
  );
};

// ── Dispatcher ─────────────────────────────────────────────────────
function detectEvidenceType(
  rule: RuleResult,
  tx: Transaction,
): 'geo' | 'velocity' | 'amount' | 'duplicate' | 'generic' {
  const id = rule.rule_id.toLowerCase();
  const ev = rule.evidence ?? {};

  if (
    id.includes('duplicate') ||
    'duplicate_count' in ev ||
    'duplicate_txn_ids' in ev ||
    tx.is_duplicate_claim
  ) return 'duplicate';

  if (
    id.includes('travel') || id.includes('geo') ||
    'distance_km' in ev || 'implied_speed_kmh' in ev ||
    tx.travel_distance_km !== undefined
  ) return 'geo';

  if (
    id.includes('velocity') || id.includes('burst') ||
    'count' in ev || 'window_seconds' in ev ||
    tx.velocity_count !== undefined
  ) return 'velocity';

  if (
    id.includes('amount') || id.includes('huge') ||
    'zscore' in ev || 'median' in ev ||
    tx.amount_zscore !== undefined
  ) return 'amount';

  return 'generic';
}

// ── Public component ───────────────────────────────────────────────
interface Props {
  rule: RuleResult;
  tx: Transaction;
}

export const EvidenceRenderer: React.FC<Props> = ({ rule, tx }) => {
  const type = detectEvidenceType(rule, tx);
  if (type === 'duplicate') return <DuplicateClaimEvidence rule={rule} tx={tx} />;
  if (type === 'geo')       return <GeographyEvidence rule={rule} tx={tx} />;
  if (type === 'velocity')  return <VelocityEvidence  rule={rule} tx={tx} />;
  if (type === 'amount')    return <AmountEvidence    rule={rule} tx={tx} />;
  return <GenericEvidence rule={rule} />;
};
