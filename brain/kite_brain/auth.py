import hashlib
import sqlite3
import time
from collections import defaultdict, deque
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request

from kite_brain.contract import DeviceKind

RATE_LIMIT = 300
RATE_WINDOW_S = 60
RATE_EXEMPT_PREFIX = "/creations/"  # unguessable-id cartoons, not kid data


@dataclass
class Device:
    id: str
    kid_id: str
    kind: DeviceKind


class RateLimiter:
    def __init__(self) -> None:
        self._hits: defaultdict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str) -> bool:
        hits, now = self._hits[key], time.monotonic()
        while hits and now - hits[0] > RATE_WINDOW_S:
            hits.popleft()
        if len(hits) >= RATE_LIMIT:
            return False
        hits.append(now)
        return True


def _token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip()
    return request.cookies.get("kite_token")


def lookup(conn: sqlite3.Connection, token: str) -> Device | None:
    row = conn.execute(
        "SELECT id, kid_id, kind FROM device WHERE token_hash = ?",
        (hashlib.sha256(token.encode()).hexdigest(),),
    ).fetchone()
    return Device(row["id"], row["kid_id"], row["kind"]) if row else None


def require(*kinds: DeviceKind):
    """Dependency for every endpoint. 401: no or unknown token. 403: wrong kind, or a
    kid_id in the path that isn't this device's kid. 429: over the rate limit."""

    def dependency(request: Request) -> Device:
        token = _token(request)
        device = lookup(request.app.state.conn, token) if token else None
        if device is None:
            raise HTTPException(401, "missing or unknown device token")
        if kinds and device.kind not in kinds:
            raise HTTPException(403, f"{device.kind} devices can't use this endpoint")
        if request.path_params.get("kid_id", device.kid_id) != device.kid_id:
            raise HTTPException(403, "this device belongs to another kid")
        exempt = request.url.path.startswith(RATE_EXEMPT_PREFIX)
        if not exempt and not request.app.state.limiter.allow(device.id):
            raise HTTPException(429, "rate limit: 300 requests a minute")
        return device

    return Depends(dependency)
