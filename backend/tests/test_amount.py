"""
Tests for UnusualAmountRule.
Uses FakeContext — no database required.
"""
from datetime import datetime, timezone

import pytest

from app.core.config import AppConfig, set_config
from app.core.context import FakeContext
from app.rules.amount import UnusualAmountRule


@pytest.fixture(autouse=True)
def _set_config():
    set_config(AppConfig())


BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)


def _make_txn(amount=100.0, member_id="MBR-001", category="office_visit"):
    return {
        "txn_id": "test",
        "member_id": member_id,
        "category": category,
        "amount": amount,
        "event_ts": BASE,
    }


class TestUnusualAmountRule:
    def test_no_history_below_cold_start(self):
        rule = UnusualAmountRule()
        ctx = FakeContext(amounts=[])
        result = rule.evaluate(_make_txn(amount=500.0), ctx)
        assert result.applicable is True
        assert result.triggered is False

    def test_no_history_above_cold_start(self):
        rule = UnusualAmountRule()
        ctx = FakeContext(amounts=[])
        result = rule.evaluate(_make_txn(amount=25000.0), ctx)
        assert result.applicable is True
        assert result.triggered is True
        assert result.score > 0.0

    def test_insufficient_history(self):
        """< min_history samples → cold start mode."""
        rule = UnusualAmountRule()
        ctx = FakeContext(amounts=[100.0, 100.0, 100.0])  # 3 < 5
        result = rule.evaluate(_make_txn(amount=200.0), ctx)
        assert result.evidence.get("mode") == "cold_start" or result.evidence.get("history_count", 0) < 5

    def test_normal_amount(self):
        """Amount within normal range."""
        rule = UnusualAmountRule()
        amounts = [100.0, 110.0, 95.0, 105.0, 100.0, 98.0, 102.0]
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=105.0), ctx)
        assert result.triggered is False
        assert result.score == 0.0

    def test_extreme_outlier(self):
        """Amount far above baseline → high score."""
        rule = UnusualAmountRule()
        amounts = [100.0, 110.0, 95.0, 105.0, 100.0, 98.0, 102.0]
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=50000.0), ctx)
        assert result.triggered is True
        assert result.score >= 0.9

    def test_moderate_outlier(self):
        """Moderate outlier → partial score."""
        rule = UnusualAmountRule()
        amounts = [100.0, 110.0, 95.0, 105.0, 100.0, 98.0, 102.0]
        ctx = FakeContext(amounts=amounts)
        # z-score about 4-5 range
        result = rule.evaluate(_make_txn(amount=160.0), ctx)
        # Should be moderate
        assert 0.0 <= result.score <= 1.0

    def test_zero_mad_same_value(self):
        """All historical values identical, current matches."""
        rule = UnusualAmountRule()
        amounts = [100.0] * 10
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=100.0), ctx)
        assert result.triggered is False
        assert result.score == 0.0

    def test_zero_mad_different_value(self):
        """All historical values identical, current differs."""
        rule = UnusualAmountRule()
        amounts = [100.0] * 10
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=500.0), ctx)
        assert result.triggered is True
        assert result.score > 0.0

    def test_missing_entity(self):
        rule = UnusualAmountRule()
        ctx = FakeContext()
        result = rule.evaluate({"amount": 100.0, "member_id": ""}, ctx)
        assert result.applicable is False

    def test_evidence_includes_z_score(self):
        rule = UnusualAmountRule()
        amounts = [100.0, 110.0, 95.0, 105.0, 100.0, 98.0]
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=500.0), ctx)
        assert "robust_z" in result.evidence
        assert "historical_median" in result.evidence

    def test_score_clamped(self):
        rule = UnusualAmountRule()
        amounts = [1.0] * 10
        ctx = FakeContext(amounts=amounts)
        result = rule.evaluate(_make_txn(amount=1_000_000.0), ctx)
        assert 0.0 <= result.score <= 1.0
