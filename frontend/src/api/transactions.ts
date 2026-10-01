/**
 * Transaction API
 *
 * Types and fetch helpers for the /api/transactions endpoint.
 *
 * Field names are documented assumptions — confirmed/adjusted once backend is live.
 *
 * Documented endpoints:
 *  - GET  /api/transactions/           → PaginatedResponse<Transaction>
 *  - GET  /api/transactions/:id/       → Transaction (with optional rule_results)
 *  - PATCH /api/transactions/:id/review → ReviewPayload → Transaction
 */

import client from './client.ts';

// ── Shared enums ───────────────────────────────────────────────────
export type RiskLevel    = 'low' | 'medium' | 'high' | 'critical';
export type ReviewStatus = 'pending' | 'approved' | 'declined' | 'escalated';

// ── Rule result (per-rule evaluation output) ───────────────────────
/**
 * A single rule's evaluation result as returned by the backend.
 * All fields are optional — the renderer must handle absent fields gracefully.
 *
 * Assumption: the backend may return rule_results as an array on the
 * single-transaction endpoint but not on the list endpoint.
 */
export interface RuleResult {
  rule_id:     string;
  rule_name:   string;
  version?:    string;
  applicable:  boolean;       // false → rule did not fire; still shown as muted
  score?:      number;        // contribution to final score (0-100 scale)
  weight?:     number;        // relative weight if backend exposes it
  reason?:     string;        // plain-language reason string
  error?:      string;        // if the rule errored during evaluation
  /** Freeform evidence bag — keys and values are rule-specific */
  evidence?:   Record<string, unknown>;
}

// ── Audit event (review history entry) ────────────────────────────
export interface AuditEvent {
  id?:         string;
  event_type:  string;        // e.g. "review", "flag", "alert"
  actor?:      string;
  note?:       string;
  to_status?:  ReviewStatus;
  created_at:  string;        // ISO 8601
}

// ── Transaction shape ──────────────────────────────────────────────
export interface Transaction {
  id:                 string;
  version?:           number;     // optimistic-concurrency version for PATCH /review
  created_at:         string;     // ISO 8601
  amount:             number;     // in minor units (pence / cents)
  currency:           string;     // ISO 4217
  merchant_name:      string;
  merchant_category:  string;
  card_last4:         string;
  cardholder_name:    string;
  cardholder_country: string;
  ip_address?:        string;
  device_fingerprint?: string;

  // ── Risk scoring ────────────────────────────────────────────────
  risk_score:         number;     // 0–100, backend is source of truth
  risk_level:         RiskLevel;
  triggered_rules:    string[];   // rule IDs (present on list + detail)
  rule_results?:      RuleResult[]; // full rule outputs (detail endpoint only)

  // ── Aggregation metadata (if backend exposes it) ────────────────
  score_formula?:     string;     // e.g. "noisy_or" — display-only, never recalculate
  score_components?:  Record<string, number>; // rule_id → contribution

  // ── Review state ────────────────────────────────────────────────
  review_status:      ReviewStatus;
  reviewed_by?:       string;
  reviewed_at?:       string;
  notes?:             string;

  // ── Audit trail (if backend includes it) ────────────────────────
  audit_events?:      AuditEvent[];

  // ── Evidence fields (populated by rules engine) ─────────────────
  velocity_count?:       number;
  velocity_window_s?:    number;    // time window in seconds
  travel_distance_km?:   number;
  travel_time_minutes?:  number;
  travel_origin?:        string;
  travel_destination?:   string;
  implied_speed_kmh?:    number;
  is_duplicate_claim?:   boolean;
  amount_median?:        number;    // historical median for cardholder/merchant
  amount_mad?:           number;    // median absolute deviation
  amount_zscore?:        number;    // z-score of this amount
}

// ── Pagination wrapper ─────────────────────────────────────────────
export interface PaginatedResponse<T> {
  results:  T[];
  count:    number;
  next:     string | null;
  previous: string | null;
}

// ── Query params ───────────────────────────────────────────────────
export interface TransactionQuery {
  page?:          number;
  page_size?:     number;
  risk_level?:    RiskLevel;
  review_status?: ReviewStatus;
  search?:        string;
  ordering?:      string;
  member_id?:     string;
  provider_id?:   string;
  status?:        string;
  tier?:          string;
  limit?:         number;
  offset?:        number;
}

