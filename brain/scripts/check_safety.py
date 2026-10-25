"""Safety and privacy claims, as plain asserts. Run from brain/: uv run python -m scripts.check_safety"""

from datetime import datetime, timezone

from cryptography.exceptions import InvalidTag
from pydantic import TypeAdapter, ValidationError

from kite_brain.crypto import FamilyKeys, aad, new_key, open_sealed, seal
from kite_brain.contract import KiteEvent, LearningPayload
from kite_brain.db import connect, init_db
from scripts.checks import (
    about_kite, audiences, classroom, counselor, dashboard, decide, evals, forget, fresh_start, homework, ledger, memory,
    past_chats, pipeline, route, story, studio, studio_pro, teach, trust, voice,
)


def check_encryption() -> None:
    key = new_key()
    blob = seal(key, b"secret", aad("alert", "maya", "a1"))
    assert open_sealed(key, blob, aad("alert", "maya", "a1")) == b"secret", "seal round trip"
    try:
        open_sealed(key, blob, aad("alert", "sam", "a1"))
    except InvalidTag:
        pass
    else:
        raise AssertionError("another kid's AAD must fail with InvalidTag")


def check_shred() -> None:
    conn = connect(":memory:")
    init_db(conn)
    keys = FamilyKeys(conn, new_key())
    keys.create_family("rivera", "Rivera")
    conn.execute(
        "INSERT INTO kid(id, family_id, display_name, grade, school_start_year)"
        " VALUES ('maya', 'rivera', 'Maya', 11, 2015)"
    )
    keys.for_kid("maya")
    keys.shred("rivera")
    for reader in (keys, FamilyKeys(conn, keys.master)):
        try:
            reader.for_kid("maya")
        except LookupError:
            pass
        else:
            raise AssertionError("a shredded family must be unreadable")


def rejects(adapter: TypeAdapter, value: dict, why: str) -> None:
    try:
        adapter.validate_python(value)
    except ValidationError:
        return
    raise AssertionError(why)


def check_contract() -> None:
    event, payload = TypeAdapter(KiteEvent), TypeAdapter(LearningPayload)
    base = {"kid_id": "maya", "turn_id": "t1", "at": datetime.now(timezone.utc)}
    rejects(event, {**base, "type": "decided", "audience": "kid", "backend": "haiku",
                    "safety": {}, "sensitive_topic": "none", "initiative": "own_question",
                    "concept_id": None, "about_me": 0.0}, "kid must never get a decided event")
    rejects(event, {**base, "type": "alert", "audience": "parent", "alert_id": "a",
                    "kinds": ["abuse"], "routed_to": "counselor"},
            "a counselor alert must not carry the parent audience")
    fact = {"kind": "profile_fact", "fact_kind": "favorite_character", "sprite": "rexy"}
    payload.validate_python({**fact, "name": "x" * 40})
    rejects(payload, {**fact, "name": "x" * 41}, "character names are capped at 40")


if __name__ == "__main__":
    check_encryption()
    check_shred()
    check_contract()
    for area in (
        audiences, decide, ledger, memory, route, voice, pipeline, homework, teach, evals, studio_pro, about_kite, trust,
        dashboard, counselor, forget, fresh_start, past_chats, studio, story, classroom,
    ):
        area.run()
    print("ok")
