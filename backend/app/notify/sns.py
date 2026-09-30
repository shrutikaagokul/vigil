"""
SNS Notifier — sends alerts via AWS SNS.
Falls back gracefully when AWS credentials are unavailable.
Payload contains NO personal identifying information.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime, timezone

from app.database.database import AlertRecord
from app.notify.base import Notifier

logger = logging.getLogger(__name__)


class SNSNotifier(Notifier):
    """Sends alert notifications via AWS SNS."""

    def __init__(self, topic_arn: str = "", region: str = "us-east-1", console_url: str = ""):
        self.topic_arn = topic_arn or os.getenv("SNS_TOPIC_ARN", "")
        self.region = region or os.getenv("AWS_DEFAULT_REGION", "us-east-1")
        self.console_url = console_url
        self._client = None

    def _get_client(self):
        if self._client is None:
            import boto3
            self._client = boto3.client("sns", region_name=self.region)
        return self._client

    def send_alert(
        self,
        txn_id: str,
        risk_score: int,
        risk_tier: str,
        triggered_rules: list[str],
        session=None,
    ) -> bool:
        try:
            # Check for duplicate alert
            if session:
                existing = session.query(AlertRecord).filter_by(txn_id=txn_id).first()
                if existing:
                    logger.info(f"Alert already exists for {txn_id}, skipping SNS.")
                    return existing.status == "SENT"

            if not self.topic_arn:
                logger.warning("SNS_TOPIC_ARN not configured. Alert not sent.")
                self._persist_alert(session, txn_id, "FAILED", "SNS_TOPIC_ARN not configured")
                return False

            # NO personal data in payload
            message = {
                "txn_id": txn_id,
                "risk_score": risk_score,
                "risk_tier": risk_tier,
                "triggered_rules": triggered_rules,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            if self.console_url:
                message["console_url"] = f"{self.console_url}/transactions/{txn_id}"

            client = self._get_client()
            response = client.publish(
                TopicArn=self.topic_arn,
                Subject=f"VIGIL Alert: {risk_tier} risk transaction {txn_id}",
                Message=json.dumps(message, indent=2),
            )

            logger.info(f"SNS alert sent for {txn_id}: {response.get('MessageId')}")
            self._persist_alert(session, txn_id, "SENT")
            return True

        except Exception as e:
            logger.error(f"SNS notification failed for {txn_id}: {e}", exc_info=True)
            self._persist_alert(session, txn_id, "FAILED", str(e))
            return False

    @staticmethod
    def _persist_alert(session, txn_id: str, status: str, error: str | None = None):
        if session:
            try:
                alert = AlertRecord(
                    txn_id=txn_id,
                    channel="sns",
                    status=status,
                    error=error,
                )
                session.add(alert)
                session.commit()
            except Exception as e:
                logger.error(f"Failed to persist alert record: {e}")
