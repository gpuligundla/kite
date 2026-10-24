import argparse
import hashlib
import hmac
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import get_args

from kite_brain.config import get_settings
from kite_brain.contract import DeviceKind, SensitiveTopic
from kite_brain.crypto import FamilyKeys, aad, master_key, seal
from kite_brain.db import connect, init_db

FAMILY_ID = "rivera"
KID_ID = "maya"
CONTACTS = [("c1", "Ana Rivera", "+1-555-0100"), ("c2", "Luis Rivera", "+1-555-0101")]


@dataclass
class SeedResult:
    family_id: str
    kid_id: str
    tokens: dict[DeviceKind, str]


def device_token(master: bytes, kind: str) -> str:
    """Derived from the master key, so reseeding reproduces the same tokens and the
    database only ever stores their hashes."""
    return hmac.new(master, f"device:{KID_ID}:{kind}".encode(), hashlib.sha256).hexdigest()


def seed(conn: sqlite3.Connection, keys: FamilyKeys, now: datetime) -> SeedResult:
    """Idempotent. `now` is reserved for Task 12, which stores the simulated class with
    dates relative to it."""
    if not conn.execute("SELECT 1 FROM family WHERE id = ?", (FAMILY_ID,)).fetchone():
        keys.create_family(FAMILY_ID, "Rivera")
    conn.execute(
        "INSERT OR IGNORE INTO kid(id, family_id, display_name, grade, school_start_year)"
        " VALUES (?, ?, 'Maya', 11, 2015)",
        (KID_ID, FAMILY_ID),
    )
    key = keys.for_kid(KID_ID)

    tokens = {kind: device_token(keys.master, kind) for kind in get_args(DeviceKind)}
    for kind, token in tokens.items():
        conn.execute(
            "INSERT OR IGNORE INTO device(id, kid_id, kind, token_hash) VALUES (?, ?, ?, ?)",
            (f"{KID_ID}-{kind}", KID_ID, kind, hashlib.sha256(token.encode()).hexdigest()),
        )
    for contact_id, name, phone in CONTACTS:
        a = aad("contact", KID_ID, contact_id)
        conn.execute(
            "INSERT OR IGNORE INTO contact(id, kid_id, name, phone) VALUES (?, ?, ?, ?)",
            (contact_id, KID_ID, seal(key, name.encode(), a), seal(key, phone.encode(), a)),
        )
    for topic in get_args(SensitiveTopic):
        if topic != "none":
            conn.execute(
                "INSERT OR IGNORE INTO policy(family_id, topic, action) VALUES (?, ?, ?)",
                (FAMILY_ID, topic, "answer_and_tell" if topic == "death" else "answer"),
            )
    conn.commit()
    return SeedResult(FAMILY_ID, KID_ID, tokens)


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Rivera family and print device tokens.")
    parser.add_argument("--assets", action="store_true",
                        help="also build concept vectors (Task 7) and the simulated class (Task 12)")
    args = parser.parse_args()

    settings = get_settings()
    Path(settings.KITE_DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = connect(settings.KITE_DB_PATH)
    init_db(conn)
    result = seed(conn, FamilyKeys(conn, master_key(settings.KITE_MASTER_KEY)), datetime.now(timezone.utc))
    for kind, token in result.tokens.items():
        print(f"{kind}: {token}")
    if args.assets:
        print("--assets: concept vectors and the simulated class are built by Tasks 7 and 12")


if __name__ == "__main__":
    main()
