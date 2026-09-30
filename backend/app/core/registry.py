"""
Rule Registry — automatic discovery and registration of fraud rules.
The FraudEngine never hardcodes rule names; it gets them from the registry.
New rules are discovered automatically from app.rules and app.domains.* packages.
"""
from __future__ import annotations

import importlib
import logging
import pkgutil
from typing import Any

from app.core.config import AppConfig, get_config
from app.rules.base import Rule

logger = logging.getLogger(__name__)

# Global registry: rule_name → Rule instance
_registry: dict[str, Rule] = {}
_discovered = False


def register_rule(rule: Rule) -> None:
    """Manually register a rule instance."""
    _registry[rule.name] = rule
    logger.info(f"Registered rule: {rule.name} v{rule.version}")


def get_rule(name: str) -> Rule | None:
    """Get a registered rule by name."""
    return _registry.get(name)


def get_all_rules() -> dict[str, Rule]:
    """Return all registered rules."""
    return dict(_registry)


def get_enabled_rules(config: AppConfig | None = None) -> list[Rule]:
    """Return only rules whose config has enabled=True."""
    cfg = config or get_config()
    enabled = []
    for name, rule in _registry.items():
        rule_cfg = _get_rule_config(name, cfg)
        if rule_cfg and rule_cfg.get("enabled", True):
            enabled.append(rule)
        elif rule_cfg is None:
            # No specific config → enabled by default
            enabled.append(rule)
    return enabled


def get_rule_weight(rule_name: str, config: AppConfig | None = None) -> float:
    """Get the configured weight for a rule."""
    cfg = config or get_config()
    rule_cfg = _get_rule_config(rule_name, cfg)
    if rule_cfg:
        return rule_cfg.get("weight", 1.0)
    return 1.0


def get_rule_config_dict(rule_name: str, config: AppConfig | None = None) -> dict[str, Any]:
    """Get the full config dict for a rule."""
    cfg = config or get_config()
    return _get_rule_config(rule_name, cfg) or {}


def _get_rule_config(rule_name: str, cfg: AppConfig) -> dict[str, Any] | None:
    """Look up per-rule configuration by name."""
    rules_cfg = cfg.rules
    # Map rule name to config attribute
    name_map = {
        "velocity": "velocity",
        "unusual_amount": "amount",
        "geographic_anomaly": "geography",
        "duplicate_claim": "duplicate_claim",
    }
    attr = name_map.get(rule_name)
    if attr and hasattr(rules_cfg, attr):
        return getattr(rules_cfg, attr).model_dump()
    return None


def discover_rules() -> None:
    """
    Auto-discover rule modules from app.rules and app.domains.* packages.
    Each module that contains a Rule subclass will be imported, and any
    module-level RULE_INSTANCE or register() call will populate the registry.
    """
    global _discovered
    if _discovered:
        return

    # Discover from app.rules
    _discover_package("app.rules")

    # Discover from app.domains
    _discover_package("app.domains")

    _discovered = True
    logger.info(f"Rule discovery complete. {len(_registry)} rules registered: "
                f"{list(_registry.keys())}")


def _discover_package(package_name: str) -> None:
    """Recursively import all modules in a package to trigger rule registration."""
    try:
        package = importlib.import_module(package_name)
    except ImportError as e:
        logger.warning(f"Could not import package {package_name}: {e}")
        return

    if not hasattr(package, "__path__"):
        return

    for importer, modname, ispkg in pkgutil.walk_packages(
        package.__path__, prefix=package.__name__ + "."
    ):
        try:
            mod = importlib.import_module(modname)
            # Check for RULE_INSTANCE at module level
            if hasattr(mod, "RULE_INSTANCE"):
                instance = mod.RULE_INSTANCE
                if isinstance(instance, Rule) and instance.name not in _registry:
                    register_rule(instance)
        except Exception as e:
            logger.warning(f"Failed to import rule module {modname}: {e}")


def reset_registry() -> None:
    """Reset the registry — primarily for testing."""
    global _discovered
    _registry.clear()
    _discovered = False
