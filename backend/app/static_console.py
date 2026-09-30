"""
Lightweight temporary Developer Verification Console for VIGIL backend.
Provides a single-page interactive UI for testing endpoints, viewing live metrics,
triggering demo scenarios, and verifying review state transitions.
"""
from __future__ import annotations

TEST_CONSOLE_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>VIGIL — Fraud Engine Verification Console</title>
  <style>
    :root {
      --bg: #0b0f19;
      --card-bg: #111827;
      --border: #1f2937;
      --text: #f3f4f6;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --purple: #8b5cf6;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      padding: 24px;
      line-height: 1.5;
    }
    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 24px;
      padding-bottom: 16px;
      border-bottom: 1px solid var(--border);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 2px;
      color: #60a5fa;
      background: linear-gradient(135deg, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 9999px;
      background: rgba(16, 185, 129, 0.15);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.3);
    }
    .links a {
      color: #93c5fd;
      text-decoration: none;
      margin-left: 16px;
      font-size: 14px;
    }
    .links a:hover { text-decoration: underline; }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin-bottom: 24px;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }
    .card-title {
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: var(--text-muted);
      margin-bottom: 8px;
    }
    .card-value {
      font-size: 28px;
      font-weight: 700;
      color: #fff;
    }
    .actions-panel {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 24px;
    }
    .section-title {
      font-size: 16px;
      font-weight: 600;
      margin-bottom: 12px;
      color: #e5e7eb;
    }
    .btn-group {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }
    button {
      background: #1e293b;
      border: 1px solid #334155;
      color: #e2e8f0;
      padding: 8px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    button:hover {
      background: #334155;
      border-color: #475569;
    }
    button.btn-primary {
      background: var(--primary);
      border-color: var(--primary-hover);
      color: #fff;
    }
    button.btn-primary:hover {
      background: var(--primary-hover);
    }
    button.btn-danger {
      background: rgba(239, 68, 68, 0.15);
      border-color: rgba(239, 68, 68, 0.4);
      color: #f87171;
    }
    button.btn-danger:hover {
      background: rgba(239, 68, 68, 0.25);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
    }
    th, td {
      padding: 12px 14px;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }
    th {
      background: #161e2e;
      color: var(--text-muted);
      font-weight: 600;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    tr:hover { background: rgba(255, 255, 255, 0.02); }
    .tier-pill {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 8px;
      border-radius: 4px;
      display: inline-block;
    }
    .tier-LOW { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .tier-MEDIUM { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .tier-HIGH { background: rgba(239, 68, 68, 0.15); color: #f87171; }
    .tier-CRITICAL { background: rgba(139, 92, 246, 0.25); color: #c084fc; border: 1px solid #c084fc; }
    .status-pill {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 6px;
      border-radius: 4px;
    }
    .status-CLEAN { color: #9ca3af; }
    .status-FLAGGED { color: #f87171; font-weight: 700; }
    .status-REVIEWED { color: #60a5fa; }
    .status-CLEARED { color: #34d399; }
    .rules-list {
      font-size: 11px;
      color: #93c5fd;
      max-width: 320px;
    }
    .notice {
      margin-top: 16px;
      font-size: 12px;
      color: var(--text-muted);
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="brand">
      <span class="logo">VIGIL</span>
      <span class="badge">BACKEND READY v1.0.0</span>
    </div>
    <div class="links">
      <a href="/docs" target="_blank">Swagger OpenAPI Docs</a>
      <a href="/redoc" target="_blank">ReDoc Specification</a>
      <a href="/api/rules" target="_blank">Rule Registry</a>
      <a href="/api/dashboard/metrics" target="_blank">Metrics JSON</a>
    </div>
  </header>

  <div class="grid">
    <div class="card">
      <div class="card-title">Total Evaluated</div>
      <div class="card-value" id="val-total">0</div>
    </div>
    <div class="card">
      <div class="card-title">Flagged for Review</div>
      <div class="card-value" id="val-flagged" style="color: #f87171;">0</div>
    </div>
    <div class="card">
      <div class="card-title">Reviewed</div>
      <div class="card-value" id="val-reviewed" style="color: #60a5fa;">0</div>
    </div>
    <div class="card">
      <div class="card-title">Cleared</div>
      <div class="card-value" id="val-cleared" style="color: #34d399;">0</div>
    </div>
    <div class="card">
      <div class="card-title">Alerts Dispatched</div>
      <div class="card-value" id="val-alerts" style="color: #c084fc;">0</div>
    </div>
  </div>

  <div class="actions-panel">
    <div class="section-title">Deterministic Scenario Simulator & Demo Controls</div>
    <div class="btn-group">
      <button class="btn-primary" onclick="seedAll()">Seed All Scenarios</button>
      <button onclick="runScenario('normal')">Run Normal Claim</button>
      <button onclick="runScenario('velocity_burst')">Run Velocity Burst</button>
      <button onclick="runScenario('huge_amount')">Run Extreme Amount</button>
      <button onclick="runScenario('impossible_travel')">Run Impossible Travel</button>
      <button onclick="runScenario('duplicate_claim')">Run Duplicate Claim</button>
      <button onclick="runScenario('multi_trigger')">Run Multi-Vector Attack</button>
      <button class="btn-danger" onclick="resetDb()">Reset Database</button>
    </div>
  </div>

  <div class="actions-panel">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <div class="section-title" style="margin: 0;">Recent Transactions & Explainability Audit</div>
      <button onclick="loadAll()" style="font-size: 12px; padding: 4px 10px;">Refresh</button>
    </div>
    <table>
      <thead>
        <tr>
          <th>Txn ID</th>
          <th>Event / Category</th>
          <th>Member</th>
          <th>Amount</th>
          <th>Score</th>
          <th>Tier</th>
          <th>Status</th>
          <th>Triggered Rules / Evidence</th>
          <th>Review Actions</th>
        </tr>
      </thead>
      <tbody id="txn-tbody">
        <tr><td colspan="9" style="text-align: center; color: var(--text-muted);">Loading transactions...</td></tr>
      </tbody>
    </table>
  </div>

  <div class="notice">
    VIGIL Developer Verification Console &bull; Backend Lead Interface for Testing & API Verification &bull; React Frontend connects to <code>/api/*</code>
  </div>

  <script>
    async function fetchJSON(url, opts) {
      const res = await fetch(url, opts);
      return res.json();
    }

    async function loadAll() {
      try {
        const metrics = await fetchJSON('/api/dashboard/metrics');
        document.getElementById('val-total').innerText = metrics.total_transactions;
        document.getElementById('val-flagged').innerText = metrics.flagged;
        document.getElementById('val-reviewed').innerText = metrics.reviewed;
        document.getElementById('val-cleared').innerText = metrics.cleared;
        document.getElementById('val-alerts').innerText = metrics.alert_count;

        const txns = await fetchJSON('/api/transactions?limit=50');
        const tbody = document.getElementById('txn-tbody');
        if (!txns || txns.length === 0) {
          tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; color: var(--text-muted);">No transactions recorded yet. Click "Seed All Scenarios" above to populate realistic data!</td></tr>';
          return;
        }

        tbody.innerHTML = txns.map(t => {
          const triggers = (t.rule_results || [])
            .filter(r => r.triggered)
            .map(r => `<div><strong>${r.rule_name}</strong> (score: ${r.score}): ${r.reason}</div>`)
            .join('');

          let actions = '-';
          if (t.status === 'FLAGGED') {
            actions = `
              <div style="display: flex; gap: 6px;">
                <button style="padding: 3px 8px; font-size: 11px;" onclick="review('${t.txn_id}', 'REVIEWED', ${t.version})">Review</button>
                <button style="padding: 3px 8px; font-size: 11px;" onclick="review('${t.txn_id}', 'CLEARED', ${t.version})">Clear</button>
              </div>
            `;
          }

          return `
            <tr>
              <td style="font-family: monospace; font-size: 12px; color: #93c5fd;">${t.txn_id}</td>
              <td>${t.event_type} / ${t.category || 'N/A'}</td>
              <td style="font-family: monospace;">${t.member_id}</td>
              <td>$${Number(t.amount).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
              <td><strong>${t.risk_score}</strong>/100</td>
              <td><span class="tier-pill tier-${t.risk_tier}">${t.risk_tier}</span></td>
              <td><span class="status-pill status-${t.status}">${t.status}</span></td>
              <td class="rules-list">${triggers || '<span style="color: #6b7280;">None (Clean)</span>'}</td>
              <td>${actions}</td>
            </tr>
          `;
        }).join('');
      } catch (err) {
        console.error('Failed to load data:', err);
      }
    }

    async function runScenario(scenario) {
      await fetchJSON(`/api/simulate?scenario=${scenario}`, { method: 'POST' });
      await loadAll();
    }

    async function seedAll() {
      await fetchJSON('/api/demo/seed', { method: 'POST' });
      await loadAll();
    }

    async function resetDb() {
      if (confirm('Clear database and re-seed?')) {
        await fetchJSON('/api/demo/reset?seed=true', { method: 'POST' });
        await loadAll();
      }
    }

    async function review(txnId, toStatus, version) {
      await fetchJSON(`/api/transactions/${txnId}/review`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to_status: toStatus,
          reviewer: 'console_reviewer',
          note: `Marked as ${toStatus} via verification console`,
          expected_version: version
        })
      });
      await loadAll();
    }

    loadAll();
  </script>
</body>
</html>
"""
