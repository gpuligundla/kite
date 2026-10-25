"""Task 26: the counselor console, as plain asserts, with a temp DB and stand-in Deps.
Run from brain/: uv run python -m scripts.checks.counselor"""

import asyncio
from datetime import datetime, timedelta, timezone

from kite_brain.memory import ledger
from kite_brain.seed import KID_ID
from kite_brain.turn.route import ALERT_REPLY
from scripts.checks.audiences import drain
from scripts.checks.dashboard import client_with_data, seed_ledger
from scripts.checks.forget import decisions
from scripts.checks.fresh_start import setup
from scripts.checks.ledger import NOW

ROUTES = (("get", "/counselor/alerts"), ("get", "/counselor/student"), ("get", "/counselor/receipts"))


def check_inbox() -> None:
    client, deps, bearer = client_with_data()
    seed_ledger(deps)
    deps.conn.execute(
        "INSERT INTO kid(id, family_id, display_name, grade, school_start_year) VALUES ('sam', 'rivera', 'Sam', 3, 2023)"
    )
    ledger.record_alert(deps.conn, deps.keys, kid_id="sam", kinds=["abuse"], routed_to="counselor",
                        excerpt="sam's words", at=NOW)

    def receipts():
        return deps.conn.execute("SELECT who, kid_id, what FROM access_receipt ORDER BY id").fetchall()

    assert client.get("/counselor/alerts").status_code == 401, "no token is 401"
    for kind in ("parent", "os", "handheld"):
        r = client.get("/counselor/alerts", headers=bearer[kind])
        assert r.status_code == 403 and "private words" not in r.text, f"{kind} must get 403, got {r.status_code}"
    assert receipts() == [], "a refused request writes no receipt"
    print("ok parent and kid tokens get 403")

    r = client.get("/counselor/alerts", headers=bearer["counselor"])
    assert r.status_code == 200, r.text
    alerts = r.json()
    assert [a["kinds"] for a in alerts] == [["abuse"], ["abuse"]], f"the abuse alerts only, never bullying or SOS: {alerts}"
    assert all(a["excerpt"] == "private words" for a in alerts), "excerpts decrypt, and another kid's never show"
    assert alerts[0]["at"] > alerts[1]["at"], "newest first"
    print("ok the counselor sees the abuse alerts with excerpts, not the bullying ones")

    got = receipts()
    assert [tuple(r) for r in got] == [("counselor", "maya", f"alert {a['alert_id']}") for a in alerts], got
    print("ok one counselor receipt per excerpt read")


