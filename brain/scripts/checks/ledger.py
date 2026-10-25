"""Ledger and maps claims, as plain asserts. Run: uv run python -m scripts.checks.ledger"""

from datetime import datetime, timedelta, timezone

from kite_brain.catalog import Catalog
from kite_brain.contract import (
    ConceptEvidence, CuriositySignal, InterestFact, Moment,
)
from kite_brain.crypto import FamilyKeys, aad, new_key, seal
from kite_brain.db import connect, init_db
from kite_brain.memory import ledger, maps
from kite_brain.seed import KID_ID, seed

NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)
T0 = datetime(2016, 1, 10, 9, 0, tzinfo=timezone.utc)
CATALOG = Catalog.load()


def fresh():
    conn = connect(":memory:")
    init_db(conn)
    keys = FamilyKeys(conn, new_key())
    seed(conn, keys, NOW)
    return conn, keys


def add(conn, keys, payload, *, grade=1, at=T0, session="s1", turn="t1", concept=None, topic=None):
    return ledger.append(conn, keys, CATALOG, kid_id=KID_ID, grade=grade, at=at, session_id=session,
                         payload=payload, source_turn_id=turn, concept_id=concept, topic=topic)


def evidence(outcome, source="check_question", points=None):
    return ConceptEvidence(outcome=outcome, source=source, points=points)


def levels(skills):
    return {c.concept_id: c.level for c in skills.concepts}


def check_time_travel() -> None:
    conn, keys = fresh()
    add(conn, keys, InterestFact(topic="light"), grade=1)
    add(conn, keys, InterestFact(topic="gravity"), grade=8)
    at_2 = maps.profile_view(ledger.events(conn, keys, KID_ID, 2))
    assert at_2.interests == ["light"], "a grade-8 fact must not show as of grade 2"
    at_8 = maps.profile_view(ledger.events(conn, keys, KID_ID, 8))
    assert at_8.interests == ["light", "gravity"], "both facts show as of grade 8"


def check_encrypted_at_rest() -> None:
    conn, keys = fresh()
    add(conn, keys, Moment(concept_id="dino_what", character="Rexyzzq", source="answer"))
    blob = conn.execute("SELECT payload FROM learning_event").fetchone()[0]
    assert b"Rexyzzq" not in blob and b"moment" not in blob, "payload bytes must not hold plaintext"
    assert ledger.events(conn, keys, KID_ID, 12)[0].payload.character == "Rexyzzq", "round trip"


def seal_row(keys, table, row_id, text):
    return seal(keys.for_kid(KID_ID), text.encode(), aad(table, KID_ID, row_id))


def check_forget_turn() -> None:
    conn, keys = fresh()
    far = (NOW + timedelta(days=30)).isoformat()
    ev = add(conn, keys, evidence("got_it"), turn="t9", concept="dino_what")
    add(conn, keys, evidence("got_it"), turn="t8", concept="dino_what")
    conn.execute("INSERT INTO moment_vector VALUES (?, ?)", (ev, b"vec"))
    conn.execute(
        "INSERT INTO session_turn VALUES ('t9', ?, 's1', 'os', 'kid', ?, ?, ?)",
        (KID_ID, T0.isoformat(), far, seal_row(keys, "session_turn", "t9", "hi")),
    )
    conn.execute(
        "INSERT INTO big_question_card VALUES ('c9', ?, 1, ?, 'dinosaurs', 't9', ?, ?)",
        (KID_ID, T0.isoformat(), seal_row(keys, "big_question_card", "c9", "s"),
         seal_row(keys, "big_question_card", "c9", "q")),
    )
    conn.execute(
        "INSERT INTO alert VALUES ('a9', ?, '[\"bullying\"]', 'parent', ?, ?, ?, NULL, 't9', 's1')",
        (KID_ID, T0.isoformat(), far, seal_row(keys, "alert", "a9", "x")),
    )
    assert ledger.forget_turn(conn, KID_ID, "t9") == 1, "one event belonged to t9"
    count = lambda t: conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
    assert [count(t) for t in ("moment_vector", "session_turn", "big_question_card")] == [0, 0, 0]
    assert count("learning_event") == 1, "another turn's event stays"
    assert count("alert") == 1, "alerts stay as the safety record"


def check_real_time_expiry() -> None:
    conn, keys = fresh()
    simulated = datetime(2016, 3, 1, tzinfo=timezone.utc)
    real_expiry = (NOW + timedelta(days=30)).isoformat()
    for tid, expires in (("old", (NOW - timedelta(days=1)).isoformat()), ("sim2016", real_expiry)):
        conn.execute(
            "INSERT INTO session_turn VALUES (?, ?, 's1', 'os', 'kid', ?, ?, ?)",
            (tid, KID_ID, simulated.isoformat(), expires, seal_row(keys, "session_turn", tid, "hi")),
        )
    assert ledger.purge_expired(conn, NOW) == 1, "only the really expired turn goes"
    left = [r[0] for r in conn.execute("SELECT id FROM session_turn")]
    assert left == ["sim2016"], "a simulated-2016 chat written today is not purged"


