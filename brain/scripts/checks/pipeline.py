"""The turn pipeline's stage claims, with local stand-ins for every vendor client.
Run from brain/: uv run python -m scripts.checks.pipeline

This is the one place stand-in Deps are allowed. Each stand-in records what it was
asked, so a claim such as "no LLM call" is a count, not a guess."""

import asyncio
import io
import json
import logging
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from kite_brain import studio_pro
from kite_brain.api import create_app
from kite_brain.bus import EventBus
from kite_brain.contract import KID_EVENT_TYPES, ConceptEvidence
from kite_brain.decide import DecideUnavailable, Decisions
from kite_brain.deps import Deps, SafetyResult, ToolCall
from kite_brain.llm import TOOLS
from kite_brain.seed import KID_ID, seed
from kite_brain.studio import store
from kite_brain.studio_pro import GameResult, Playtest
from kite_brain.turn import pipeline
from kite_brain.turn.pipeline import TEACH_NOT_MET, TurnInput, run_turn, teaching_now
from kite_brain.turn.route import FALLBACK, UNHEARD, teach_start_line
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG, NOW, add, fresh
from scripts.checks.memory import async_embed, candidates
from scripts.checks.route import decisions as route_decisions
from scripts.checks.voice import use_sample_voices

ANSWER = "Hello there, Maya. The sky looks blue because air scatters blue light. Neat, right?"


def make_decisions(alerts=None, about_me=0.0) -> Decisions:
    d = route_decisions(alerts, about_me=about_me)
    d.answers["initiative"] = {"own_question": 1.0, "follow_up_why": 0.0, "assigned_work": 0.0}
    return d


class StandIns:
    """Stand-in vendor clients. `llm_calls` and `requests` are the evidence."""

    def __init__(self, *, heard="why is the sky blue?", decide=None, answer=ANSWER, flag_output=None):
        self.heard, self.decide_result, self.answer, self.flag_output = heard, decide, answer, flag_output
        self.llm_calls, self.requests = 0, []

    async def transcribe(self, audio, mime):
        return self.heard

    async def decide(self, context, questions):
        if self.decide_result is None:
            raise DecideUnavailable("both paths down")
        return self.decide_result

    async def check_input(self, text):
        return SafetyResult(set())

    async def check_output(self, text):
        return not (self.flag_output and self.flag_output in text)

    async def stream(self, request):
        self.llm_calls += 1
        self.requests.append(request)
        for word in self.answer.split(" "):
            yield word + " "

    async def speak(self, text, spec):
        return b"mp3"

    async def parse(self, request, model_cls):
        return candidates()


def deps_for(stand: StandIns) -> tuple[Deps, EventBus]:
    conn, keys = fresh()
    bus = EventBus()
    deps = Deps(
        conn=conn, keys=keys, bus=bus, catalog=CATALOG, decide=stand.decide,
        llm=stand, embed=async_embed, safety=stand, stt=stand, tts=stand,
        clock=lambda: NOW,
    )
    return deps, bus


def turn(deps, bus, stand, turn_id="t1", **fields):
    base = dict(kid_id=KID_ID, device="os", mode="talk", audio=b"\0", audio_mime="audio/webm")
    inp = TurnInput(**base | fields)
    asyncio.run(run_turn(inp, deps, turn_id))
    seen = {kind: asyncio.run(drain(bus, kind)) for kind in ("os", "parent", "counselor")}
    for e in seen["os"]:
        assert e.type in KID_EVENT_TYPES, f"a kid device received {e.type}"  # claim 2, every turn
    return seen


def rows(deps, table):
    return deps.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]


def types(events):
    return [e.type for e in events]


