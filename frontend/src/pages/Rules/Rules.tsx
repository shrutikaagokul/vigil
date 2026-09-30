/**
 * Rule Library — dynamic catalogue of all fraud detection rules in the engine.
 *
 * Requirements:
 *  - Discovered via GET /rules (rendered dynamically from backend response)
 *  - DO NOT hardcode rule names (Velocity, Unusual Amount, Impossible Travel, etc.)
 *  - Displays when provided: name, version, enabled/available state, entity key,
 *    and relevant configuration/metadata.
 *  - Demonstrates that any new rule added to the engine appears automatically
 *    without frontend modifications.
 *  - Editorial table layout with hairline dividers (no wall of cards, no zebra striping).
 */

import React, { useState } from 'react';
import { useAsync } from '../../hooks/useAsync.ts';
import { rulesApi } from '../../api/rules.ts';
import type { Rule } from '../../api/rules.ts';
import { LoadingPane } from '../../components/LoadingSpinner/index.ts';
import { ErrorState } from '../../components/ErrorState/index.ts';
import { EmptyState } from '../../components/EmptyState/index.ts';
import './Rules.css';

/** Standard top-level keys to filter out when rendering generic configuration tags */
const EXCLUDED_CONFIG_KEYS = new Set([
  'id',
  'name',
  'title',
  'description',
  'version',
  'enabled',
  'status',
  'available',
  'action',
  'entity_key',
  'entity',
  'created_at',
  'updated_at',
  'created_by',
  'triggered_count',
  'last_triggered_at',
  'condition_expression',
]);

interface ConfigItem {
  label: string;
  value: string;
}

/** Extracts any exposed configuration or metadata fields into key-value pairs */
function extractConfigItems(rule: Rule): ConfigItem[] {
  const items: ConfigItem[] = [];

  // Dedicated config or parameters sub-objects if returned by backend
  const subConfig = (rule.parameters ?? rule.config ?? rule.metadata) as
    | Record<string, unknown>
    | undefined;

  if (subConfig && typeof subConfig === 'object') {
    for (const [k, v] of Object.entries(subConfig)) {
      if (v !== undefined && v !== null && typeof v !== 'object') {
        items.push({ label: k.replace(/_/g, ' '), value: String(v) });
      }
    }
  }

  // Top-level configuration fields
  if (rule.threshold !== undefined) {
    items.push({ label: 'threshold', value: String(rule.threshold) });
  }
  if (rule.window_seconds !== undefined) {
    items.push({ label: 'window', value: `${rule.window_seconds}s` });
  }

  // Any remaining primitive keys on the rule object
  for (const [k, v] of Object.entries(rule)) {
    if (!EXCLUDED_CONFIG_KEYS.has(k) && k !== 'config' && k !== 'parameters' && k !== 'metadata') {
      if (v !== undefined && v !== null && typeof v !== 'object') {
        items.push({ label: k.replace(/_/g, ' '), value: String(v) });
      }
    }
  }

  return items;
}

