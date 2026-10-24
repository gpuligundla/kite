import os
import sqlite3

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

NONCE_BYTES = 12


def new_key() -> bytes:
    return AESGCM.generate_key(bit_length=256)


def aad(table: str, kid_id: str, row_id: str) -> str:
    return f"{table}:{kid_id}:{row_id}"


def seal(key: bytes, plaintext: bytes, aad: str) -> bytes:
    nonce = os.urandom(NONCE_BYTES)
    return nonce + AESGCM(key).encrypt(nonce, plaintext, aad.encode())


def open_sealed(key: bytes, blob: bytes, aad: str) -> bytes:
    """Raises cryptography.exceptions.InvalidTag when the key or aad is wrong."""
    return AESGCM(key).decrypt(blob[:NONCE_BYTES], blob[NONCE_BYTES:], aad.encode())


class FamilyKeys:
    """Per-family data keys, wrapped under the master key and stored in `family`."""

    def __init__(self, conn: sqlite3.Connection, master: bytes):
        self.conn = conn
        self.master = master
        self._cache: dict[str, bytes] = {}

    def create_family(self, family_id: str, name: str) -> None:
        wrapped = seal(self.master, new_key(), "family-key:" + family_id)
        self.conn.execute(
            "INSERT INTO family(id, name, wrapped_key) VALUES (?, ?, ?)", (family_id, name, wrapped)
        )
        self.conn.commit()

    def for_kid(self, kid_id: str) -> bytes:
        row = self.conn.execute(
            "SELECT f.id, f.wrapped_key FROM kid k JOIN family f ON f.id = k.family_id WHERE k.id = ?",
            (kid_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"unknown kid {kid_id}")
        family_id, wrapped = row
        if wrapped is None:
            self._cache.pop(family_id, None)
            raise LookupError(f"family {family_id} was shredded")
        if family_id not in self._cache:
            self._cache[family_id] = open_sealed(self.master, wrapped, "family-key:" + family_id)
        return self._cache[family_id]

    def shred(self, family_id: str) -> None:
        self._cache.pop(family_id, None)
        self.conn.execute("UPDATE family SET wrapped_key = NULL WHERE id = ?", (family_id,))
        self.conn.commit()
        self.conn.execute("VACUUM")
