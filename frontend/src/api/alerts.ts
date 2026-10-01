/**
 * Alerts API
 *
 * Types and fetch helpers for the /api/alerts endpoint.
 *
 * Documented assumptions:
 *  - GET  /api/alerts/       → Alert[] (or PaginatedResponse<Alert>)
 *  - GET  /api/alerts/:id/   → single Alert
 *  - PATCH /api/alerts/:id/  → acknowledge / dismiss
 *
 * The Alert shape is modelled on a notification-delivery ledger.
 * Fields that are not returned by the backend will be undefined —
 * the UI renders only what the backend provides.
 */

import client, { ApiError } from './client.ts';

// ── Enums (assumed; adjust to match actual backend values) ─────────
export type AlertSeverity = 'info' | 'warning' | 'critical';
export type AlertStatus   = 'sent' | 'failed' | 'pending' | 'fallback' | string;
export type AlertChannel  = 'SNS' | 'SES' | 'console' | 'webhook' | string;
export type AlertState    = 'open' | 'acknowledged' | 'dismissed' | string;

export interface Alert {
  id:               string;
  /** Alert type / title */
  title?:           string;
  /** Human-readable description */
  body?:            string;
  /** Severity tier — may be absent for delivery-ledger entries */
  severity?:        AlertSeverity;
  /** Delivery state from backend (open / acknowledged / dismissed) */
  state?:           AlertState;

  // ── Delivery ledger fields ──────────────────────────────────────
  /** Channel used for delivery: SNS, SES, console, webhook, etc. */
  channel?:         AlertChannel;
  /** Delivery status: sent, failed, pending, fallback */
  status?:          AlertStatus;
  /** Error detail if delivery failed */
  error?:           string;
  /** Fallback channel used if primary channel failed */
  fallback_channel?: AlertChannel;

  // ── Relations ───────────────────────────────────────────────────
  transaction_id?:  string;
  rule_id?:         string;

  // ── Timestamps ──────────────────────────────────────────────────
  created_at:       string;   // ISO 8601
  sent_at?:         string;
  acknowledged_by?: string;
  acknowledged_at?: string;
}

export interface AlertAckPayload {
  state:             AlertState;
  acknowledged_by?:  string;
}

// ── API helpers ────────────────────────────────────────────────────
export const alertsApi = {
  list: async (): Promise<Alert[]> => {
    let res: unknown;
    try {
      res = await client.get<unknown>('/api/alerts');
    } catch {
      try {
        res = await client.get<unknown>('/api/alerts/');
      } catch {
        res = await client.get<unknown>('/alerts');
      }
    }

    let list: Array<Record<string, unknown>> = [];
    if (Array.isArray(res)) {
      list = res as Array<Record<string, unknown>>;
    } else if (res && typeof res === 'object') {
      const obj = res as { results?: Array<Record<string, unknown>>; alerts?: Array<Record<string, unknown>> };
      list = obj.results ?? obj.alerts ?? [];
    }

    return list.map(item => ({
      id: String(item.id ?? ''),
      title: (item.title as string) || `Alert for ${item.txn_id || item.transaction_id || 'transaction'}`,
      body: (item.body as string) || (item.error as string) || undefined,
      severity: (item.severity as AlertSeverity) || (item.status === 'FAILED' ? 'critical' : 'info'),
      state: (item.state as AlertState) || 'open',
      channel: (item.channel as AlertChannel) || 'console',
      status: ((item.status as string) || 'sent').toLowerCase(),
      error: (item.error as string) || undefined,
      fallback_channel: (item.fallback_channel as AlertChannel) || undefined,
      transaction_id: (item.transaction_id ?? item.txn_id) as string | undefined,
      rule_id: item.rule_id as string | undefined,
      created_at: (item.created_at ?? item.timestamp ?? new Date().toISOString()) as string,
    }));
  },

  get: async (id: string): Promise<Alert> => {
    try {
      return await client.get<Alert>(`/api/alerts/${id}/`);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
        return await client.get<Alert>(`/alerts/${id}`);
      }
      throw err;
    }
  },

  acknowledge: (id: string, payload: AlertAckPayload) =>
    client.patch<Alert>(`/api/alerts/${id}/`, payload),
};
