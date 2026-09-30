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
    try {
      const res = await client.get<Alert[] | { results?: Alert[]; alerts?: Alert[] }>('/api/alerts/');
      if (Array.isArray(res)) return res;
      if (res && Array.isArray((res as { results?: Alert[] }).results)) return (res as { results: Alert[] }).results;
      if (res && Array.isArray((res as { alerts?: Alert[] }).alerts)) return (res as { alerts: Alert[] }).alerts;
      return [];
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
        const res = await client.get<Alert[] | { results?: Alert[]; alerts?: Alert[] }>('/alerts');
        if (Array.isArray(res)) return res;
        if (res && Array.isArray((res as { results?: Alert[] }).results)) return (res as { results: Alert[] }).results;
        if (res && Array.isArray((res as { alerts?: Alert[] }).alerts)) return (res as { alerts: Alert[] }).alerts;
        return [];
      }
      throw err;
    }
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
