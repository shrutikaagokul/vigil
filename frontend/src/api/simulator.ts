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
  | 'duplicate_claim'
  | 'multi_trigger';

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
    // If it returns a shaped object with a results array, find the notable transaction.
    const result = (raw ?? {}) as Record<string, unknown>;
    const items = (result?.results ?? []) as Array<Record<string, unknown>>;
    let notableTx: Transaction | undefined;

    if (items.length > 0) {
      const target = items.find(i => i.risk_tier === 'CRITICAL' || i.risk_tier === 'HIGH') ?? items[items.length - 1];
      notableTx = {
        id: String(target.txn_id ?? target.id ?? ''),
        risk_score: typeof target.risk_score === 'number' ? target.risk_score : 0,
        risk_level: ((target.risk_tier ?? target.risk_level ?? 'low') as string).toLowerCase() as 'low' | 'medium' | 'high' | 'critical',
        review_status: 'pending',
        amount: 0,
        currency: 'USD',
        merchant_name: 'Simulated Transaction',
        merchant_category: scenario,
        cardholder_name: 'Member',
        cardholder_country: 'US',
        card_last4: '4242',
        created_at: new Date().toISOString(),
        triggered_rules: [],
      };
    } else if (result?.transaction || result?.id || result?.txn_id) {
      notableTx = (result.transaction ?? result) as unknown as Transaction;
    }

    return {
      transaction: notableTx,
      scenario:    (result?.scenario ?? scenario) as SimulatorScenario,
      elapsed_ms:  result?.elapsed_ms as number | undefined,
      message:     result?.transactions_created ? `${result.transactions_created} transaction(s) evaluated` : (result?.message as string | undefined),
      raw,
    };
  },
};
