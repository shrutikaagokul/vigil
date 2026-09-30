"""
FastAPI routes for VIGIL fraud engine.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.config import get_config
from app.core.engine import FraudEngine
from app.core.models import (
    AlertResponse,
    AlertStatus,
    DashboardMetrics,
    ReviewHistoryItem,
    ReviewRequest,
    ReviewResponse,
    RiskAssessment,
    RiskTier,
    RuleInfo,
    RuleResult,
    ScenarioDescription,
    SimulateResponse,
    TransactionInput,
    TransactionResponse,
    TransactionStatus,
)
from app.core.registry import get_all_rules, get_rule_config_dict, get_rule_weight
from app.database.database import (
    AlertRecord,
    ReviewRecord,
    RuleResultRecord,
    TransactionRecord,
    get_session,
)

logger = logging.getLogger(__name__)

router = APIRouter()

# ── Dependency: DB session ────────────────────────────────────────────
def get_db():
    session = get_session()
    try:
        yield session
    finally:
        session.close()


# ── Engine singleton (set from main.py) ───────────────────────────────
_engine: FraudEngine | None = None


def set_engine(engine: FraudEngine):
    global _engine
    _engine = engine


def get_engine() -> FraudEngine:
    if _engine is None:
        raise HTTPException(500, "Engine not initialized")
    return _engine


# ══════════════════════════════════════════════════════════════════════
# POST /transactions — submit transaction for evaluation
# ══════════════════════════════════════════════════════════════════════
@router.post("/transactions", response_model=RiskAssessment, status_code=201)
def create_transaction(txn: TransactionInput, db: Session = Depends(get_db)):
    engine = get_engine()
    try:
        result = engine.evaluate(txn, session=db)
        # If it was a duplicate, return 200 instead of 201
        # Check if it already existed
        return result
    except Exception as e:
        logger.error(f"Transaction evaluation failed: {e}", exc_info=True)
        raise HTTPException(500, f"Evaluation failed: {str(e)}")


# ══════════════════════════════════════════════════════════════════════
# GET /transactions — list transactions with filters
# ══════════════════════════════════════════════════════════════════════
@router.get("/transactions", response_model=list[TransactionResponse])
def list_transactions(
    status: Optional[str] = Query(None),
    tier: Optional[str] = Query(None),
    member_id: Optional[str] = Query(None),
    provider_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(TransactionRecord)
    if status:
        q = q.filter(TransactionRecord.status == status)
    if tier:
        q = q.filter(TransactionRecord.risk_tier == tier)
    if member_id:
        q = q.filter(TransactionRecord.member_id == member_id)
    if provider_id:
        q = q.filter(TransactionRecord.provider_id == provider_id)

    q = q.order_by(TransactionRecord.event_ts.desc())
    records = q.offset(offset).limit(limit).all()

    results = []
    for r in records:
        rule_results = _load_rule_results(db, r.txn_id)
        results.append(_record_to_response(r, rule_results))

    return results


# ══════════════════════════════════════════════════════════════════════
# GET /transactions/{txn_id} — single transaction detail
# ══════════════════════════════════════════════════════════════════════
@router.get("/transactions/{txn_id}", response_model=TransactionResponse)
def get_transaction(txn_id: str, db: Session = Depends(get_db)):
    record = db.query(TransactionRecord).filter_by(txn_id=txn_id).first()
    if not record:
        raise HTTPException(404, f"Transaction {txn_id} not found")
    rule_results = _load_rule_results(db, txn_id)
    return _record_to_response(record, rule_results)


# ══════════════════════════════════════════════════════════════════════
# GET /transactions/{txn_id}/risk — risk details
# ══════════════════════════════════════════════════════════════════════
@router.get("/transactions/{txn_id}/risk", response_model=RiskAssessment)
def get_transaction_risk(txn_id: str, db: Session = Depends(get_db)):
    record = db.query(TransactionRecord).filter_by(txn_id=txn_id).first()
    if not record:
        raise HTTPException(404, f"Transaction {txn_id} not found")

    rule_results = _load_rule_results(db, txn_id)

    return RiskAssessment(
        txn_id=record.txn_id,
        risk_score=record.risk_score,
        risk_tier=RiskTier(record.risk_tier),
        status=TransactionStatus(record.status),
        rule_results=rule_results,
        alert_sent=record.alert_status == "SENT",
        evaluated_at=record.created_at or datetime.now(timezone.utc),
    )


# ══════════════════════════════════════════════════════════════════════
# PATCH /transactions/{txn_id}/review — review workflow
# ══════════════════════════════════════════════════════════════════════
@router.patch("/transactions/{txn_id}/review", response_model=ReviewResponse)
def review_transaction(txn_id: str, review: ReviewRequest, db: Session = Depends(get_db)):
    record = db.query(TransactionRecord).filter_by(txn_id=txn_id).first()
    if not record:
        raise HTTPException(404, f"Transaction {txn_id} not found")

    # Optimistic concurrency check
    if record.version != review.expected_version:
        raise HTTPException(
            409,
            f"Version conflict: expected {review.expected_version}, "
            f"actual {record.version}. Transaction may have been modified."
        )

    # Validate state transitions
    current_status = TransactionStatus(record.status)
    allowed_transitions = {
        TransactionStatus.FLAGGED: {TransactionStatus.REVIEWED, TransactionStatus.CLEARED},
    }

    allowed = allowed_transitions.get(current_status, set())
    if review.to_status not in allowed:
        raise HTTPException(
            400,
            f"Cannot transition from {current_status.value} to {review.to_status.value}. "
            f"Allowed transitions: {[s.value for s in allowed]}"
        )

    from_status = current_status
    now = datetime.now(timezone.utc)

    # Update transaction
    record.status = review.to_status.value
    record.version += 1
    record.updated_at = now

    # Create audit record
    review_record = ReviewRecord(
        txn_id=txn_id,
        reviewer=review.reviewer,
        from_status=from_status.value,
        to_status=review.to_status.value,
        note=review.note,
        timestamp=now,
    )
    db.add(review_record)
    db.commit()

    return ReviewResponse(
        txn_id=txn_id,
        from_status=from_status,
        to_status=review.to_status,
        reviewer=review.reviewer,
        note=review.note,
        reviewed_at=now,
        new_version=record.version,
    )


# ══════════════════════════════════════════════════════════════════════
# GET /transactions/{txn_id}/reviews — review history / audit log
# ══════════════════════════════════════════════════════════════════════
@router.get("/transactions/{txn_id}/reviews", response_model=list[ReviewHistoryItem])
def get_transaction_reviews(txn_id: str, db: Session = Depends(get_db)):
    record = db.query(TransactionRecord).filter_by(txn_id=txn_id).first()
    if not record:
        raise HTTPException(404, f"Transaction {txn_id} not found")
    reviews = (
        db.query(ReviewRecord)
        .filter_by(txn_id=txn_id)
        .order_by(ReviewRecord.timestamp.asc())
        .all()
    )
    return [
        ReviewHistoryItem(
            id=r.id,
            txn_id=r.txn_id,
            reviewer=r.reviewer,
            from_status=TransactionStatus(r.from_status),
            to_status=TransactionStatus(r.to_status),
            note=r.note or "",
            timestamp=r.timestamp,
        )
        for r in reviews
    ]


# ══════════════════════════════════════════════════════════════════════
# GET /rules — list loaded rules
# ══════════════════════════════════════════════════════════════════════
@router.get("/rules", response_model=list[RuleInfo])
def list_rules():
    rules = get_all_rules()
    cfg = get_config()
    result = []
    for name, rule in rules.items():
        rule_cfg = get_rule_config_dict(name, cfg)
        result.append(RuleInfo(
            name=rule.name,
            version=rule.version,
            description=rule.description,
            entity_key=rule.entity_key,
            enabled=rule_cfg.get("enabled", True),
            weight=get_rule_weight(name, cfg),
            config=rule_cfg,
        ))
    return result


# ══════════════════════════════════════════════════════════════════════
# GET /alerts — list alerts
# ══════════════════════════════════════════════════════════════════════
@router.get("/alerts", response_model=list[AlertResponse])
def list_alerts(
    status: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    db: Session = Depends(get_db),
):
    q = db.query(AlertRecord)
    if status:
        q = q.filter(AlertRecord.status == status)
    q = q.order_by(AlertRecord.timestamp.desc()).limit(limit)
    records = q.all()
    return [
        AlertResponse(
            id=r.id,
            txn_id=r.txn_id,
            channel=r.channel,
            status=AlertStatus(r.status),
            error=r.error,
            timestamp=r.timestamp,
        )
        for r in records
    ]


# ══════════════════════════════════════════════════════════════════════
# GET /dashboard/metrics — dashboard summary
# ══════════════════════════════════════════════════════════════════════
@router.get("/dashboard/metrics", response_model=DashboardMetrics)
def dashboard_metrics(db: Session = Depends(get_db)):
    total = db.query(TransactionRecord).count()
    flagged = db.query(TransactionRecord).filter_by(status="FLAGGED").count()
    reviewed = db.query(TransactionRecord).filter_by(status="REVIEWED").count()
    cleared = db.query(TransactionRecord).filter_by(status="CLEARED").count()
    clean = db.query(TransactionRecord).filter_by(status="CLEAN").count()

    # By tier
    by_tier = {}
    for tier in ["LOW", "MEDIUM", "HIGH", "CRITICAL"]:
        by_tier[tier] = db.query(TransactionRecord).filter_by(risk_tier=tier).count()

    # By rule (triggered count)
    by_rule = {}
    triggered_results = db.query(RuleResultRecord).filter_by(triggered=True).all()
    for rr in triggered_results:
        by_rule[rr.rule_name] = by_rule.get(rr.rule_name, 0) + 1

    # Average risk score
    from sqlalchemy import func
    avg = db.query(func.avg(TransactionRecord.risk_score)).scalar() or 0.0

    alert_count = db.query(AlertRecord).count()

    return DashboardMetrics(
        total_transactions=total,
        flagged=flagged,
        reviewed=reviewed,
        cleared=cleared,
        clean=clean,
        by_tier=by_tier,
        by_rule=by_rule,
        avg_risk_score=round(float(avg), 2),
        alert_count=alert_count,
    )


# ══════════════════════════════════════════════════════════════════════
# POST /simulate — run demo scenarios
# ══════════════════════════════════════════════════════════════════════
@router.post("/simulate", response_model=SimulateResponse)
def simulate(scenario: str = Query("normal"), db: Session = Depends(get_db)):
    from app.simulator import get_scenario_transactions
    engine = get_engine()

    txns = get_scenario_transactions(scenario)
    if not txns:
        raise HTTPException(400, f"Unknown scenario: {scenario}")

    results = []
    for txn_input in txns:
        assessment = engine.evaluate(txn_input, session=db)
        results.append(assessment)

    return SimulateResponse(
        scenario=scenario,
        transactions_created=len(results),
        results=results,
    )


# ══════════════════════════════════════════════════════════════════════
# GET /simulate/scenarios — list all available simulation scenarios
# ══════════════════════════════════════════════════════════════════════
@router.get("/simulate/scenarios", response_model=list[ScenarioDescription])
def list_simulation_scenarios():
    from app.simulator import get_scenario_catalog
    return [ScenarioDescription(**item) for item in get_scenario_catalog()]


# ══════════════════════════════════════════════════════════════════════
# POST /demo/seed — seed all demo scenarios into database
# ══════════════════════════════════════════════════════════════════════
@router.post("/demo/seed")
def seed_demo_data(db: Session = Depends(get_db)):
    """Seed comprehensive demo scenarios into the database for immediate testing."""
    from app.simulator import get_scenario_transactions, list_scenarios
    engine = get_engine()
    total_created = 0
    scenarios_seeded = []
    for sc in list_scenarios():
        txns = get_scenario_transactions(sc)
        for t in txns:
            engine.evaluate(t, session=db)
            total_created += 1
        scenarios_seeded.append(sc)
    return {
        "status": "seeded",
        "scenarios": scenarios_seeded,
        "transactions_evaluated": total_created,
    }


# ══════════════════════════════════════════════════════════════════════
# POST /demo/reset — clear database and optionally re-seed
# ══════════════════════════════════════════════════════════════════════
@router.post("/demo/reset")
def reset_demo_data(seed: bool = Query(True), db: Session = Depends(get_db)):
    """Clear all records and optionally re-seed demo scenarios."""
    db.query(AlertRecord).delete()
    db.query(ReviewRecord).delete()
    db.query(RuleResultRecord).delete()
    db.query(TransactionRecord).delete()
    db.commit()

    if seed:
        from app.simulator import get_scenario_transactions, list_scenarios
        engine = get_engine()
        total_created = 0
        for sc in list_scenarios():
            for t in get_scenario_transactions(sc):
                engine.evaluate(t, session=db)
                total_created += 1
        return {"status": "reset_and_seeded", "transactions_evaluated": total_created}
    return {"status": "cleared"}


# ══════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════

def _load_rule_results(db: Session, txn_id: str) -> list[RuleResult]:
    records = db.query(RuleResultRecord).filter_by(txn_id=txn_id).all()
    return [
        RuleResult(
            rule_name=rr.rule_name,
            rule_version=rr.rule_version,
            applicable=rr.applicable,
            triggered=rr.triggered,
            score=rr.score,
            severity=rr.severity,
            reason=rr.reason,
            evidence=rr.get_evidence(),
            error=rr.error,
        )
        for rr in records
    ]


def _record_to_response(r: TransactionRecord, rule_results: list[RuleResult]) -> TransactionResponse:
    return TransactionResponse(
        txn_id=r.txn_id,
        event_type=r.event_type,
        member_id=r.member_id,
        provider_id=r.provider_id,
        category=r.category,
        amount=r.amount,
        currency=r.currency,
        latitude=r.latitude,
        longitude=r.longitude,
        event_ts=r.event_ts,
        risk_score=r.risk_score,
        risk_tier=RiskTier(r.risk_tier),
        status=TransactionStatus(r.status),
        alert_status=r.alert_status,
        version=r.version,
        created_at=r.created_at or datetime.now(timezone.utc),
        updated_at=r.updated_at or datetime.now(timezone.utc),
        rule_results=rule_results,
    )