def check_abuse_turn_invisible_to_parent() -> None:
    stand = StandIns(decide=make_decisions({"abuse": 0.9}))
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "abuse1")
    assert not [e for e in seen["parent"] if e.turn_id == "abuse1"], "the parent must receive nothing from an abuse turn"
    counselor = types(seen["counselor"])
    assert "heard" in counselor and "alert" in counselor, f"the counselor gets heard and alert, got {counselor}"
    assert stand.llm_calls == 0 and rows(deps, "session_turn") == 0, "an alert turn is a fixed reply with no history"
    assert rows(deps, "alert") == 1, "the alert row is the safety record"
    assert "988" in seen["os"][-1].text, "the kid hears the fixed reply with the crisis line"


def check_time_travel_writes_nothing() -> None:
    stand = StandIns(decide=make_decisions())
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "tt1", as_of_grade=2)
    assert rows(deps, "session_turn") == 0 and rows(deps, "learning_event") == 0, "a grade-2 turn for a grade-11 kid writes nothing"
    assert types(seen["os"])[-1] == "answer.done", "answer.done is still emitted"
    assert stand.llm_calls == 1, "the answer is still spoken"

    stand = StandIns(decide=make_decisions({"self_harm": 0.5}))
    deps, bus = deps_for(stand)
    turn(deps, bus, stand, "tt2", as_of_grade=2)
    assert rows(deps, "alert") == 1 and rows(deps, "session_turn") == 0, "a time-travel alert is still recorded"


def check_both_decide_paths_down_is_fallback() -> None:
    stand = StandIns(decide=None)
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "fb1")
    routed = next(e for e in seen["parent"] if e.type == "routed")
    assert routed.route == "fallback", routed.route
    assert seen["os"][-1].text == FALLBACK and stand.llm_calls == 0, "fallback line, no LLM call"
    assert all(rows(deps, t) == 0 for t in ("session_turn", "learning_event", "alert")), "no writes"


def check_decision_jailbreak_is_fallback() -> None:
    """Prompt Shields saw nothing (the stand-in's check_input), and Decision-1's jailbreak question caught it."""
    decisions = make_decisions()
    decisions.answers["jailbreak"]["attack"] = 1.0
    stand = StandIns(decide=decisions)
    asked = []
    answer = stand.decide

    async def recording(context, questions):
        asked.extend(q.name for q in questions)
        return await answer(context, questions)

    stand.decide = recording
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "jb1")
    assert "jailbreak" in asked, f"every turn asks the jailbreak question: {asked}"
    assert next(e for e in seen["parent"] if e.type == "routed").route == "fallback"
    assert seen["os"][-1].text == FALLBACK and stand.llm_calls == 0, "fallback line, no LLM call"
    assert rows(deps, "session_turn") == 0, "nothing written"


def check_output_flag_stops_and_falls_back() -> None:
    stand = StandIns(decide=make_decisions(), answer="Hello there. This one is BAD. Never spoken.", flag_output="BAD")
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "of1")
    sentences = [e.text for e in seen["os"] if e.type == "answer.sentence"]
    assert sentences == ["Hello there.", FALLBACK], sentences
    assert seen["os"][-1].text == FALLBACK, "answer.done carries what was actually spoken"


def check_unheard() -> None:
    stand = StandIns(heard="  \n ", decide=make_decisions())
    deps, bus = deps_for(stand)
    seen = turn(deps, bus, stand, "uh1")
    assert seen["os"][-1].text == UNHEARD and stand.llm_calls == 0, "whitespace means UNHEARD and no model call"
    assert rows(deps, "session_turn") == 0, "nothing written"


def check_answer_path() -> None:
    stand = StandIns(decide=make_decisions())
    deps, bus = deps_for(stand)
    for session in ("s1", "s2"):
        add(deps.conn, deps.keys, ConceptEvidence(outcome="partly", source="game"), session=session, concept="dino_diets")
    seen = turn(deps, bus, stand, "ok1", concept_id="light_see", image=b"\x89PNG...")
    kid = types(seen["os"])
    assert kid[0] == "heard" and kid[-1] == "answer.done" and "answer.sentence" in kid, kid
    sentence = next(e for e in seen["os"] if e.type == "answer.sentence")
    assert sentence.audio_b64 == "bXAz", "sentences carry base64 audio"
    done = seen["os"][-1]
    assert done.fk_grade is not None and done.text == ANSWER, "done carries the full text and its FK grade"
    parent = types(seen["parent"])
    for t in ("heard", "decided", "recalled", "routed", "answer.sentence", "answer.done", "memory.saved"):
        assert t in parent, f"parent x-ray is missing {t}: {parent}"
    assert seen["counselor"] == [], "a normal turn never reaches the counselor"
    assert rows(deps, "session_turn") == 2, "kid and kite rows"
    req = stand.requests[0]
    assert req.image == b"\x89PNG...", "the image reaches the request"
    whole = json.dumps([req.system, req.context, req.messages])
    assert CATALOG.get("dino_diets").kid_name not in whole and "growing" not in whole, "no skills data in the request"


