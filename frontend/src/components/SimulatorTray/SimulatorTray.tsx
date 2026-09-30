/**
 * SimulatorTray — fixed bottom tray for triggering test scenarios.
 *
 * Maps five buttons to:
 *   POST /simulate?scenario=normal
 *   POST /simulate?scenario=velocity_burst
 *   POST /simulate?scenario=huge_amount
 *   POST /simulate?scenario=impossible_travel
 *   POST /simulate?scenario=duplicate_claim
 *
 * After a successful run:
 *  - Shows a compact result strip with real backend data
 *  - Calls onSimulated() so Desk can immediately refresh
 *  - Provides a link to open the returned transaction if an ID is present
 *
 * The tray is compact by default.  No simulation logic lives here.
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { simulatorApi } from '../../api/simulator.ts';
import type { SimulatorScenario, SimulatorResult } from '../../api/simulator.ts';
import { LoadingSpinner } from '../LoadingSpinner/index.ts';
import './SimulatorTray.css';

interface ScenarioConfig {
  id: SimulatorScenario;
  label: string;
  title: string;
}

const SCENARIOS: ScenarioConfig[] = [
  {
    id: 'normal',
    label: 'Normal',
    title: 'POST /simulate?scenario=normal — low-risk baseline transaction',
  },
  {
    id: 'velocity_burst',
    label: 'Velocity Burst',
    title: 'POST /simulate?scenario=velocity_burst — many rapid transactions from one card',
  },
  {
    id: 'huge_amount',
    label: 'Huge Amount',
    title: 'POST /simulate?scenario=huge_amount — single very large transaction',
  },
  {
    id: 'impossible_travel',
    label: 'Impossible Travel',
    title: 'POST /simulate?scenario=impossible_travel — transaction from impossible location',
  },
  {
    id: 'duplicate_claim',
    label: 'Duplicate Claim',
    title: 'POST /simulate?scenario=duplicate_claim — repeated / duplicate insurance claim',
  },
];

interface FeedbackState {
  scenario: SimulatorScenario;
  result: SimulatorResult | null;
  error: Error | null;
}

interface Props {
  /** Called after a successful simulation so the Desk can refresh immediately */
  onSimulated?: () => void;
}

export const SimulatorTray: React.FC<Props> = ({ onSimulated }) => {
  const [running, setRunning]   = useState<SimulatorScenario | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);

  const run = async (scenario: SimulatorScenario) => {
    setRunning(scenario);
    setFeedback(null);
    try {
      const result = await simulatorApi.run(scenario);
      setFeedback({ scenario, result, error: null });
      // Trigger Desk refresh
      onSimulated?.();
    } catch (err) {
      setFeedback({
        scenario,
        result: null,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      setRunning(null);
    }
  };

  const txId = feedback?.result?.transaction?.id;

  return (
    <div className="sim-tray" role="complementary" aria-label="Transaction simulator">
      <div className="sim-tray__inner">

        <span className="sim-tray__label" aria-hidden="true">Simulate</span>

        <div className="sim-tray__scenarios">
          {SCENARIOS.map(s => (
            <button
              key={s.id}
              type="button"
              className={[
                'sim-tray__btn',
                running === s.id ? 'sim-tray__btn--running' : '',
              ].filter(Boolean).join(' ')}
              onClick={() => void run(s.id)}
              disabled={running !== null}
              title={s.title}
              aria-label={s.title}
            >
              {running === s.id && (
                <LoadingSpinner size="sm" label="Running…" />
              )}
              <span>{s.label}</span>
            </button>
          ))}
        </div>

        {/* ── Feedback strip ─────────────────────────────────────── */}
        {feedback && (
          <div
            className={[
              'sim-tray__feedback',
              feedback.error ? 'sim-tray__feedback--error' : 'sim-tray__feedback--ok',
            ].join(' ')}
            aria-live="polite"
          >
            {feedback.error ? (
              <span className="sim-tray__feedback-msg">
                ✗ {feedback.error.message}
              </span>
            ) : feedback.result ? (
              <>
                <span className="sim-tray__feedback-msg mono">
                  ✓ {feedback.scenario.replace('_', ' ')}
                  {feedback.result.transaction?.risk_score !== undefined
                    ? ` · score ${feedback.result.transaction.risk_score}`
                    : ''}
                  {feedback.result.elapsed_ms !== undefined
                    ? ` · ${feedback.result.elapsed_ms}ms`
                    : ''}
                  {feedback.result.message ? ` · ${feedback.result.message}` : ''}
                </span>
                {txId && (
                  <Link
                    to={`/transactions/${txId}`}
                    className="sim-tray__feedback-link mono"
                    title="Open case file"
                  >
                    Open →
                  </Link>
                )}
              </>
            ) : null}
          </div>
        )}

      </div>
    </div>
  );
};
