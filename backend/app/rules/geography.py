"""
Impossible Geography Rule — detects physically impossible travel between transactions.
Uses Haversine distance and implied speed calculation.
"""
from __future__ import annotations

import math
from typing import Any

from app.core.config import get_config
from app.core.models import RuleResult, Severity
from app.rules.base import Rule


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great-circle distance between two points on Earth (in km)."""
    R = 6371.0  # Earth radius in kilometers
    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)

    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r

    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))

    return R * c


class GeographicRule(Rule):
    name = "geographic_anomaly"
    version = "1.0"
    description = "Detects impossible geographic travel between consecutive transactions using Haversine distance"
    entity_key = "member_id"

    def evaluate(self, txn: dict[str, Any], ctx: Any) -> RuleResult:
        cfg = get_config().rules.geography
        min_distance = cfg.min_distance_km
        speed_low = cfg.speed_low_kmh
        speed_high = cfg.speed_high_kmh

        lat = txn.get("latitude")
        lon = txn.get("longitude")
        event_ts = txn.get("event_ts")
        entity_value = txn.get(self.entity_key, "")

        # Check if current transaction has location data
        if lat is None or lon is None:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Current transaction has no geographic coordinates.",
            )

        if not event_ts or not entity_value:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="Missing event timestamp or entity identifier.",
            )

        # Get previous transactions for this entity
        history = ctx.history(
            entity_key=self.entity_key,
            entity_value=entity_value,
            before=event_ts,
            limit=10,
        )

        # Find the most recent transaction WITH location data
        prev = None
        for h in history:
            if h.get("latitude") is not None and h.get("longitude") is not None:
                prev = h
                break

        if prev is None:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=False,
                reason="No previous transaction with geographic coordinates found.",
            )

        prev_lat = prev["latitude"]
        prev_lon = prev["longitude"]
        prev_ts = prev["event_ts"]

        # Calculate distance
        distance_km = haversine_km(prev_lat, prev_lon, lat, lon)

        # Ignore GPS jitter (very small movements)
        if distance_km < min_distance:
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=True,
                triggered=False,
                score=0.0,
                reason=f"Distance {distance_km:.1f} km is below minimum threshold ({min_distance} km). Likely GPS jitter.",
                evidence={
                    "distance_km": round(distance_km, 2),
                    "min_distance_km": min_distance,
                    "prev_latitude": prev_lat,
                    "prev_longitude": prev_lon,
                    "curr_latitude": lat,
                    "curr_longitude": lon,
                },
            )

        # Calculate time difference
        if hasattr(prev_ts, "timestamp") and hasattr(event_ts, "timestamp"):
            elapsed_seconds = (event_ts - prev_ts).total_seconds()
        else:
            elapsed_seconds = 0

        # Handle identical or very close timestamps
        if elapsed_seconds <= 0:
            # Significant distance with zero/negative time difference → impossible
            return RuleResult(
                rule_name=self.name,
                rule_version=self.version,
                applicable=True,
                triggered=True,
                score=1.0,
                severity=Severity.CRITICAL,
                reason=(
                    f"Transaction is {distance_km:,.1f} km from previous location "
                    f"with zero or negative time elapsed. Physically impossible."
                ),
                evidence={
                    "distance_km": round(distance_km, 2),
                    "elapsed_seconds": elapsed_seconds,
                    "implied_speed_kmh": float("inf"),
                    "prev_latitude": prev_lat,
                    "prev_longitude": prev_lon,
                    "curr_latitude": lat,
                    "curr_longitude": lon,
                    "prev_event_ts": str(prev_ts),
                    "curr_event_ts": str(event_ts),
                },
            )

        elapsed_hours = elapsed_seconds / 3600.0
        implied_speed = distance_km / elapsed_hours

        # Score: interpolate between speed_low and speed_high
        if implied_speed <= speed_low:
            score = 0.0
        elif implied_speed >= speed_high:
            score = 1.0
        else:
            score = (implied_speed - speed_low) / (speed_high - speed_low)

        score = round(max(0.0, min(1.0, score)), 4)
        triggered = score > 0.0

        severity = Severity.NONE
        if score >= 0.85:
            severity = Severity.CRITICAL
        elif score >= 0.6:
            severity = Severity.HIGH
        elif score >= 0.3:
            severity = Severity.MEDIUM
        elif triggered:
            severity = Severity.LOW

        time_desc = ""
        if elapsed_seconds < 60:
            time_desc = f"{elapsed_seconds:.0f} seconds"
        elif elapsed_seconds < 3600:
            time_desc = f"{elapsed_seconds / 60:.0f} minutes"
        else:
            time_desc = f"{elapsed_hours:.1f} hours"

        reason = ""
        if triggered:
            reason = (
                f"Previous transaction was {distance_km:,.1f} km away only "
                f"{time_desc} earlier (implied speed: {implied_speed:,.0f} km/h)."
            )
        else:
            reason = (
                f"Geographic movement of {distance_km:,.1f} km in {time_desc} "
                f"is within normal range ({implied_speed:,.0f} km/h)."
            )

        return RuleResult(
            rule_name=self.name,
            rule_version=self.version,
            applicable=True,
            triggered=triggered,
            score=score,
            severity=severity,
            reason=reason,
            evidence={
                "distance_km": round(distance_km, 2),
                "elapsed_seconds": round(elapsed_seconds, 2),
                "elapsed_hours": round(elapsed_hours, 4),
                "implied_speed_kmh": round(implied_speed, 2),
                "prev_latitude": prev_lat,
                "prev_longitude": prev_lon,
                "curr_latitude": lat,
                "curr_longitude": lon,
                "prev_event_ts": str(prev_ts),
                "curr_event_ts": str(event_ts),
                "speed_threshold_low": speed_low,
                "speed_threshold_high": speed_high,
            },
        )


# Auto-registration via discovery
RULE_INSTANCE = GeographicRule()
