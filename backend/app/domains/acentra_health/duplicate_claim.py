"""
Duplicate Claim Rule — Acentra Health domain-specific rule.
Detects duplicate claims: same member, same provider, same procedure within a configurable window.
Demonstrates that the generic engine supports healthcare-specific rules via the same Rule interface.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from app.core.config import get_config
from app.core.models import RuleResult, Severity
from app.rules.base import Rule


class DuplicateClaimRule(Rule):
    name = "duplicate_claim"
    version = "1.0"
    description = "Detects potential duplicate insurance claims (same member, provider, and procedure within a time window)"
    entity_key = "member_id"

    def evaluate(self, txn: dict[str, Any], ctx: Any) -> RuleResult:
        cfg = get_config().rules.duplicate_claim
        window_days = cfg.window_days

        event_ts = txn.get("event_ts")
        member_id = txn.get("member_id", "")
        provider_id = txn.get("provider_id", "")
        category = txn.get("category", "")
        event_type = txn.get("event_type", "")

        # Only applicable to insurance claims
        if event_type not in ("insurance_claim", "provider_billing"):
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Rule only applies to insurance claims and provider billing events.",
            )

        if not event_ts or not member_id or not category:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Missing required fields (event_ts, member_id, or category).",
            )

        # Look for similar transactions in the window
        window = timedelta(days=window_days)
        history = ctx.history(
            entity_key=self.entity_key,
            entity_value=member_id,
            before=event_ts,
            window=window,
        )

        # Find duplicates: same provider + same category
        duplicates = []
        for h in history:
            if (h.get("provider_id") == provider_id
                    and h.get("category") == category
                    and h.get("event_type") in ("insurance_claim", "provider_billing")):
                duplicates.append(h)

        if not duplicates:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=True,
                triggered=False,
                score=0.0,
                reason=f"No duplicate claims found within {window_days} days.",
                evidence={
                    "window_days": window_days,
                    "duplicates_found": 0,
                },
            )

        # Score based on number of duplicates and similarity
        dup_count = len(duplicates)
        # 1 dup → 0.6, 2+ → approaching 1.0
        score = min(1.0, 0.4 + (dup_count * 0.3))

        # Check if amounts are identical (even more suspicious)
        current_amount = txn.get("amount", 0)
        exact_matches = [d for d in duplicates if d.get("amount") == current_amount]

        if exact_matches:
            score = min(1.0, score + 0.2)

        severity = Severity.NONE
        if score >= 0.85:
            severity = Severity.CRITICAL
        elif score >= 0.6:
            severity = Severity.HIGH
        elif score >= 0.3:
            severity = Severity.MEDIUM
        elif score > 0:
            severity = Severity.LOW

        return RuleResult(
            rule_name=self.name,
            rule_version=self.version,
            applicable=True,
            triggered=True,
            score=round(score, 4),
            severity=severity,
            reason=(
                f"Found {dup_count} potential duplicate claim(s) for "
                f"category '{category}' with provider '{provider_id}' "
                f"within {window_days} days."
                + (f" {len(exact_matches)} with identical amount." if exact_matches else "")
            ),
            evidence={
                "duplicate_count": dup_count,
                "exact_amount_matches": len(exact_matches),
                "window_days": window_days,
                "category": category,
                "provider_id": provider_id,
                "current_amount": current_amount,
                "duplicate_txn_ids": [d.get("txn_id", "") for d in duplicates[:5]],
            },
        )


# Auto-registration via discovery
RULE_INSTANCE = DuplicateClaimRule()
