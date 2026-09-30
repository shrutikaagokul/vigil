/**
 * CaseFile — the investigator's dossier for a single transaction.
 *
 * Sections:
 *   1. Back nav + identity header
 *   2. Verdict block (score, tier, tick, plain-language summary)
 *   3. Score driver bar (actual rule contributions or rule count fallback)
 *   4. Rule findings (dynamic, from backend rule_results)
 *   5. Score receipt (actual backend value + available rule contributions)
 *   6. Review panel (PATCH /transactions/:id/review, 409 handling)
 *   7. Audit trail (timeline from audit_events if present)
 *
 * Nothing here is invented. Absent data shows honest neutral states.
 */

import React, {
  useEffect,
  useRef,
  useState,
} from 'react';
import { Link, useParams } from 'react-router-dom';

import { ApiError } from '../../api/client.ts';
import { transactionsApi } from '../../api/transactions.ts';
import type {
  Transaction,
  RuleResult,
  ReviewStatus,
  AuditEvent,
} from '../../api/transactions.ts';
import { useAsync } from '../../hooks/useAsync.ts';

import { LoadingPane } from '../../components/LoadingSpinner/index.ts';
import { ErrorState } from '../../components/ErrorState/index.ts';
import { EvidenceRenderer } from '../../components/EvidenceRenderer/index.ts';

import './CaseFile.css';

// ── Shared constants ───────────────────────────────────────────────
const RISK_COLOR: Record<string, string> = {
  low:      '#9DB2AB',
  medium:   '#D9788C',
  high:     '#C21E4C',
  critical: '#5B0F2B',
};

const RISK_LABEL: Record<string, string> = {
  low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
};

const RISK_ORDER: Record<string, number> = {
  low: 1, medium: 2, high: 3, critical: 4,
};

const STATUS_LABEL: Record<ReviewStatus, string> = {
  pending:   'Pending review',
  approved:  'Cleared',
  declined:  'Declined',
  escalated: 'Escalated',
};

// ── Utility functions ──────────────────────────────────────────────
function fmtCurrency(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency', currency, minimumFractionDigits: 2,
    }).format(amount / 100);
  } catch {
    return `${currency} ${(amount / 100).toFixed(2)}`;
  }
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZone: 'UTC',
    hour12: false,
  }) + ' UTC';
}

function fmtRelative(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Sub-component: four-segment risk tick ──────────────────────────
const RiskTick: React.FC<{ level: string; size?: 'sm' | 'lg' }> = ({
  level, size = 'sm',
}) => {
  const filled = RISK_ORDER[level] ?? 0;
  const color  = RISK_COLOR[level] ?? '#9DB2AB';
  const w = size === 'lg' ? 20 : 14;
  const h = size === 'lg' ? 5  : 3;
  return (
    <span
      className={`risk-tick risk-tick--${size}`}
      aria-label={`${RISK_LABEL[level] ?? level} risk tier`}
    >
      {[1, 2, 3, 4].map(i => (
        <span
          key={i}
          className="risk-tick__seg"
          style={{
            width: w, height: h,
            background: i <= filled ? color : undefined,
          }}
        />
      ))}
    </span>
  );
};

// ── Sub-component: verdict block ───────────────────────────────────
const VerdictBlock: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const color = RISK_COLOR[tx.risk_level] ?? '#9DB2AB';
  const label = RISK_LABEL[tx.risk_level] ?? tx.risk_level;

  // Animated score count-up (respects prefers-reduced-motion)
  const scoreRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = scoreRef.current;
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) { el.textContent = String(tx.risk_score); return; }
    let frame = 0;
    const target = tx.risk_score;
    const duration = 600;
    const start = performance.now();
    const tick = (now: number) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = String(Math.round(eased * target));
      if (progress < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [tx.risk_score]);

  // Plain-language summary (derived from backend data, never invented)
  const topRuleName = tx.rule_results?.find(r => r.applicable)?.rule_name;
  let verdictText = '';
  if (tx.risk_level === 'critical') {
    verdictText = topRuleName
      ? `Flagged as critical risk. Primary driver: ${topRuleName}.`
      : 'Flagged as critical risk. Review the rule findings below.';
  } else if (tx.risk_level === 'high') {
    verdictText = topRuleName
      ? `High risk transaction. Primary driver: ${topRuleName}.`
      : 'High risk transaction. See rule findings below.';
  } else if (tx.risk_level === 'medium') {
    verdictText = 'Elevated risk — one or more rules triggered. Review findings.';
  } else {
    verdictText = tx.triggered_rules.length > 0
      ? 'Low risk, but some rules activated. Findings below.'
      : 'No rules triggered. Engine considers this low risk.';
  }

  return (
    <section className="cf-verdict" aria-label="Verdict">
      <div className="cf-verdict__score-wrap">
        <span
          ref={scoreRef}
          className="cf-verdict__score mono"
          style={{ color }}
          aria-label={`Risk score ${tx.risk_score} out of 100`}
        >
          {tx.risk_score}
        </span>
        <span className="cf-verdict__score-denom mono muted">/100</span>
      </div>

      <div className="cf-verdict__tier">
        <span
          className="cf-verdict__tier-label"
          style={{ color }}
        >
          {label} risk
        </span>
        <RiskTick level={tx.risk_level} size="lg" />
      </div>

      <p className="cf-verdict__summary muted">{verdictText}</p>
    </section>
  );
};