def check_no_text_in_logs() -> None:
    """Every vendor stand-in fails with the kid's words in its message, the way a real API
    error body can. Nothing of it may reach the log."""
    phrase = "secret-phrase-123"

    class Leaky(StandIns):
        async def speak(self, text, spec):
            raise RuntimeError(text)

        async def check_output(self, text):
            raise RuntimeError(text)

        async def check_input(self, text):
            raise RuntimeError(text)

        async def stream(self, request):
            yield "One fine sentence. "
            raise RuntimeError(request.messages[0]["content"])

    buffer, handler = io.StringIO(), logging.StreamHandler(io.StringIO())
    handler.stream = buffer
    logger = logging.getLogger("kite_brain")
    logger.addHandler(handler)
    logger.setLevel(logging.DEBUG)
    try:
        stand = Leaky(heard=f"my {phrase} question", decide=make_decisions())
        deps, bus = deps_for(stand)
        turn(deps, bus, stand, "leak1")
        deps.conn.close()  # the next turn hits a closed connection, the catch-all path
        turn(deps, bus, stand, "leak2")
    finally:
        logger.removeHandler(handler)
    assert phrase not in buffer.getvalue(), "conversation text reached a log line"
    assert "leak1" in buffer.getvalue() and "leak2" in buffer.getvalue(), "turn ids are logged"


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
    form = {"kid_id": KID_ID, "device": "os", "mode": "talk", "text": "hi"}

    assert client.post("/turns", data=form, headers=bearer("parent")).status_code == 403, "a parent can't post turns"
    big = client.post("/turns", data=form, files={"audio": ("a.webm", b"\0" * 1_000_000, "audio/webm")}, headers=bearer("os"))
    assert big.status_code == 413, f"a 1 MB upload is 413, got {big.status_code}"
    for bad in ("13", "-1", "K"):
        r = client.post("/turns", data=form | {"as_of_grade": bad}, headers=bearer("os"))
        assert r.status_code == 422, f"as_of_grade={bad} must be 422, got {r.status_code}"
    r = client.post("/turns", data=form, headers=bearer("os"))
    assert r.status_code == 200 and r.json()["turn_id"], r.text
    r = client.post("/turns", data=form | {"as_of_grade": "3"}, headers=bearer("handheld"))
    assert r.status_code == 200, "as_of_grade is optional and 0-12 is fine"

    r = client.post(f"/kids/{KID_ID}/sos", json={"lat": 42.36, "lng": -71.06}, headers=bearer("parent"))
    assert r.status_code == 403, "SOS is a kid-device endpoint"
    r = client.post(f"/kids/{KID_ID}/sos", json={"lat": 42.36, "lng": -71.06}, headers=bearer("handheld"))
    assert r.status_code == 200, r.text
    parent = asyncio.run(drain(app.state.bus, "parent"))
    sos = [e for e in parent if e.type == "alert"]
    assert sos and sos[0].kinds == ["sos"] and sos[0].lat == 42.36, "SOS reaches the parent stream"
    assert all(e.type in KID_EVENT_TYPES for e in asyncio.run(drain(app.state.bus, "os"))), "and never the kid"
    assert conn.execute("SELECT location FROM alert WHERE kinds = '[\"sos\"]'").fetchone()[0] is not None


