import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from functools import partial
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException

from kite_brain.auth import RateLimiter, require
from kite_brain.bus import EventBus
from kite_brain.catalog import VECTORS_PATH, Catalog
from kite_brain import config
from kite_brain.config import DECIDE_TIMEOUT_S, Settings, get_settings
from kite_brain.crypto import FamilyKeys, master_key
from kite_brain.db import connect, init_db
from kite_brain.decide import HaikuBackend, decide, foundry_backend, openrouter_backend
from kite_brain.deps import Deps
from kite_brain.homework import load_assignments, store_assignments
from kite_brain.llm import FoundryLlm
from kite_brain.memory.embed import FoundryEmbed
from kite_brain.memory.ledger import purge_loop
from kite_brain.policy import collab_log, fk_grade
from kite_brain.routers import counselor, creations, dashboard, games, kids, stream, turns
from kite_brain.safety import AzureSafety
from kite_brain.voice import ElevenTts, ScribeStt
from kite_brain.studio.store import seed_showcase


async def _no_embed(texts: list[str]) -> np.ndarray:
    raise RuntimeError("no embedding deployment configured")


def build_deps(conn: sqlite3.Connection, bus: EventBus, settings: Settings) -> Deps:
    """The real clients. A backend with no key is left out, so with no keys at all every
    turn takes the fallback path and the server still starts."""
    llm = FoundryLlm(settings)
    backends = []
    if settings.FOUNDRY_KEY and settings.DECISION_DEPLOYMENT:
        backends.append(foundry_backend(settings.FOUNDRY_ENDPOINT, settings.FOUNDRY_KEY, settings.DECISION_DEPLOYMENT))
    if settings.OPENROUTER_KEY:
        backends.append(openrouter_backend(settings.OPENROUTER_KEY))
    if settings.FOUNDRY_KEY:
        backends.append(HaikuBackend(llm))
    catalog = Catalog.load()
    if Path(VECTORS_PATH).exists():
        catalog.vectors = np.load(VECTORS_PATH)
    return Deps(
        conn=conn,
        keys=FamilyKeys(conn, master_key(settings.KITE_MASTER_KEY)),
        bus=bus,
        catalog=catalog,
        decide=partial(decide, backends=backends, timeout_s=DECIDE_TIMEOUT_S),
        llm=llm,
        embed=FoundryEmbed(settings) if settings.FOUNDRY_KEY else _no_embed,
        safety=AzureSafety(settings),
        stt=ScribeStt(settings.ELEVENLABS_API_KEY),
        tts=ElevenTts(settings.ELEVENLABS_API_KEY),
        clock=lambda: datetime.now(timezone.utc),
    )


def create_app(conn: sqlite3.Connection | None = None) -> FastAPI:
    """Pass `conn` to use an existing database; otherwise startup opens KITE_DB_PATH."""

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        settings = get_settings()
        if conn is None:
            Path(settings.KITE_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
            app.state.conn = connect(settings.KITE_DB_PATH)
            init_db(app.state.conn)
        app.state.deps = build_deps(app.state.conn, app.state.bus, settings)
        now = datetime.now(timezone.utc)
        for kid in app.state.conn.execute("SELECT id FROM kid").fetchall():
            await store_assignments(app.state.deps, kid["id"], load_assignments(kid["id"], now))
        fk_grade("Warm up the reading-level dictionaries.")
        collab_log()
        seed_showcase()
        purge = asyncio.create_task(purge_loop(app.state.conn))
        yield
        purge.cancel()

    app = FastAPI(title="Kite brain", lifespan=lifespan)
    if conn is not None:
        app.state.conn = conn
    app.state.bus = EventBus()
    app.state.limiter = RateLimiter()
    app.add_middleware(turns.UploadCap)
    for router in (
        stream.router, turns.router, kids.router, games.router, creations.router, dashboard.router, counselor.router,
    ):
        app.include_router(router)

    @app.get("/health")
    def health() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/trust", dependencies=[require("parent")])
    def trust() -> dict:
        """The eval results the Trust tab draws, from the files the night shift writes."""
        out = {}
        for key in ("scorecard", "readability"):
            path = config.TRUST_DIR / f"{key}.json"
            try:
                out[key] = json.loads(path.read_text())
            except FileNotFoundError:
                raise HTTPException(404, f"{path.name} not found: run the night shift to produce docs/trust/") from None
        return out

    return app


app = create_app()
