/**
 * Masthead — top navigation bar for Vigil.
 *
 * Contains:
 *  - Vigil wordmark
 *  - Primary nav: Desk / Rules / Alerts
 *  - Engine status indicator (live, rule count, last transaction time)
 *  - "Reviewing as" analyst identity input
 */

import React, { useId } from 'react';
import { NavLink } from 'react-router-dom';
import { useEngineStatus } from '../../hooks/useEngineStatus.ts';
import './Masthead.css';

interface Props {
  reviewer: string;
  onReviewerChange: (name: string) => void;
}

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const delta = Date.now() - new Date(iso).getTime();
  const s = Math.floor(delta / 1000);
  if (s < 60)  return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ago`;
}

export const Masthead: React.FC<Props> = ({ reviewer, onReviewerChange }) => {
  const { status, error } = useEngineStatus();
  const inputId = useId();

  const isLive    = status?.live ?? false;
  const rulesCount = status?.rules_loaded ?? null;
  const lastTx    = status?.last_transaction_at ?? null;

  const engineDotClass = [
    'status-dot',
    error ? 'status-dot--error' : isLive ? 'status-dot--live' : '',
  ].filter(Boolean).join(' ');

  return (
    <header className="masthead" role="banner">
      <div className="masthead__inner">

        {/* ── Wordmark ────────────────────────────────────────── */}
        <div className="masthead__wordmark" aria-label="Vigil">
          <span className="masthead__wordmark-text">Vigil</span>
        </div>

        {/* ── Primary navigation ──────────────────────────────── */}
        <nav className="masthead__nav" aria-label="Primary navigation">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`
            }
          >
            Desk
          </NavLink>
          <NavLink
            to="/rules"
            className={({ isActive }) =>
              `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`
            }
          >
            Rules
          </NavLink>
          <NavLink
            to="/alerts"
            className={({ isActive }) =>
              `masthead__nav-link${isActive ? ' masthead__nav-link--active' : ''}`
            }
          >
            Alerts
          </NavLink>
        </nav>

        {/* ── Engine status ───────────────────────────────────── */}
        <div className="masthead__engine" aria-label="Engine status">
          <span className={engineDotClass} aria-hidden="true" />
          <span className="masthead__engine-label">
            {error ? 'Engine unreachable' : isLive ? 'Engine live' : 'Connecting…'}
          </span>

          {rulesCount !== null && (
            <>
              <span className="masthead__engine-divider" aria-hidden="true">·</span>
              <span
                className="masthead__engine-stat mono"
                title="Loaded rules"
              >
                {rulesCount} rules
              </span>
            </>
          )}

          {lastTx !== null && (
            <>
              <span className="masthead__engine-divider" aria-hidden="true">·</span>
              <span
                className="masthead__engine-stat mono"
                title="Last transaction processed"
              >
                {formatRelativeTime(lastTx)}
              </span>
            </>
          )}
        </div>

        {/* ── Reviewing as ────────────────────────────────────── */}
        <div className="masthead__reviewer">
          <label htmlFor={inputId} className="masthead__reviewer-label">
            Reviewing as
          </label>
          <input
            id={inputId}
            type="text"
            className="masthead__reviewer-input mono"
            value={reviewer}
            onChange={e => onReviewerChange(e.target.value)}
            placeholder="analyst name"
            spellCheck={false}
            aria-label="Reviewer name"
          />
        </div>

      </div>
    </header>
  );
};