// ── Review payload ─────────────────────────────────────────────────
/**
 * PATCH /api/transactions/:id/review
 *
 * Uses expected_version for optimistic concurrency.
 * A 409 from the server means someone else updated first.
 */
export interface ReviewPayload {
  to_status:        ReviewStatus;
  reviewer:         string;
  note?:            string;
  expected_version?: number;
}

// ── API functions ──────────────────────────────────────────────────
export function buildTransactionQuery(params: TransactionQuery): string {
  const p = new URLSearchParams();
  if (params.page)          p.set('page',          String(params.page));
  if (params.page_size)     p.set('page_size',     String(params.page_size));
  if (params.risk_level)    p.set('risk_level',    params.risk_level);
  if (params.review_status) p.set('review_status', params.review_status);
  if (params.search)        p.set('search',        params.search);
  if (params.ordering)      p.set('ordering',      params.ordering);
  if (params.member_id)     p.set('member_id',     params.member_id);
  if (params.provider_id)   p.set('provider_id',   params.provider_id);
  if (params.status)        p.set('status',        params.status);
  if (params.tier)          p.set('tier',          params.tier);
  if (params.limit)         p.set('limit',         String(params.limit));
  if (params.offset)        p.set('offset',        String(params.offset));
  return p.toString() ? `?${p}` : '';
}

export function normalizeTransaction(raw: Record<string, unknown>): Transaction {
  if (!raw) return raw as unknown as Transaction;

  const id = (raw.id ?? raw.txn_id ?? '') as string;
  const rawTier = (raw.risk_tier ?? raw.risk_level ?? 'low') as string;
  const riskTier = rawTier.toLowerCase() as RiskLevel;

  // Map backend status ('FLAGGED', 'CLEAN', 'REVIEWED', 'CLEARED') to ReviewStatus
  let reviewStatus: ReviewStatus = 'pending';
  const st = (raw.status ?? raw.review_status ?? '').toString().toUpperCase();
  if (st === 'FLAGGED' || st === 'PENDING') {
    reviewStatus = 'pending';
  } else if (st === 'REVIEWED' || st === 'DECLINED') {
    reviewStatus = 'declined';
  } else if (st === 'CLEARED' || st === 'APPROVED' || st === 'CLEAN') {
    reviewStatus = 'approved';
  } else if (st === 'ESCALATED') {
    reviewStatus = 'escalated';
  }

  const rawRuleResults = (raw.rule_results ?? []) as Array<Record<string, unknown>>;
  const ruleResults: RuleResult[] = rawRuleResults.map(rr => {
    const scoreVal = typeof rr.score === 'number' ? rr.score : 0;
    // Score can be 0.0-1.0 or 0-100
    const normalizedScore = scoreVal <= 1.0 && scoreVal > 0 ? Math.round(scoreVal * 100) : Math.round(scoreVal);
    const ruleName = (rr.rule_name ?? rr.rule_id ?? 'rule') as string;

    return {
      rule_id: ruleName,
      rule_name: ruleName.replace(/_/g, ' '),
      version: (rr.rule_version ?? rr.version ?? '1.0') as string,
      applicable: rr.applicable !== false,
      score: normalizedScore,
      weight: typeof rr.weight === 'number' ? rr.weight : 1.0,
      reason: (rr.reason as string) || (rr.triggered ? 'Rule condition triggered' : 'Normal range'),
      error: (rr.error as string) || undefined,
      evidence: (rr.evidence as Record<string, unknown>) || {},
    };
  });

  const rawTriggered = raw.triggered_rules as string[] | undefined;
  const triggeredRules: string[] = rawTriggered ?? (
    rawRuleResults.length > 0
      ? rawRuleResults.filter(r => Boolean(r.triggered) || (typeof r.score === 'number' && r.score > 0)).map(r => String(r.rule_name ?? r.rule_id))
      : []
  );

  // Amount handling: backend sends float dollars (e.g. 85000.0 or 250.0).
  // Convert to minor units (cents) so UI formatting components display exact amounts.
  const rawAmount = typeof raw.amount === 'number' ? raw.amount : 0;
  const minorUnits = Math.round(rawAmount * 100);

  const rawAudit = raw.audit_events as AuditEvent[] | undefined;

  return {
    id,
    version: typeof raw.version === 'number' ? raw.version : 1,
    created_at: (raw.created_at ?? raw.event_ts ?? new Date().toISOString()) as string,
    amount: minorUnits,
    currency: (raw.currency ?? 'USD') as string,
    merchant_name: (raw.merchant_name ?? raw.provider_id ?? raw.category ?? 'Healthcare Provider') as string,
    merchant_category: (raw.merchant_category ?? raw.category ?? raw.event_type ?? 'Medical Claim') as string,
    card_last4: (raw.card_last4 ?? (id.includes('-') ? id.split('-').pop()! : '4242')) as string,
    cardholder_name: (raw.cardholder_name ?? raw.member_id ?? 'Member') as string,
    cardholder_country: (raw.cardholder_country ?? 'US') as string,
    risk_score: typeof raw.risk_score === 'number' ? raw.risk_score : 0,
    risk_level: riskTier,
    triggered_rules: triggeredRules,
    rule_results: ruleResults,
    review_status: reviewStatus,
    reviewed_by: (raw.reviewed_by as string) || undefined,
    reviewed_at: (raw.reviewed_at as string) || undefined,
    notes: (raw.notes as string) || (raw.note as string) || undefined,
    audit_events: rawAudit,
  };
}

