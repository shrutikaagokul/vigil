"""
Deterministic simulator — generates predictable transaction scenarios for demo.
Uses fixed timestamps and synthetic healthcare-flavored data.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.core.models import TransactionInput

# Fixed base time for deterministic scenarios
BASE_TIME = datetime(2026, 9, 30, 10, 0, 0, tzinfo=timezone.utc)


def _make_txn(
    txn_id: str,
    member_id: str = "MBR-001",
    provider_id: str = "PRV-001",
    event_type: str = "insurance_claim",
    category: str = "office_visit",
    amount: float = 150.0,
    currency: str = "USD",
    latitude: Optional[float] = 40.7128,
    longitude: Optional[float] = -74.0060,
    event_ts: Optional[datetime] = None,
) -> TransactionInput:
    return TransactionInput(
        txn_id=txn_id,
        event_type=event_type,
        member_id=member_id,
        provider_id=provider_id,
        category=category,
        amount=amount,
        currency=currency,
        latitude=latitude,
        longitude=longitude,
        event_ts=event_ts or BASE_TIME,
    )


def scenario_normal() -> list[TransactionInput]:
    """Normal transactions — should all score LOW."""
    txns = []
    for i in range(5):
        txns.append(_make_txn(
            txn_id=f"SIM-NORMAL-{i+1:03d}",
            member_id="MBR-SIM-NORMAL",
            amount=150.0 + (i * 10),
            event_ts=BASE_TIME + timedelta(days=i),
            latitude=40.7128,
            longitude=-74.0060,
        ))
    return txns


def scenario_velocity_burst() -> list[TransactionInput]:
    """8 transactions in 4 minutes — triggers velocity rule."""
    txns = []
    for i in range(8):
        txns.append(_make_txn(
            txn_id=f"SIM-VELOCITY-{i+1:03d}",
            member_id="MBR-SIM-VELOCITY",
            amount=120.0,
            event_ts=BASE_TIME + timedelta(seconds=i * 30),
            category="lab_test",
        ))
    return txns


def scenario_huge_amount() -> list[TransactionInput]:
    """Build baseline, then submit an extreme outlier."""
    txns = []
    # 10 baseline transactions with normal amounts
    for i in range(10):
        txns.append(_make_txn(
            txn_id=f"SIM-AMOUNT-BASE-{i+1:03d}",
            member_id="MBR-SIM-AMOUNT",
            provider_id="PRV-LAB",
            category="lab_test",
            amount=150.0 + (i * 5),
            event_ts=BASE_TIME + timedelta(days=i),
        ))
    # Outlier
    txns.append(_make_txn(
        txn_id="SIM-AMOUNT-OUTLIER",
        member_id="MBR-SIM-AMOUNT",
        provider_id="PRV-LAB",
        category="lab_test",
        amount=85000.0,
        event_ts=BASE_TIME + timedelta(days=11),
    ))
    return txns


def scenario_impossible_travel() -> list[TransactionInput]:
    """Two transactions: New York, then Tokyo 15 minutes later."""
    txns = [
        _make_txn(
            txn_id="SIM-GEO-NYC",
            member_id="MBR-SIM-GEO",
            category="provider_billing",
            amount=200.0,
            latitude=40.7128,
            longitude=-74.0060,
            event_ts=BASE_TIME,
        ),
        _make_txn(
            txn_id="SIM-GEO-TOKYO",
            member_id="MBR-SIM-GEO",
            category="provider_billing",
            amount=250.0,
            latitude=35.6762,
            longitude=139.6503,
            event_ts=BASE_TIME + timedelta(minutes=15),
        ),
    ]
    return txns


def scenario_duplicate_claim() -> list[TransactionInput]:
    """Same member, same provider, same category within 3 days."""
    txns = [
        _make_txn(
            txn_id="SIM-DUP-CLAIM-1",
            member_id="MBR-SIM-DUP",
            provider_id="PRV-SURG",
            event_type="insurance_claim",
            category="knee_replacement",
            amount=45000.0,
            event_ts=BASE_TIME,
        ),
        _make_txn(
            txn_id="SIM-DUP-CLAIM-2",
            member_id="MBR-SIM-DUP",
            provider_id="PRV-SURG",
            event_type="insurance_claim",
            category="knee_replacement",
            amount=45000.0,
            event_ts=BASE_TIME + timedelta(days=3),
        ),
    ]
    return txns


def scenario_multi_trigger() -> list[TransactionInput]:
    """Scenario that triggers multiple rules simultaneously."""
    txns = []
    # Build baseline for amount rule
    for i in range(6):
        txns.append(_make_txn(
            txn_id=f"SIM-MULTI-BASE-{i+1:03d}",
            member_id="MBR-SIM-MULTI",
            category="consultation",
            amount=100.0,
            latitude=40.7128,
            longitude=-74.0060,
            event_ts=BASE_TIME + timedelta(hours=i * 24),
        ))
    # Now trigger: velocity + amount + geo all at once
    for i in range(6):
        txns.append(_make_txn(
            txn_id=f"SIM-MULTI-BURST-{i+1:03d}",
            member_id="MBR-SIM-MULTI",
            category="consultation",
            amount=50000.0,  # huge amount
            latitude=35.6762,  # Tokyo (impossible travel from NYC)
            longitude=139.6503,
            event_ts=BASE_TIME + timedelta(days=7, seconds=i * 30),  # burst
        ))
    return txns


_SCENARIO_CATALOG = {
    "normal": {
        "name": "Normal Healthcare Activity",
        "description": "Routine office visits spaced across multiple days with standard amounts. Evaluates to LOW risk.",
        "fn": scenario_normal,
    },
    "velocity_burst": {
        "name": "Rapid Claim/Transaction Burst",
        "description": "8 transactions submitted within 4 minutes for a single member. Triggers velocity rule.",
        "fn": scenario_velocity_burst,
    },
    "huge_amount": {
        "name": "Extreme Amount Outlier",
        "description": "10 normal baseline claims followed by an extreme $85,000 outlier claim. Triggers unusual amount rule.",
        "fn": scenario_huge_amount,
    },
    "impossible_travel": {
        "name": "Geographic Impossibility",
        "description": "Two transactions: New York City then Tokyo 15 minutes later (>40,000 km/h). Triggers geographic rule.",
        "fn": scenario_impossible_travel,
    },
    "duplicate_claim": {
        "name": "Duplicate Insurance Claim",
        "description": "Same member, same provider, and same knee surgery procedure within 3 days. Triggers duplicate claim rule.",
        "fn": scenario_duplicate_claim,
    },
    "multi_trigger": {
        "name": "Multi-Vector Fraud Attack",
        "description": "Simultaneous rapid burst, huge amount, and impossible travel. Escalates to CRITICAL risk tier.",
        "fn": scenario_multi_trigger,
    },
}

_SCENARIOS = {k: v["fn"] for k, v in _SCENARIO_CATALOG.items()}


def get_scenario_transactions(scenario: str) -> list[TransactionInput]:
    """Get transactions for a named scenario."""
    fn = _SCENARIOS.get(scenario)
    if fn is None:
        return []
    return fn()


def list_scenarios() -> list[str]:
    return list(_SCENARIOS.keys())


def get_scenario_catalog() -> list[dict]:
    """Get rich metadata for all scenarios."""
    items = []
    for sid, info in _SCENARIO_CATALOG.items():
        txns = info["fn"]()
        items.append({
            "id": sid,
            "name": info["name"],
            "description": info["description"],
            "transaction_count": len(txns),
        })
    return items
