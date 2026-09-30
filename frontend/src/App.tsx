/**
 * App — root application component.
 *
 * Sets up:
 *  - React Router routes
 *  - Persistent reviewer identity (localStorage; no auth)
 *  - Fixed Masthead + SimulatorTray shell
 *  - Page content area
 *
 * The `deskRefreshKey` is incremented when the SimulatorTray signals
 * a successful simulation so the Desk immediately re-polls.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Routes, Route } from 'react-router-dom';

import { Masthead } from './components/Masthead/index.ts';
import { SimulatorTray } from './components/SimulatorTray/index.ts';

import { Desk } from './pages/Desk/index.ts';
import { CaseFile } from './pages/CaseFile/index.ts';
import { Rules } from './pages/Rules/index.ts';
import { Alerts } from './pages/Alerts/index.ts';

import './style.css';

// ── Reviewer identity persisted in localStorage ────────────────────
const REVIEWER_KEY = 'vigil:reviewer';
const storedReviewer = localStorage.getItem(REVIEWER_KEY) ?? '';

export const App: React.FC = () => {
  const [reviewer, setReviewer] = useState<string>(storedReviewer);

  // External refresh handle: Desk registers its refresh fn here,
  // SimulatorTray calls triggerDeskRefresh() after a successful sim.
  const deskRefreshRef = useRef<(() => void) | null>(null);

  const triggerDeskRefresh = useCallback(() => {
    deskRefreshRef.current?.();
  }, []);

  function handleReviewerChange(name: string) {
    setReviewer(name);
    localStorage.setItem(REVIEWER_KEY, name);
  }

  return (
    <>
      {/* ── Fixed top bar ─────────────────────────────────────── */}
      <Masthead reviewer={reviewer} onReviewerChange={handleReviewerChange} />

      {/* ── Scrollable page content ───────────────────────────── */}
      <main className="app-body">
        <div className="page-content">
          <Routes>
            <Route
              path="/"
              element={
                <Desk
                  reviewer={reviewer}
                  registerRefresh={(fn) => { deskRefreshRef.current = fn; }}
                />
              }
            />
            <Route
              path="/transactions/:id"
              element={<CaseFile reviewer={reviewer} />}
            />
            <Route path="/rules"   element={<Rules />} />
            <Route path="/alerts"  element={<Alerts />} />
            <Route path="*"        element={<NotFound />} />
          </Routes>
        </div>
      </main>

      {/* ── Fixed bottom simulator tray ───────────────────────── */}
      <SimulatorTray onSimulated={triggerDeskRefresh} />
    </>
  );
};

const NotFound: React.FC = () => (
  <div style={{ padding: 'var(--space-12) 0' }}>
    <h1
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 'var(--text-3xl)',
        marginBottom: 'var(--space-4)',
      }}
    >
      404
    </h1>
    <p style={{ color: 'var(--color-muted)', fontSize: 'var(--text-base)' }}>
      Page not found.
    </p>
  </div>
);
