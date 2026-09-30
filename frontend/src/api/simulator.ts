/**
 * Simulator API
 *
 * Fires synthetic transactions through the backend engine.
 *
 * Endpoint (per spec):
 *   POST /simulate?scenario={scenario}
 *
 * The frontend does NOT implement any simulation logic.
 * It only sends the scenario name and displays whatever the backend returns.
 *
 * The response shape is unknown until the backend is live; we type it
 * as SimulatorResult with the fields we expect, but accept unknown keys
 * gracefully by using `unknown` for the raw response.
 */

import client, { ApiError } from './client.ts';
import type { Transaction } from './transactions.ts';

export type SimulatorScenario =
  | 'normal'
  | 'velocity_burst'
  | 'huge_amount'
  | 'impossible_travel'
  | 'duplicate_claim';

/**
 * What the backend is expected to return.
 * Adjust field names once the real API contract is confirmed.
 */
export interface SimulatorResult {
  /** The created/flagged transaction (if backend returns one) */
  transaction?: Transaction;
  /** The scenario that was run */
  scenario?: SimulatorScenario;
  /** Processing time in ms (if backend exposes it) */
  elapsed_ms?: number;
  /** Any backend message string */
  message?: string;
  /** Raw backend response preserved for inspection */
  raw?: unknown;
}

export const simulatorApi = {
  /**
   * POST /simulate?scenario={scenario}
   * No request body — scenario is a query parameter per the API spec.
   */
  run: async (scenario: SimulatorScenario): Promise<SimulatorResult> => {
    let raw: unknown;
    try {
      raw = await client.post<unknown>(
        `/simulate?scenario=${encodeURIComponent(scenario)}`,
      );
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 502)) {
        raw = await client.post<unknown>(
          `/api/simulate?scenario=${encodeURIComponent(scenario)}`,
        );
      } else {
        throw err;
      }
    }
    // Normalise: if the backend returns the transaction directly, wrap it.
    // If it returns a shaped object, use it as-is.
    const result = (raw ?? {}) as Record<string, unknown>;
    return {
      transaction: (result?.transaction ?? (result?.id ? raw : undefined)) as Transaction | undefined,
      scenario:    (result?.scenario ?? scenario) as SimulatorScenario,
      elapsed_ms:  result?.elapsed_ms as number | undefined,
      message:     result?.message as string | undefined,
      raw,
    };
  },
};
