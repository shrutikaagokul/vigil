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
  return p.toString() ? `?${p}` : '';
}

export const transactionsApi = {
  list: (query: TransactionQuery = {}) =>
    client.get<PaginatedResponse<Transaction>>(
      `/api/transactions/${buildTransactionQuery(query)}`,
    ),

  get: (id: string) =>
    client.get<Transaction>(`/api/transactions/${id}/`),

  /**
   * PATCH /api/transactions/:id/review
   * Returns the updated Transaction.
   * Throws ApiError(409) on version conflict.
   */
  review: (id: string, payload: ReviewPayload) =>
    client.patch<Transaction>(`/api/transactions/${id}/review`, payload),
};
