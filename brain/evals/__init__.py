"""Night-shift tooling: the simulator, the demo-shape check and the trust evals."""

import sqlite3

from kite_brain.bus import EventBus
from kite_brain.contract import AnswerDoneEvent, KiteEvent, RoutedEvent


def backup(src: str, dst: str) -> None:
    """Copy a live database with SQLite's backup API, which is safe while WAL is on."""
    source, target = sqlite3.connect(src), sqlite3.connect(dst)
    with target:
        source.backup(target)
    source.close()
    target.close()


class TapBus(EventBus):
    """An event bus that also keeps what a turn published, so the caller can read the
    answer and the route without a subscriber."""

    def __init__(self) -> None:
        super().__init__()
        self.events: list[KiteEvent] = []

    def publish(self, event: KiteEvent) -> KiteEvent:
        event = super().publish(event)
        self.events.append(event)
        return event

    def take(self) -> list[KiteEvent]:
        taken, self.events = self.events, []
        return taken


def answer_of(events: list[KiteEvent]) -> str:
    return next((e.text for e in events if isinstance(e, AnswerDoneEvent) and e.audience == "kid"), "")


def routed_of(events: list[KiteEvent]) -> RoutedEvent | None:
    return next((e for e in events if isinstance(e, RoutedEvent)), None)
