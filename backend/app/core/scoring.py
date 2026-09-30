"""
Risk Scoring — noisy-OR aggregation with explainability.
Each rule returns a score ∈ [0, 1]. We aggregate using:
    risk = 1 - ∏(1 - weight_i * score_i)
with a guard: HIGH/CRITICAL requires at least one individual rule score >= 0.5.
"""
from __future__ import annotations

from app.core.config import AppConfig, get_config
from app.core.models import RiskTier, RuleResult, Severity
from app.core.registry import get_rule_weight


def aggregate_risk(
    rule_results: list[RuleResult],
    config: AppConfig | None = None,
) -> tuple[float, RiskTier]:
    """
    Aggregate multiple rule results into a single risk score and tier.

    Returns:
        (risk_score_0_to_100, RiskTier)
    """
    cfg = config or get_config()
    scoring = cfg.scoring

    if not rule_results:
        return 0, RiskTier.LOW

    # noisy-OR aggregation
    product = 1.0
    max_individual_score = 0.0

    for result in rule_results:
        if not result.applicable:
            continue
        weight = get_rule_weight(result.rule_name, cfg)
        weighted_score = weight * result.score
        weighted_score = max(0.0, min(1.0, weighted_score))
        product *= (1.0 - weighted_score)
        max_individual_score = max(max_individual_score, result.score)

    risk = 1.0 - product
    risk = max(0.0, min(1.0, risk))

    # Determine tier
    tier = _compute_tier(risk, max_individual_score, scoring)

    risk_score = round(risk * 100)
    return risk_score, tier


def _compute_tier(risk: float, max_score: float, scoring) -> RiskTier:
    """Compute risk tier with the guard for HIGH/CRITICAL."""
    if risk >= scoring.high_threshold:
        raw_tier = RiskTier.CRITICAL
    elif risk >= scoring.medium_threshold:
        raw_tier = RiskTier.HIGH
    elif risk >= scoring.low_threshold:
        raw_tier = RiskTier.MEDIUM
    else:
        raw_tier = RiskTier.LOW

    # Guard: HIGH or CRITICAL requires at least one individual rule score >= 0.5
    if raw_tier in (RiskTier.HIGH, RiskTier.CRITICAL):
        if max_score < scoring.min_individual_score_for_high:
            raw_tier = RiskTier.MEDIUM

    return raw_tier


def score_to_severity(score: float) -> Severity:
    """Convert a 0-1 score to a severity level."""
    if score >= 0.85:
        return Severity.CRITICAL
    elif score >= 0.6:
        return Severity.HIGH
    elif score >= 0.3:
        return Severity.MEDIUM
    elif score > 0:
        return Severity.LOW
    return Severity.NONE
