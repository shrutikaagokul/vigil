"""
VIGIL — Explainable Fraud Rule Engine
FastAPI application entry point.
"""
from __future__ import annotations

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse

from app.api.routes import router, set_engine
from app.core.config import get_config, load_config, set_config
from app.core.engine import FraudEngine
from app.core.registry import discover_rules
from app.database.database import init_db
from app.notify.console import ConsoleNotifier
from app.notify.sns import SNSNotifier
from app.static_console import TEST_CONSOLE_HTML

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


def create_app() -> FastAPI:
    """Application factory."""
    cfg = load_config()
    set_config(cfg)

    # Initialize database
    init_db(cfg.database.url, cfg.database.echo)
    logger.info(f"Database initialized: {cfg.database.url}")

    # Initialize notifier
    if cfg.notification.mode == "sns":
        notifier = SNSNotifier(
            topic_arn=cfg.notification.sns_topic_arn,
            region=cfg.notification.sns_region,
            console_url=cfg.notification.console_url,
        )
        logger.info("Notification mode: AWS SNS")
    else:
        notifier = ConsoleNotifier()
        logger.info("Notification mode: Console")

    # Discover rules
    discover_rules()

    # Initialize engine
    engine = FraudEngine(config=cfg, notifier=notifier)
    set_engine(engine)

    # Create FastAPI app
    app = FastAPI(
        title="VIGIL — Fraud Rule Engine",
        description="Explainable fraud detection with auto-discovered rules, risk scoring, and review workflow.",
        version=cfg.version,
    )

    # CORS for frontend
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(router, prefix="/api")

    @app.get("/health")
    def health():
        return {"status": "ok", "version": cfg.version}

    @app.get("/", response_class=HTMLResponse)
    def verification_console():
        return HTMLResponse(content=TEST_CONSOLE_HTML)

    @app.get("/console", response_class=HTMLResponse)
    def verification_console_alt():
        return HTMLResponse(content=TEST_CONSOLE_HTML)

    return app


app = create_app()
