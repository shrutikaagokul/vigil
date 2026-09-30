"""
Tests for VelocityRule.
Uses FakeContext with fixed timestamps — no database required.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import AppConfig, set_config
from app.core.context import FakeContext
from app.rules.velocity import VelocityRule


@pytest.fixture(autouse=True)
def _set_config():
    set_config(AppConfig())


BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def _make_txn(member_id="MBR-001", event_ts=None):
    return {
        "txn_id": "test",
        "member_id": member_id,
        "event_ts": event_ts or BASE,
    }


def _make_history(member_id, count, interval_seconds=30, start=None):
    """Create `count` past transactions evenly spaced before `start`."""
    start = start or BASE
    txns = []
    for i in range(count):
        ts = start - timedelta(seconds=(i + 1) * interval_seconds)
        txns.append({
            "txn_id": f"hist-{i}",
            "member_id": member_id,
            "event_ts": ts,
            "amount": 100.0,
        })
    return txns


class TestVelocityRule:
    def test_first_transaction_no_history(self):
        rule = VelocityRule()
        ctx = FakeContext(transactions=[])
        result = rule.evaluate(_make_txn(), ctx)
        assert result.applicable is True
        assert result.triggered is False
        assert result.score == 0.0

    def test_below_threshold(self):
        rule = VelocityRule()
        # 2 transactions in window (threshold=5, half=2.5)
        history = _make_history("MBR-001", 2)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert result.applicable is True
        assert result.triggered is False
        assert result.score == 0.0

    def test_at_half_threshold(self):
        """At 50% of threshold → score should be ~0."""
        rule = VelocityRule()
        # half of 5 = 2.5 → 2 txns should be ~0
        history = _make_history("MBR-001", 2)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert result.score == 0.0

    def test_above_threshold(self):
        """Above threshold → triggered with meaningful score."""
        rule = VelocityRule()
        history = _make_history("MBR-001", 7)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert result.applicable is True
        assert result.triggered is True
        assert 0.0 < result.score <= 1.0
        assert result.evidence["transaction_count"] == 7

    def test_at_double_threshold(self):
        """At 2x threshold → score should be 1.0."""
        rule = VelocityRule()
        history = _make_history("MBR-001", 10)  # 2x of 5
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert result.score == 1.0

    def test_different_entity_not_counted(self):
        """Transactions from different entity should not be counted."""
        rule = VelocityRule()
        history = _make_history("MBR-OTHER", 10)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(member_id="MBR-001"), ctx)
        assert result.score == 0.0

    def test_outside_window_not_counted(self):
        """Transactions outside the 5-minute window should not count."""
        rule = VelocityRule()
        # All transactions 10 minutes before — outside 5-min window
        history = _make_history("MBR-001", 10, interval_seconds=60,
                                start=BASE - timedelta(minutes=10))
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert result.score == 0.0

    def test_missing_entity(self):
        rule = VelocityRule()
        ctx = FakeContext()
        result = rule.evaluate({"event_ts": BASE, "member_id": ""}, ctx)
        assert result.applicable is False

    def test_missing_timestamp(self):
        rule = VelocityRule()
        ctx = FakeContext()
        result = rule.evaluate({"member_id": "MBR-001"}, ctx)
        assert result.applicable is False

    def test_evidence_structure(self):
        rule = VelocityRule()
        history = _make_history("MBR-001", 6)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert "transaction_count" in result.evidence
        assert "window_minutes" in result.evidence
        assert "threshold" in result.evidence

    def test_score_clamped(self):
        rule = VelocityRule()
        history = _make_history("MBR-001", 50)
        ctx = FakeContext(transactions=history)
        result = rule.evaluate(_make_txn(), ctx)
        assert 0.0 <= result.score <= 1.0
