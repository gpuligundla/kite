"""Homework guard claims, with the stand-ins from checks/pipeline.py.
Run from brain/: uv run python -m scripts.checks.homework

Embeddings here are one axis per distinct text, so a question that repeats an item has
cosine 1.0 and the rest are 0.0; the signal-level checks build exact cosines on top."""

import asyncio
import os
from datetime import datetime, timedelta, timezone

import numpy as np
from fastapi.testclient import TestClient

from kite_brain.api import create_app
from kite_brain.config import get_settings
from kite_brain.homework import (
    Assignment, homework_signal, load_assignments, status, store_assignments, stored_assignments,
)
from kite_brain.policy import HOMEWORK_LINES
from kite_brain.seed import KID_ID
from kite_brain.turn.route import PAUSE_REPLY
from scripts.checks.ledger import NOW, fresh
from scripts.checks.pipeline import StandIns, deps_for, make_decisions, rows, turn
from scripts.checks.voice import use_sample_voices

DIM = 256
AXES: dict[str, int] = {}
HINT = "Try multiplying the length by the width. What do you get? "
SOLUTION = "Area is length times width, so 8 times 5 is 40 square centimeters. "


def axis(text: str) -> np.ndarray:
    v = np.zeros(DIM, dtype=np.float32)
    v[AXES.setdefault(text, len(AXES))] = 1.0
    return v


async def axis_embed(texts):
    return np.array([axis(t) for t in texts])


def at_cosine(item_text: str, cosine: float) -> np.ndarray:
    """A unit vector at exactly `cosine` from the item's vector."""
    return cosine * axis(item_text) + np.sqrt(1 - cosine**2) * axis("an unrelated question")


class Tutor(StandIns):
    """A model that obeys the mode line: a hint in help mode, the full solution otherwise."""

    async def stream(self, request):
        self.llm_calls += 1
        self.requests.append(request)
        yield HINT if HOMEWORK_LINES["help"] in request.context else SOLUTION


def with_class(deps, now: datetime = NOW) -> dict[str, Assignment]:
    """Store the simulated class, as app start does. Returns it by assignment id."""
    deps.embed = axis_embed
    items = load_assignments(KID_ID, now)
    asyncio.run(store_assignments(deps, KID_ID, items))
    return {a.id.removeprefix(f"{KID_ID}-"): a for a in items}


def signal(deps, vec=None, concept=None, p=0.0, now: datetime = NOW):
    return asyncio.run(homework_signal(deps, KID_ID, vec, concept, p, now))


def check_offsets_keep_quiz_live_at_any_now() -> None:
    for now in (NOW, datetime(2016, 1, 10, tzinfo=timezone.utc), datetime(2031, 6, 30, tzinfo=timezone.utc)):
        by_id = {a.id.removeprefix(f"{KID_ID}-"): a for a in load_assignments(KID_ID, now)}
        got = {i: status(a, now) for i, a in by_id.items()}
        assert got == {"hw-area-perimeter": "open", "quiz-light-color": "closed", "quiz-water-cycle": "exam_live"}, f"{now}: {got}"
        assert all(len(a.items) >= 3 for a in by_id.values()), "every description has numbered questions"
        assert by_id["hw-area-perimeter"].due_at == now + timedelta(days=1), "homework is due tomorrow"


def check_status() -> None:
    t = NOW
    hour = timedelta(hours=1)
    def make(kind, **dates):
        return Assignment("a", "A", kind, items=(), concept_id="c", topic="t", description="", **{
            "unlock_at": None, "due_at": None, "lock_at": None} | dates)

    quiz, hw = (lambda **d: make("quiz", **d)), (lambda **d: make("homework", **d))  # noqa: E731
    cases = [
        (quiz(unlock_at=t - hour, due_at=t + hour, lock_at=t + hour), "exam_live"),
        (quiz(unlock_at=t + hour), "open"),  # not given yet: hints only, never the worked answers
        (quiz(unlock_at=t - hour, due_at=t), "closed"),
        (quiz(unlock_at=t - hour, lock_at=t), "closed"),
        (hw(due_at=t - hour), "open"),
        (hw(lock_at=t + hour), "open"),
        (hw(lock_at=t), "closed"),
    ]
    for a, want in cases:
        assert status(a, t) == want, f"{a.kind} {a} should be {want}"


