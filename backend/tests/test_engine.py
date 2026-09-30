"""
Tests for the FraudEngine, rule registry, and scoring.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.core.config import AppConfig, set_config
from app.core.context import FakeContext
from app.core.models import RuleResult, Severity
from app.core.registry import (
    discover_rules,
    get_all_rules,
    get_enabled_rules,
    register_rule,
    reset_registry,
)
from app.core.scoring import aggregate_risk
from app.rules.base import Rule


@pytest.fixture(autouse=True)
def _clean_state():
    set_config(AppConfig())
    reset_registry()
    yield
    reset_registry()


class DummyRule(Rule):
    name = "dummy"
    version = "1.0"
    description = "Test rule"
    entity_key = "member_id"

    def evaluate(self, txn, ctx):
        return RuleResult(
            rule_name=self.name,
            rule_version=self.version,
            applicable=True,
            triggered=True,
            score=0.5,
            severity=Severity.MEDIUM,
            reason="Dummy triggered",
        )


class ExplodingRule(Rule):
    name = "exploding"
    version = "1.0"
    description = "Always raises"
    entity_key = "member_id"

    def evaluate(self, txn, ctx):
        raise RuntimeError("BOOM!")


class TestRegistry:
    def test_register_and_retrieve(self):
        rule = DummyRule()
        register_rule(rule)
        rules = get_all_rules()
        assert "dummy" in rules

    def test_auto_discovery(self):
        discover_rules()
        rules = get_all_rules()
        assert "velocity" in rules
        assert "unusual_amount" in rules
        assert "geographic_anomaly" in rules

    def test_enabled_rules(self):
        discover_rules()
        enabled = get_enabled_rules()
        names = [r.name for r in enabled]
        assert "velocity" in names

    def test_discovery_idempotent(self):
        discover_rules()
        count1 = len(get_all_rules())
        discover_rules()
        count2 = len(get_all_rules())
        assert count1 == count2


class TestScoring:
    def test_empty_results(self):
        score, tier = aggregate_risk([])
        assert score == 0
        assert tier.value == "LOW"

    def test_single_low_score(self):
        results = [RuleResult(rule_name="test", score=0.1, applicable=True)]
        score, tier = aggregate_risk(results)
        assert score == 10
        assert tier.value == "LOW"

    def test_single_high_score(self):
        results = [RuleResult(rule_name="test", score=0.9, applicable=True)]
        score, tier = aggregate_risk(results)
        assert score == 90
        assert tier.value == "CRITICAL"

    def test_noisy_or_aggregation(self):
        """Two rules with score 0.5 → 1-(0.5*0.5) = 0.75"""
        results = [
            RuleResult(rule_name="a", score=0.5, applicable=True),
            RuleResult(rule_name="b", score=0.5, applicable=True),
        ]
        score, tier = aggregate_risk(results)
        assert score == 75

    def test_high_tier_guard(self):
        """Many weak signals should NOT become HIGH."""
        results = [
            RuleResult(rule_name=f"r{i}", score=0.2, applicable=True)
            for i in range(10)
        ]
        score, tier = aggregate_risk(results)
        # Noisy-OR of 10x0.2 = 1-(0.8^10) ≈ 0.893 → would be CRITICAL
        # But guard: max individual score 0.2 < 0.5 → capped at MEDIUM
        assert tier.value == "MEDIUM"

    def test_non_applicable_excluded(self):
        results = [
            RuleResult(rule_name="a", score=0.9, applicable=False),
        ]
        score, tier = aggregate_risk(results)
        assert score == 0

    def test_known_numeric_example(self):
        """Velocity=0.8 (w=1), Amount=0.6 (w=1) → 1-(0.2*0.4) = 0.92"""
        results = [
            RuleResult(rule_name="velocity", score=0.8, applicable=True),
            RuleResult(rule_name="unusual_amount", score=0.6, applicable=True),
        ]
        score, tier = aggregate_risk(results)
        assert score == 92
        assert tier.value == "CRITICAL"


class TestRuleIsolation:
    def test_exception_does_not_stop_other_rules(self):
        """An exploding rule must not prevent other rules from running."""
        from app.core.engine import FraudEngine
        from app.database.database import init_db

        init_db("sqlite:///:memory:")
        discover_rules()

        # Also register exploding rule
        register_rule(ExplodingRule())

        engine = FraudEngine()
        # We just verify the engine can run without crashing
        # even with an exploding rule
        from app.core.models import TransactionInput
        txn = TransactionInput(
            txn_id="test-isolation",
            member_id="MBR-001",
            event_ts=datetime.now(timezone.utc),
        )

        result = engine.evaluate(txn)
        # Should have results from all rules (including error for exploding)
        error_results = [r for r in result.rule_results if r.error]
        assert len(error_results) >= 1
        assert "BOOM" in error_results[0].error
