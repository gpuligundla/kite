"""Memory claims with local stand-ins for the model, Decision-1 and embeddings.
Run from brain/: uv run python -m scripts.checks.memory

The gate rule and the guidance word rule are the claims that matter here. The live gate
check against real Haiku and Decision-1 is the night shift's job."""

import asyncio
import re
import zlib
from datetime import timedelta
from types import SimpleNamespace

import numpy as np

from kite_brain.contract import ConceptEvidence
from kite_brain.decide import DecideUnavailable, Decisions
from kite_brain.memory import ledger, maps
from kite_brain.memory.embed import top_k
from kite_brain.memory.recall import guidance_for, kid_view, recall
from kite_brain.memory.writer import Candidates, CharacterDraft, FinishedTurn, write_memory
from kite_brain.seed import KID_ID
from scripts.checks.ledger import CATALOG, NOW, T0, add, fresh

BANNED = re.compile(r"growing|weak|level|score", re.I)
PERSONAL = ["my dad yelled at me", "my parents are getting divorced", "Sam lives on Oak St"]


def fake_embed(texts):
    rows = np.array([np.random.default_rng(zlib.crc32(t.encode())).normal(size=16) for t in texts])
    return rows / np.linalg.norm(rows, axis=1, keepdims=True)


async def async_embed(texts):
    return fake_embed(texts)


def deps_for(conn, keys, candidates, yes, backend="decision1", unavailable=False):
    async def parse(request, model_cls):
        return candidates

    async def decide(context, questions):
        if unavailable:
            raise DecideUnavailable("down")
        return Decisions({q.name: {"yes": yes, "no": 1 - yes} for q in questions}, backend)

    return SimpleNamespace(
        conn=conn, keys=keys, catalog=CATALOG, llm=SimpleNamespace(parse=parse), embed=async_embed,
        decide=decide,
    )


def turn(text="hi", concept_id=None, initiative="assigned_work", session="s1", turn_id="t1"):
    return FinishedTurn(KID_ID, 1, T0, session, turn_id, text, "ok", initiative, concept_id, "answer")


def stored(conn, keys):
    return [e.payload for e in ledger.events(conn, keys, KID_ID, 12)]


def candidates(interests=(), names=()):
    return Candidates(interests=list(interests), characters=[CharacterDraft(name=n) for n in names], style=None)


def check_write_gate_fails_closed() -> None:
    for text in PERSONAL:
        conn, keys = fresh()
        deps = deps_for(conn, keys, candidates(names=["Dad", "Sam"]), yes=0.1)
        assert asyncio.run(write_memory(turn(text), deps)) == [], f"nothing stored for {text!r}"
        assert stored(conn, keys) == [], f"ledger must stay empty for {text!r}"

    conn, keys = fresh()
    haiku = deps_for(conn, keys, candidates(names=["Rexy"]), yes=1.0, backend="haiku")
    asyncio.run(write_memory(turn(), haiku))
    assert stored(conn, keys) == [], "a haiku-backend decision at 1.0 must store nothing"

    down = deps_for(conn, keys, candidates(names=["Rexy"]), yes=1.0, unavailable=True)
    asyncio.run(write_memory(turn(), down))
    assert stored(conn, keys) == [], "no decision at all must store nothing"

    ok = deps_for(conn, keys, candidates(names=["Rexy"]), yes=0.95)
    asyncio.run(write_memory(turn(), ok))
    assert [p.name for p in stored(conn, keys)] == ["Rexy"], "an approved character is stored"


def check_interests_and_dedupe() -> None:
    conn, keys = fresh()
    deps = deps_for(conn, keys, candidates(interests=["dinosaurs", "cryptozoology"], names=["Rexy"]), yes=0.95)
    asyncio.run(write_memory(turn(), deps))
    asyncio.run(write_memory(turn(turn_id="t2"), deps))
    facts = [(p.fact_kind, getattr(p, "topic", None) or p.name) for p in stored(conn, keys)]
    assert facts == [("interest", "dinosaurs"), ("favorite_character", "Rexy")], \
        "unknown topic dropped and a repeat adds nothing"


def check_curiosity_and_moment() -> None:
    conn, keys = fresh()
    deps = deps_for(conn, keys, candidates(), yes=0.95)
    kinds = asyncio.run(write_memory(
        turn(concept_id="dino_what", initiative="own_question"), deps))
    assert kinds == ["curiosity_signal", "moment"], kinds
    vec = conn.execute("SELECT COUNT(*) FROM moment_vector").fetchone()[0]
    assert vec == 1, "a moment gets its vector"
    kinds = asyncio.run(write_memory(
        turn(concept_id="dino_diets", initiative="follow_up_why", session="s2", turn_id="t2"), deps))
    assert kinds.count("curiosity_signal") == 2, "same topic in a later session adds a return visit"
    again = asyncio.run(write_memory(
        turn(concept_id="dino_diets", initiative="follow_up_why", session="s2", turn_id="t3"), deps))
    assert again == ["curiosity_signal"], "one return visit per topic per session, and no repeat moment"
    assigned = asyncio.run(write_memory(turn(concept_id="light_see", initiative="assigned_work"), deps))
    assert assigned == ["moment"], "homework says nothing about curiosity"