def check_upsert_no_duplicates() -> None:
    stand = StandIns(decide=make_decisions())
    deps, _ = deps_for(stand)
    first = with_class(deps)
    with_class(deps, NOW + timedelta(days=1))  # a restart a day later
    assert rows(deps, "assignment") == 3, "an assignment per id, however many starts"
    assert rows(deps, "assignment_item") == sum(len(a.items) for a in first.values()), "items are not duplicated"
    quiz = next(a for a, _ in stored_assignments(deps.conn, deps.keys, KID_ID) if a.id.endswith("quiz-water-cycle"))
    assert quiz.unlock_at == NOW + timedelta(days=1, hours=-1), "dates are refreshed on every start"
    raw = b"".join(bytes(r[0]) for r in deps.conn.execute("SELECT text FROM assignment_item"))
    assert b"evaporation" not in raw.lower(), "item text is sealed"

    stand = StandIns(decide=make_decisions())
    deps, _ = deps_for(stand)

    async def down(texts):
        raise RuntimeError("no embedding deployment")

    deps.embed = down
    asyncio.run(store_assignments(deps, KID_ID, load_assignments(KID_ID, NOW)))
    assert rows(deps, "assignment") == 3 and rows(deps, "assignment_item") == 0, "stored without items when embedding is down"
    assert signal(deps, None, "water_cycle_basic").near_live_quiz, "and the quiz still pauses by concept"


def check_signals() -> None:
    stand = StandIns(decide=make_decisions())
    deps, _ = deps_for(stand)
    cls = with_class(deps)
    live_item, open_item, closed_item = (cls[i].items[0] for i in ("quiz-water-cycle", "hw-area-perimeter", "quiz-light-color"))
    quiz_title = cls["quiz-water-cycle"].title

    near = signal(deps, at_cosine(live_item, 0.65))
    assert near.near_live_quiz and near.status == "exam_live" and near.title == quiz_title, "cosine 0.65 pauses"
    assert not signal(deps, at_cosine(live_item, 0.55)).near_live_quiz, "cosine 0.55 does not"
    assert signal(deps, at_cosine(live_item, 0.6)).near_live_quiz, "0.60 itself pauses"

    assert signal(deps, None, "water_cycle_basic").near_live_quiz, "the same concept as the live quiz pauses"
    assert signal(deps, None, "water_energy").near_live_quiz, "the same topic pauses"
    assert signal(deps, None, "light_see").status is None, "another topic does not"
    assert signal(deps, None, None, 0.5).near_live_quiz, "assigned work during a live quiz pauses"
    assert signal(deps, None, None, 0.49).status is None
    hw_during_quiz = signal(deps, axis(open_item), None, 0.9)
    assert (hw_during_quiz.status, hw_during_quiz.near_live_quiz) == ("open", False), "a homework match is help during a live quiz"
    by_topic = signal(deps, at_cosine(open_item, 0.5), "ap_perimeter", 0.9)
    assert (by_topic.status, by_topic.title) == ("open", "Area and perimeter practice"), "assigned work on the homework's topic is help"
    assert signal(deps, at_cosine(open_item, 0.5), "ap_perimeter", 0.3).status is None, "the topic without assigned work is not homework"
    assert signal(deps, None, "light_see", 0.9).near_live_quiz, "a closed quiz's topic is not enough to explain, so it pauses"

    open_match = signal(deps, axis(open_item))
    assert (open_match.status, open_match.title, open_match.near_live_quiz) == ("open", "Area and perimeter practice", False)
    assert signal(deps, at_cosine(open_item, 0.8)).status == "open", "0.80 matches"
    assert signal(deps, at_cosine(open_item, 0.79)).status is None, "0.79 does not"
    closed = signal(deps, axis(closed_item))
    assert (closed.status, closed.title) == ("closed", "Light and color quiz"), "a closed quiz match is closed"

    later = NOW + timedelta(days=30)  # the water cycle quiz has locked
    unmatched = signal(deps, at_cosine(open_item, 0.3), None, 0.7, later)
    assert (unmatched.status, unmatched.title) == ("open", None), "unmatched assigned work with no live quiz is help"
    assert signal(deps, at_cosine(open_item, 0.3), None, 0.3, later).status is None, "an ordinary question is not"
    assert signal(deps, None, "water_cycle_basic", 0.0, later).status is None, "the quiz concept is fair game after it locks"


