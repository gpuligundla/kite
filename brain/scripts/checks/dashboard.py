"""Task 21: the parent dashboard routes, as plain asserts, with a temp DB and stand-in Deps.
Run from brain/: uv run python -m scripts.checks.dashboard"""

import tempfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from kite_brain import studio_pro
from kite_brain.api import create_app
from kite_brain.contract import ConceptEvidence, Creation, InterestFact, Moment
from kite_brain.deps import Deps
from kite_brain.memory import ledger
from kite_brain.seed import FAMILY_ID, KID_ID, seed
from kite_brain.turn.pipeline import TurnInput, _Turn
from scripts.checks.ledger import CATALOG, NOW, T0, add, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns

BAD_ROUTES = (
    ("get", f"/kids/{KID_ID}/dashboard", None), ("get", f"/kids/{KID_ID}/contacts", None),
    ("get", f"/kids/{KID_ID}/movies", None), ("put", f"/families/{FAMILY_ID}/policy/death", {"action": "answer"}),
)
GRADE_8 = datetime(2023, 3, 1, tzinfo=timezone.utc)


def client_with_data():
    conn, keys = fresh()
    tokens = seed(conn, keys, NOW).tokens
    app = create_app(conn)
    stand = StandIns()
    app.state.deps = Deps(
        conn=conn, keys=keys, bus=app.state.bus, catalog=CATALOG, decide=stand.decide, llm=stand,
        embed=async_embed, safety=stand, stt=stand, tts=stand, clock=lambda: NOW,
    )
    return TestClient(app), app.state.deps, {k: {"Authorization": f"Bearer {t}"} for k, t in tokens.items()}


def seed_ledger(deps) -> None:
    conn, keys = deps.conn, deps.keys
    add(conn, keys, InterestFact(topic="light"), grade=1)
    add(conn, keys, InterestFact(topic="gravity"), grade=8, at=GRADE_8)
    add(conn, keys, Moment(concept_id="light_see", source="answer", character="Rexy"), grade=1)
    add(conn, keys, Moment(concept_id="gravity_mass_distance", source="game"), grade=8, at=GRADE_8, turn="t8")
    add(conn, keys, ConceptEvidence(outcome="got_it", source="teach_back",
                                    points={p: "covered" for p in CATALOG.get("light_see").key_points}),
        grade=1, concept="light_see")
    for grade, at in ((1, T0), (8, GRADE_8)):
        for kind in ("parent", "counselor"):
            ledger.record_alert(conn, keys, kid_id=KID_ID, kinds=["abuse" if kind == "counselor" else "bullying"],
                                routed_to=kind, excerpt="private words", at=at)
    ledger.record_alert(conn, keys, kid_id=KID_ID, kinds=["sos"], routed_to="parent", excerpt="SOS button",
                        at=T0, location={"lat": 42.36, "lng": -71.06})


def insert_card(deps, grade, at, topic, turn_id) -> None:
    from kite_brain.crypto import aad, seal
    key, a = deps.keys.for_kid(KID_ID), aad("big_question_card", KID_ID, f"card{grade}")
    deps.conn.execute(
        "INSERT INTO big_question_card(id, kid_id, grade, at, topic, source_turn_id, summary, starter)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        (f"card{grade}", KID_ID, grade, ledger.iso(at), topic, turn_id, seal(key, b"a summary", a), seal(key, b"a starter", a)),
    )
    deps.conn.commit()


def check_all() -> None:
    client, deps, bearer = client_with_data()
    seed_ledger(deps)
    insert_card(deps, 1, T0, "light", "t1")
    insert_card(deps, 8, GRADE_8, "gravity", "t8")

    for kind in ("os", "handheld", "counselor"):
        for method, path, body in BAD_ROUTES:
            r = getattr(client, method)(path, headers=bearer[kind], **({"json": body} if body else {}))
            assert r.status_code == 403, f"{kind} on {method} {path} must be 403, got {r.status_code}"
    assert client.get(f"/kids/{KID_ID}/dashboard").status_code == 401, "no token is 401"
    print("ok kid and counselor tokens get 403 on every route")

    receipts = lambda: deps.conn.execute("SELECT COUNT(*) FROM access_receipt").fetchone()[0]  # noqa: E731
    assert receipts() == 0, "a refused request writes no receipt"

    r = client.get(f"/kids/{KID_ID}/dashboard", headers=bearer["parent"])
    assert r.status_code == 200, r.text
    full = r.json()
    assert len(full["alerts"]) == 3 and all("abuse" not in a["kinds"] for a in full["alerts"]), "counselor alerts absent"
    assert any(a["kinds"] == ["sos"] and a["lat"] == 42.36 for a in full["alerts"]), "SOS location shows"
    assert "private words" not in r.text, "no excerpt reaches the page"
    print("ok counselor-routed alerts are absent")

    assert full["skills"]["can_teach"] == ["light_see"], f"can_teach: {full['skills']['can_teach']}"
    assert full["moments_by_grade"]["1"] == ["Figured out how we see things, with Rexy"] or "Rexy" in full["moments_by_grade"]["1"][0]
    assert {c["topic"] for c in full["cards"]} == {"light", "gravity"} and full["cards"][0]["summary"] == "a summary"
    assert full["how_she_learns"] == {"teach_back": 1.0}, f"how_she_learns: {full['how_she_learns']}"
    assert isinstance(full["strengths"], list), "the dashboard names its strength topics"
    print("ok can-teach concepts are listed; cards decrypt; how she learns is present")

    g3 = client.get(f"/kids/{KID_ID}/dashboard?grade=3", headers=bearer["parent"]).json()
    assert g3["profile"]["interests"] == ["light"], f"grade 3 hides grade-8 facts: {g3['profile']}"
    assert list(g3["moments_by_grade"]) == ["1"] and [c["topic"] for c in g3["cards"]] == ["light"]
    assert len(g3["alerts"]) == 2 and [t["topic"] for t in g3["curiosity"]["topics"]] == []
    assert client.get(f"/kids/{KID_ID}/dashboard?grade=13", headers=bearer["parent"]).status_code == 422
    print("ok grade=3 hides grade-8 facts, cards and alerts")

    assert receipts() == 2, f"one receipt per dashboard read, got {receipts()}"
    client.get(f"/kids/{KID_ID}/contacts", headers=bearer["parent"])
    client.get(f"/kids/{KID_ID}/movies", headers=bearer["parent"])
    rows = deps.conn.execute("SELECT who, kid_id, what FROM access_receipt").fetchall()
    assert [r["what"] for r in rows][-2:] == ["contacts", "movies"] and {r["who"] for r in rows} == {"parent"}
    print("ok a receipt is written per read")

    check_policy(client, deps, bearer)
    check_contacts_and_movies(client, bearer)