class Tooling(StandIns):
    """Claude answers, then calls `call`, the way the real stream ends with any tool use."""

    def __init__(self, call: ToolCall, **kw):
        super().__init__(**kw)
        self.call = call

    async def stream(self, request):
        async for word in super().stream(request):
            yield word
        yield self.call


class ReadyAgent:
    """The studio agent, building at once."""

    def __init__(self):
        self.requests = []

    async def build(self, request, progress):
        self.requests.append(request)
        progress("Write game.html")
        return GameResult("ready", "<!doctype html><title>Moon jump</title><p>Jump to the moon!</p>", Playtest(True, []))


def settled_turn(deps, bus, turn_id, **fields):
    """One turn plus the background jobs its tool call started, in one event loop."""
    base = dict(kid_id=KID_ID, device="os", mode="talk", audio=b"\0", audio_mime="audio/webm")

    async def go():
        await run_turn(TurnInput(**base | fields), deps, turn_id)
        # settle() never yields when every task is done but its done-callback is still queued (3.12's gather
        # completes at once), so it would spin forever. One tick lets the callbacks run first.
        await asyncio.sleep(0)
        await store.settle()

    asyncio.run(go())
    return {kind: asyncio.run(drain(bus, kind)) for kind in ("os", "parent", "counselor")}


def about(concept, forget=0.0):
    d = make_decisions()
    d.answers["concept"] = {concept: 1.0, "none": 0.0}
    d.answers["forget_request"] = {"yes": forget, "no": 1 - forget}
    return d


def check_voice_tools_are_offered() -> None:
    schemas = {t["name"]: t["input_schema"]["required"] for t in TOOLS}
    assert schemas == {
        "make_movie": ["topic", "learning_goal"], "make_game": ["topic", "learning_goal"],
        "build_new_game": ["topic", "learning_goal"], "teach_kite": ["topic"],
    }, schemas
    stand = StandIns(decide=make_decisions())
    deps, bus = deps_for(stand)
    turn(deps, bus, stand, "tools1")
    assert stand.requests[0].tools, "a talk turn offers the tools"


def check_build_new_game_by_voice() -> None:
    agent = ReadyAgent()
    stand = Tooling(ToolCall("build_new_game", "the moon", "The moon has less gravity, so you jump higher."),
                    decide=make_decisions(), heard="build me a brand-new game about the moon")
    deps, bus = deps_for(stand)
    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())), \
            patch.object(studio_pro, "default_agent", lambda: agent):
        seen = settled_turn(deps, bus, "bng1")
        made = list(studio_pro.CREATIONS_DIR.iterdir())
    kid = [e for e in seen["os"] if e.type.startswith("creation.")]
    assert kid[0].type == "creation.progress" and kid[0].step == 0 and kid[0].kind == "game", kid
    assert kid[-1].type == "creation.ready" and kid[-1].status == "ready", kid[-1]
    assert len(made) == 1 and (made[0] / "game.html").exists(), "the brand-new game is saved under its creation"
    assert agent.requests[0]["topic"] == "the moon" and "jump higher" in agent.requests[0]["learning_goal"], \
        "Claude's topic and goal reach the studio agent"
    assert any(e.type == "creation.ready" for e in seen["parent"]), "and the grown-up copy"


