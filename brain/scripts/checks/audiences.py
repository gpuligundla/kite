"""Audience filtering, replay and auth. Run: uv run python -m scripts.checks.audiences"""

import asyncio
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from kite_brain.api import create_app
from kite_brain.bus import EventBus, visible_to
from kite_brain.contract import AnswerSentenceEvent, RoutedEvent
from kite_brain.crypto import FamilyKeys, new_key
from kite_brain.db import connect, init_db
from kite_brain.seed import seed

# kind -> audiences it may receive. The whole safety claim in one table.
TABLE = {
    "os": {"kid": True, "parent": False, "counselor": False},
    "handheld": {"kid": True, "parent": False, "counselor": False},
    "parent": {"kid": False, "parent": True, "counselor": False},
    "counselor": {"kid": False, "parent": False, "counselor": True},
}


def check_visible_to_table() -> None:
    for kind, row in TABLE.items():
        for audience, expected in row.items():
            assert visible_to(kind, audience) is expected, f"{kind} seeing {audience} must be {expected}"


def event(cls, audience: str, **fields):
    return cls(kid_id="maya", turn_id="t1", at=datetime.now(timezone.utc), audience=audience, **fields)


def sentence(i: int, audience: str = "kid"):
    return event(AnswerSentenceEvent, audience, index=i, text=f"s{i}", audio_b64="")


async def drain(bus: EventBus, kind: str, last_event_id: int | None = None) -> list:
    """What a subscriber receives from the buffer, then stop waiting for live events."""
    got = []
    stream = bus.subscribe("maya", kind, last_event_id)
    try:
        while True:
            got.append(await asyncio.wait_for(anext(stream), timeout=0.05))
    except TimeoutError:
        await stream.aclose()
    return got


def check_bus() -> None:
    bus = EventBus()
    bus.publish(sentence(0))
    bus.publish(event(RoutedEvent, "parent", route="answer"))
    bus.publish(event(RoutedEvent, "counselor", route="alert"))
    types = lambda evts: [(e.id, e.audience) for e in evts]  # noqa: E731
    assert types(asyncio.run(drain(bus, "parent"))) == [(2, "parent")], "parent: its own copies only"
    assert types(asyncio.run(drain(bus, "os"))) == [(1, "kid")], "kid device: kid events only"
    assert types(asyncio.run(drain(bus, "counselor"))) == [(3, "counselor")], "counselor: its own only"

    bus = EventBus()
    for i in range(5):
        bus.publish(sentence(i))
    assert [e.id for e in asyncio.run(drain(bus, "os", 2))] == [3, 4, 5], "replay after Last-Event-ID 2"

    for i in range(120):
        bus.publish(sentence(i))
    assert len(asyncio.run(drain(bus, "os"))) == 100, "buffer keeps the last 100"


def check_live_delivery() -> None:
    async def run() -> list[int]:
        bus = EventBus()
        stream = bus.subscribe("maya", "os", None)
        first = asyncio.ensure_future(anext(stream))
        await asyncio.sleep(0)
        bus.publish(event(RoutedEvent, "parent", route="answer"))
        bus.publish(sentence(0))
        got = [(await first).id]
        await stream.aclose()
        return got

    assert asyncio.run(run()) == [2], "a live kid subscriber skips the parent event"


def check_auth() -> None:
    conn = connect(":memory:")
    init_db(conn)
    keys = FamilyKeys(conn, new_key())
    tokens = seed(conn, keys, datetime.now(timezone.utc)).tokens
    client = TestClient(create_app(conn))
    bearer = lambda kind: {"Authorization": f"Bearer {tokens[kind]}"}  # noqa: E731

    assert client.get("/kids/maya/dashboard").status_code == 401, "no token is 401"
    assert client.get("/kids/maya/dashboard", headers={"Authorization": "Bearer nope"}).status_code == 401
    for kind in ("os", "handheld", "counselor"):
        assert client.get("/kids/maya/dashboard", headers=bearer(kind)).status_code == 403, (
            f"a {kind} token must not read the dashboard"
        )
    assert client.get("/kids/maya/dashboard", headers=bearer("parent")).status_code == 200
    assert client.get("/kids/sam/dashboard", headers=bearer("parent")).status_code == 403, "another kid is 403"
    assert client.get("/kids/maya/dashboard", cookies={"kite_token": tokens["parent"]}).status_code == 200, (
        "the cookie works"
    )

    fresh = TestClient(create_app(conn))
    statuses = [fresh.get("/kids/maya/dashboard", headers=bearer("parent")).status_code for _ in range(301)]
    assert set(statuses[:300]) == {200}, "the first 300 requests pass"
    assert statuses[300] == 429, "the 301st request in a minute is 429"


def run() -> None:
    check_visible_to_table()
    check_bus()
    check_live_delivery()
    check_auth()


if __name__ == "__main__":
    run()
    print("ok")