// ── Sub-component: score driver bar ───────────────────────────────
const DriverBar: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const ruleResults = tx.rule_results ?? [];
  const applicable  = ruleResults.filter(r => r.applicable && !r.error);

  // Use backend-provided score_components if available; otherwise use rule scores
  const components: Array<{ id: string; name: string; value: number; color: string }> = [];

  if (tx.score_components) {
    for (const [ruleId, contribution] of Object.entries(tx.score_components)) {
      const matched = ruleResults.find(r => r.rule_id === ruleId);
      components.push({
        id:    ruleId,
        name:  matched?.rule_name ?? ruleId,
        value: contribution,
        color: RISK_COLOR[matched?.rule_id ? 'high' : 'medium'] ?? '#D9788C',
      });
    }
  } else if (applicable.length > 0) {
    const total = applicable.reduce((s, r) => s + (r.score ?? 0), 0) || 1;
    for (const r of applicable) {
      if ((r.score ?? 0) > 0) {
        components.push({
          id:    r.rule_id,
          name:  r.rule_name,
          value: Math.round(((r.score ?? 0) / total) * 100),
          color: RISK_COLOR[r.rule_id] ?? '#D9788C',
        });
      }
    }
  }

  const hasWeights = tx.score_components !== undefined || ruleResults.some(r => r.weight !== undefined);
  const label      = hasWeights
    ? 'Weighted rule contributions'
    : 'Rule score contribution (approximate — backend is source of truth)';

  if (components.length === 0) {
    if (tx.triggered_rules.length === 0) return null;
    return (
      <section className="cf-drivers" aria-label="Score drivers">
        <h2 className="cf-section-title">What drove the score</h2>
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {tx.triggered_rules.length} rule{tx.triggered_rules.length !== 1 ? 's' : ''} triggered.
          Detailed contributions not available from this endpoint.
        </p>
      </section>
    );
  }

  return (
    <section className="cf-drivers" aria-label="Score drivers">
      <h2 className="cf-section-title">What drove the score</h2>
      <p className="cf-drivers__label muted">{label}</p>

      {/* Segmented bar */}
      <div className="cf-drivers__bar" role="img" aria-label="Contribution bar">
        {components.map((c, i) => (
          <div
            key={c.id}
            className="cf-drivers__seg"
            style={{
              width:      `${c.value}%`,
              background: RISK_COLOR[['critical','high','medium','low'][i % 4]] ?? '#D9788C',
              animationDelay: `${i * 80}ms`,
            }}
            title={`${c.name}: ${c.value}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <ul className="cf-drivers__legend">
        {components.map((c, i) => (
          <li key={c.id} className="cf-drivers__legend-item">
            <span
              className="cf-drivers__legend-dot"
              style={{ background: RISK_COLOR[['critical','high','medium','low'][i % 4]] ?? '#D9788C' }}
              aria-hidden="true"
            />
            <span className="cf-drivers__legend-name">{c.name}</span>
            <span className="cf-drivers__legend-pct mono">{c.value}%</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

// ── Sub-component: single rule finding row ─────────────────────────
const RuleFinding: React.FC<{ rule: RuleResult; tx: Transaction }> = ({ rule, tx }) => {
  const [open, setOpen] = useState(false);

  if (!rule.applicable) {
    return (
      <div className="cf-rule cf-rule--na" aria-label={`${rule.rule_name}: not applicable`}>
        <div className="cf-rule__header">
          <span className="cf-rule__name muted">{rule.rule_name}</span>
          {rule.version && (
            <span className="cf-rule__version mono muted">v{rule.version}</span>
          )}
          <span className="cf-rule__na-badge">Not applicable</span>
        </div>
      </div>
    );
  }

  if (rule.error) {
    return (
      <div className="cf-rule cf-rule--error" role="alert">
        <div className="cf-rule__header">
          <span className="cf-rule__name">{rule.rule_name}</span>
          {rule.version && (
            <span className="cf-rule__version mono">v{rule.version}</span>
          )}
          <span className="cf-rule__error-badge">Rule failed</span>
        </div>
        <p className="cf-rule__error-msg">
          {rule.error} — Rule failed. Other rules were not affected.
        </p>
      </div>
    );
  }

  const hasEvidence = rule.evidence
    ? Object.keys(rule.evidence).length > 0
    : false;
  const hasDetail = !!rule.reason || hasEvidence;

  return (
    <div className={`cf-rule${open ? ' cf-rule--open' : ''}`}>
      <button
        className="cf-rule__header cf-rule__toggle"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-label={`${rule.rule_name}: score ${rule.score ?? '—'}, ${open ? 'collapse' : 'expand'}`}
        type="button"
        disabled={!hasDetail}
      >
        <span className="cf-rule__name">{rule.rule_name}</span>
        {rule.version && (
          <span className="cf-rule__version mono muted">v{rule.version}</span>
        )}
        {rule.score !== undefined && (
          <span className="cf-rule__score mono">{rule.score}</span>
        )}
        {hasDetail && (
          <span className="cf-rule__chevron" aria-hidden="true">
            {open ? '▲' : '▼'}
          </span>
        )}
      </button>

      {open && hasDetail && (
        <div className="cf-rule__detail">
          {rule.reason && (
            <p className="cf-rule__reason">{rule.reason}</p>
          )}
          {hasEvidence && (
            <div className="cf-rule__evidence">
              <EvidenceRenderer rule={rule} tx={tx} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ── Sub-component: rule findings list ─────────────────────────────
const RuleFindings: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const ruleResults = tx.rule_results;

  if (!ruleResults || ruleResults.length === 0) {
    // Fall back to triggered_rules IDs
    if (tx.triggered_rules.length === 0) {
      return (
        <section className="cf-findings" aria-label="Rule findings">
          <h2 className="cf-section-title">Rule findings</h2>
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            No rules triggered for this transaction.
          </p>
        </section>
      );
    }
    return (
      <section className="cf-findings" aria-label="Rule findings">
        <h2 className="cf-section-title">Rule findings</h2>
        <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
          {tx.triggered_rules.length} rule ID{tx.triggered_rules.length !== 1 ? 's' : ''} reported
          by engine. Detailed rule output not available from this endpoint.
        </p>
        <ul className="cf-findings__id-list mono">
          {tx.triggered_rules.map(id => (
            <li key={id} className="cf-findings__id">{id}</li>
          ))}
        </ul>
      </section>
    );
  }

  // Sort: errors first, then by score desc, then not-applicable last
  const sorted = [...ruleResults].sort((a, b) => {
    if (a.error && !b.error)     return -1;
    if (!a.error && b.error)     return 1;
    if (a.applicable && !b.applicable) return -1;
    if (!a.applicable && b.applicable) return 1;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  return (
    <section className="cf-findings" aria-label="Rule findings">
      <h2 className="cf-section-title">Rule findings</h2>
      <div className="cf-findings__list">
        {sorted.map(rule => (
          <RuleFinding key={rule.rule_id} rule={rule} tx={tx} />
        ))}
      </div>
    </section>
  );
};

// ── Sub-component: score receipt ───────────────────────────────────
const ScoreReceipt: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const hasFormula = !!tx.score_formula;
  const contributions = tx.score_components
    ? Object.entries(tx.score_components)
    : (tx.rule_results ?? [])
        .filter(r => r.applicable && r.score !== undefined)
        .map(r => [r.rule_name, r.score!] as [string, number]);

  return (
    <section className="cf-receipt" aria-label="Risk calculation">
      <h2 className="cf-section-title">Risk calculation</h2>

      <div className="cf-receipt__body">
        <div className="cf-receipt__final">
          <span className="cf-receipt__final-label muted">Final risk score</span>
          <span className="cf-receipt__final-value mono">{tx.risk_score}</span>
        </div>

        {hasFormula && (
          <div className="cf-receipt__formula">
            <span className="cf-receipt__formula-label muted">Aggregation method</span>
            <span className="cf-receipt__formula-value mono">{tx.score_formula}</span>
          </div>
        )}

        {contributions.length > 0 && (
          <>
            <p className="cf-receipt__contrib-label muted">
              Rule contributions{!hasFormula ? ' — backend is source of truth' : ''}
            </p>
            <dl className="cf-receipt__contribs">
              {contributions.map(([name, val]) => (
                <React.Fragment key={name}>
                  <dt className="cf-receipt__contrib-name">{name}</dt>
                  <dd className="cf-receipt__contrib-val mono">{val}</dd>
                </React.Fragment>
              ))}
            </dl>
          </>
        )}

        {!hasFormula && contributions.length === 0 && (
          <p className="muted" style={{ fontSize: 'var(--text-sm)' }}>
            Detailed score breakdown not available from this endpoint.
            The score above is the authoritative value from the engine.
          </p>
        )}
      </div>
    </section>
  );
};

// ── Sub-component: review panel ────────────────────────────────────
interface ReviewPanelProps {
  tx: Transaction;
  reviewer: string;
  onUpdated: (updated: Transaction) => void;
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({ tx, reviewer, onUpdated }) => {
  const [localReviewer, setLocalReviewer] = useState(reviewer);
  const [note,          setNote]          = useState('');
  const [submitting,    setSubmitting]    = useState(false);
  const [conflictError, setConflictError] = useState(false);
  const [submitError,   setSubmitError]   = useState<string | null>(null);

  // Keep in sync if the masthead reviewer changes
  useEffect(() => {
    setLocalReviewer(prev => prev || reviewer);
  }, [reviewer]);

  const isResolved = tx.review_status !== 'pending';
  const canReview  = !!localReviewer.trim() && !submitting;

  const submit = async (toStatus: ReviewStatus) => {
    if (!canReview) return;
    setSubmitting(true);
    setConflictError(false);
    setSubmitError(null);

    try {
      const updated = await transactionsApi.review(tx.id, {
        to_status:        toStatus,
        reviewer:         localReviewer.trim(),
        note:             note.trim() || undefined,
        expected_version: tx.version,
      });
      onUpdated(updated);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflictError(true);
      } else {
        setSubmitError(err instanceof Error ? err.message : 'Review failed. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (conflictError) {
    return (
      <section className="cf-review" aria-label="Review">
        <h2 className="cf-section-title">Review</h2>
        <div className="cf-review__conflict" role="alert">
          <p className="cf-review__conflict-msg">
            Someone else updated this case. Reload to see their decision.
          </p>
          <button
            type="button"
            className="cf-review__conflict-reload"
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="cf-review" aria-label="Review">
      <h2 className="cf-section-title">Review</h2>

      {/* Current status */}
      <div className="cf-review__status">
        <span className={`cf-review__status-badge cf-review__status-badge--${tx.review_status}`}>
          {STATUS_LABEL[tx.review_status]}
        </span>
        {tx.reviewed_by && (
          <span className="cf-review__reviewed-by muted">
            by {tx.reviewed_by}
            {tx.reviewed_at ? ` · ${fmtRelative(tx.reviewed_at)}` : ''}
          </span>
        )}
      </div>

      {isResolved ? (
        <p className="cf-review__resolved-note muted">
          This transaction has been resolved. To change the decision, a new review action is required.
        </p>
      ) : (
        <div className="cf-review__form">
          {/* Reviewer */}
          <label className="cf-review__field">
            <span className="cf-review__field-label">Reviewer</span>
            <input
              type="text"
              className="cf-review__input mono"
              value={localReviewer}
              onChange={e => setLocalReviewer(e.target.value)}
              placeholder="Enter your name"
              aria-label="Reviewer name"
              spellCheck={false}
            />
          </label>

          {/* Note */}
          <label className="cf-review__field">
            <span className="cf-review__field-label">Note <span className="muted">(optional)</span></span>
            <textarea
              className="cf-review__textarea"
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Add a note for the audit trail…"
              rows={3}
              aria-label="Review note"
            />
          </label>

          {/* Reviewer required hint */}
          {!localReviewer.trim() && (
            <p className="cf-review__reviewer-hint muted" role="status">
              Enter your name to review
            </p>
          )}

          {/* Submit error */}
          {submitError && (
            <p className="cf-review__submit-error" role="alert">{submitError}</p>
          )}

          {/* Action buttons */}
          <div className="cf-review__actions">
            <button
              type="button"
              className="cf-review__btn cf-review__btn--review"
              onClick={() => void submit('declined')}
              disabled={!canReview}
              aria-disabled={!canReview}
            >
              {submitting ? 'Submitting…' : 'Mark reviewed'}
            </button>
            <button
              type="button"
              className="cf-review__btn cf-review__btn--clear"
              onClick={() => void submit('approved')}
              disabled={!canReview}
              aria-disabled={!canReview}
            >
              {submitting ? 'Submitting…' : 'Mark cleared'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

// ── Sub-component: audit trail ─────────────────────────────────────
const AuditTrail: React.FC<{ tx: Transaction }> = ({ tx }) => {
  const events: AuditEvent[] = tx.audit_events ?? [];

  // Also synthesise a creation event from the transaction itself
  const allEvents: AuditEvent[] = [
    {
      event_type: 'created',
      created_at: tx.created_at,
      note:       `${tx.merchant_name} · ${fmtCurrency(tx.amount, tx.currency)}`,
    },
    ...events,
    // If reviewed, add a synthesised event if audit_events don't include it
    ...(tx.reviewed_at && !events.some(e => e.event_type === 'review')
      ? [{
          event_type: 'review',
          actor:      tx.reviewed_by,
          to_status:  tx.review_status,
          note:       tx.notes,
          created_at: tx.reviewed_at,
        } as AuditEvent]
      : []),
  ].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (allEvents.length === 0) return null;

  return (
    <section className="cf-audit" aria-label="Audit trail">
      <h2 className="cf-section-title">Audit trail</h2>
      <ol className="cf-audit__timeline">
        {allEvents.map((ev, i) => (
          <li key={i} className="cf-audit__event">
            <span className="cf-audit__dot" aria-hidden="true" />
            <div className="cf-audit__body">
              <div className="cf-audit__top">
                <span className="cf-audit__type">{ev.event_type.replace(/_/g, ' ')}</span>
                {ev.actor && (
                  <span className="cf-audit__actor muted">by {ev.actor}</span>
                )}
                {ev.to_status && (
                  <span className={`cf-audit__status cf-audit__status--${ev.to_status}`}>
                    → {STATUS_LABEL[ev.to_status]}
                  </span>
                )}
              </div>
              {ev.note && (
                <p className="cf-audit__note muted">{ev.note}</p>
              )}
              <time
                className="cf-audit__time mono"
                dateTime={ev.created_at}
                title={fmtDateTime(ev.created_at)}
              >
                {fmtRelative(ev.created_at)} · {fmtDateTime(ev.created_at)}
              </time>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
};

// ── Transaction identity header ────────────────────────────────────
const TxHeader: React.FC<{ tx: Transaction }> = ({ tx }) => (
  <header className="cf-header">
    <div className="cf-header__top">
      <h1 className="cf-header__id mono">{tx.id}</h1>
      <span className={`cf-header__status-badge cf-header__status-badge--${tx.review_status}`}>
        {STATUS_LABEL[tx.review_status]}
      </span>
    </div>

    <div className="cf-header__meta">
      <span className="cf-header__merchant">{tx.merchant_name}</span>
      {tx.merchant_category && (
        <span className="cf-header__category muted">{tx.merchant_category}</span>
      )}
      <span className="cf-header__amount mono">
        {fmtCurrency(tx.amount, tx.currency)}
      </span>
    </div>

    <div className="cf-header__identity">
      {tx.cardholder_name && (
        <span className="cf-header__identity-item">
          <span className="cf-header__identity-label muted">Cardholder</span>
          <span className="cf-header__identity-value">{tx.cardholder_name}</span>
        </span>
      )}
      {tx.card_last4 && (
        <span className="cf-header__identity-item">
          <span className="cf-header__identity-label muted">Card</span>
          <span className="cf-header__identity-value mono">••••&nbsp;{tx.card_last4}</span>
        </span>
      )}
      {tx.cardholder_country && (
        <span className="cf-header__identity-item">
          <span className="cf-header__identity-label muted">Country</span>
          <span className="cf-header__identity-value">{tx.cardholder_country}</span>
        </span>
      )}
      {tx.ip_address && (
        <span className="cf-header__identity-item">
          <span className="cf-header__identity-label muted">IP</span>
          <span className="cf-header__identity-value mono">{tx.ip_address}</span>
        </span>
      )}
      <span className="cf-header__identity-item">
        <span className="cf-header__identity-label muted">Time</span>
        <span className="cf-header__identity-value mono" title={tx.created_at}>
          {fmtDateTime(tx.created_at)}
        </span>
      </span>
      {tx.version !== undefined && (
        <span className="cf-header__identity-item">
          <span className="cf-header__identity-label muted">Version</span>
          <span className="cf-header__identity-value mono">v{tx.version}</span>
        </span>
      )}
    </div>
  </header>
);

// ── Root CaseFile component ────────────────────────────────────────
interface Props {
  reviewer: string;
}

export const CaseFile: React.FC<Props> = ({ reviewer }) => {
  const { id } = useParams<{ id: string }>();

  const { data: initial, loading, error, refresh } = useAsync(
    () => transactionsApi.get(id!),
    [id],
  );

  // Local state so review updates reflect immediately without re-fetch
  const [tx, setTx] = useState<Transaction | null>(null);
  useEffect(() => {
    if (initial) setTx(initial);
  }, [initial]);

  if (loading) return <LoadingPane label="Loading case file…" />;
  if (error) {
    return (
      <div className="cf-state-wrap">
        <ErrorState error={error} onRetry={refresh} title="Could not load case file" />
      </div>
    );
  }
  if (!tx) return null;

  return (
    <article className="casefile">
      {/* Back nav */}
      <nav aria-label="Breadcrumb">
        <Link to="/" className="cf-back">← Back to Desk</Link>
      </nav>

      {/* Two-column layout on wide screens */}
      <div className="cf-layout">
        {/* Left: identity + findings */}
        <div className="cf-layout__main">
          <TxHeader tx={tx} />
          <VerdictBlock tx={tx} />
          <DriverBar tx={tx} />
          <RuleFindings tx={tx} />
          <ScoreReceipt tx={tx} />
          <AuditTrail tx={tx} />
        </div>

        {/* Right: review panel (sticky) */}
        <aside className="cf-layout__aside">
          <ReviewPanel
            tx={tx}
            reviewer={reviewer}
            onUpdated={setTx}
          />
        </aside>
      </div>
    </article>
  );
};