def check_session_gap() -> None:
    conn, keys = fresh()
    s1 = ledger.session_for(conn, KID_ID, T0)
    add(conn, keys, evidence("got_it"), session=s1, at=T0, concept="dino_what")
    assert ledger.session_for(conn, KID_ID, T0 + timedelta(minutes=30)) == s1, "30 minutes reuses"
    assert ledger.session_for(conn, KID_ID, T0 + timedelta(minutes=31)) != s1, "31 minutes starts anew"


def check_skills_rules() -> None:
    conn, keys = fresh()
    t = lambda i: T0 + timedelta(hours=i)
    add(conn, keys, evidence("partly"), at=t(0), session="s1", concept="dino_what")
    add(conn, keys, evidence("got_it"), at=t(1), session="s1", concept="dino_what")
    add(conn, keys, evidence("got_it"), at=t(2), session="s1", concept="dino_what")
    add(conn, keys, evidence("got_it"), at=t(0), session="s1", concept="dino_diets")
    add(conn, keys, evidence("partly"), at=t(1), session="s2", concept="dino_diets")
    add(conn, keys, evidence("not_yet"), at=t(0), session="s1", concept="light_see")
    full = {"p1": "covered", "p2": "covered"}
    add(conn, keys, evidence("got_it", "teach_back", full), at=t(0), concept="dino_fossils")
    add(conn, keys, evidence("got_it", "teach_back", {"p1": "covered", "p2": "partly"}),
        at=t(0), concept="light_shadows")
    skills = maps.skills_map(ledger.events(conn, keys, KID_ID, 12), CATALOG, 12)
    lv = levels(skills)
    assert lv["dino_what"] == "got_it", "two got_it in a row"
    assert lv["dino_diets"] == "learning", "got_it then partly is not got_it"
    assert lv["light_see"] == "not_yet", "only not_yet outcomes"
    assert lv["dino_fossils"] == "can_teach" and skills.can_teach == ["dino_fossils"], "full teach-back"
    assert lv["light_shadows"] == "learning", "a partial teach-back is not can_teach"
    assert set(skills.growing) == {"dino_diets"}, "below got_it across 2 sessions only"
    assert "dino_extinction" in skills.frontier, "prereq dino_fossils is can_teach"
    assert "dino_timeline" in skills.frontier, "prereq dino_fossils is can_teach"
    assert "dino_birds" not in skills.frontier, "its prereqs have no evidence yet"
    assert "dino_what" not in skills.frontier, "evidenced concepts are not frontier"
    assert "light_shadows" not in skills.frontier and "light_reflect" not in skills.frontier


def check_curiosity_decay() -> None:
    conn, keys = fresh()
    as_of = maps.school_year_end(2015, 1)
    assert as_of == datetime(2017, 6, 15, tzinfo=timezone.utc), "school_year_end"
    add(conn, keys, CuriositySignal(signal="return_visit"), at=as_of, topic="light")
    add(conn, keys, CuriositySignal(signal="return_visit"), at=as_of - timedelta(days=180), topic="gravity")
    add(conn, keys, CuriositySignal(signal="own_question"), grade=0, at=as_of, topic="gravity")
    cur = maps.curiosity_map(ledger.events(conn, keys, KID_ID, 12), as_of)
    by = {t.topic: t for t in cur.topics}
    assert by["light"].score == 1.0, "top topic normalizes to 1"
    assert abs(by["gravity"].score - (1.5 + 1) / 3) < 1e-9, "one half-life halves the weight"
    assert by["gravity"].by_grade.keys() == {0, 1}, "per-grade trend"
    later = maps.curiosity_map(ledger.events(conn, keys, KID_ID, 12), as_of + timedelta(days=180))
    assert abs({t.topic: t for t in later.topics}["light"].score - 1.0) < 1e-9, "relative scores keep shape"


def check_strength() -> None:
    conn, keys = fresh()
    at = lambda i: T0 + timedelta(hours=i)
    for i, cid in enumerate(["dino_what", "dino_what", "dino_diets", "dino_diets", "light_see", "light_see"]):
        add(conn, keys, evidence("got_it"), at=at(i), concept=cid)
    for i in range(3):
        add(conn, keys, CuriositySignal(signal="return_visit"), at=at(i), topic="dinosaurs")
        add(conn, keys, CuriositySignal(signal="return_visit"), at=at(i), topic="light")
    evts = ledger.events(conn, keys, KID_ID, 12)
    skills, cur = maps.skills_map(evts, CATALOG, 12), maps.curiosity_map(evts, NOW)
    assert maps.strength_topics(skills, cur, CATALOG, 12) == ["dinosaurs"], "2 evidenced concepts count"
    # light has top curiosity too but only one evidenced concept, and frontier concepts never count.


def run() -> None:
    for check in (check_time_travel, check_encrypted_at_rest, check_forget_turn, check_real_time_expiry,
                  check_session_gap, check_skills_rules, check_curiosity_decay, check_strength):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
