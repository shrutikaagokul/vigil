"""
Tests for the notification service.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.core.config import AppConfig, set_config
from app.database.database import AlertRecord, init_db, get_session
from app.notify.console import ConsoleNotifier
from app.notify.sns import SNSNotifier


@pytest.fixture(autouse=True)
def _setup():
    set_config(AppConfig())
    init_db("sqlite:///:memory:")
    yield


class TestConsoleNotifier:
    def test_sends_alert(self, capsys):
        notifier = ConsoleNotifier()
        session = get_session()
        result = notifier.send_alert(
            txn_id="TXN-001",
            risk_score=85,
            risk_tier="HIGH",
            triggered_rules=["velocity", "unusual_amount"],
            session=session,
        )
        assert result is True
        captured = capsys.readouterr()
        assert "VIGIL ALERT" in captured.out
        assert "TXN-001" in captured.out
        session.close()

    def test_deduplication(self):
        notifier = ConsoleNotifier()
        session = get_session()
        notifier.send_alert("TXN-DUP", 90, "CRITICAL", ["velocity"], session)
        result = notifier.send_alert("TXN-DUP", 90, "CRITICAL", ["velocity"], session)
        # Second call should detect existing alert
        assert result is True  # Existing was SENT
        # Should only have 1 alert record
        count = session.query(AlertRecord).filter_by(txn_id="TXN-DUP").count()
        assert count == 1
        session.close()

    def test_persists_alert_record(self):
        notifier = ConsoleNotifier()
        session = get_session()
        notifier.send_alert("TXN-PERSIST", 85, "HIGH", ["velocity"], session)
        alert = session.query(AlertRecord).filter_by(txn_id="TXN-PERSIST").first()
        assert alert is not None
        assert alert.channel == "console"
        assert alert.status == "SENT"
        session.close()


class TestSNSNotifier:
    def test_no_topic_arn(self):
        """Without topic ARN, should fail gracefully."""
        notifier = SNSNotifier(topic_arn="")
        session = get_session()
        result = notifier.send_alert("TXN-001", 85, "HIGH", ["velocity"], session)
        assert result is False
        session.close()

    def test_sns_call(self):
        """Mock boto3 to verify SNS is called correctly."""
        notifier = SNSNotifier(topic_arn="arn:aws:sns:us-east-1:123:alerts")
        mock_client = MagicMock()
        mock_client.publish.return_value = {"MessageId": "test-123"}
        notifier._client = mock_client

        session = get_session()
        result = notifier.send_alert(
            txn_id="TXN-SNS",
            risk_score=92,
            risk_tier="CRITICAL",
            triggered_rules=["velocity", "geographic_anomaly"],
            session=session,
        )
        assert result is True
        mock_client.publish.assert_called_once()

        # Verify no PII in message
        call_kwargs = mock_client.publish.call_args
        import json
        msg = json.loads(call_kwargs.kwargs.get("Message", call_kwargs[1].get("Message", "")))
        assert "member_id" not in msg
        assert "txn_id" in msg
        session.close()

    def test_sns_failure_graceful(self):
        """SNS failure should not crash."""
        notifier = SNSNotifier(topic_arn="arn:aws:sns:us-east-1:123:alerts")
        mock_client = MagicMock()
        mock_client.publish.side_effect = Exception("AWS error")
        notifier._client = mock_client

        session = get_session()
        result = notifier.send_alert("TXN-FAIL", 85, "HIGH", ["velocity"], session)
        assert result is False
        # Should persist failure
        alert = session.query(AlertRecord).filter_by(txn_id="TXN-FAIL").first()
        assert alert is not None
        assert alert.status == "FAILED"
        session.close()
