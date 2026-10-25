"""Counselor demo data, made by the real pipeline. Scripted kid turns go to a running brain's /turns, so
decision-1 and the safety layer classify them. Each scenario is then moved back into the last month, and the
older abuse report's case is worked through to closed. Synthetic words for Maya, a fictional seeded kid.

Run it once against a fresh copy of the demo snapshot, with a brain serving that copy. From brain/:

    cp <snapshot> data/counselor-work.db
    KITE_DB_PATH=data/counselor-work.db uv run uvicorn kite_brain.api:app --port 8002
    uv run python -m scripts.seed_counselor --brain http://localhost:8002 --db data/counselor-work.db

It refuses a database that already has counselor reports, so a rerun starts from a fresh copy.
It prints routes and dates only, never the words.
"""

import argparse
import sqlite3
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import httpx

from kite_brain.config import get_settings
from kite_brain.crypto import FamilyKeys, master_key
from kite_brain.memory import ledger
from kite_brain.seed import KID_ID, device_token

LOCAL = ZoneInfo("America/New_York")
WAIT_S = 180


@dataclass(frozen=True)
class Scenario:
    days_ago: int
    clock: tuple[int, int]  # local hour and minute of the alert
    # Ordinary turns before it, in the same session. They are her own questions, not homework: the simulated
    # class has a live quiz, and anything that reads as assigned work pauses Kite instead of answering.
    lead_in: tuple[str, ...]
    words: str
    kind: str
    routed_to: str


SCENARIOS = (
    Scenario(21, (21, 42), (
        "i just watched a video about the great depression. why did fdr start so many new programs all at once?",
        "wait so which of those are still around today?",
        "ok cool. i'm gonna go to the library after school tomorrow and read more about it",
    ), "my stepdad gets really angry when he drinks and last night he shoved me into the wall. i have a bruise on "
       "my arm and i'm scared to go home", "abuse", "counselor"),
    Scenario(12, (16, 10), (), "some girls in my grade made a group chat just to make fun of me and they keep posting "
             "screenshots of my stuff. everyone at school is laughing about it", "bullying", "parent"),
    Scenario(7, (19, 55), (), "someone i met in a game chat keeps messaging me and asking for my address so he can send "
             "me a gift. i've never met him in real life", "stranger", "parent"),
    Scenario(1, (22, 18), ("random question but why do i remember song lyrics so much better than stuff i study?",),
             "my stepdad did it again tonight. he grabbed my wrist so hard it hurt and said if i tell anyone i'll "
             "regret it. i don't feel safe at home", "abuse", "counselor"),
)

# The older report's case: (days and local time after the alert's day, status, note).
CASE = (
    (1, (7, 48), "reviewing", "Read this before first period. Asked her English teacher to send her down during 2nd."),
    (1, (10, 5), "met_with_student", "Met with Maya for 40 minutes. She confirmed her stepdad pushed her when he'd "
                 "been drinking; bruise on her upper arm. She feels safe at school and is staying at her aunt's tonight."),
    (1, (10, 52), "reported", "Called the state child abuse hotline per district policy; intake taken by phone. "
                  "Principal informed. Did not contact the parents first."),
    (7, (15, 30), "closed", "CPS caseworker visited the home. Safety plan in place: weekends at her aunt's. "
                  "Weekly check-ins with me continue."),
)


def local(day: datetime, hm: tuple[int, int]) -> datetime:
    return day.astimezone(LOCAL).replace(hour=hm[0], minute=hm[1], second=0, microsecond=0).astimezone(timezone.utc)


def wait_for(conn: sqlite3.Connection, sql: str, args: tuple):
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        if row := conn.execute(sql, args).fetchone():
            return row
        time.sleep(0.5)
    return None


def say(client: httpx.Client, conn: sqlite3.Connection, text: str, expect_alert: bool):
    """Post one turn and wait for what it stores: an alert row, or the turn's session row."""
    turn_id = client.post("/turns", data={"kid_id": KID_ID, "device": "os", "text": text}).raise_for_status().json()["turn_id"]
    if expect_alert:
        row = wait_for(conn, "SELECT * FROM alert WHERE source_turn_id = ?", (turn_id,))
    else:
        row = wait_for(conn, "SELECT * FROM session_turn WHERE id = ?", (turn_id,))
        if conn.execute("SELECT 1 FROM alert WHERE source_turn_id = ?", (turn_id,)).fetchone():
            sys.exit(f"turn {turn_id}: a lead-in raised an alert; reword it")
    if row is None:
        sys.exit(f"turn {turn_id}: nothing stored after {WAIT_S}s (fallback route?); check the brain's log")
    return turn_id, row


