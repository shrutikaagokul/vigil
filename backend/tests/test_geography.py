"""
Tests for GeographicRule (Impossible Geography).
Uses FakeContext with fixed timestamps and coordinates.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import AppConfig, set_config
from app.core.context import FakeContext
from app.rules.geography import GeographicRule, haversine_km


@pytest.fixture(autouse=True)
def _set_config():
    set_config(AppConfig())


BASE = datetime(2026, 1, 1, 12, 0, 0, tzinfo=timezone.utc)

# Coords
NYC = (40.7128, -74.0060)
TOKYO = (35.6762, 139.6503)
LONDON = (51.5074, -0.1278)
NEARBY = (40.7200, -74.0000)  # ~0.8 km from NYC


def _make_txn(lat, lon, event_ts=None, member_id="MBR-001"):
    return {
        "txn_id": "test",
        "member_id": member_id,
        "event_ts": event_ts or BASE,
        "latitude": lat,
        "longitude": lon,
        "amount": 100.0,
    }


def _make_prev(lat, lon, event_ts=None, member_id="MBR-001"):
    return {
        "txn_id": "prev",
        "member_id": member_id,
        "event_ts": event_ts or (BASE - timedelta(hours=1)),
        "latitude": lat,
        "longitude": lon,
        "amount": 100.0,
    }


class TestHaversine:
    def test_same_point(self):
        assert haversine_km(0, 0, 0, 0) == 0.0

    def test_known_distance(self):
        """NYC to London is about 5570 km."""
        d = haversine_km(*NYC, *LONDON)
        assert 5500 < d < 5700

    def test_nyc_to_tokyo(self):
        """NYC to Tokyo is about 10,850 km."""
        d = haversine_km(*NYC, *TOKYO)
        assert 10700 < d < 11000


class TestGeographicRule:
    def test_no_location(self):
        rule = GeographicRule()
        ctx = FakeContext()
        result = rule.evaluate({"member_id": "MBR-001", "event_ts": BASE,
                                "latitude": None, "longitude": None}, ctx)
        assert result.applicable is False

    def test_no_previous_transaction(self):
        rule = GeographicRule()
        ctx = FakeContext(transactions=[])
        result = rule.evaluate(_make_txn(*NYC), ctx)
        assert result.applicable is False

    def test_previous_has_no_location(self):
        rule = GeographicRule()
        prev = {"txn_id": "prev", "member_id": "MBR-001",
                "event_ts": BASE - timedelta(hours=1),
                "latitude": None, "longitude": None}
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*NYC), ctx)
        assert result.applicable is False

    def test_nearby_no_trigger(self):
        """Small movement → GPS jitter → not triggered."""
        rule = GeographicRule()
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(minutes=5))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*NEARBY), ctx)
        assert result.triggered is False

    def test_normal_travel(self):
        """NYC to London in 8 hours → ~696 km/h → below 800 threshold."""
        rule = GeographicRule()
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(hours=8))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*LONDON, event_ts=BASE), ctx)
        assert result.triggered is False

    def test_impossible_travel(self):
        """NYC to Tokyo in 15 minutes → ~43000 km/h → triggered."""
        rule = GeographicRule()
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(minutes=15))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*TOKYO, event_ts=BASE), ctx)
        assert result.triggered is True
        assert result.score >= 0.9

    def test_same_timestamp_large_distance(self):
        """Near-simultaneous with large distance → max score.
        Prev is 1 second before so it appears in history (strict < filter).
        With 10850 km in 1 second, implied speed is enormous → score 1.0.
        """
        rule = GeographicRule()
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(seconds=1))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*TOKYO, event_ts=BASE), ctx)
        assert result.triggered is True
        assert result.score == 1.0

    def test_evidence_structure(self):
        rule = GeographicRule()
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(minutes=15))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*TOKYO, event_ts=BASE), ctx)
        assert "distance_km" in result.evidence
        assert "implied_speed_kmh" in result.evidence
        assert "prev_latitude" in result.evidence
        assert "curr_latitude" in result.evidence

    def test_different_entity_not_used(self):
        """Previous transaction from different entity should be ignored."""
        rule = GeographicRule()
        prev = _make_prev(*NYC, member_id="OTHER")
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*TOKYO, member_id="MBR-001"), ctx)
        assert result.applicable is False  # no matching history

    def test_moderate_speed(self):
        """Speed between 800-1500 → partial score."""
        rule = GeographicRule()
        # 5570 km in 5 hours = 1114 km/h → between 800 and 1500
        prev = _make_prev(*NYC, event_ts=BASE - timedelta(hours=5))
        ctx = FakeContext(transactions=[prev])
        result = rule.evaluate(_make_txn(*LONDON, event_ts=BASE), ctx)
        assert result.triggered is True
        assert 0.0 < result.score < 1.0
