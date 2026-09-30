# VIGIL — System Architecture & Engine Design

## Overview
VIGIL is an explainable fraud detection engine and reviewer console backend designed for high-integrity healthcare claim evaluation and financial transaction monitoring.

```
┌────────────────────────────────────────────────────────┐
│                   Ingestion / API                      │
│        (FastAPI Router, Pydantic Input Validation)     │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                    Fraud Engine                        │
│  - Idempotency check                                   │
│  - Isolated Rule Execution (Fault Tolerant)            │
│  - History Query via Evaluation Context                │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│                  Plugin Rule Registry                  │
│  - Auto-discovery from app.rules and app.domains.*     │
│  - Configurable weights and enablement                 │
└──────┬────────────────────┬────────────────────┬───────┘
       │                    │                    │
┌──────▼───────┐    ┌───────▼──────┐     ┌───────▼───────┐
│ VelocityRule │    │  AmountRule  │     │    GeoRule    │ ... + Domain Rules
└──────┬───────┘    └───────┬──────┘     └───────┬───────┘
       │                    │                    │
┌──────▼────────────────────▼────────────────────▼───────┐
│               Noisy-OR Risk Aggregator                 │
│  - Independent probabilities combined: 1 - Π(1 - w*p)  │
│  - High-tier guardrail (requires individual >= 0.50)   │
│  - Tiering: LOW / MEDIUM / HIGH / CRITICAL             │
└───────────────────────────┬────────────────────────────┘
                            │
┌───────────────────────────▼────────────────────────────┐
│               Persistence & Notification               │
│  - SQLAlchemy ORM (SQLite / PostgreSQL)                │
│  - Optimistic locking (version checking)               │
│  - Alert dispatch (AWS SNS + Console fallback)         │
└────────────────────────────────────────────────────────┘
```

## Core Components

1. **`app.core.engine.FraudEngine`**: Central orchestrator that handles transaction evaluation, queries contextual history, manages rule execution in isolated blocks, aggregates risk scores, and dispatches alerts.
2. **`app.core.registry`**: Dynamically discovers and loads `Rule` subclasses at runtime without hardcoded rule lists.
3. **`app.core.scoring`**: Implements mathematically sound Noisy-OR probability aggregation with anti-false-positive guardrails.
4. **`app.core.context`**: Database-backed or in-memory evaluation history context for sliding window queries.
5. **`app.rules.*`**: Core cross-industry fraud detection rules (Velocity, Amount outlier using MAD, Geographic impossible travel using Haversine).
6. **`app.domains.accentra_health.*`**: Domain-specific healthcare packs (e.g., Duplicate Claim detection).
7. **`app.notify.*`**: Multi-channel notification pipeline (AWS SNS with local console fallback and deduplication).
8. **`app.api.routes`**: RESTful API implementing transactions ingestion, reviewer workflow with optimistic locking, metrics, and scenario simulations.