def check_context_case_and_parent() -> None:
    client, deps, bearer, stand, say, fresh_start, session = setup()
    say("what is lava made of?")
    fresh_start()
    first = say("how do bees make honey?")
    say("can bees see colors?")
    stand.decide_result = decisions(alerts={"bullying": 0.9})
    say("kids on the bus call me names")
    stand.decide_result = decisions(alerts={"abuse": 0.9})
    flagged = say("someone at home hurts me")
    stand.decide_result = None
    say("what do bees eat in winter?")

    row = deps.conn.execute("SELECT id, source_turn_id, session_id FROM alert WHERE routed_to = 'counselor'").fetchone()
    assert (row["source_turn_id"], row["session_id"]) == (flagged, session(first)), "the alert names its turn and session"
    alert_id = row["id"]
    parent_alert = deps.conn.execute("SELECT id FROM alert WHERE routed_to = 'parent'").fetchone()[0]

    [a] = client.get("/counselor/alerts", headers=bearer["counselor"]).json()
    kid_lines = [t["text"] for t in a["context"] if t["role"] == "kid"]
    assert kid_lines == ["how do bees make honey?", "can bees see colors?"], \
        f"context is the alert's own session before it, never another session or a later turn: {kid_lines}"
    assert [t["role"] for t in a["context"]] == ["kid", "kite"] * 2, a["context"]
    assert (a["said"], a["reply"]) == ("someone at home hurts me", ALERT_REPLY["abuse"]), a
    assert (a["status"], a["history"], a["context_purged"]) == ("new", [], False), a
    print("ok context is the turns before the alert in its own session")

    parent_events = asyncio.run(drain(deps.bus, "parent"))
    assert not [e for e in parent_events if e.turn_id == flagged], "no parent event for a counselor-routed turn"
    dash = client.get(f"/kids/{KID_ID}/dashboard", headers=bearer["parent"])
    assert dash.status_code == 200 and parent_alert in dash.text, dash.text[:200]
    for secret in (alert_id, "hurts me", ALERT_REPLY["abuse"]):
        assert secret not in dash.text, "the parent's dashboard never holds the counselor's alert or its words"
    path = f"/counselor/alerts/{alert_id}/status"
    for kind in ("parent", "os", "handheld"):
        for method, route in ROUTES:
            assert getattr(client, method)(route, headers=bearer[kind]).status_code == 403, f"{kind} on {route}"
        assert client.put(path, json={"status": "closed"}, headers=bearer[kind]).status_code == 403, kind
    print("ok the parent never sees the counselor's alert, its words or its routes")

    note = "Met with her at 10. Safety plan in place."
    r = client.put(path, json={"status": "met_with_student", "note": f"  {note} "}, headers=bearer["counselor"])
    assert r.status_code == 200, r.text
    assert [(c["status"], c["note"]) for c in r.json()] == [("met_with_student", note)], r.json()
    assert client.put(path, json={"status": "met_with_student"}, headers=bearer["counselor"]).status_code == 422, \
        "the same status with no note changes nothing"
    r = client.put(path, json={"status": "closed"}, headers=bearer["counselor"])
    assert [c["status"] for c in r.json()] == ["met_with_student", "closed"], r.json()
    other = f"/counselor/alerts/{parent_alert}/status"
    assert client.put(other, json={"status": "closed"}, headers=bearer["counselor"]).status_code == 404, \
        "a parent-routed alert has no counselor case"
    sealed = deps.conn.execute("SELECT note FROM alert_case WHERE note IS NOT NULL").fetchone()[0]
    assert note.encode() not in sealed, "the note is sealed at rest"
    [a] = client.get("/counselor/alerts", headers=bearer["counselor"]).json()
    assert a["status"] == "closed" and a["history"][0]["note"] == note, a
    print("ok a status change is recorded, sealed and returned")

    student = client.get("/counselor/student", headers=bearer["counselor"]).json()
    assert (student["name"], student["grade"]) == ("Maya", 11), student
    assert student["reports"] == {"new": 0, "reviewing": 0, "met_with_student": 0, "reported": 0, "closed": 1}, student
    assert student["last_heard"] is not None, student
    trail = client.get("/counselor/receipts", headers=bearer["counselor"]).json()
    whats = [t["what"] for t in trail]
    assert whats[:3] == ["student profile", f"alert {alert_id}", f"case {alert_id} closed"], whats
    assert f"case {alert_id} met_with_student with a note" in whats, whats
    assert {t["who"] for t in trail} == {"counselor"}, "the parent's reads stay out of the counselor's trail"
    print("ok the student profile counts reports by status, and every read and change is in the trail")

    long_ago = ledger.iso(datetime.now(timezone.utc) + ledger.ALERT_TTL - ledger.SESSION_TURN_TTL - timedelta(hours=1))
    deps.conn.execute("UPDATE alert SET expires_at = ? WHERE id = ?", (long_ago, alert_id))
    [a] = client.get("/counselor/alerts", headers=bearer["counselor"]).json()
    assert (a["context"], a["context_purged"], a["said"]) == ([], True, "someone at home hurts me"), a
    print("ok after 30 days the context is gone and says so; her words stay with the alert")


def run() -> None:
    check_inbox()
    check_context_case_and_parent()


if __name__ == "__main__":
    run()