def check_teach_kite_by_voice() -> None:
    pipeline._teaching.clear()
    opener = teach_start_line(CATALOG.get("light_rainbow").kid_name)
    stand = Tooling(ToolCall("teach_kite", "rainbows", ""), decide=about("light_rainbow"),
                    answer="Ooh, yes.", heard="I want to teach you about rainbows")
    deps, bus = deps_for(stand)
    add(deps.conn, deps.keys, ConceptEvidence(outcome="partly", source="game"), concept="light_rainbow")
    seen = turn(deps, bus, stand, "tk1")
    spoken = [e.text for e in seen["os"] if e.type == "answer.sentence" and e.turn_id == "tk1"]
    assert spoken == ["Ooh, yes.", opener], f"the turn speaks the opener after Claude's line: {spoken}"
    turnless = [e for e in seen["os"] if e.type == "answer.sentence" and e.turn_id is None]
    assert [e.text for e in turnless] == [opener] and turnless[0].audio_b64 == "", \
        "the screens get the opener as the lesson's start, unvoiced: the turn already says it"
    assert any(e.turn_id is None and e.text == opener for e in seen["parent"]), "the grown-up sees the lesson start"
    assert teaching_now(deps, KID_ID) == "light_rainbow", "and the screen can ask which lesson began"

    pipeline._teaching.clear()
    stand = Tooling(ToolCall("teach_kite", "volcanoes", ""), decide=about("light_rainbow"), answer="Sure.")
    deps, bus = deps_for(stand)  # she has met nothing
    seen = turn(deps, bus, stand, "tk2")
    assert seen["os"][-1].text == f"Sure. {TEACH_NOT_MET.format(topic='volcanoes')}", seen["os"][-1].text
    assert not [e for e in seen["os"] if e.turn_id is None] and teaching_now(deps, KID_ID) is None, \
        "an unmet topic starts no lesson"


def check_time_travel_follow_ups() -> None:
    """A time-travel turn writes nothing, yet "make that into a movie" must still see what came before."""
    pipeline._time_travel.clear()
    stand = StandIns(decide=make_decisions(), heard="why do volcanoes erupt?")
    deps, bus = deps_for(stand)
    turn(deps, bus, stand, "tt1", as_of_grade=2)
    stand.heard = "make that into a movie"
    turn(deps, bus, stand, "tt2", as_of_grade=2)
    assert "kid: why do volcanoes erupt?" in stand.requests[1].context, "the follow-up sees the question"
    assert f"kite: {ANSWER}" in stand.requests[1].context, "and Kite's answer"
    assert rows(deps, "session_turn") == 0, "still nothing written"

    stand.heard = "what is lava?"
    turn(deps, bus, stand, "now1")
    assert "volcanoes" not in stand.requests[2].context, "a turn at her own grade never sees time travel"

    stand.heard, stand.decide_result = "forget that", about("none", forget=0.9)
    turn(deps, bus, stand, "tt3", as_of_grade=2)
    stand.heard, stand.decide_result = "and what is magma?", make_decisions()
    turn(deps, bus, stand, "tt4", as_of_grade=2)
    context = stand.requests[-1].context
    assert "volcanoes" in context and "make that into a movie" not in context, "forget drops the last exchange"


def check_teach_active_endpoint() -> None:
    pipeline._teaching.clear()
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
    url = f"/kids/{KID_ID}/teach/active"
    r = client.get(url, headers=bearer("os"))
    assert r.status_code == 200 and r.json() is None, "nothing started yet"
    r = client.post(f"/kids/{KID_ID}/teach/start", json={"concept_id": "light_rainbow"}, headers=bearer("handheld"))
    assert r.status_code == 200, r.text
    for kind in ("os", "handheld"):
        r = client.get(url, headers=bearer(kind))
        assert r.status_code == 200 and r.json() == {"concept_id": "light_rainbow", "kid_name": "Rainbows"}, r.text
    for kind in ("parent", "counselor"):
        assert client.get(url, headers=bearer(kind)).status_code == 403, f"{kind} devices can't see it"
    assert client.get("/kids/sam/teach/active", headers=bearer("os")).status_code == 403, "only her own kid"
    assert client.get(url).status_code == 401, "no token, no answer"


def run() -> None:
    use_sample_voices()
    for check in (
        check_abuse_turn_invisible_to_parent, check_time_travel_writes_nothing,
        check_both_decide_paths_down_is_fallback, check_decision_jailbreak_is_fallback,
        check_output_flag_stops_and_falls_back, check_unheard,
        check_answer_path, check_no_text_in_logs, check_api,
        check_voice_tools_are_offered, check_build_new_game_by_voice, check_teach_kite_by_voice,
        check_time_travel_follow_ups, check_teach_active_endpoint,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
