"""
Abstract Rule interface.
All fraud detection rules must implement this interface.
Rules NEVER query the database directly — they receive history through EvaluationContext.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from app.core.models import RuleResult


class Rule(ABC):
    """Base class for all fraud detection rules."""

    name: str = "base_rule"
    version: str = "1.0"
    description: str = "Base rule"
    entity_key: str = "member_id"  # which field to use for entity history

    @abstractmethod
    def evaluate(self, txn: dict[str, Any], ctx: "EvaluationContext") -> RuleResult:
        """
        Evaluate a transaction against this rule.

        Args:
            txn: Dictionary representation of the transaction.
            ctx: Context providing historical data (no direct DB access).

        Returns:
            RuleResult with score, reason, evidence, etc.
        """
        ...

    def __repr__(self) -> str:
        return f"<Rule {self.name} v{self.version}>"
