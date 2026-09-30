"""
Shared test fixtures.
"""
import pytest

from app.core.config import AppConfig, set_config
from app.core.registry import reset_registry
from app.database.database import init_db


@pytest.fixture(autouse=True)
def _reset_state():
    """Reset global state between tests."""
    reset_registry()
    set_config(AppConfig())
    yield
    reset_registry()
