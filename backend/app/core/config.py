"""
VIGIL configuration management.
Loads from config.yaml + environment variables.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

_PROJECT_ROOT = Path(__file__).resolve().parents[3]  # vigil/
_DEFAULT_CONFIG = _PROJECT_ROOT / "config.yaml"


# ── per-rule configuration ──────────────────────────────────────────
class VelocityConfig(BaseModel):
    enabled: bool = True
    window_minutes: int = 5
    max_transactions: int = 5
    weight: float = 1.0


class AmountConfig(BaseModel):
    enabled: bool = True
    min_history: int = 5
    z_low: float = 3.0
    z_high: float = 6.0
    cold_start_threshold: float = 10000.0
    weight: float = 1.0


class GeographyConfig(BaseModel):
    enabled: bool = True
    min_distance_km: float = 50.0
    speed_low_kmh: float = 800.0
    speed_high_kmh: float = 1500.0
    weight: float = 1.0


class DuplicateClaimConfig(BaseModel):
    enabled: bool = True
    window_days: int = 7
    weight: float = 0.8


class RulesConfig(BaseModel):
    velocity: VelocityConfig = Field(default_factory=VelocityConfig)
    amount: AmountConfig = Field(default_factory=AmountConfig)
    geography: GeographyConfig = Field(default_factory=GeographyConfig)
    duplicate_claim: DuplicateClaimConfig = Field(default_factory=DuplicateClaimConfig)


# ── scoring thresholds ──────────────────────────────────────────────
class ScoringConfig(BaseModel):
    low_threshold: float = 0.30
    medium_threshold: float = 0.60
    high_threshold: float = 0.85
    min_individual_score_for_high: float = 0.5


# ── notifications ───────────────────────────────────────────────────
class NotificationConfig(BaseModel):
    mode: str = "console"  # "console" | "sns"
    sns_topic_arn: str = ""
    sns_region: str = "us-east-1"
    alert_tiers: list[str] = Field(default_factory=lambda: ["HIGH", "CRITICAL"])
    console_url: str = "http://localhost:5173"


# ── database ────────────────────────────────────────────────────────
class DatabaseConfig(BaseModel):
    url: str = "sqlite:///vigil.db"
    echo: bool = False


# ── top-level ───────────────────────────────────────────────────────
class AppConfig(BaseModel):
    app_name: str = "VIGIL"
    version: str = "0.1.0"
    debug: bool = False
    database: DatabaseConfig = Field(default_factory=DatabaseConfig)
    rules: RulesConfig = Field(default_factory=RulesConfig)
    scoring: ScoringConfig = Field(default_factory=ScoringConfig)
    notification: NotificationConfig = Field(default_factory=NotificationConfig)


def load_config(path: str | Path | None = None) -> AppConfig:
    """Load configuration from YAML file, then overlay environment variables."""
    cfg_path = Path(path) if path else _DEFAULT_CONFIG
    data: dict[str, Any] = {}
    if cfg_path.exists():
        with open(cfg_path) as f:
            data = yaml.safe_load(f) or {}

    # Environment overrides
    if db_url := os.getenv("DATABASE_URL"):
        data.setdefault("database", {})["url"] = db_url
    if mode := os.getenv("NOTIFICATION_MODE"):
        data.setdefault("notification", {})["mode"] = mode
    if arn := os.getenv("SNS_TOPIC_ARN"):
        data.setdefault("notification", {})["sns_topic_arn"] = arn
    if region := os.getenv("AWS_DEFAULT_REGION"):
        data.setdefault("notification", {})["sns_region"] = region
    if os.getenv("DEBUG"):
        data["debug"] = True

    return AppConfig(**data)


# Module-level singleton (lazy)
_config: AppConfig | None = None


def get_config() -> AppConfig:
    global _config
    if _config is None:
        _config = load_config()
    return _config


def set_config(cfg: AppConfig) -> None:
    global _config
    _config = cfg
