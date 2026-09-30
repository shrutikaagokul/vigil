"""
Tests for FastAPI endpoints.
Uses TestClient with file-based SQLite in a temp dir.
"""
import os
import tempfile
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
    """Fresh DB and engine for each test."""
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


def _normal_txn(txn_id="TXN-001"):
    return {
        "txn_id": txn_id,
        "event_type": "payment",
        "member_id": "MBR-001",
        "provider_id": "PRV-001",
        "category": "office_visit",
        "amount": 150.0,
        "currency": "USD",
        "latitude": 40.7128,
        "longitude": -74.006,
        "event_ts": "2026-01-01T12:00:00Z",
    }


class TestTransactionAPI:
    def test_create_transaction(self, client):
        resp = client.post("/api/transactions", json=_normal_txn())
        assert resp.status_code == 201
        data = resp.json()
        assert data["txn_id"] == "TXN-001"
        assert "risk_score" in data
        assert "risk_tier" in data
        assert "rule_results" in data

    def test_get_transaction(self, client):
        client.post("/api/transactions", json=_normal_txn())
        resp = client.get("/api/transactions/TXN-001")
        assert resp.status_code == 200
        assert resp.json()["txn_id"] == "TXN-001"

    def test_get_nonexistent(self, client):
        resp = client.get("/api/transactions/NOPE")
        assert resp.status_code == 404

    def test_list_transactions(self, client):
        client.post("/api/transactions", json=_normal_txn("TXN-A"))
        client.post("/api/transactions", json={**_normal_txn("TXN-B"),
                                                "event_ts": "2026-01-02T12:00:00Z"})
        resp = client.get("/api/transactions")
        assert resp.status_code == 200
        assert len(resp.json()) == 2

    def test_filter_by_status(self, client):
        client.post("/api/transactions", json=_normal_txn())
        resp = client.get("/api/transactions?status=CLEAN")
        assert resp.status_code == 200

    def test_risk_endpoint(self, client):
        client.post("/api/transactions", json=_normal_txn())
        resp = client.get("/api/transactions/TXN-001/risk")
        assert resp.status_code == 200
        data = resp.json()
        assert "rule_results" in data


class TestIdempotency:
    def test_duplicate_txn_id(self, client):
        resp1 = client.post("/api/transactions", json=_normal_txn())
        resp2 = client.post("/api/transactions", json=_normal_txn())
        assert resp1.status_code == 201
        assert resp2.status_code == 201
        assert resp1.json()["txn_id"] == resp2.json()["txn_id"]
        resp = client.get("/api/transactions")
        assert len(resp.json()) == 1


class TestRulesEndpoint:
    def test_list_rules(self, client):
        resp = client.get("/api/rules")
        assert resp.status_code == 200
        rules = resp.json()
        names = [r["name"] for r in rules]
        assert "velocity" in names
        assert "unusual_amount" in names
        assert "geographic_anomaly" in names


class TestDashboard:
    def test_metrics(self, client):
        client.post("/api/transactions", json=_normal_txn())
        resp = client.get("/api/dashboard/metrics")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_transactions"] == 1


class TestSimulate:
    def test_normal_scenario(self, client):
        resp = client.post("/api/simulate?scenario=normal")
        assert resp.status_code == 200
        data = resp.json()
        assert data["scenario"] == "normal"
        assert data["transactions_created"] >= 1

    def test_unknown_scenario(self, client):
        resp = client.post("/api/simulate?scenario=unknown")
        assert resp.status_code == 400

    def test_list_scenarios(self, client):
        resp = client.get("/api/simulate/scenarios")
        assert resp.status_code == 200
        scenarios = resp.json()
        assert len(scenarios) >= 5
        ids = [s["id"] for s in scenarios]
        assert "normal" in ids
        assert "velocity_burst" in ids
        assert "huge_amount" in ids
        assert "impossible_travel" in ids
        assert "duplicate_claim" in ids


class TestReviewHistory:
    def test_review_history_endpoint(self, client):
        client.post("/api/transactions", json=_normal_txn())
        # First check empty review history
        resp = client.get("/api/transactions/TXN-001/reviews")
        assert resp.status_code == 200
        assert resp.json() == []

        # Perform review
        # First artificially flag it by creating another transaction with high score,
        # or directly review if flagged. Let's run a burst to get FLAGGED.
        client.post("/api/simulate?scenario=velocity_burst")
        txns = client.get("/api/transactions?status=FLAGGED").json()
        assert len(txns) > 0
        flagged_id = txns[0]["txn_id"]

        review_resp = client.patch(
            f"/api/transactions/{flagged_id}/review",
            json={
                "to_status": "REVIEWED",
                "reviewer": "investigator_alice",
                "note": "Confirmed legitimate burst from mobile app reconnect",
                "expected_version": 1,
            },
        )
        assert review_resp.status_code == 200

        # Now get review audit history
        history_resp = client.get(f"/api/transactions/{flagged_id}/reviews")
        assert history_resp.status_code == 200
        history = history_resp.json()
        assert len(history) == 1
        assert history[0]["reviewer"] == "investigator_alice"
        assert history[0]["from_status"] == "FLAGGED"
        assert history[0]["to_status"] == "REVIEWED"
        assert history[0]["note"] == "Confirmed legitimate burst from mobile app reconnect"


class TestDemoSeedReset:
    def test_demo_seed_and_reset(self, client):
        resp = client.post("/api/demo/seed")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "seeded"
        assert data["transactions_evaluated"] > 10

        metrics = client.get("/api/dashboard/metrics").json()
        assert metrics["total_transactions"] > 10
        assert metrics["flagged"] > 0

        # Reset without re-seeding
        reset_resp = client.post("/api/demo/reset?seed=false")
        assert reset_resp.status_code == 200
        assert reset_resp.json()["status"] == "cleared"

        metrics_after = client.get("/api/dashboard/metrics").json()
        assert metrics_after["total_transactions"] == 0


class TestAppFactory:
    def test_app_factory_health_and_console(self, tmp_path):
        from app.main import create_app
        # point db to temp
        db_path = str(tmp_path / "factory.db")
        from app.core.config import set_config, AppConfig
        cfg = AppConfig()
        cfg.database.url = f"sqlite:///{db_path}"
        set_config(cfg)

        app = create_app()
        tc = TestClient(app)
        h_resp = tc.get("/health")
        assert h_resp.status_code == 200
        assert h_resp.json()["status"] == "ok"

        c_resp = tc.get("/")
        assert c_resp.status_code == 200
        assert "VIGIL" in c_resp.text

        docs_resp = tc.get("/docs")
        assert docs_resp.status_code == 200
