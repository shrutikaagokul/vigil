"""
Unusual Amount Rule — detects amounts that deviate significantly from historical baseline.
Uses robust median / MAD (Median Absolute Deviation) approach.
"""
from __future__ import annotations

import statistics
from typing import Any

from app.core.config import get_config
from app.core.models import RuleResult, Severity
from app.rules.base import Rule


class UnusualAmountRule(Rule):
    name = "unusual_amount"
    version = "1.0"
    description = "Detects transaction amounts that deviate significantly from historical baseline using robust statistics"
    entity_key = "member_id"

    def evaluate(self, txn: dict[str, Any], ctx: Any) -> RuleResult:
        cfg = get_config().rules.amount
        min_history = cfg.min_history
        z_low = cfg.z_low
        z_high = cfg.z_high
        cold_start_threshold = cfg.cold_start_threshold

        amount = txn.get("amount", 0.0)
        entity_value = txn.get(self.entity_key, "")
        category = txn.get("category", "")

        if not entity_value:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Missing entity identifier.",
            )

        # Get historical amounts via context
        amounts = ctx.baseline(
            entity_key=self.entity_key,
            entity_value=entity_value,
            category=category,
            exclude_flagged=True,
        )

        # Cold start: insufficient history
        if len(amounts) < min_history:
            # Use absolute threshold fallback
            if amount > cold_start_threshold:
                score = min(1.0, (amount / cold_start_threshold - 1.0) / 2.0)
                return RuleResult(
                    rule_name=self.name,
                    rule_version=self.version,
                    applicable=True,
                    triggered=True,
                    score=round(max(0.0, min(1.0, score)), 4),
                    severity=self._severity(score),
                    reason=f"Insufficient history ({len(amounts)} samples). Amount ${amount:,.2f} exceeds cold-start threshold ${cold_start_threshold:,.2f}.",
                    evidence={
                        "current_amount": amount,
                        "cold_start_threshold": cold_start_threshold,
                        "history_count": len(amounts),
                        "mode": "cold_start",
                    },
                )
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=True,
                triggered=False,
                score=0.0,
                reason=f"Insufficient history ({len(amounts)} samples). Amount within cold-start threshold.",
                evidence={
                    "current_amount": amount,
                    "cold_start_threshold": cold_start_threshold,
                    "history_count": len(amounts),
                    "mode": "cold_start",
                },
            )

        # Compute robust statistics
        median_val = statistics.median(amounts)
        mad = statistics.median([abs(x - median_val) for x in amounts])

        # Handle zero MAD (all values identical)
        if mad == 0:
            if amount == median_val:
                return RuleResult(
                    rule_name=self.name,
                    rule_version=self.version,
                    applicable=True,
                    triggered=False,
                    score=0.0,
                    reason="Amount matches historical constant value.",
                    evidence={
                        "current_amount": amount,
                        "historical_median": median_val,
                        "mad": 0,
                        "robust_z": 0,
                        "history_count": len(amounts),
                    },
                )
            # Any deviation from a constant baseline is noteworthy
            deviation = abs(amount - median_val)
            score = min(1.0, deviation / (median_val + 1.0))
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=True,
                triggered=score > 0.0,
                score=round(score, 4),
                severity=self._severity(score),
                reason=f"Amount ${amount:,.2f} deviates from constant baseline of ${median_val:,.2f} (zero MAD).",
                evidence={
                    "current_amount": amount,
                    "historical_median": median_val,
                    "mad": 0,
                    "deviation": deviation,
                    "history_count": len(amounts),
                    "mode": "zero_mad",
                },
            )

        # Robust z-score: |x - median| / (1.4826 * MAD)
        robust_z = abs(amount - median_val) / (1.4826 * mad)

        # Score: linear interpolation between z_low and z_high
        if robust_z <= z_low:
            score = 0.0
        elif robust_z >= z_high:
            score = 1.0
        else:
            score = (robust_z - z_low) / (z_high - z_low)

        score = round(max(0.0, min(1.0, score)), 4)
        triggered = score > 0.0

        reason = ""
        if triggered:
            reason = (
                f"Transaction amount ${amount:,.2f} is significantly "
                f"{'above' if amount > median_val else 'below'} "
                f"the entity's historical baseline of ${median_val:,.2f} "
                f"for {'category ' + category if category else 'all categories'} "
                f"(robust z-score: {robust_z:.2f})."
            )
        else:
            reason = f"Amount ${amount:,.2f} is within normal range (median: ${median_val:,.2f}, z: {robust_z:.2f})."

        return RuleResult(
            rule_name=self.name,
            rule_version=self.version,
            applicable=True,
            triggered=triggered,
            score=score,
            severity=self._severity(score),
            reason=reason,
            evidence={
                "current_amount": amount,
                "historical_median": round(median_val, 2),
                "mad": round(mad, 2),
                "robust_z": round(robust_z, 2),
                "history_count": len(amounts),
                "category": category,
            },
        )

    @staticmethod
    def _severity(score: float) -> Severity:
        if score >= 0.85:
            return Severity.CRITICAL
        elif score >= 0.6:
            return Severity.HIGH
        elif score >= 0.3:
            return Severity.MEDIUM
        elif score > 0:
            return Severity.LOW
        return Severity.NONE


# Auto-registration via discovery
RULE_INSTANCE = UnusualAmountRule()