def shift(conn: sqlite3.Connection, table: str, where: str, args: tuple, delta: timedelta, cols: tuple[str, ...]):
    """Move rows' timestamps by delta. Every sealed column's AAD is (table, kid, id), so no seal changes."""
    for row in conn.execute(f"SELECT rowid, {', '.join(cols)} FROM {table} WHERE {where}", args).fetchall():
        moved = [ledger.iso(datetime.fromisoformat(row[c]) + delta) for c in cols]
        conn.execute(f"UPDATE {table} SET {', '.join(f'{c} = ?' for c in cols)} WHERE rowid = ?", (*moved, row[0]))


def receipt(conn: sqlite3.Connection, what: str, at: datetime) -> None:
    conn.execute("INSERT INTO access_receipt(who, kid_id, what, at) VALUES ('counselor', ?, ?, ?)",
                 (KID_ID, what, ledger.iso(at)))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--brain", default="http://localhost:8002")
    parser.add_argument("--db", required=True, help="the database file that brain is serving")
    args = parser.parse_args()

    conn = sqlite3.connect(args.db, timeout=10)
    conn.row_factory = sqlite3.Row
    if conn.execute("SELECT 1 FROM alert WHERE routed_to = 'counselor'").fetchone():
        sys.exit("this database already has counselor reports; start again from a fresh snapshot copy")
    master = master_key(get_settings().KITE_MASTER_KEY)
    keys = FamilyKeys(conn, master)
    fresh_before = conn.execute("SELECT at FROM fresh_start WHERE kid_id = ?", (KID_ID,)).fetchone()
    client = httpx.Client(base_url=args.brain, timeout=30,
                          headers={"Authorization": f"Bearer {device_token(master, 'os')}"})

    now = datetime.now(timezone.utc)
    alerts = []
    for s in SCENARIOS:
        client.post(f"/kids/{KID_ID}/fresh-start").raise_for_status()  # its own session
        lead_ids = [say(client, conn, text, expect_alert=False)[0] for text in s.lead_in]
        turn_id, alert = say(client, conn, s.words, expect_alert=True)
        kinds = alert["kinds"]
        if alert["routed_to"] != s.routed_to or f'"{s.kind}"' not in kinds:
            sys.exit(f"turn {turn_id}: wanted {s.kind} to the {s.routed_to}, got {kinds} to the {alert['routed_to']}; "
                     "reword it, don't move a threshold")
        sessions = {r[0] for r in conn.execute(
            f"SELECT session_id FROM session_turn WHERE id IN ({','.join('?' * len(lead_ids))})", lead_ids)}
        if sessions - {alert["session_id"]}:
            sys.exit(f"turn {turn_id}: its lead-in landed in another session")
        target = local(now - timedelta(days=s.days_ago), s.clock)
        alerts.append((s, alert["id"], alert["session_id"], target - datetime.fromisoformat(alert["at"])))
        print(f"ok {s.kind} routed to the {s.routed_to} after {len(lead_ids)} lead-in turns")

    time.sleep(5)  # the last alert's spoken reply finishes; it stores nothing more
    for s, alert_id, session_id, delta in alerts:
        shift(conn, "alert", "id = ?", (alert_id,), delta, ("at", "expires_at"))
        shift(conn, "session_turn", "session_id = ?", (session_id,), delta, ("at", "expires_at"))
        shift(conn, "learning_event", "session_id = ?", (session_id,), delta, ("at",))
        shift(conn, "big_question_card", "source_turn_id IN (SELECT id FROM session_turn WHERE session_id = ?)",
              (session_id,), delta, ("at",))

    s, alert_id, _, delta = alerts[0]
    alert_day = local(now - timedelta(days=s.days_ago), s.clock)
    for i, (days, hm, status, note) in enumerate(CASE):
        at = local(alert_day + timedelta(days=days), hm)
        if i == 0:
            receipt(conn, f"alert {alert_id}", at - timedelta(minutes=3))
        ledger.record_case_change(conn, keys, kid_id=KID_ID, alert_id=alert_id, status=status, note=note, at=at)
        receipt(conn, f"case {alert_id} {status} with a note", at)

    conn.execute("DELETE FROM fresh_start WHERE kid_id = ?", (KID_ID,))
    if fresh_before:
        conn.execute("INSERT INTO fresh_start(kid_id, at) VALUES (?, ?)", (KID_ID, fresh_before[0]))
    conn.commit()
    for s, alert_id, _, _ in alerts:
        at, = conn.execute("SELECT at FROM alert WHERE id = ?", (alert_id,)).fetchone()
        status = conn.execute("SELECT status FROM alert_case WHERE alert_id = ? ORDER BY at DESC LIMIT 1",
                              (alert_id,)).fetchone()
        print(f"{s.kind:9} to the {s.routed_to:9} at {at[:16]}Z  case: {status[0] if status else '-'}")


if __name__ == "__main__":
    main()
