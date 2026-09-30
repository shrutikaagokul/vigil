# VIGIL — API Contracts & Frontend Integration Guide
**Acentra Health — BUILD TO CARE 2026 Codeathon**  
*Target Audience: React Frontend Engineer / Reviewer Console Lead*

Base URL: `http://localhost:8000/api`  
Interactive Docs: `http://localhost:8000/docs` (Swagger UI) & `http://localhost:8000/redoc` (ReDoc)  
Developer Test Console: `http://localhost:8000/`

---

## 1. Quick TypeScript Interfaces

Copy and paste these directly into your React application (`types/vigil.ts`):

```typescript
export type RiskTier = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type TransactionStatus = "CLEAN" | "FLAGGED" | "REVIEWED" | "CLEARED";

export type AlertStatus = "PENDING" | "SENT" | "FAILED";

export type Severity = "NONE" | "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RuleResult {
  rule_name: string;
  rule_version: string;
  applicable: boolean;
  triggered: boolean;
  score: number; // 0.0 to 1.0
  severity: Severity;
  reason: string;
  evidence: Record<string, any>;
  metadata?: Record<string, any>;
  error?: string | null;
}

export interface RiskAssessment {
  txn_id: string;
  risk_score: number; // 0 to 100
  risk_tier: RiskTier;
  status: TransactionStatus;
  rule_results: RuleResult[];
  alert_sent: boolean;
  evaluated_at: string; // ISO 8601 UTC
}

export interface Transaction {
  txn_id: string;
  event_type: string;
  member_id: string;
  provider_id: string;
  category: string;
  amount: number;
  currency: string;
  latitude: number | null;
  longitude: number | null;
  event_ts: string; // ISO 8601 UTC
  risk_score: number;
  risk_tier: RiskTier;
  status: TransactionStatus;
  alert_status: string | null;
  version: number; // For optimistic concurrency
  created_at: string;
  updated_at: string;
  rule_results: RuleResult[];
}

export interface ReviewRequest {
  to_status: "REVIEWED" | "CLEARED";
  reviewer: string;
  note: string;
  expected_version: number;
}

export interface ReviewResponse {
  txn_id: string;
  from_status: TransactionStatus;
  to_status: TransactionStatus;
  reviewer: string;
  note: string;
  reviewed_at: string;
  new_version: number;
}

export interface ReviewHistoryItem {
  id: number;
  txn_id: string;
  reviewer: string;
  from_status: TransactionStatus;
  to_status: TransactionStatus;
  note: string;
  timestamp: string;
}

export interface DashboardMetrics {
  total_transactions: number;
  flagged: number;
  reviewed: number;
  cleared: number;
  clean: number;
  by_tier: Record<RiskTier, number>;
  by_rule: Record<string, number>;
  avg_risk_score: number;
  alert_count: number;
}

export interface RuleInfo {
  name: string;
  version: string;
  description: string;
  entity_key: string;
  enabled: boolean;
  weight: number;
  config: Record<string, any>;
}

export interface ScenarioDescription {
  id: string;
  name: string;
  description: string;
  transaction_count: number;
}
```

---

## 2. API Endpoints

### 2.1 Dashboard & Metrics

#### `GET /api/dashboard/metrics`
Returns aggregate statistics for the reviewer console dashboard cards and breakdown charts.

**Response `200 OK`:**
```json
{
  "total_transactions": 24,
  "flagged": 8,
  "reviewed": 3,
  "cleared": 2,
  "clean": 11,
  "by_tier": {
    "LOW": 11,
    "MEDIUM": 5,
    "HIGH": 6,
    "CRITICAL": 2
  },
  "by_rule": {
    "velocity": 4,
    "unusual_amount": 3,
    "geographic_anomaly": 2,
    "duplicate_claim": 2
  },
  "avg_risk_score": 42.5,
  "alert_count": 8
}
```

---

### 2.2 Transactions List & Search

