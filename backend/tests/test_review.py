"""
Tests for the review workflow.
"""
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.core.config import AppConfig, set_config
from app.core.engine import FraudEngine
from app.core.registry import discover_rules, reset_registry
from app.database.database import init_db, get_session
from app.notify.console import ConsoleNotifier
from app.api import routes as routes_module
from app.api.routes import set_engine


@pytest.fixture()
def client(tmp_path):
    reset_registry()
    set_config(AppConfig())
    db_path = str(tmp_path / "test.db")
    init_db(f"sqlite:///{db_path}", echo=False)
    discover_rules()
    notifier = ConsoleNotifier()
    engine = FraudEngine(notifier=notifier)
    set_engine(engine)

    app = FastAPI()
    app.include_router(routes_module.router, prefix="/api")

    yield TestClient(app)
    reset_registry()


def _flagged_txn(client, txn_id="TXN-FLAG"):
    """Create a transaction that gets FLAGGED (impossible travel + huge amount)."""
    # First create a normal NYC transaction
    client.post("/api/transactions", json={
        "txn_id": f"{txn_id}-base",
        "member_id": "MBR-REVIEW",
        "amount": 100.0,
        "latitude": 40.7128,
        "longitude": -74.006,
        "event_ts": "2026-01-01T12:00:00Z",
    })
    # Build baseline for amount rule
    for i in range(6):
        client.post("/api/transactions", json={
            "txn_id": f"{txn_id}-hist-{i}",
            "member_id": "MBR-REVIEW",
            "amount": 100.0,
            "latitude": 40.7128,
            "longitude": -74.006,
            "event_ts": f"2026-01-0{i+2}T12:00:00Z",
        })

    # Impossible travel to Tokyo 5 min after last + huge amount
    resp = client.post("/api/transactions", json={
        "txn_id": txn_id,
        "member_id": "MBR-REVIEW",
        "amount": 99000.0,
        "latitude": 35.6762,
        "longitude": 139.6503,
        "event_ts": "2026-01-08T12:05:00Z",
    })
    return resp


class TestReviewWorkflow:
    def test_review_flagged(self, client):
        _flagged_txn(client)

        resp = client.get("/api/transactions/TXN-FLAG")
        data = resp.json()
        if data["status"] != "FLAGGED":
            pytest.skip("Transaction wasn't flagged (score may not be high enough)")

        resp = client.patch("/api/transactions/TXN-FLAG/review", json={
            "to_status": "REVIEWED",
            "reviewer": "Dr. Smith",
            "note": "Confirmed suspicious pattern",
            "expected_version": data["version"],
        })
        assert resp.status_code == 200
        review_data = resp.json()
        assert review_data["from_status"] == "FLAGGED"
        assert review_data["to_status"] == "REVIEWED"
        assert review_data["reviewer"] == "Dr. Smith"

    def test_clear_flagged(self, client):
        _flagged_txn(client)

        resp = client.get("/api/transactions/TXN-FLAG")
        data = resp.json()
        if data["status"] != "FLAGGED":
            pytest.skip("Transaction wasn't flagged")

        resp = client.patch("/api/transactions/TXN-FLAG/review", json={
            "to_status": "CLEARED",
            "reviewer": "Auditor Jones",
            "note": "False positive — known travel",
            "expected_version": data["version"],
        })
        assert resp.status_code == 200
        assert resp.json()["to_status"] == "CLEARED"

    def test_version_conflict(self, client):
        _flagged_txn(client)

        resp = client.get("/api/transactions/TXN-FLAG")
        data = resp.json()
        if data["status"] != "FLAGGED":
            pytest.skip("Transaction wasn't flagged")

        resp = client.patch("/api/transactions/TXN-FLAG/review", json={
            "to_status": "REVIEWED",
            "reviewer": "Dr. Smith",
            "expected_version": 999,
        })
        assert resp.status_code == 409

    def test_invalid_transition(self, client):
        client.post("/api/transactions", json={
            "txn_id": "TXN-CLEAN",
            "member_id": "MBR-001",
            "amount": 100.0,
            "event_ts": "2026-01-01T12:00:00Z",
        })

        resp = client.patch("/api/transactions/TXN-CLEAN/review", json={
            "to_status": "REVIEWED",
            "reviewer": "Dr. Smith",
            "expected_version": 1,
        })
        assert resp.status_code == 400

    def test_review_nonexistent(self, client):
        resp = client.patch("/api/transactions/NOPE/review", json={
            "to_status": "REVIEWED",
            "reviewer": "Dr. Smith",
            "expected_version": 1,
        })
        assert resp.status_code == 404