export const transactionsApi = {
  list: async (query: TransactionQuery = {}): Promise<PaginatedResponse<Transaction>> => {
    let res: unknown;
    try {
      res = await client.get<unknown>(`/api/transactions${buildTransactionQuery(query)}`);
    } catch {
      res = await client.get<unknown>(`/transactions${buildTransactionQuery(query)}`);
    }

    let rawList: Array<Record<string, unknown>> = [];
    let count = 0;

    if (Array.isArray(res)) {
      rawList = res as Array<Record<string, unknown>>;
      count = rawList.length;
    } else if (res && typeof res === 'object') {
      const obj = res as { results?: Array<Record<string, unknown>>; count?: number };
      if (Array.isArray(obj.results)) {
        rawList = obj.results;
        count = obj.count ?? rawList.length;
      }
    }

    const normalized = rawList.map(item => normalizeTransaction(item));
    return {
      results: normalized,
      count,
      next: null,
      previous: null,
    };
  },

  get: async (id: string): Promise<Transaction> => {
    let raw: Record<string, unknown>;
    try {
      raw = await client.get<Record<string, unknown>>(`/api/transactions/${id}`);
    } catch {
      raw = await client.get<Record<string, unknown>>(`/transactions/${id}`);
    }

    // Attempt to also load review history for rich audit timeline
    try {
      const reviews = await client.get<Array<{
        id: number | string;
        reviewer: string;
        from_status: string;
        to_status: string;
        note: string;
        timestamp: string;
      }>>(`/api/transactions/${id}/reviews`);

      if (Array.isArray(reviews) && reviews.length > 0) {
        raw.audit_events = reviews.map(r => ({
          id: String(r.id),
          event_type: 'review',
          actor: r.reviewer,
          note: r.note,
          to_status: r.to_status === 'REVIEWED' ? 'declined' : 'approved',
          created_at: r.timestamp,
        }));
      }
    } catch {
      // Optional audit trail enrichment
    }

    return normalizeTransaction(raw);
  },

  /**
   * PATCH /api/transactions/:id/review
   * Returns the updated Transaction.
   * Throws ApiError(409) on version conflict.
   */
  review: async (id: string, payload: ReviewPayload): Promise<Transaction> => {
    // Backend expects uppercase status: REVIEWED or CLEARED
    const backendStatus = payload.to_status === 'approved' ? 'CLEARED' : 'REVIEWED';

    const body = {
      to_status: backendStatus,
      reviewer: payload.reviewer,
      note: payload.note || 'Reviewed in Vigil console',
      expected_version: payload.expected_version ?? 1,
    };

    try {
      await client.patch<unknown>(`/api/transactions/${id}/review`, body);
    } catch (err) {
      if (err instanceof Error && err.message.includes('404')) {
        await client.patch<unknown>(`/transactions/${id}/review`, body);
      } else {
        throw err;
      }
    }

    // Return the fresh transaction
    return transactionsApi.get(id);
  },
};
