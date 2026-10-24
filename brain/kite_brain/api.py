import asyncio
import sqlite3
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI

from kite_brain.auth import RateLimiter, require
from kite_brain.bus import EventBus
from kite_brain.config import get_settings
from kite_brain.db import connect, init_db
from kite_brain.memory.ledger import purge_loop
from kite_brain.routers import stream


def create_app(conn: sqlite3.Connection | None = None) -> FastAPI:
    """Pass `conn` to use an existing database; otherwise startup opens KITE_DB_PATH."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if conn is None:
            path = get_settings().KITE_DB_PATH
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            app.state.conn = connect(path)
            init_db(app.state.conn)
        purge = asyncio.create_task(purge_loop(app.state.conn))
        yield
        purge.cancel()

    app = FastAPI(title="Kite brain", lifespan=lifespan)
    if conn is not None:
        app.state.conn = conn
    app.state.bus = EventBus()
    app.state.limiter = RateLimiter()
    app.include_router(stream.router)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/kids/{kid_id}/dashboard", dependencies=[require("parent")])
    def dashboard(kid_id: str) -> dict:
        return {}  # Task 21 replaces this stub

    return app


app = create_app()
