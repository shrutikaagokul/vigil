"""
Tests for risk scoring module.
"""
import pytest

from app.core.config import AppConfig, set_config
from app.core.models import RuleResult
from app.core.scoring import aggregate_risk


@pytest.fixture(autouse=True)
def _set_config():
    set_config(AppConfig())


class TestAggregateRisk:
    def test_empty(self):
        score, tier = aggregate_risk([])
        assert score == 0
        assert tier.value == "LOW"

    def test_single_zero(self):
        results = [RuleResult(rule_name="x", score=0.0, applicable=True)]
        score, tier = aggregate_risk(results)
        assert score == 0
        assert tier.value == "LOW"

    def test_single_one(self):
        results = [RuleResult(rule_name="x", score=1.0, applicable=True)]
        score, tier = aggregate_risk(results)
        assert score == 100
        assert tier.value == "CRITICAL"

    def test_three_rules_known(self):
        """v=0.5, a=0.3, g=0.0 → 1-(0.5*0.7*1.0) = 0.65"""
        results = [
            RuleResult(rule_name="velocity", score=0.5, applicable=True),
            RuleResult(rule_name="unusual_amount", score=0.3, applicable=True),
            RuleResult(rule_name="geographic_anomaly", score=0.0, applicable=True),
        ]
        score, tier = aggregate_risk(results)
        assert score == 65
        assert tier.value == "HIGH"

    def test_guard_prevents_high_from_weak_signals(self):
        """Many 0.4 scores → high aggregate but guard kicks in."""
        results = [
            RuleResult(rule_name=f"r{i}", score=0.4, applicable=True)
            for i in range(5)
        ]
        score, tier = aggregate_risk(results)
        # 1-(0.6^5) = 0.922 → would be CRITICAL, but max=0.4 < 0.5 → MEDIUM
        assert tier.value == "MEDIUM"

    def test_guard_allows_high_with_strong_signal(self):
        results = [
            RuleResult(rule_name="a", score=0.7, applicable=True),
            RuleResult(rule_name="b", score=0.3, applicable=True),
        ]
        score, tier = aggregate_risk(results)
        # 1-(0.3*0.7) = 0.79 → HIGH tier, max=0.7 >= 0.5 → allowed
        assert tier.value == "HIGH"

    def test_tiers(self):
        """Verify each tier boundary."""
        # < 0.30 → LOW
        r = [RuleResult(rule_name="x", score=0.2, applicable=True)]
        _, tier = aggregate_risk(r)
        assert tier.value == "LOW"

        # 0.30 - 0.60 → MEDIUM
        r = [RuleResult(rule_name="x", score=0.45, applicable=True)]
        _, tier = aggregate_risk(r)
        assert tier.value == "MEDIUM"

        # 0.60 - 0.85 → HIGH (with sufficient individual score)
        r = [RuleResult(rule_name="x", score=0.7, applicable=True)]
        _, tier = aggregate_risk(r)
        assert tier.value == "HIGH"

        # >= 0.85 → CRITICAL
        r = [RuleResult(rule_name="x", score=0.95, applicable=True)]
        _, tier = aggregate_risk(r)
        assert tier.value == "CRITICAL"
