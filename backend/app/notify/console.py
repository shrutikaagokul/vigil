"""
Console Notifier — logs alerts to stdout/stderr.
Used as fallback when SNS is not configured.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from app.database.database import AlertRecord
from app.notify.base import Notifier

logger = logging.getLogger(__name__)


class ConsoleNotifier(Notifier):
    """Logs alert notifications to the console."""

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
                    logger.info(f"Alert already exists for {txn_id}, skipping.")
                    return existing.status == "SENT"

            msg = (
                f"\n{'='*60}\n"
                f"🚨 VIGIL ALERT — {risk_tier}\n"
                f"{'='*60}\n"
                f"Transaction:   {txn_id}\n"
                f"Risk Score:    {risk_score}/100\n"
                f"Risk Tier:     {risk_tier}\n"
                f"Triggered:     {', '.join(triggered_rules)}\n"
                f"Time:          {datetime.now(timezone.utc).isoformat()}\n"
                f"{'='*60}\n"
            )
            logger.warning(msg)
            print(msg)

            # Persist alert record
            if session:
                alert = AlertRecord(
                    txn_id=txn_id,
                    channel="console",
                    status="SENT",
                )
                session.add(alert)
                session.commit()

            return True
        except Exception as e:
            logger.error(f"Console notification failed: {e}")
            if session:
                try:
                    alert = AlertRecord(
                        txn_id=txn_id,
                        channel="console",
                        status="FAILED",
                        error=str(e),
                    )
                    session.add(alert)
                    session.commit()
                except Exception:
                    pass
            return False
