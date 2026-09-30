/**
 * Rules API
 *
 * Types and fetch helpers for the /api/rules endpoint.
 *
 * The Rule shape is intentionally loose — new backend rules with additional
 * metadata will be picked up automatically by the frontend without code changes.
 * Unknown fields are preserved in the `meta` bag.
 *
 * Documented endpoints:
 *  - GET    /api/rules/        → Rule[]
 *  - GET    /api/rules/:id/    → Rule
 *  - POST   /api/rules/        → create Rule
 *  - PATCH  /api/rules/:id/    → update Rule
 *  - DELETE /api/rules/:id/    → delete Rule
 */

import client, { ApiError } from './client.ts';

// ── Enums (assumed; adjust to match actual backend values) ─────────
export type RuleStatus = 'active' | 'inactive' | 'draft' | string;
export type RuleAction = 'flag' | 'block' | 'review' | 'alert' | string;

export interface Rule {
  id:                   string;
  name:                 string;
  version?:             string;
  description?:         string;

  /** Whether the rule is currently active / evaluated */
  enabled?:             boolean;
  /** Alternative status field if backend uses it instead of enabled */
  status?:              RuleStatus;

  /** Action taken when rule fires */
  action?:              RuleAction;

  /** The entity key this rule applies to (e.g. "card", "user", "merchant") */
  entity_key?:          string;

  /** Threshold / configuration values exposed by backend */
  threshold?:           number;
  window_seconds?:      number;

  /** DSL / JSON condition expression (opaque string — display only) */
  condition_expression?: string;

  /** Risk level this rule maps to */
  risk_level?:          'low' | 'medium' | 'high' | 'critical' | string;

  /** Trigger statistics */
  triggered_count?:     number;
  last_triggered_at?:   string;

  created_at?:          string;
  updated_at?:          string;
  created_by?:          string;

  /**
   * Catch-all for any additional fields the backend returns.
   * This ensures a new rule type doesn't cause a render failure.
   */
  [key: string]: unknown;
}

export interface RulePayload {
  name:                  string;
  description?:          string;
  enabled?:              boolean;
  status?:               RuleStatus;
  action?:               RuleAction;
  condition_expression?: string;
  risk_level?:           Rule['risk_level'];
}

export const rulesApi = {
  list: async (): Promise<Rule[]> => {
    try {
      const res = await client.get<Rule[] | { results?: Rule[]; rules?: Rule[] }>('/api/rules/');
      if (Array.isArray(res)) return res;
      if (res && Array.isArray((res as { results?: Rule[] }).results)) return (res as { results: Rule[] }).results;
      if (res && Array.isArray((res as { rules?: Rule[] }).rules)) return (res as { rules: Rule[] }).rules;
      return [];
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
        const res = await client.get<Rule[] | { results?: Rule[]; rules?: Rule[] }>('/rules');
        if (Array.isArray(res)) return res;
        if (res && Array.isArray((res as { results?: Rule[] }).results)) return (res as { results: Rule[] }).results;
        if (res && Array.isArray((res as { rules?: Rule[] }).rules)) return (res as { rules: Rule[] }).rules;
        return [];
      }
      throw err;
    }
  },

  get: async (id: string): Promise<Rule> => {
    try {
      return await client.get<Rule>(`/api/rules/${id}/`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
        return await client.get<Rule>(`/rules/${id}`);
      }
      throw err;
    }
  },

  create: (payload: RulePayload) =>
    client.post<Rule>('/api/rules/', payload),

  update: (id: string, payload: Partial<RulePayload>) =>
    client.patch<Rule>(`/api/rules/${id}/`, payload),

  delete: (id: string) =>
    client.delete<void>(`/api/rules/${id}/`),
};
