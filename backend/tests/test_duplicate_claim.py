"""
Tests for DuplicateClaimRule (Acentra Health domain rule).
Uses FakeContext with fixed timestamps.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import AppConfig, set_config
from app.core.context import FakeContext
from app.core.models import Severity
from app.domains.acentra_health.duplicate_claim import DuplicateClaimRule


@pytest.fixture(autouse=True)
def _set_config():
    set_config(AppConfig())


BASE = datetime(2026, 9, 30, 10, 0, 0, tzinfo=timezone.utc)


def _make_claim(
    txn_id="CLM-001",
    member_id="MBR-001",
    provider_id="PRV-001",
    category="knee_surgery",
    event_type="insurance_claim",
    amount=5000.0,
    event_ts=None,
):
    return {
        "txn_id": txn_id,
        "member_id": member_id,
        "provider_id": provider_id,
        "category": category,
        "event_type": event_type,
        "amount": amount,
        "event_ts": event_ts or BASE,
    }


class TestDuplicateClaimRule:
    def test_non_claim_event_type_not_applicable(self):
        rule = DuplicateClaimRule()
        txn = _make_claim(event_type="payment")
        ctx = FakeContext(transactions=[])
        result = rule.evaluate(txn, ctx)
        assert result.applicable is False
        assert result.triggered is False

    def test_missing_fields_not_applicable(self):
        rule = DuplicateClaimRule()
        txn = _make_claim(category="")
        ctx = FakeContext(transactions=[])
        result = rule.evaluate(txn, ctx)
        assert result.applicable is False

    def test_no_history_not_triggered(self):
        rule = DuplicateClaimRule()
        txn = _make_claim()
        ctx = FakeContext(transactions=[])
        result = rule.evaluate(txn, ctx)
        assert result.applicable is True
        assert result.triggered is False
        assert result.score == 0.0

    def test_different_provider_not_triggered(self):
        rule = DuplicateClaimRule()
        past = _make_claim(
            txn_id="HIST-001",
            provider_id="PRV-DIFFERENT",
            event_ts=BASE - timedelta(days=2),
        )
        ctx = FakeContext(transactions=[past])
        result = rule.evaluate(_make_claim(), ctx)
        assert result.applicable is True
        assert result.triggered is False
        assert result.score == 0.0

    def test_different_category_not_triggered(self):
        rule = DuplicateClaimRule()
        past = _make_claim(
            txn_id="HIST-001",
            category="dental_checkup",
            event_ts=BASE - timedelta(days=2),
        )
        ctx = FakeContext(transactions=[past])
        result = rule.evaluate(_make_claim(), ctx)
        assert result.applicable is True
        assert result.triggered is False
        assert result.score == 0.0

    def test_outside_window_not_found(self):
        rule = DuplicateClaimRule()
        past = _make_claim(
            txn_id="HIST-001",
            event_ts=BASE - timedelta(days=10),  # Config window is 7 days
        )
        ctx = FakeContext(transactions=[past])
        result = rule.evaluate(_make_claim(), ctx)
        assert result.applicable is True
        assert result.triggered is False

    def test_single_duplicate_triggers(self):
        rule = DuplicateClaimRule()
        past = _make_claim(
            txn_id="HIST-001",
            amount=4500.0,  # different amount
            event_ts=BASE - timedelta(days=2),
        )
        ctx = FakeContext(transactions=[past])
        result = rule.evaluate(_make_claim(amount=5000.0), ctx)
        assert result.applicable is True
        assert result.triggered is True
        assert result.score >= 0.6
        assert result.severity in (Severity.HIGH, Severity.CRITICAL)
        assert result.evidence["duplicate_count"] == 1
        assert result.evidence["exact_amount_matches"] == 0

    def test_exact_amount_escalates_score(self):
        rule = DuplicateClaimRule()
        past = _make_claim(
            txn_id="HIST-001",
            amount=5000.0,  # identical amount
            event_ts=BASE - timedelta(days=1),
        )
        ctx = FakeContext(transactions=[past])
        result = rule.evaluate(_make_claim(amount=5000.0), ctx)
        assert result.triggered is True
        assert result.score >= 0.8
        assert result.severity == Severity.CRITICAL
        assert result.evidence["exact_amount_matches"] == 1
        assert "identical amount" in result.reason
