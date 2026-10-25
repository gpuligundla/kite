"""Past chats on the kid's screen: their own conversations, grouped by session, inside the 30-day window, with no
alert turns and no levels. Run from brain/: uv run python -m scripts.checks.past_chats"""

from datetime import datetime, timedelta, timezone

from kite_brain.crypto import aad, seal
from kite_brain.seed import KID_ID
from scripts.checks.forget import SKILL_WORDS, decisions
from scripts.checks.fresh_start import setup
from scripts.checks.memory import BANNED

PATH = f"/kids/{KID_ID}/history"
LONG = "why do some volcanoes explode with ash while other volcanoes just ooze slow rivers of lava down the side"


def insert_turn(deps, row_id, session_id, at, text, expires):
    deps.conn.execute(
        "INSERT INTO session_turn(id, kid_id, session_id, device, role, at, expires_at, text)"
        " VALUES (?, ?, ?, 'os', 'kid', ?, ?, ?)",
        (row_id, KID_ID, session_id, at, expires,
         seal(deps.keys.for_kid(KID_ID), text.encode(), aad("session_turn", KID_ID, row_id))),
    )
    deps.conn.commit()


def check_auth() -> None:
    client, _, bearer, *_ = setup()
    assert client.get(PATH).status_code == 401, "no token is 401"
    for kind in ("parent", "counselor"):
        assert client.get(PATH, headers=bearer[kind]).status_code == 403, f"{kind} devices don't read the kid's chats"
    assert client.get("/kids/sam/history", headers=bearer["os"]).status_code == 403, "another kid is 403"
    for kind in ("os", "handheld"):
        assert client.get(PATH, headers=bearer[kind]).json() == [], "no chats yet"


def check_grouping_window_and_alerts() -> None:
    client, deps, bearer, stand, say, fresh_start, _ = setup()
    say(LONG)
    say("what is lava made of?")
    fresh_start()
    say("how do bees make honey?")
    stand.decide_result = decisions(alerts={"abuse": 0.9})
    say("someone at school hurts me")
    stand.decide_result = None
    alert_at = deps.conn.execute("SELECT at FROM alert").fetchone()[0]
    far = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
    insert_turn(deps, "alerted", "s-alert", alert_at, "a turn stored at the alert's moment", far)
    gone = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    insert_turn(deps, "expired", "s-old", "2026-09-01T10:00:00+00:00", "an expired question", gone)

    r = client.get(PATH, headers=bearer["handheld"])
    assert r.status_code == 200, r.text
    chats = r.json()
    assert [c["title"] for c in chats] == ["how do bees make honey?", LONG[:59].rsplit(" ", 1)[0] + "…"], \
        f"one chat per session, newest first, titled by the first question: {[c['title'] for c in chats]}"
    old = chats[1]["turns"]
    assert [t["role"] for t in old] == ["kid", "kite"] * 2 and old[2]["text"] == "what is lava made of?", old
    assert chats[1]["at"] < chats[0]["at"], "each chat carries when it started"
    assert "hurts me" not in r.text and "alert's moment" not in r.text, "a turn that raised an alert never shows"
    assert "expired question" not in r.text, "the 30-day window holds even before the hourly purge"
    assert not BANNED.search(r.text) and not SKILL_WORDS.search(r.text), "no levels or scores"
    assert set(chats[0]) == {"id", "at", "title", "turns"} and set(old[0]) == {"role", "text"}, chats[0]


def run() -> None:
    for check in (check_auth, check_grouping_window_and_alerts):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