def check_guidance_and_recall() -> None:
    conn, keys = fresh()
    t = lambda i: T0 + timedelta(hours=i)
    add(conn, keys, ConceptEvidence(outcome="partly", source="game"), at=t(0), session="s1", concept="dino_diets")
    add(conn, keys, ConceptEvidence(outcome="partly", source="game"), at=t(1), session="s2", concept="dino_diets")
    for i in range(2):
        add(conn, keys, ConceptEvidence(outcome="got_it", source="game"), at=t(i), concept="light_see")
    skills = maps.skills_map(ledger.events(conn, keys, KID_ID, 12), CATALOG, 12)
    for cid in ("dino_diets", "light_see"):
        lines = guidance_for(skills, cid, CATALOG)
        text = " ".join(lines)
        assert lines and not BANNED.search(text), f"guidance for {cid} has level words: {text!r}"
        other = "light_see" if cid == "dino_diets" else "dino_diets"
        assert CATALOG.get(other).kid_name not in text, "guidance must cover only the current concept"
    assert guidance_for(skills, "dino_what", CATALOG) == [], "no evidence, no guidance"

    deps = deps_for(conn, keys, candidates(), yes=0.95)
    q = fake_embed(["x"])[0]
    plain = asyncio.run(recall(deps, KID_ID, 12, q, "dino_diets", 0.0))
    assert plain.guidance, "guidance is kept for a normal turn"
    about = asyncio.run(recall(deps, KID_ID, 12, q, "dino_diets", 0.25))
    assert about.guidance == [], "guidance is dropped when about_me is plausible"
    dump = about.kid_view.model_dump_json()
    assert not re.search(r"skills|frontier|can_teach|got_it|level|score", dump), "kid view has no skills data"
    assert set(type(about.kid_view).model_fields) == {"interests", "characters", "moments", "deep_topics"}


def check_history_and_moments() -> None:
    conn, keys = fresh()
    from scripts.checks.ledger import seal_row
    far = (NOW + timedelta(days=30)).isoformat()
    for i in range(12):
        tid = f"h{i:02d}"
        conn.execute(
            "INSERT INTO session_turn VALUES (?, ?, 's1', 'os', 'kid', ?, ?, ?)",
            (tid, KID_ID, (T0 + timedelta(minutes=i)).isoformat(), far,
             seal_row(keys, "session_turn", tid, f"msg {i}")),
        )
    deps = deps_for(conn, keys, candidates(), yes=0.95)
    asyncio.run(write_memory(turn(concept_id="dino_what", initiative="own_question"), deps))
    out = asyncio.run(recall(deps, KID_ID, 12, fake_embed(["Figured out"])[0], None, 0.0))
    assert [text for _, text in out.history] == [f"msg {i}" for i in range(2, 12)], "last 10, oldest first"
    assert len(out.kid_view.moments) == 1 and out.kid_view.moments[0].startswith("Figured out"), out.kid_view


def check_top_k_cosine() -> None:
    mat = np.array([[1.0, 0.0], [0.6, 0.8], [0.0, 1.0], [-1.0, 0.0]])
    got = top_k(np.array([0.8, 0.6]), mat, 3)
    assert [i for i, _ in got] == [1, 0, 2], f"cosine order, got {got}"
    assert abs(got[0][1] - 0.96) < 1e-6, "scores are cosines"


def check_how_she_learns() -> None:
    conn, keys = fresh()
    step = iter(range(100))
    ev = lambda cid, outcome, source, grade=1: add(  # noqa: E731
        conn, keys, ConceptEvidence(outcome=outcome, source=source), grade=grade, concept=cid,
        at=T0 + timedelta(minutes=next(step)))
    ev("light_see", "got_it", "game"), ev("light_see", "got_it", "teach_back")
    ev("light_shadows", "not_yet", "check_question"), ev("light_shadows", "got_it", "game")
    ev("light_rainbow", "partly", "game")
    ev("light_reflect", "got_it", "teach_back", grade=4), ev("light_reflect", "got_it", "teach_back", grade=4)
    got = maps.how_she_learns(ledger.events(conn, keys, KID_ID, 12))
    assert got == {"game": 0.5, "check_question": 0.0, "teach_back": 1.0}, f"first-met mode keys, share math: {got}"
    capped = maps.how_she_learns(ledger.events(conn, keys, KID_ID, 3))
    assert capped == {"game": 0.5, "check_question": 0.0}, f"grade 3 hides the grade-4 concept: {capped}"
    assert maps.how_she_learns([]) == {}, "no evidence, no modes"


def run() -> None:
    for check in (check_how_she_learns, check_write_gate_fails_closed, check_interests_and_dedupe, check_curiosity_and_moment,
                  check_guidance_and_recall, check_history_and_moments, check_top_k_cosine):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