#### `GET /api/transactions`
Query parameters:
- `status`: (optional) Filter by status (`FLAGGED`, `REVIEWED`, `CLEARED`, `CLEAN`)
- `tier`: (optional) Filter by tier (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
- `member_id`: (optional) Filter by member ID
- `provider_id`: (optional) Filter by provider ID
- `limit`: (optional, default `100`, max `1000`)
- `offset`: (optional, default `0`)

**Response `200 OK`:**
```json
[
  {
    "txn_id": "SIM-GEO-TOKYO",
    "event_type": "provider_billing",
    "member_id": "MBR-SIM-GEO",
    "provider_id": "PRV-001",
    "category": "provider_billing",
    "amount": 250.0,
    "currency": "USD",
    "latitude": 35.6762,
    "longitude": 139.6503,
    "event_ts": "2026-09-30T10:15:00Z",
    "risk_score": 100,
    "risk_tier": "CRITICAL",
    "status": "FLAGGED",
    "alert_status": "SENT",
    "version": 1,
    "created_at": "2026-09-30T10:15:01Z",
    "updated_at": "2026-09-30T10:15:01Z",
    "rule_results": [
      {
        "rule_name": "geographic_anomaly",
        "rule_version": "1.0",
        "applicable": true,
        "triggered": true,
        "score": 1.0,
        "severity": "CRITICAL",
        "reason": "Impossible travel: 10850.5 km in 15.0 min requires 43402.0 km/h (>1500 km/h threshold).",
        "evidence": {
          "distance_km": 10850.5,
          "elapsed_seconds": 900.0,
          "implied_speed_kmh": 43402.0,
          "speed_threshold_high": 1500.0,
          "prev_txn_id": "SIM-GEO-NYC",
          "prev_location": [40.7128, -74.006]
        }
      }
    ]
  }
]
```

---

### 2.3 Single Transaction & Risk Detail

#### `GET /api/transactions/{txn_id}`
Returns full transaction details, status, version, and attached rule explanations.

#### `GET /api/transactions/{txn_id}/risk`
Returns pure risk assessment and rule breakdown.

---

### 2.4 Review Workflow (Human-in-the-Loop)

#### `PATCH /api/transactions/{txn_id}/review`
Reviewers can transition `FLAGGED` transactions to `REVIEWED` or `CLEARED`.

**Headers:** `Content-Type: application/json`

**Request Body:**
```json
{
  "to_status": "REVIEWED",
  "reviewer": "investigator_john",
  "note": "Contacted member; verified legitimate international travel and confirmed authorization.",
  "expected_version": 1
}
```

**State Transition Rules:**
- From `FLAGGED` → Can transition to `REVIEWED` or `CLEARED`.
- Any other transition returns `400 Bad Request`.
- If `expected_version` does not match the database version, returns `409 Conflict` (prevents race conditions where two reviewers act simultaneously).

**Response `200 OK`:**
```json
{
  "txn_id": "SIM-GEO-TOKYO",
  "from_status": "FLAGGED",
  "to_status": "REVIEWED",
  "reviewer": "investigator_john",
  "note": "Contacted member; verified legitimate international travel and confirmed authorization.",
  "reviewed_at": "2026-09-30T10:30:00Z",
  "new_version": 2
}
```

---

### 2.5 Review Audit Trail

#### `GET /api/transactions/{txn_id}/reviews`
Returns full history of reviews, decisions, timestamps, and investigator notes for the selected transaction.

**Response `200 OK`:**
```json
[
  {
    "id": 1,
    "txn_id": "SIM-GEO-TOKYO",
    "reviewer": "investigator_john",
    "from_status": "FLAGGED",
    "to_status": "REVIEWED",
    "note": "Contacted member; verified legitimate international travel.",
    "timestamp": "2026-09-30T10:30:00Z"
  }
]
```

---

### 2.6 Simulation & Demo Endpoints

#### `GET /api/simulate/scenarios`
Returns the catalog of deterministic demo scenarios:
```json
[
  {
    "id": "normal",
    "name": "Normal Healthcare Activity",
    "description": "Routine office visits spaced across multiple days with standard amounts. Evaluates to LOW risk.",
    "transaction_count": 5
  },
  {
    "id": "velocity_burst",
    "name": "Rapid Claim/Transaction Burst",
    "description": "8 transactions submitted within 4 minutes for a single member. Triggers velocity rule.",
    "transaction_count": 8
  },
  {
    "id": "huge_amount",
    "name": "Extreme Amount Outlier",
    "description": "10 normal baseline claims followed by an extreme $85,000 outlier claim. Triggers unusual amount rule.",
    "transaction_count": 11
  },
  {
    "id": "impossible_travel",
    "name": "Geographic Impossibility",
    "description": "Two transactions: New York City then Tokyo 15 minutes later (>40,000 km/h). Triggers geographic rule.",
    "transaction_count": 2
  },
  {
    "id": "duplicate_claim",
    "name": "Duplicate Insurance Claim",
    "description": "Same member, same provider, and same knee surgery procedure within 3 days. Triggers duplicate claim rule.",
    "transaction_count": 2
  },
  {
    "id": "multi_trigger",
    "name": "Multi-Vector Fraud Attack",
    "description": "Simultaneous rapid burst, huge amount, and impossible travel. Escalates to CRITICAL risk tier.",
    "transaction_count": 12
  }
]
```

#### `POST /api/simulate?scenario={scenario_id}`
Executes a scenario and immediately returns risk assessments.

#### `POST /api/demo/seed`
One-click seed for presentations and frontend initialization. Populates realistic clean, flagged, and outlier transactions across all scenarios.

#### `POST /api/demo/reset?seed=true`
Wipes the database and optionally re-seeds clean data.

---

### 2.7 Rule Registry & Configuration

#### `GET /api/rules`
Lists all active engine rules with metadata, weights, and live configurations.

---

## 3. Recommended Frontend UI Layout

1. **Top Header**: VIGIL brand logo, system status badge (`GET /health`), active rule count (`GET /api/rules`), and demo scenario trigger dropdown.
2. **Metrics Bar**: 4 stat cards (Total Transactions, Flagged Queue, Cleared/Reviewed Count, Dispatched Alerts).
3. **Investigation Queue (Main Table)**:
   - Filter tabs: `All`, `Flagged (Action Required)`, `Reviewed`, `Cleared`.
   - Columns: Txn ID, Timestamp, Member / Provider, Amount, Risk Score (color-coded badge), Risk Tier, Triggered Explanations, Actions.
4. **Transaction Detail Modal / Drawer**:
   - Split view:
     - Left: Full transaction attributes and historical context.
     - Right: **Explainability Cards** for each triggered rule displaying:
       - Rule name & severity pill
       - Human-readable reason string
       - Evidence JSON/metric breakdown (e.g., speed, z-score, duplicates)
     - Bottom: **Reviewer Decision Box**:
       - Note input field
       - "Mark as Reviewed" and "Clear False Positive" buttons
       - Concurrency conflict handling (`409` banner if another reviewer updated first)
