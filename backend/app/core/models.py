"""
Pydantic models for API request/response and domain objects.
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ── Enums ────────────────────────────────────────────────────────────
class RiskTier(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TransactionStatus(str, Enum):
    CLEAN = "CLEAN"
    FLAGGED = "FLAGGED"
    REVIEWED = "REVIEWED"
    CLEARED = "CLEARED"


class AlertStatus(str, Enum):
    PENDING = "PENDING"
    SENT = "SENT"
    FAILED = "FAILED"


class Severity(str, Enum):
    NONE = "NONE"
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


# ── Rule Result ──────────────────────────────────────────────────────
class RuleResult(BaseModel):
    """Explainable result from a single rule evaluation."""
    rule_name: str
    rule_version: str = "1.0"
    applicable: bool = True
    triggered: bool = False
    score: float = Field(default=0.0, ge=0.0, le=1.0)
    severity: Severity = Severity.NONE
    reason: str = ""
    evidence: dict[str, Any] = Field(default_factory=dict)
    metadata: dict[str, Any] = Field(default_factory=dict)
    error: Optional[str] = None


# ── Transaction Input ────────────────────────────────────────────────
class TransactionInput(BaseModel):
    """Incoming transaction for evaluation."""
    txn_id: str
    event_type: str = "payment"
    member_id: str
    provider_id: str = ""
    category: str = ""
    amount: float = 0.0
    currency: str = "USD"
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    event_ts: datetime
    metadata: dict[str, Any] = Field(default_factory=dict)


# ── Risk Assessment Response ────────────────────────────────────────
class RiskAssessment(BaseModel):
    """Full risk assessment returned after evaluation."""
    txn_id: str
    risk_score: int = Field(ge=0, le=100)
    risk_tier: RiskTier
    status: TransactionStatus
    rule_results: list[RuleResult]
    alert_sent: bool = False
    evaluated_at: datetime


# ── Transaction Response ─────────────────────────────────────────────
class TransactionResponse(BaseModel):
    txn_id: str
    event_type: str
    member_id: str
    provider_id: str
    category: str
    amount: float
    currency: str
    latitude: Optional[float]
    longitude: Optional[float]
    event_ts: datetime
    risk_score: int
    risk_tier: RiskTier
    status: TransactionStatus
    alert_status: Optional[str]
    version: int
    created_at: datetime
    updated_at: datetime
    rule_results: list[RuleResult] = Field(default_factory=list)


# ── Review Request ───────────────────────────────────────────────────
class ReviewRequest(BaseModel):
    to_status: TransactionStatus
    reviewer: str
    note: str = ""
    expected_version: int


class ReviewResponse(BaseModel):
    txn_id: str
    from_status: TransactionStatus
    to_status: TransactionStatus
    reviewer: str
    note: str
    reviewed_at: datetime
    new_version: int


# ── Alert Response ───────────────────────────────────────────────────
class AlertResponse(BaseModel):
    id: int
    txn_id: str
    channel: str
    status: AlertStatus
    error: Optional[str]
    timestamp: datetime


# ── Rule Info ─────────────────────────────────────────────────────────
class RuleInfo(BaseModel):
    name: str
    version: str
    description: str
    entity_key: str
    enabled: bool
    weight: float
    config: dict[str, Any] = Field(default_factory=dict)


# ── Dashboard Metrics ────────────────────────────────────────────────
class DashboardMetrics(BaseModel):
    total_transactions: int = 0
    flagged: int = 0
    reviewed: int = 0
    cleared: int = 0
    clean: int = 0
    by_tier: dict[str, int] = Field(default_factory=dict)
    by_rule: dict[str, int] = Field(default_factory=dict)
    avg_risk_score: float = 0.0
    alert_count: int = 0


# ── Simulate Request ─────────────────────────────────────────────────
class SimulateResponse(BaseModel):
    scenario: str
    transactions_created: int
    results: list[RiskAssessment]


class ScenarioDescription(BaseModel):
    id: str
    name: str
    description: str
    transaction_count: int


class ReviewHistoryItem(BaseModel):
    id: int
    txn_id: str
    reviewer: str
    from_status: TransactionStatus
    to_status: TransactionStatus
    note: str
    timestamp: datetime
