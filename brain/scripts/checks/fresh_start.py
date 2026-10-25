"""New topic: a fresh start cuts recall's history and the session, and leaves what Kite learned alone.
Also the kid screen's one-question ear, /hear. Run from brain/: uv run python -m scripts.checks.fresh_start"""

import asyncio
import base64
from datetime import timedelta

from kite_brain.db import init_db
from kite_brain.memory.recall import recall
from kite_brain.seed import KID_ID
from kite_brain.turn import pipeline
from scripts.checks.audiences import drain
from scripts.checks.dashboard import client_with_data, seed_ledger
from scripts.checks.forget import decisions
from scripts.checks.ledger import NOW

PATH = f"/kids/{KID_ID}/fresh-start"


def setup():
    client, deps, bearer = client_with_data()
    stand = deps.llm  # client_with_data's StandIns: `requests` holds every answer's context
    clock = [NOW]
    deps.clock = lambda: clock[0]

    async def decide(context, questions):
        return stand.decide_result or decisions()

    deps.decide = decide

    def say(text, **form):
        clock[0] += timedelta(minutes=1)
        r = client.post("/turns", data={"kid_id": KID_ID, "device": "os", "text": text} | form, headers=bearer["os"])
        assert r.status_code == 200, r.text
        asyncio.run(drain(deps.bus, "parent"))
        return r.json()["turn_id"]

    def fresh_start(kind="os"):
        clock[0] += timedelta(minutes=1)
        return client.post(PATH, headers=bearer[kind])

    def session(turn_id):
        return deps.conn.execute("SELECT session_id FROM session_turn WHERE id = ?", (turn_id,)).fetchone()[0]

    return client, deps, bearer, stand, say, fresh_start, session


def learning(client, deps, bearer):
    """Everything Kite learned about the kid, as the kid sees it and as stored."""
    view = client.get(f"/kids/{KID_ID}/kid-view", headers=bearer["os"]).json()
    ids = [r[0] for r in deps.conn.execute("SELECT id FROM learning_event ORDER BY id")]
    count = lambda table: deps.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]  # noqa: E731
    return view, ids, count("moment_vector"), count("big_question_card")


def check_auth() -> None:
    client, _, bearer, *_ = setup()
    assert client.post(PATH).status_code == 401, "no token is 401"
    for kind in ("parent", "counselor"):
        assert client.post(PATH, headers=bearer[kind]).status_code == 403, f"{kind} devices can't start a new topic"
    assert client.post("/kids/sam/fresh-start", headers=bearer["os"]).status_code == 403, "another kid is 403"
    for kind in ("os", "handheld"):
        r = client.post(PATH, headers=bearer[kind])
        assert r.status_code == 200 and set(r.json()) == {"at"}, r.text


def check_history_cut_and_new_session() -> None:
    client, deps, bearer, stand, say, fresh_start, session = setup()
    seed_ledger(deps)
    volcano = say("why do volcanoes erupt?", concept_id="dino_what")
    say("what is lava made of?")
    assert "volcanoes" in stand.requests[-1].context, "before a fresh start the follow-up sees the question"
    before = learning(client, deps, bearer)
    assert before[0]["moments"] and len(before[1]) > 5, f"learning to compare against: {before[:2]}"

    r = fresh_start()
    assert r.status_code == 200, r.text
    assert learning(client, deps, bearer) == before, "the kid view, ledger, moments and cards are untouched"
    assert asyncio.run(recall(deps, KID_ID, 11, None, None, 0.0)).history == [], "recall's history starts empty"

    movie = say("make a movie about that")
    context = stand.requests[-1].context
    assert "volcano" not in context and "lava" not in context, "\"that\" no longer points at volcanoes"
    assert session(movie) != session(volcano), "a new session begins well inside the 30-minute gap"
    game = say("and a game too")
    assert "make a movie about that" in stand.requests[-1].context, "history builds again after the mark"
    assert session(game) == session(movie), "and the new session carries on"

    init_db(deps.conn)  # what a brain restart runs
    assert [t for _, t in asyncio.run(recall(deps, KID_ID, 11, None, None, 0.0)).history if "volcano" in t] == [], \
        "the mark survives a restart"


def check_time_travel_cleared() -> None:
    pipeline._time_travel.clear()
    _, deps, _, stand, say, fresh_start, _ = setup()
    say("why do volcanoes erupt?", as_of_grade="2")
    say("make that into a movie", as_of_grade="2")
    assert "volcanoes" in stand.requests[-1].context, "time travel remembers within its grade"
    assert fresh_start().status_code == 200
    say("make that into a game", as_of_grade="2")
    assert "volcanoes" not in stand.requests[-1].context, "a fresh start clears time travel, as forget does"
    assert deps.conn.execute("SELECT COUNT(*) FROM session_turn").fetchone()[0] == 0, "time travel still writes nothing"


def check_hear() -> None:
    client, deps, bearer, stand, *_ = setup()
    path, body = f"/kids/{KID_ID}/hear", {"audio_b64": base64.b64encode(b"\0audio").decode(), "mime": "audio/webm"}
    assert client.post(path, json=body).status_code == 401, "no token is 401"
    assert client.post(path, json=body, headers=bearer["parent"]).status_code == 403, "a parent device can't use it"
    assert client.post("/kids/sam/hear", json=body, headers=bearer["os"]).status_code == 403, "another kid is 403"
    stand.heard = "  big\n volcanoes "
    r = client.post(path, json=body, headers=bearer["handheld"])
    assert r.status_code == 200 and r.json() == {"text": "big volcanoes"}, r.text
    for bad in ({**body, "audio_b64": "not base64!"}, {**body, "mime": "text/html"}, {**body, "audio_b64": "A" * 1_300_000}):
        assert client.post(path, json=bad, headers=bearer["os"]).status_code == 422, f"rejected: {str(bad)[:60]}"
    assert deps.conn.execute("SELECT COUNT(*) FROM session_turn").fetchone()[0] == 0, "hearing stores nothing"


def run() -> None:
    for check in (check_auth, check_history_cut_and_new_session, check_time_travel_cleared, check_hear):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
