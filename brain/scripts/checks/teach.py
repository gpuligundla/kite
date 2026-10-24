"""Teach Kite claims, with the stand-ins from checks/pipeline.py.
Run from brain/: uv run python -m scripts.checks.teach"""

import asyncio
import json
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from kite_brain.api import create_app
from kite_brain.contract import ConceptEvidence
from kite_brain.deps import Deps
from kite_brain.memory import ledger, maps
from kite_brain.policy import band_for
from kite_brain.seed import KID_ID, seed
from kite_brain.turn.route import PAUSE_REPLY, TEACH_START
from kite_brain.turn.teach import TRY_AGAIN
from kite_brain.voice import voice_for
from scripts.checks.audiences import drain
from scripts.checks.homework import with_class
from scripts.checks.ledger import CATALOG, NOW, add, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns, deps_for, make_decisions, rows, turn, types
from scripts.checks.voice import use_sample_voices

CONCEPT = CATALOG.get("light_sky_blue")  # four key points
POINTS = CONCEPT.key_points
assert len(POINTS) == 4


class Recording(StandIns):
    """Also remembers the voice each sentence was spoken in."""

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.specs = []

    async def speak(self, text, spec):
        self.specs.append(spec)
        return b"mp3"


def teach_decisions(*verdicts):
    d = make_decisions()
    for i, v in enumerate(verdicts):
        d.answers[f"teach_point:{i}"] = {x: float(x == v) for x in ("covered", "partly", "missing", "wrong")}
    return d


def attempt(deps, bus, stand, verdicts, turn_id, **fields):
    stand.decide_result = teach_decisions(*verdicts)
    return turn(deps, bus, stand, turn_id, mode="teach", concept_id=CONCEPT.id, **fields)


def evidence(deps):
    return [
        e for e in ledger.events(deps.conn, deps.keys, KID_ID, 12)
        if isinstance(e.payload, ConceptEvidence) and e.payload.source == "teach_back"
    ]


def check_all_covered_celebrates_and_can_teach() -> None:
    stand = Recording(decide=make_decisions(), heard="The sky is blue because air scatters blue light.")
    deps, bus = deps_for(stand)
    seen = attempt(deps, bus, stand, ["covered"] * 4, "tb1")
    assert stand.llm_calls == 1 and "covered every point" in stand.requests[0].context, "celebrate brief"
    assert stand.specs[-1] == voice_for(band_for(11), "celebrate"), "the celebrate voice"
    assert stand.requests[0].tools is False, "no movie or game tools while she is teaching"
    [ev] = evidence(deps)
    assert ev.payload.outcome == "got_it" and set(ev.payload.points.values()) == {"covered"}, ev.payload
    skills = maps.skills_map(ledger.events(deps.conn, deps.keys, KID_ID, 12), CATALOG, 12)
    assert skills.can_teach == [CONCEPT.id], "all points covered makes the concept can_teach"
    moments = [e.payload for e in ledger.events(deps.conn, deps.keys, KID_ID, 12) if e.payload.kind == "moment"]
    assert [m.source for m in moments] == ["teach_back"], "a teach_back moment"
    taught = [e for e in seen["parent"] if e.type == "taught"]
    assert [(t.concept_id, t.outcome) for t in taught] == [(CONCEPT.id, "got_it")], "the parent hears of it"
    assert not [e for e in seen["counselor"]], "never the counselor"
    saved = next(e for e in seen["parent"] if e.type == "memory.saved")
    assert "concept_evidence" in saved.kinds and "moment" in saved.kinds, saved.kinds


