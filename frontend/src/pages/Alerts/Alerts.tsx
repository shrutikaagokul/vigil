/**
 * Alert Ledger — delivery records and notification logs from the fraud engine.
 *
 * Requirements:
 *  - Fetches via GET /alerts
 *  - Displays:
 *     • timestamp
 *     • transaction ID (with link to case file)
 *     • channel (SNS, SES, console, webhook, etc.)
 *     • alert status (sent, failed, pending, fallback, etc.)
 *     • error if present
 *  - Failed alerts are visually obvious (crimson indicator/badge) but not chaotic.
 *  - Fallback channel highlighted if primary failed.
 *  - Empty, loading, and error states.
 *  - Clean tabular ledger layout with hairline dividers (no cards).
 */

import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAsync } from '../../hooks/useAsync.ts';
import { alertsApi } from '../../api/alerts.ts';
import type { Alert } from '../../api/alerts.ts';
import { LoadingPane } from '../../components/LoadingSpinner/index.ts';
import { ErrorState } from '../../components/ErrorState/index.ts';
import { EmptyState } from '../../components/EmptyState/index.ts';
import './Alerts.css';

function formatTimestamp(iso: string): { formatted: string; relative: string } {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return { formatted: iso, relative: '' };

    const formatted = d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });

    const deltaSec = Math.floor((Date.now() - d.getTime()) / 1000);
    let relative = '';
    if (deltaSec < 60) relative = `${deltaSec}s ago`;
    else if (deltaSec < 3600) relative = `${Math.floor(deltaSec / 60)}m ago`;
    else if (deltaSec < 86400) relative = `${Math.floor(deltaSec / 3600)}h ago`;
    else relative = `${Math.floor(deltaSec / 86400)}d ago`;

    return { formatted, relative };
  } catch {
    return { formatted: iso, relative: '' };
  }
}

function isFailedAlert(alert: Alert): boolean {
  const st = (alert.status ?? alert.state ?? '').toLowerCase();
  return st === 'failed' || st === 'error' || Boolean(alert.error);
}

