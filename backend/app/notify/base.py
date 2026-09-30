"""
Notifier base interface.
"""
from __future__ import annotations

from abc import ABC, abstractmethod


class Notifier(ABC):
    """Base notification interface."""

    @abstractmethod
    def send_alert(
        self,
        txn_id: str,
        risk_score: int,
        risk_tier: str,
        triggered_rules: list[str],
        session=None,
    ) -> bool:
        """
        Send an alert notification.
        Must never raise — returns False on failure.
        """
        ...