def check_missing_point_named_first() -> None:
    stand = Recording(decide=make_decisions())
    deps, bus = deps_for(stand)
    seen = attempt(deps, bus, stand, ["covered", "missing", "covered", "missing"], "tb2")
    context = stand.requests[0].context
    ask = next(line for line in context.splitlines() if line.startswith("Then ask ONE guiding question"))
    assert ask.endswith(POINTS[1]) and POINTS[3] not in ask, f"the first missing point leads: {ask}"
    assert "Start by praising" in context and TRY_AGAIN in context and "misconception" not in context
    assert stand.specs[-1] == voice_for(band_for(11), "answer"), "the normal answer voice"
    assert evidence(deps)[0].payload.outcome == "partly", "two of four covered is partly"
    assert [e.outcome for e in seen["parent"] if e.type == "taught"] == ["partly"]
    skills = maps.skills_map(ledger.events(deps.conn, deps.keys, KID_ID, 12), CATALOG, 12)
    assert skills.can_teach == [], "a partial attempt is not can_teach"


def check_wrong_point_is_a_misconception() -> None:
    stand = Recording(decide=make_decisions())
    deps, bus = deps_for(stand)
    attempt(deps, bus, stand, ["covered", "covered", "wrong", "missing"], "tb3")
    context = stand.requests[0].context
    assert next(l for l in context.splitlines() if l.startswith("Then ask")).endswith(POINTS[2])
    assert "misconception" in context, "a wrong point is checked gently"
    attempt(deps, bus, stand, ["missing", "covered", "missing", "missing"], "tb3b")
    assert evidence(deps)[-1].payload.outcome == "partly", "merged with the first attempt: three covered"


def check_attempts_merge_within_session() -> None:
    stand = Recording(decide=make_decisions())
    deps, bus = deps_for(stand)
    attempt(deps, bus, stand, ["covered", "missing", "missing", "missing"], "m1")
    attempt(deps, bus, stand, ["missing", "covered", "missing", "missing"], "m2")
    second = evidence(deps)[-1].payload
    assert list(second.points.values()) == ["covered", "covered", "missing", "missing"], second.points
    attempt(deps, bus, stand, ["missing", "missing", "covered", "partly"], "m3")
    last = stand.requests[-1].context
    assert next(l for l in last.splitlines() if l.startswith("Then ask")).endswith(POINTS[3]), "only the partly point is left"
    attempt(deps, bus, stand, ["wrong", "wrong", "wrong", "covered"], "m4")
    final = evidence(deps)[-1].payload
    assert set(final.points.values()) == {"covered"} and final.outcome == "got_it", "a worse attempt never undoes a covered point"
    assert stand.specs[-1] == voice_for(band_for(11), "celebrate")

    # a different session starts again
    other = Recording(decide=make_decisions())
    deps2, bus2 = deps_for(other)
    attempt(deps2, bus2, other, ["covered", "missing", "missing", "missing"], "n1")
    deps2.clock = lambda: NOW.replace(day=NOW.day + 1)
    attempt(deps2, bus2, other, ["missing", "covered", "missing", "missing"], "n2", now=NOW.replace(day=NOW.day + 1))
    assert list(evidence(deps2)[-1].payload.points.values()) == ["missing", "covered", "missing", "missing"], "no merge across sessions"


def check_time_travel_teach_writes_nothing() -> None:
    stand = Recording(decide=make_decisions())
    deps, bus = deps_for(stand)
    seen = attempt(deps, bus, stand, ["covered"] * 4, "tt1", as_of_grade=6)
    assert rows(deps, "learning_event") == 0 and rows(deps, "session_turn") == 0, "a time-travel teach turn writes nothing"
    assert "taught" not in types(seen["parent"]), "and does not report a lesson that was not recorded"
    assert types(seen["os"])[-1] == "answer.done" and stand.llm_calls == 1, "she still hears the answer"


