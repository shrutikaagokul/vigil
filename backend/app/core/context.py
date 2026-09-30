"""
EvaluationContext — provides historical/baseline data to rules.
Rules NEVER query the database directly. All history is surfaced through this context.
This design makes rules independently testable with fake/mock contexts.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Optional, Protocol

from app.database.database import TransactionRecord, get_session


class EvaluationContext(Protocol):
    """Protocol that rules use to access historical data."""

    def history(
        self,
        entity_key: str,
        entity_value: str,
        before: datetime,
        window: Optional[timedelta] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        """Return past transactions for an entity, ordered by event_ts descending."""
        ...

    def baseline(
        self,
        entity_key: str,
        entity_value: str,
        category: str = "",
        exclude_flagged: bool = True,
        limit: int = 500,
    ) -> list[float]:
        """Return historical amounts for baseline computation."""
        ...


class DatabaseContext:
    """Production context backed by SQLAlchemy queries."""

    def __init__(self, session=None):
        self._session = session

    def _get_session(self):
        return self._session or get_session()

    def history(
        self,
        entity_key: str,
        entity_value: str,
        before: datetime,
        window: Optional[timedelta] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        session = self._get_session()
        try:
            col = getattr(TransactionRecord, entity_key, TransactionRecord.member_id)
            q = session.query(TransactionRecord).filter(
                col == entity_value,
                TransactionRecord.event_ts < before,
            )
            if window:
                earliest = before - window
                q = q.filter(TransactionRecord.event_ts >= earliest)

            q = q.order_by(TransactionRecord.event_ts.desc()).limit(limit)
            rows = q.all()
            return [self._to_dict(r) for r in rows]
        finally:
            if not self._session:
                session.close()

    def baseline(
        self,
        entity_key: str,
        entity_value: str,
        category: str = "",
        exclude_flagged: bool = True,
        limit: int = 500,
    ) -> list[float]:
        session = self._get_session()
        try:
            col = getattr(TransactionRecord, entity_key, TransactionRecord.member_id)
            q = session.query(TransactionRecord.amount).filter(
                col == entity_value,
            )
            if category:
                q = q.filter(TransactionRecord.category == category)
            if exclude_flagged:
                q = q.filter(TransactionRecord.status.notin_(["FLAGGED", "REVIEWED"]))

            q = q.order_by(TransactionRecord.event_ts.desc()).limit(limit)
            return [row[0] for row in q.all()]
        finally:
            if not self._session:
                session.close()

    @staticmethod
    def _to_dict(record: TransactionRecord) -> dict[str, Any]:
        # Ensure event_ts is a datetime object (SQLite may return strings)
        event_ts = record.event_ts
        if isinstance(event_ts, str):
            from datetime import datetime as dt
            try:
                event_ts = dt.fromisoformat(event_ts.replace("Z", "+00:00"))
            except (ValueError, AttributeError):
                pass
        if event_ts is not None and event_ts.tzinfo is None:
            event_ts = event_ts.replace(tzinfo=timezone.utc)

        return {
            "txn_id": record.txn_id,
            "event_type": record.event_type,
            "member_id": record.member_id,
            "provider_id": record.provider_id,
            "category": record.category,
            "amount": record.amount,
            "currency": record.currency,
            "latitude": record.latitude,
            "longitude": record.longitude,
            "event_ts": event_ts,
            "risk_score": record.risk_score,
            "risk_tier": record.risk_tier,
            "status": record.status,
        }


class FakeContext:
    """In-memory context for testing. Rules can be tested without a database."""

    def __init__(
        self,
        transactions: Optional[list[dict[str, Any]]] = None,
        amounts: Optional[list[float]] = None,
    ):
        self._transactions = transactions or []
        self._amounts = amounts or []

    def history(
        self,
        entity_key: str,
        entity_value: str,
        before: datetime,
        window: Optional[timedelta] = None,
        limit: int = 1000,
    ) -> list[dict[str, Any]]:
        results = []
        for txn in self._transactions:
            entity_val = txn.get(entity_key, "")
            ts = txn.get("event_ts")
            if entity_val != entity_value:
                continue
            if ts and ts >= before:
                continue
            if window and ts and ts < before - window:
                continue
            results.append(txn)

        results.sort(key=lambda t: t.get("event_ts", datetime.min.replace(tzinfo=timezone.utc)), reverse=True)
        return results[:limit]

    def baseline(
        self,
        entity_key: str,
        entity_value: str,
        category: str = "",
        exclude_flagged: bool = True,
        limit: int = 500,
    ) -> list[float]:
        if self._amounts:
            return self._amounts[:limit]
        # Fall back to extracting from transactions
        results = []
        for txn in self._transactions:
            entity_val = txn.get(entity_key, "")
            if entity_val != entity_value:
                continue
            if category and txn.get("category", "") != category:
                continue
            if exclude_flagged and txn.get("status") in ("FLAGGED", "REVIEWED"):
                continue
            results.append(txn.get("amount", 0.0))
        return results[:limit]