def check_policy(client, deps, bearer) -> None:
    def turn_policy():
        t = _Turn(TurnInput(kid_id=KID_ID, device="os", mode="talk"), deps, "tp")
        t.load_kid()
        return t.policy()

    assert turn_policy()["death"] == "answer_and_tell", "seeded"
    r = client.put(f"/families/{FAMILY_ID}/policy/death", json={"action": "ask_parent"}, headers=bearer["parent"])
    assert r.status_code == 200, r.text
    assert turn_policy()["death"] == "ask_parent", "the next turn's policy input reads the new action"
    from kite_brain.homework import NO_HOMEWORK
    from kite_brain.turn.route import route
    from scripts.checks.route import decisions
    from kite_brain.deps import SafetyResult
    plan = route(decisions(topic="death"), SafetyResult(set()), turn_policy(), NO_HOMEWORK, "talk", False)
    assert plan.route == "ask_parent", f"and routing follows it: {plan.route}"
    assert client.get(f"/kids/{KID_ID}/dashboard", headers=bearer["parent"]).json()["policy"]["death"] == "ask_parent"
    for topic, body in (("none", {"action": "answer"}), ("war", {"action": "never"})):
        r = client.put(f"/families/{FAMILY_ID}/policy/{topic}", json=body, headers=bearer["parent"])
        assert r.status_code == 422, f"{topic} {body}: {r.status_code}"
    r = client.put("/families/other/policy/war", json={"action": "answer"}, headers=bearer["parent"])
    assert r.status_code == 403, "another family's policy is 403"
    print("ok a policy PUT changes the next turn's route input")


def check_contacts_and_movies(client, bearer) -> None:
    r = client.get(f"/kids/{KID_ID}/contacts", headers=bearer["parent"])
    assert r.json() == [{"name": "Ana Rivera", "phone": "+1-555-0100"}, {"name": "Luis Rivera", "phone": "+1-555-0101"}]
    with tempfile.TemporaryDirectory() as tmp, patch.object(studio_pro, "CREATIONS_DIR", Path(tmp)):
        for cid, kind, url in (("a", "movie", "/creations/a/movie.mp4"), ("b", "movie", None),
                               ("c", "game", None), ("d", "movie", "/creations/d/movie.mp4")):
            (Path(tmp) / cid).mkdir()
            (Path(tmp) / cid / "creation.json").write_text(
                Creation(id=cid, kind=kind, status="ready", video_url=url).model_dump_json())
        import os
        os.utime(Path(tmp) / "a" / "creation.json", (1, 1))
        got = [m["id"] for m in client.get(f"/kids/{KID_ID}/movies", headers=bearer["parent"]).json()]
        assert got == ["d", "a"], f"rendered movies only, newest first: {got}"
    print("ok contacts decrypt; movies list rendered ones newest first")


def check_auth() -> None:
    """The parts of require() the route sweep in check_all leaves out: bad tokens, other kids, the cookie, the rate limit."""
    client, _, bearer = client_with_data()
    assert client.get(f"/kids/{KID_ID}/dashboard", headers={"Authorization": "Bearer nope"}).status_code == 401
    assert client.get("/kids/sam/dashboard", headers=bearer["parent"]).status_code == 403, "another kid is 403"
    token = bearer["parent"]["Authorization"].removeprefix("Bearer ")
    assert client.get(f"/kids/{KID_ID}/dashboard", cookies={"kite_token": token}).status_code == 200, "the cookie works"

    fresh_client, _, bearer = client_with_data()
    statuses = [fresh_client.get(f"/kids/{KID_ID}/dashboard", headers=bearer["parent"]).status_code for _ in range(301)]
    assert set(statuses[:300]) == {200}, "the first 300 requests pass"
    assert statuses[300] == 429, "the 301st request in a minute is 429"
    print("ok bad tokens, other kids, the cookie and the rate limit")


def check_sos_without_location() -> None:
    client, _, bearer = client_with_data()
    assert client.post(f"/kids/{KID_ID}/sos", json={}, headers=bearer["os"]).status_code == 200, "no location still sends"
    alerts = client.get(f"/kids/{KID_ID}/dashboard", headers=bearer["parent"]).json()["alerts"]
    assert any(a["kinds"] == ["sos"] and a["lat"] is None for a in alerts), "the parent sees it, with no map"
    print("ok an SOS with no location still reaches the parent")


def run() -> None:
    check_all()
    check_auth()
    check_sos_without_location()


if __name__ == "__main__":
    run()
