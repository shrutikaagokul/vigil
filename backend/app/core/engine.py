"""
FraudEngine — orchestrates rule evaluation, scoring, and persistence.
The engine NEVER hardcodes rule names. It gets rules from the registry.
Each rule runs independently; one rule's failure doesn't affect others.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from app.core.config import AppConfig, get_config
from app.core.context import DatabaseContext
from app.core.models import (
    RiskAssessment,
    RiskTier,
    RuleResult,
    TransactionInput,
    TransactionStatus,
)
from app.core.registry import discover_rules, get_enabled_rules
from app.core.scoring import aggregate_risk
from app.database.database import (
    RuleResultRecord,
    TransactionRecord,
    get_session,
)

logger = logging.getLogger(__name__)


class FraudEngine:
    """
    Core fraud evaluation engine.
    Evaluates a transaction against all enabled rules, aggregates risk,
    persists results, and triggers notifications.
    """

    def __init__(self, config: AppConfig | None = None, notifier=None):
        self.config = config or get_config()
        self.notifier = notifier
        discover_rules()

    def evaluate(self, txn_input: TransactionInput, session=None) -> RiskAssessment:
        """
        Evaluate a transaction against all enabled rules.
        Returns a full RiskAssessment.
        """
        own_session = session is None
        if own_session:
            session = get_session()

        try:
            # Check for duplicate txn_id (idempotency)
            existing = session.query(TransactionRecord).filter_by(
                txn_id=txn_input.txn_id
            ).first()
            if existing:
                return self._load_existing_assessment(existing, session)

            # Persist the transaction first (so history queries can find it for future txns)
            record = self._create_record(txn_input)
            session.add(record)
            session.flush()  # Get the record into the session but don't commit yet

            # Build evaluation context (backed by DB)
            ctx = DatabaseContext(session=session)
            txn_dict = self._txn_to_dict(txn_input)

            # Run all enabled rules independently
            rule_results = self._run_rules(txn_dict, ctx)

            # Aggregate risk
            risk_score, risk_tier = aggregate_risk(rule_results, self.config)

            # Determine status
            status = TransactionStatus.CLEAN
            if risk_tier in (RiskTier.HIGH, RiskTier.CRITICAL):
                status = TransactionStatus.FLAGGED
            elif risk_tier == RiskTier.MEDIUM:
                # Medium stays CLEAN but is noted
                status = TransactionStatus.CLEAN

            # Update transaction record
            record.risk_score = risk_score
            record.risk_tier = risk_tier.value
            record.status = status.value

            # Persist rule results
            for result in rule_results:
                rr = RuleResultRecord(
                    txn_id=txn_input.txn_id,
                    rule_name=result.rule_name,
                    rule_version=result.rule_version,
                    applicable=result.applicable,
                    triggered=result.triggered,
                    score=result.score,
                    severity=result.severity.value,
                    reason=result.reason,
                    evidence=json.dumps(result.evidence),
                    error=result.error,
                )
                session.add(rr)

            session.commit()

            # Trigger notification if needed (AFTER commit, never blocks)
            alert_sent = False
            if status == TransactionStatus.FLAGGED and self.notifier:
                alert_sent = self._send_alert(txn_input.txn_id, risk_score, risk_tier, rule_results, session)

            return RiskAssessment(
                txn_id=txn_input.txn_id,
                risk_score=risk_score,
                risk_tier=risk_tier,
                status=status,
                rule_results=rule_results,
                alert_sent=alert_sent,
                evaluated_at=datetime.now(timezone.utc),
            )

        except Exception:
            if own_session:
                session.rollback()
            raise
        finally:
            if own_session:
                session.close()

    def _run_rules(self, txn_dict: dict[str, Any], ctx: Any) -> list[RuleResult]:
        """Run all enabled rules independently. One rule's failure doesn't stop others."""
        rules = get_enabled_rules(self.config)
        results = []

        for rule in rules:
            try:
                result = rule.evaluate(txn_dict, ctx)
                results.append(result)
            except Exception as e:
                logger.error(f"Rule {rule.name} failed: {e}", exc_info=True)
                results.append(RuleResult(
                    rule_name=rule.name,
                    rule_version=rule.version,
                    applicable=True,
                    triggered=False,
                    score=0.0,
                    reason=f"Rule evaluation failed: {type(e).__name__}",
                    error=str(e),
                ))

        return results

    def _send_alert(
        self,
        txn_id: str,
        risk_score: int,
        risk_tier: RiskTier,
        rule_results: list[RuleResult],
        session,
    ) -> bool:
        """Send alert notification. Never blocks transaction processing."""
        try:
            triggered_rules = [r.rule_name for r in rule_results if r.triggered]
            return self.notifier.send_alert(
                txn_id=txn_id,
                risk_score=risk_score,
                risk_tier=risk_tier.value,
                triggered_rules=triggered_rules,
                session=session,
            )
        except Exception as e:
            logger.error(f"Alert notification failed for {txn_id}: {e}", exc_info=True)
            return False

    def _load_existing_assessment(self, record: TransactionRecord, session) -> RiskAssessment:
        """Load existing assessment for idempotent duplicate handling."""
        rule_results = []
        rr_records = session.query(RuleResultRecord).filter_by(txn_id=record.txn_id).all()
        for rr in rr_records:
            rule_results.append(RuleResult(
                rule_name=rr.rule_name,
                rule_version=rr.rule_version,
                applicable=rr.applicable,
                triggered=rr.triggered,
                score=rr.score,
                severity=rr.severity,
                reason=rr.reason,
                evidence=rr.get_evidence(),
                error=rr.error,
            ))

        return RiskAssessment(
            txn_id=record.txn_id,
            risk_score=record.risk_score,
            risk_tier=RiskTier(record.risk_tier),
            status=TransactionStatus(record.status),
            rule_results=rule_results,
            alert_sent=record.alert_status == "SENT",
            evaluated_at=record.created_at or datetime.now(timezone.utc),
        )

    @staticmethod
    def _create_record(txn: TransactionInput) -> TransactionRecord:
        """Create a TransactionRecord from input."""
        return TransactionRecord(
            txn_id=txn.txn_id,
            event_type=txn.event_type,
            member_id=txn.member_id,
            provider_id=txn.provider_id,
            category=txn.category,
            amount=txn.amount,
            currency=txn.currency,
            latitude=txn.latitude,
            longitude=txn.longitude,
            event_ts=txn.event_ts,
        )

    @staticmethod
    def _txn_to_dict(txn: TransactionInput) -> dict[str, Any]:
        """Convert TransactionInput to dict for rule evaluation."""
        return {
            "txn_id": txn.txn_id,
            "event_type": txn.event_type,
            "member_id": txn.member_id,
            "provider_id": txn.provider_id,
            "category": txn.category,
            "amount": txn.amount,
            "currency": txn.currency,
            "latitude": txn.latitude,
            "longitude": txn.longitude,
            "event_ts": txn.event_ts,
        }
