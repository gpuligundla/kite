"""Kite OS reads on kid devices: the class (statuses match the homework guard), contact names with no numbers, and
the kid's own creations. Run from brain/: uv run python -m scripts.checks.classroom"""

import asyncio
import os
import tempfile
from datetime import timedelta
from pathlib import Path
from unittest.mock import patch

from kite_brain import studio_pro
from kite_brain.contract import Creation, GameItem, GameSpec
from kite_brain.homework import load_assignments, store_assignments
from kite_brain.seed import KID_ID
from kite_brain.studio.store import Meta, save_meta
from scripts.checks.dashboard import client_with_data
from scripts.checks.ledger import NOW

KID_ROUTES = (f"/kids/{KID_ID}/classroom", f"/kids/{KID_ID}/approved-contacts", f"/kids/{KID_ID}/creations")


def check_auth() -> None:
    client, _, bearer = client_with_data()
    for path in KID_ROUTES:
        assert client.get(path).status_code == 401, f"{path}: no token is 401"
        for kind in ("parent", "counselor"):
            assert client.get(path, headers=bearer[kind]).status_code == 403, f"{path}: {kind} devices get 403"
        other = path.replace(f"/kids/{KID_ID}/", "/kids/sam/")
        assert client.get(other, headers=bearer["os"]).status_code == 403, f"{other}: another kid is 403"
        for kind in ("os", "handheld"):
            assert client.get(path, headers=bearer[kind]).status_code == 200, f"{path}: the kid's {kind} reads it"


def check_classroom_statuses() -> None:
    client, deps, bearer = client_with_data()
    asyncio.run(store_assignments(deps, KID_ID, load_assignments(KID_ID, NOW)))
    get = lambda: client.get(f"/kids/{KID_ID}/classroom", headers=bearer["handheld"]).json()  # noqa: E731

    room = get()
    assert room["courses"] == [
        {"id": "math", "name": "Math", "teacher": "Ms. Okafor"}, {"id": "science", "name": "Science", "teacher": "Mr. Lee"},
    ], room["courses"]
    by_title = {a["title"]: a for a in room["assignments"]}
    statuses = {t: a["status"] for t, a in by_title.items()}
    assert statuses == {
        "Area and perimeter practice": "open", "Light and color quiz": "closed", "Water cycle quiz": "exam_live",
    }, f"the guard's statuses at NOW: {statuses}"
    quiz = by_title["Water cycle quiz"]
    assert quiz["kind"] == "quiz" and quiz["course_id"] == "science", quiz
    assert quiz["description"].startswith("1. What is evaporation"), "the description decrypts"
    assert quiz["questions"][0] == "What is evaporation, and what makes it happen?" and len(quiz["questions"]) == 4
    assert quiz["unlock_at"] < quiz["due_at"] == quiz["lock_at"], "unlock, due and lock times ride along"

    deps.clock = lambda: NOW - timedelta(hours=2)
    early = {a["title"]: a["status"] for a in get()["assignments"]}
    assert early["Water cycle quiz"] == "upcoming", f"before it unlocks the quiz is upcoming: {early}"
    assert early["Area and perimeter practice"] == "open", early


def check_contact_names() -> None:
    client, _, bearer = client_with_data()
    r = client.get(f"/kids/{KID_ID}/approved-contacts", headers=bearer["handheld"])
    assert r.json() == [{"id": "c1", "name": "Ana Rivera"}, {"id": "c2", "name": "Luis Rivera"}], r.json()
    assert "555" not in r.text and "phone" not in r.text, "a phone number never reaches the kid's device"


def check_my_creations() -> None:
    client, _, bearer = client_with_data()
    game = GameSpec(template="catch", title="Catch the raindrops", instructions="Catch them", concept_id="water_cycle_basic",
                    items=[GameItem(label="rain", sprite="drop", correct=True), GameItem(label="sun", sprite="sun", correct=False)])
    with tempfile.TemporaryDirectory() as tmp, patch.object(studio_pro, "CREATIONS_DIR", Path(tmp)):
        made = {
            "mine": Creation(id="mine", kind="game", status="ready", game=game),
            "theirs": Creation(id="theirs", kind="game", status="ready", game=game),
            "making": Creation(id="making", kind="movie", status="pending"),
            "agent": Creation(id="agent", kind="game", status="ready", html_url="/creations/agent/files/game.html"),
        }
        for cid, creation in made.items():
            (Path(tmp) / cid).mkdir()
            (Path(tmp) / cid / "creation.json").write_text(creation.model_dump_json())
        (Path(tmp) / "agent" / "game.html").write_text("<html><head><title>Rain Racer</title></head></html>")
        save_meta("mine", Meta(kid_id=KID_ID, grade=5, read_only=False))
        save_meta("theirs", Meta(kid_id="sam", grade=3, read_only=False))
        os.utime(Path(tmp) / "agent" / "creation.json", (1, 1))
        got = client.get(f"/kids/{KID_ID}/creations", headers=bearer["os"]).json()
    assert got == [
        {"id": "mine", "kind": "game", "title": "Catch the raindrops"},
        {"id": "agent", "kind": "game", "title": "Rain Racer"},
    ], f"hers and the showcase's, newest first; never another kid's or one still being made: {got}"


def run() -> None:
    for check in (check_auth, check_classroom_statuses, check_contact_names, check_my_creations):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
