import sqlite3
from pathlib import Path

SCHEMA = Path(__file__).with_name("schema.sql")


def connect(path: str) -> sqlite3.Connection:
    # One connection, used only from the event loop: every handler and dependency that touches it is async,
    # so FastAPI never runs two of them on pool threads at once. check_same_thread=False only lets tests and
    # startup create it on another thread.
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA secure_delete=ON")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA.read_text())
    # Databases made before these columns existed (the demo snapshot) gain them here.
    have = {r[1] for r in conn.execute("PRAGMA table_info(alert)")}
    for column in ("source_turn_id", "session_id"):
        if column not in have:
            conn.execute(f"ALTER TABLE alert ADD COLUMN {column} TEXT")
    conn.commit()