def check_teach_during_live_quiz_pauses() -> None:
    stand = Recording(decide=make_decisions())
    deps, bus = deps_for(stand)
    with_class(deps)
    stand.decide_result = teach_decisions(*["covered"] * 4)
    seen = turn(deps, bus, stand, "q1", mode="teach", concept_id="water_cycle_basic")
    routed = next(e for e in seen["parent"] if e.type == "routed")
    assert routed.route == "pause" and stand.llm_calls == 0, "teaching the live quiz's concept pauses with no LLM call"
    assert seen["os"][-1].text == PAUSE_REPLY, "a fixed reply"
    assert rows(deps, "learning_event") == 0 and "taught" not in types(seen["parent"]), "nothing graded or recorded"

    seen = turn(deps, bus, stand, "q2", mode="teach", concept_id=CONCEPT.id)
    assert stand.llm_calls == 1 and [e.type for e in seen["parent"] if e.type == "taught"], "another concept is fine"


def check_api() -> None:
    conn, keys = fresh()
    tokens = seed(conn, keys, NOW).tokens
    app = create_app(conn)
    stand = StandIns(decide=None)
    app.state.deps = Deps(
        conn=conn, keys=keys, bus=app.state.bus, catalog=CATALOG, decide=stand.decide,
        llm=stand, embed=async_embed, safety=stand, stt=stand, tts=stand,
        clock=lambda: datetime.now(timezone.utc),
    )
    client = TestClient(app)
    bearer = lambda kind: {"Authorization": f"Bearer {tokens[kind]}"}  # noqa: E731
    url = f"/kids/{KID_ID}/teachable"

    assert client.get(url, headers=bearer("os")).json() == [], "nothing met yet"
    add(conn, keys, ConceptEvidence(outcome="got_it", source="check_question"), concept="light_see", at=NOW)
    add(conn, keys, ConceptEvidence(outcome="not_yet", source="game"), concept="water_where", grade=2, at=NOW)
    for kind in ("os", "handheld"):
        r = client.get(url, headers=bearer(kind))
        assert r.status_code == 200, r.text
    got = r.json()
    names = {c: CATALOG.get(c).kid_name for c in ("light_see", "water_where")}
    assert [(g["concept_id"], g["kid_name"]) for g in got] == [(c, names[c]) for c in ("water_where", "light_see")], got
    assert all(set(g) == {"concept_id", "kid_name"} for g in got), "no levels, no scores"
    assert not any(w in json.dumps(got) for w in ("level", "got_it", "not_yet", "can_teach")), "no levels"
    for kind in ("parent", "counselor"):
        assert client.get(url, headers=bearer(kind)).status_code == 403, f"{kind} cannot list teachable concepts"

    start = f"/kids/{KID_ID}/teach/start"
    assert client.post(start, json={"concept_id": "light_see"}, headers=bearer("parent")).status_code == 403
    assert client.post(start, json={"concept_id": "nope"}, headers=bearer("os")).status_code == 422
    use_sample_voices()
    assert client.post(start, json={"concept_id": "light_see"}, headers=bearer("os")).status_code == 200
    line = TEACH_START.format(concept=names["light_see"])
    kid = [e for e in asyncio.run(drain(app.state.bus, "os")) if e.type == "answer.sentence"]
    parent = [e for e in asyncio.run(drain(app.state.bus, "parent")) if e.type == "answer.sentence"]
    assert [e.text for e in kid] == [line] == [e.text for e in parent], "kid and parent hear the fixed line"

    form = {"kid_id": KID_ID, "device": "os", "text": "hi"}
    assert client.post("/turns", data=form | {"mode": "teach"}, headers=bearer("os")).status_code == 422, "teach needs a concept"
    assert client.post("/turns", data=form | {"concept_id": "nope"}, headers=bearer("os")).status_code == 422
    r = client.post("/turns", data=form | {"mode": "teach", "concept_id": "light_see"}, headers=bearer("os"))
    assert r.status_code == 200, r.text


def run() -> None:
    use_sample_voices()
    for check in (
        check_all_covered_celebrates_and_can_teach, check_missing_point_named_first,
        check_wrong_point_is_a_misconception, check_attempts_merge_within_session,
        check_time_travel_teach_writes_nothing, check_teach_during_live_quiz_pauses, check_api,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