export const Alerts: React.FC = () => {
  const { data: alerts, loading, error, refresh } = useAsync(
    () => alertsApi.list(),
    [],
  );

  const [statusFilter, setStatusFilter] = useState<'' | 'all' | 'failed' | 'sent'>('all');

  if (loading) return <LoadingPane label="Loading alert ledger…" />;

  if (error) {
    return (
      <div className="alerts__state-wrap">
        <ErrorState
          error={error}
          onRetry={refresh}
          title="Could not load alert ledger"
        />
      </div>
    );
  }

  if (!alerts || alerts.length === 0) {
    return (
      <EmptyState
        title="Alert ledger empty"
        description="No notification deliveries or alert attempts have been recorded by the engine yet."
      />
    );
  }

  const failedCount = alerts.filter(isFailedAlert).length;
  const sentCount = alerts.filter(a => (a.status ?? '').toLowerCase() === 'sent').length;

  const filteredAlerts = alerts.filter(alert => {
    if (statusFilter === 'failed') return isFailedAlert(alert);
    if (statusFilter === 'sent') return (alert.status ?? '').toLowerCase() === 'sent';
    return true;
  });

  return (
    <section className="alerts" aria-label="Alert Ledger">
      {/* ── Editorial header ────────────────────────────────────────── */}
      <header className="alerts__header">
        <div className="alerts__header-text">
          <h1 className="alerts__headline display">Alert Ledger</h1>
          <p className="alerts__subline muted">
            {failedCount > 0 ? (
              <>
                <span className="alerts__count-failed">{failedCount} failed</span> delivery attempt{failedCount === 1 ? '' : 's'}, {sentCount} dispatched successfully.
              </>
            ) : (
              `${alerts.length} notification${alerts.length === 1 ? '' : 's'} recorded across dispatch channels.`
            )}
          </p>
        </div>

        <div className="alerts__header-actions">
          {/* Quick filter buttons */}
          <div className="alerts__filters" role="group" aria-label="Filter alerts">
            <button
              type="button"
              className={`alerts__filter-pill ${statusFilter === 'all' ? 'alerts__filter-pill--active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({alerts.length})
            </button>
            {failedCount > 0 && (
              <button
                type="button"
                className={`alerts__filter-pill alerts__filter-pill--failed ${statusFilter === 'failed' ? 'alerts__filter-pill--active' : ''}`}
                onClick={() => setStatusFilter('failed')}
              >
                Failed ({failedCount})
              </button>
            )}
            {sentCount > 0 && (
              <button
                type="button"
                className={`alerts__filter-pill ${statusFilter === 'sent' ? 'alerts__filter-pill--active' : ''}`}
                onClick={() => setStatusFilter('sent')}
              >
                Sent ({sentCount})
              </button>
            )}
          </div>

          <button
            type="button"
            className="alerts__refresh-btn"
            onClick={() => void refresh()}
            title="Refresh alert ledger"
          >
            ↻ Refresh
          </button>
        </div>
      </header>

      {/* ── Delivery ledger table ───────────────────────────────────── */}
      <div className="alerts__table-wrap" role="table" aria-label="Alert delivery records">
        <div className="alerts__table-head" role="row" aria-hidden="true">
          <span className="alerts__col-time">Timestamp</span>
          <span className="alerts__col-tx">Transaction</span>
          <span className="alerts__col-channel">Channel</span>
          <span className="alerts__col-status">Status</span>
          <span className="alerts__col-detail">Delivery Details / Error</span>
        </div>

        <div className="alerts__rows">
          {filteredAlerts.length === 0 ? (
            <div className="alerts__empty-filter muted">
              No alerts match the selected filter.
            </div>
          ) : (
            filteredAlerts.map(alert => {
              const failed = isFailedAlert(alert);
              const { formatted, relative } = formatTimestamp(alert.created_at || (alert as unknown as { timestamp?: string }).timestamp || '');
              const channel = alert.channel ?? (alert as unknown as { delivery_channel?: string }).delivery_channel ?? 'console';
              const status = alert.status ?? alert.state ?? (failed ? 'failed' : 'sent');
              const txId = alert.transaction_id ?? (alert as unknown as { tx_id?: string }).tx_id;
              const fallbackChannel = alert.fallback_channel;
              const errorMsg = alert.error ?? (failed && alert.body ? alert.body : null);
              const titleOrBody = alert.title ?? alert.body ?? null;

              return (
                <div
                  key={alert.id}
                  className={`alerts__row ${failed ? 'alerts__row--failed' : ''}`}
                  role="row"
                >
                  {/* Timestamp */}
                  <div className="alerts__col-time mono">
                    <span className="alerts__time-fmt">{formatted}</span>
                    {relative && (
                      <span className="alerts__time-rel muted">{relative}</span>
                    )}
                  </div>

                  {/* Transaction ID */}
                  <div className="alerts__col-tx mono">
                    {txId ? (
                      <Link
                        to={`/transactions/${txId}`}
                        className="alerts__tx-link"
                        title={`Open case file for transaction ${txId}`}
                      >
                        {txId} <span className="alerts__tx-arrow">→</span>
                      </Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  {/* Channel */}
                  <div className="alerts__col-channel mono">
                    <span className="alerts__channel-tag">
                      {channel}
                    </span>
                    {fallbackChannel && (
                      <span className="alerts__fallback-tag" title="Fallback channel used">
                        ↳ {fallbackChannel}
                      </span>
                    )}
                  </div>

                  {/* Delivery Status */}
                  <div className="alerts__col-status">
                    <span
                      className={`alerts__status-badge alerts__status-badge--${failed ? 'failed' : status.toLowerCase()}`}
                    >
                      {failed ? '● Failed' : status}
                    </span>
                  </div>

                  {/* Details / Error */}
                  <div className="alerts__col-detail">
                    {errorMsg && (
                      <div className="alerts__error-callout" role="alert">
                        <span className="alerts__error-prefix mono">ERR:</span>
                        <span className="alerts__error-text">{errorMsg}</span>
                      </div>
                    )}
                    {titleOrBody && !errorMsg && (
                      <span className="alerts__detail-text muted">
                        {titleOrBody}
                      </span>
                    )}
                    {!errorMsg && !titleOrBody && (
                      <span className="muted">—</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
};
