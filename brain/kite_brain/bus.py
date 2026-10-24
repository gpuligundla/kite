import asyncio
from collections import defaultdict, deque
from collections.abc import AsyncIterator

from kite_brain.contract import Audience, DeviceKind, KiteEvent

BUFFER_SIZE = 100

# Which audiences each device kind may receive. The counselor never sees kid or
# parent events, and the parent never sees counselor ones.
AUDIENCES: dict[DeviceKind, set[Audience]] = {
    "os": {"kid"},
    "handheld": {"kid"},
    "parent": {"kid", "parent"},
    "counselor": {"counselor"},
}


def visible_to(kind: DeviceKind, audience: Audience) -> bool:
    return audience in AUDIENCES[kind]


class EventBus:
    """Per-kid event ids, a replay buffer, and live fan-out. Not thread-safe: publish
    and subscribe must run on the event loop."""

    def __init__(self) -> None:
        self._next_id: defaultdict[str, int] = defaultdict(lambda: 1)
        self._buffer: defaultdict[str, deque[KiteEvent]] = defaultdict(
            lambda: deque(maxlen=BUFFER_SIZE)
        )
        self._queues: defaultdict[str, set[asyncio.Queue[KiteEvent]]] = defaultdict(set)

    def publish(self, event: KiteEvent) -> KiteEvent:
        event = event.model_copy(update={"id": self._next_id[event.kid_id]})
        self._next_id[event.kid_id] += 1
        self._buffer[event.kid_id].append(event)
        for queue in self._queues[event.kid_id]:
            queue.put_nowait(event)
        return event

    async def subscribe(
        self, kid_id: str, kind: DeviceKind, last_event_id: int | None
    ) -> AsyncIterator[KiteEvent]:
        queue: asyncio.Queue[KiteEvent] = asyncio.Queue()
        # Snapshot and register with no await between them, so no event is lost or doubled.
        replay = [e for e in self._buffer[kid_id] if e.id > (last_event_id or 0)]
        self._queues[kid_id].add(queue)
        try:
            for event in replay:
                if visible_to(kind, event.audience):
                    yield event
            while True:
                event = await queue.get()
                if visible_to(kind, event.audience):
                    yield event
        finally:
            self._queues[kid_id].discard(queue)
