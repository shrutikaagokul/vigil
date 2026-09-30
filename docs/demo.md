# VIGIL — Demo Scenarios & Simulation Guide

VIGIL provides deterministic synthetic scenarios designed to demonstrate explainable fraud detection in healthcare and financial contexts.

## Scenarios Catalog

### 1. `normal` — Normal Healthcare Activity
- **Behavior**: 5 routine doctor office visits spaced across multiple days with normal amounts ($150 - $190).
- **Expected Outcome**: All evaluate to `LOW` risk (Score < 30). Status `CLEAN`.

### 2. `velocity_burst` — Rapid Claim Burst
- **Behavior**: 8 transactions submitted in 4 minutes for a single member (`MBR-SIM-VELOCITY`).
- **Expected Outcome**: Velocity threshold triggered (8 in 4m vs 5 in 5m threshold). Score escalates to `HIGH` / `CRITICAL`. Status `FLAGGED`.

### 3. `huge_amount` — Extreme Amount Outlier
- **Behavior**: 10 normal baseline claims ($150 - $195) followed by an extreme $85,000 outlier claim.
- **Expected Outcome**: Median Absolute Deviation (MAD) modified z-score exceeds high threshold ($Z > 6.0$). Evaluates to `HIGH` / `CRITICAL`. Status `FLAGGED`.

### 4. `impossible_travel` — Geographic Impossibility
- **Behavior**: Transaction in New York City (`40.7128, -74.0060`), followed 15 minutes later by a transaction in Tokyo (`35.6762, 139.6503`).
- **Expected Outcome**: Distance of 10,850 km in 15 minutes requires implied speed > 40,000 km/h (>1,500 km/h airliner speed limit). Evaluates to `CRITICAL` (Score: 100). Status `FLAGGED`.

### 5. `duplicate_claim` — Duplicate Insurance Claim
- **Behavior**: Same member, same provider, and identical procedure code (`knee_replacement`) submitted 3 days apart.
- **Expected Outcome**: Duplicate claim rule triggers. Because claim amounts are identical ($45,000), severity escalates to `CRITICAL`. Status `FLAGGED`.

### 6. `multi_trigger` — Multi-Vector Attack
- **Behavior**: Rapid burst of transactions with extreme amounts submitted in Tokyo shortly after NYC transactions.
- **Expected Outcome**: Velocity, Amount, and Geo rules all trigger concurrently. Probabilistic Noisy-OR combines evidence to maximum `CRITICAL` risk score.

## Triggering Demos via API

```bash
# Run a specific scenario:
curl -X POST "http://localhost:8000/api/simulate?scenario=impossible_travel"

# Seed all demo scenarios at once:
curl -X POST "http://localhost:8000/api/demo/seed"

# Reset database and re-seed clean state:
curl -X POST "http://localhost:8000/api/demo/reset?seed=true"
```