def ask(heard: str, *, stand_cls=Tutor, now=NOW, assigned=0.0, turn_id="h1"):
    decisions = make_decisions()
    decisions.answers["initiative"] = {
        "own_question": 1 - assigned, "follow_up_why": 0.0, "assigned_work": assigned,
    }
    stand = stand_cls(heard=heard, decide=decisions)
    deps, bus = deps_for(stand)
    cls = with_class(deps)
    deps.clock = lambda: now
    return stand, deps, cls, turn(deps, bus, stand, turn_id)


def routed(seen):
    return next(e for e in seen["parent"] if e.type == "routed")


def check_pipeline() -> None:
    stand = Tutor(decide=make_decisions())
    cls = with_class(deps_for(stand)[0])
    live_q, open_q, closed_q = (cls[i].items[0] for i in ("quiz-water-cycle", "hw-area-perimeter", "quiz-light-color"))

    stand, deps, _, seen = ask(live_q)
    assert routed(seen).route == "pause" and routed(seen).homework_mode == "pause", "a live-quiz question pauses"
    assert routed(seen).assignment_title == "Water cycle quiz", "routed names the quiz"
    assert stand.llm_calls == 0 and seen["os"][-1].text == PAUSE_REPLY, "a fixed reply, no model"
    assert rows(deps, "learning_event") == 0 and rows(deps, "session_turn") == 0, "nothing written, nothing reported"

    stand, deps, _, seen = ask(open_q)
    assert (routed(seen).route, routed(seen).homework_mode) == ("homework", "help"), routed(seen)
    assert routed(seen).assignment_title == "Area and perimeter practice"
    assert HOMEWORK_LINES["help"] in stand.requests[0].context, "help mode reaches the model"
    answer = seen["os"][-1].text
    assert "40" not in answer and "26" not in answer and "?" in answer, f"help gives a hint, not the answer: {answer}"

    stand, deps, _, seen = ask(closed_q)
    assert (routed(seen).route, routed(seen).homework_mode) == ("homework", "explain"), routed(seen)
    assert HOMEWORK_LINES["explain"] in stand.requests[0].context, "explain mode reaches the model"
    assert "40" in seen["os"][-1].text, "the closed quiz gets the worked solution"

    later = NOW + timedelta(days=30)
    stand, deps, _, seen = ask("My teacher gave us a worksheet", now=later, assigned=0.9)
    assert routed(seen).homework_mode == "help" and routed(seen).assignment_title is None, "unmatched assigned work is help"
    stand, deps, _, seen = ask("My teacher gave us a worksheet", assigned=0.9)
    assert routed(seen).route == "pause" and stand.llm_calls == 0, "assigned work during a live quiz pauses"


def check_startup_upserts() -> None:
    """Entering the app's lifespan resolves the offsets and stores the class, twice over without duplicates."""
    conn, keys = fresh()
    saved = {k: os.environ.get(k) for k in ("KITE_MASTER_KEY", "KITE_DB_PATH")}
    os.environ["KITE_MASTER_KEY"] = keys.master.hex()
    get_settings.cache_clear()
    try:
        for _ in range(2):
            with TestClient(create_app(conn)):
                pass
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        get_settings.cache_clear()
    stored = {a.id: a for a, _ in stored_assignments(conn, keys, KID_ID)}
    assert len(stored) == 3, "three assignments after two starts"
    live = [a for a in stored.values() if status(a, datetime.now(timezone.utc)) == "exam_live"]
    assert [a.title for a in live] == ["Water cycle quiz"], "the quiz is live right after a start"


def run() -> None:
    use_sample_voices()
    for check in (
        check_offsets_keep_quiz_live_at_any_now, check_status, check_upsert_no_duplicates, check_signals,
        check_pipeline, check_startup_upserts,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