export const Rules: React.FC = () => {
  const { data: rules, loading, error, refresh } = useAsync(
    () => rulesApi.list(),
    [],
  );

  const [expandedId, setExpandedId] = useState<string | null>(null);

  const toggleExpand = (id: string) => {
    setExpandedId(prev => (prev === id ? null : id));
  };

  if (loading) return <LoadingPane label="Loading rule library…" />;

  if (error) {
    return (
      <div className="rules__state-wrap">
        <ErrorState
          error={error}
          onRetry={refresh}
          title="Could not load rules"
        />
      </div>
    );
  }

  if (!rules || rules.length === 0) {
    return (
      <EmptyState
        title="No rules discovered"
        description="The backend engine returned an empty rule set. Any rules registered in GET /rules will automatically appear here."
      />
    );
  }

  const enabledCount = rules.filter(r =>
    r.enabled !== false && r.status !== 'inactive' && r.status !== 'disabled',
  ).length;

  return (
    <section className="rules" aria-label="Rule Library">
      {/* ── Editorial header ────────────────────────────────────────── */}
      <header className="rules__header">
        <div className="rules__header-text">
          <h1 className="rules__headline display">Rule Library</h1>
          <p className="rules__subline muted">
            {enabledCount} active of {rules.length} rule{rules.length === 1 ? '' : 's'} registered in the fraud detection engine.
          </p>
        </div>
        <button
          type="button"
          className="rules__refresh-btn"
          onClick={() => void refresh()}
          title="Refresh rules from engine"
        >
          ↻ Refresh
        </button>
      </header>

      {/* ── Editorial list table ────────────────────────────────────── */}
      <div className="rules__table-wrap" role="table" aria-label="Detection rules">
        <div className="rules__table-head" role="row" aria-hidden="true">
          <span className="rules__col-name">Rule</span>
          <span className="rules__col-entity">Entity</span>
          <span className="rules__col-version">Version</span>
          <span className="rules__col-status">Status</span>
          <span className="rules__col-action">Action</span>
          <span className="rules__col-config">Configuration</span>
          <span className="rules__col-inspect" />
        </div>

        <div className="rules__rows">
          {rules.map(rule => {
            const isExpanded = expandedId === rule.id;
            const configs = extractConfigItems(rule);
            const isEnabled = rule.enabled !== false && rule.status !== 'inactive' && rule.status !== 'disabled';
            const entityKey = (rule.entity_key ?? rule.entity ?? rule.target_entity) as string | undefined;

            return (
              <div
                key={rule.id}
                className={`rules__row-item ${isExpanded ? 'rules__row-item--expanded' : ''}`}
                role="row"
              >
                {/* ── Main row ── */}
                <div
                  className="rules__row-main"
                  onClick={() => toggleExpand(rule.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleExpand(rule.id);
                    }
                  }}
                  aria-expanded={isExpanded}
                  aria-label={`Rule ${rule.name || rule.id}`}
                >
                  {/* Name + description */}
                  <div className="rules__col-name">
                    <span className="rules__rule-name">{rule.name || rule.id}</span>
                    {rule.description && (
                      <span className="rules__rule-desc muted">{rule.description}</span>
                    )}
                  </div>

                  {/* Entity key */}
                  <div className="rules__col-entity">
                    {entityKey ? (
                      <span className="rules__entity-pill mono">{entityKey}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  {/* Version */}
                  <div className="rules__col-version mono">
                    {rule.version ? (
                      <span className="rules__version-tag">v{rule.version}</span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  {/* Status / Enabled state */}
                  <div className="rules__col-status">
                    <span
                      className={`rules__status-pill rules__status-pill--${isEnabled ? 'active' : 'inactive'}`}
                    >
                      <span
                        className={`status-dot ${isEnabled ? 'status-dot--live' : ''}`}
                        aria-hidden="true"
                      />
                      <span>{isEnabled ? 'Active' : 'Inactive'}</span>
                    </span>
                  </div>

                  {/* Action */}
                  <div className="rules__col-action mono">
                    {rule.action ? (
                      <span className={`rules__action-badge rules__action-badge--${rule.action}`}>
                        {rule.action}
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  {/* Configuration parameters */}
                  <div className="rules__col-config">
                    {configs.length > 0 ? (
                      <div className="rules__config-strip">
                        {configs.slice(0, 3).map((c, i) => (
                          <span key={i} className="rules__config-tag mono">
                            <span className="rules__config-key">{c.label}:</span> {c.value}
                          </span>
                        ))}
                        {configs.length > 3 && (
                          <span className="rules__config-more mono muted">
                            +{configs.length - 3} more
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </div>

                  {/* Inspect toggle */}
                  <div className="rules__col-inspect">
                    <button
                      type="button"
                      className="rules__inspect-btn mono"
                      onClick={e => {
                        e.stopPropagation();
                        toggleExpand(rule.id);
                      }}
                      aria-label={`${isExpanded ? 'Collapse' : 'Inspect'} rule details`}
                    >
                      {isExpanded ? 'Close ↑' : 'Inspect →'}
                    </button>
                  </div>
                </div>

                {/* ── Expanded metadata drawer ── */}
                {isExpanded && (
                  <div className="rules__drawer" role="region" aria-label="Rule inspection">
                    <div className="rules__drawer-grid">
                      <div className="rules__drawer-meta">
                        <h2 className="rules__drawer-heading">Discovered Metadata</h2>
                        <dl className="rules__meta-list mono">
                          <div className="rules__meta-item">
                            <dt>Identifier</dt>
                            <dd>{rule.id}</dd>
                          </div>
                          {rule.version && (
                            <div className="rules__meta-item">
                              <dt>Version</dt>
                              <dd>v{rule.version}</dd>
                            </div>
                          )}
                          {entityKey && (
                            <div className="rules__meta-item">
                              <dt>Entity Key</dt>
                              <dd>{entityKey}</dd>
                            </div>
                          )}
                          {rule.risk_level && (
                            <div className="rules__meta-item">
                              <dt>Risk Tier</dt>
                              <dd>{rule.risk_level}</dd>
                            </div>
                          )}
                          {rule.triggered_count !== undefined && (
                            <div className="rules__meta-item">
                              <dt>Evaluations / Triggers</dt>
                              <dd>{rule.triggered_count} hits</dd>
                            </div>
                          )}
                          {rule.last_triggered_at && (
                            <div className="rules__meta-item">
                              <dt>Last Triggered</dt>
                              <dd>{new Date(rule.last_triggered_at).toLocaleString()}</dd>
                            </div>
                          )}
                        </dl>
                      </div>

                      {rule.condition_expression && (
                        <div className="rules__drawer-expression">
                          <h2 className="rules__drawer-heading">Condition Expression</h2>
                          <pre className="rules__code-block mono">{rule.condition_expression}</pre>
                        </div>
                      )}

                      <div className="rules__drawer-raw">
                        <h2 className="rules__drawer-heading">Engine Raw Payload</h2>
                        <pre className="rules__code-block mono">
                          {JSON.stringify(rule, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
