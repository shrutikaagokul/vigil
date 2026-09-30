"""
SQLAlchemy database setup and ORM models.
Supports SQLite (default) and PostgreSQL via connection string swap.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    Index,
    Integer,
    String,
    Text,
    create_engine,
    event,
)
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


# ── ORM Models ──────────────────────────────────────────────────────

class TransactionRecord(Base):
    __tablename__ = "transactions"

    txn_id = Column(String, primary_key=True)
    event_type = Column(String, nullable=False, default="payment")
    member_id = Column(String, nullable=False, index=True)
    provider_id = Column(String, default="")
    category = Column(String, default="")
    amount = Column(Float, default=0.0)
    currency = Column(String, default="USD")
    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)
    event_ts = Column(DateTime, nullable=False)
    risk_score = Column(Integer, default=0)
    risk_tier = Column(String, default="LOW")
    status = Column(String, default="CLEAN")
    alert_status = Column(String, nullable=True)
    version = Column(Integer, default=1)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc),
                        onupdate=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_member_event_ts", "member_id", "event_ts"),
        Index("ix_provider_event_ts", "provider_id", "event_ts"),
    )


class RuleResultRecord(Base):
    __tablename__ = "rule_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    txn_id = Column(String, nullable=False, index=True)
    rule_name = Column(String, nullable=False)
    rule_version = Column(String, default="1.0")
    applicable = Column(Boolean, default=True)
    triggered = Column(Boolean, default=False)
    score = Column(Float, default=0.0)
    severity = Column(String, default="NONE")
    reason = Column(Text, default="")
    evidence = Column(Text, default="{}")  # JSON string
    error = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    def get_evidence(self) -> dict:
        try:
            return json.loads(self.evidence) if self.evidence else {}
        except (json.JSONDecodeError, TypeError):
            return {}


class ReviewRecord(Base):
    __tablename__ = "reviews"

    id = Column(Integer, primary_key=True, autoincrement=True)
    txn_id = Column(String, nullable=False, index=True)
    reviewer = Column(String, nullable=False)
    from_status = Column(String, nullable=False)
    to_status = Column(String, nullable=False)
    note = Column(Text, default="")
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))


class AlertRecord(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    txn_id = Column(String, nullable=False, index=True)
    channel = Column(String, nullable=False)
    status = Column(String, default="PENDING")
    error = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=lambda: datetime.now(timezone.utc))


# ── Engine / Session factory ─────────────────────────────────────────

_engine = None
_SessionLocal = None


def _enable_sqlite_wal(dbapi_conn, connection_record):
    """Enable WAL mode for SQLite connections."""
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


def init_db(database_url: str = "sqlite:///vigil.db", echo: bool = False):
    """Initialize the database engine and create tables."""
    global _engine, _SessionLocal

    connect_args = {}
    if database_url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    _engine = create_engine(database_url, echo=echo, connect_args=connect_args)

    # Only enable WAL for file-based SQLite, not in-memory
    if database_url.startswith("sqlite") and ":memory:" not in database_url:
        event.listen(_engine, "connect", _enable_sqlite_wal)

    Base.metadata.create_all(_engine)
    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, autocommit=False)


def get_session() -> Session:
    """Get a new database session."""
    if _SessionLocal is None:
        init_db()
    return _SessionLocal()


def get_engine():
    return _engine
