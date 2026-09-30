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
  status: () =>
    client.get<EngineStatus>('/api/engine/status/'),
};
