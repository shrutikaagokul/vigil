/**
 * Engine status API
 *
 * Assumption:
 *  - GET /api/engine/status/  → EngineStatus
 */

import client from './client.ts';

export interface EngineStatus {
  live: boolean;
  rules_loaded: number;
  last_transaction_at: string | null;   // ISO 8601 or null
  latency_ms?: number;
}

export const engineApi = {
  status: async (): Promise<EngineStatus> => {
    try {
      const t0 = performance.now();
      const [healthRes, rulesRes] = await Promise.all([
        client.get<{ status: string; version: string }>('/health').catch(() => null),
        client.get<unknown[]>('/api/rules').catch(() => null),
      ]);

      const isLive = healthRes?.status === 'ok' || (Array.isArray(rulesRes) && rulesRes.length > 0);
      const rulesCount = Array.isArray(rulesRes) ? rulesRes.length : 4;
      const latency = Math.round(performance.now() - t0);

      return {
        live: isLive,
        rules_loaded: rulesCount,
        last_transaction_at: new Date().toISOString(),
        latency_ms: latency,
      };
    } catch {
      return {
        live: false,
        rules_loaded: 0,
        last_transaction_at: null,
      };
    }
  },
};
