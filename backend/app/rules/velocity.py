"""
Velocity Rule — detects excessive transactions for an entity within a sliding window.
The window is measured relative to the transaction's own event timestamp, NOT datetime.now().
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from app.core.config import get_config
from app.core.models import RuleResult, Severity
from app.rules.base import Rule


class VelocityRule(Rule):
    name = "velocity"
    version = "1.0"
    description = "Detects excessive transaction frequency within a sliding time window"
    entity_key = "member_id"

    def evaluate(self, txn: dict[str, Any], ctx: Any) -> RuleResult:
        cfg = get_config().rules.velocity
        window_minutes = cfg.window_minutes
        max_transactions = cfg.max_transactions

        event_ts = txn.get("event_ts")
        entity_value = txn.get(self.entity_key, "")

        if not event_ts or not entity_value:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Missing event timestamp or entity identifier.",
            )

        # Query history using the context — window relative to THIS transaction's timestamp
        window = timedelta(minutes=window_minutes)
        history = ctx.history(
            entity_key=self.entity_key,
            entity_value=entity_value,
            before=event_ts,
            window=window,
        )

        count = len(history)

        # Score ramp: 0 at ~50% of threshold, 1 at ~2x threshold
        half_threshold = max_transactions * 0.5
        double_threshold = max_transactions * 2.0

        if count <= half_threshold:
            score = 0.0
        elif count >= double_threshold:
            score = 1.0
        else:
            score = (count - half_threshold) / (double_threshold - half_threshold)

        score = max(0.0, min(1.0, score))
        triggered = score > 0.0

        severity = Severity.NONE
        if score >= 0.85:
            severity = Severity.CRITICAL
        elif score >= 0.6:
            severity = Severity.HIGH
        elif score >= 0.3:
            severity = Severity.MEDIUM
        elif triggered:
            severity = Severity.LOW

        reason = ""
        if triggered:
            reason = f"{count} transactions detected within {window_minutes} minutes (threshold: {max_transactions})."
        else:
            reason = f"Transaction frequency within normal range ({count} in {window_minutes} minutes)."

        return RuleResult(
            rule_name=self.name,
            rule_version=self.version,
            applicable=True,
            triggered=triggered,
            score=round(score, 4),
            severity=severity,
            reason=reason,
            evidence={
                "transaction_count": count,
                "window_minutes": window_minutes,
                "threshold": max_transactions,
            },
        )


# Auto-registration via discovery
RULE_INSTANCE = VelocityRule()
