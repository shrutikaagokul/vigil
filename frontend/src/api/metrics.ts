/**
 * Dashboard Metrics API
 *
 * Fetches high-level metrics calculated by the backend:
 *   GET /api/dashboard/metrics
 *
 * Returns:
 *   - total_transactions
 *   - flagged
 *   - reviewed
 *   - cleared
 *   - clean
 *   - by_tier (e.g. { LOW: 5, MEDIUM: 2, HIGH: 20, CRITICAL: 13 })
 *   - by_rule (e.g. { duplicate_claim: 34, velocity: 8, ... })
 *   - avg_risk_score
 *   - alert_count
 */

import client from './client.ts';

export interface DashboardMetrics {
  total_transactions: number;
  flagged: number;
  reviewed: number;
  cleared: number;
  clean: number;
  by_tier: Record<string, number>;
  by_rule: Record<string, number>;
  avg_risk_score: number;
  alert_count: number;
}

export const metricsApi = {
  get: async (): Promise<DashboardMetrics> => {
    try {
      return await client.get<DashboardMetrics>('/api/dashboard/metrics');
    } catch {
      return await client.get<DashboardMetrics>('/dashboard/metrics');
    }
  },
};
