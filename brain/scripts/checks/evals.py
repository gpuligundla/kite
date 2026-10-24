"""The night shift's claims, with the stand-ins from checks/pipeline.py: the simulator's
time and grade stamping, the demo-shape check, and the red team's split, calibration and
scorecard rules. Run from brain/ with -m (a path run would import this file as `evals`):
uv run python -m scripts.checks.evals"""

import asyncio
import itertools
from datetime import datetime, timedelta

from evals import simulate as sim
from evals.shape import assert_demo_shape
from kite_brain.contract import ConceptEvidence, CuriositySignal
from kite_brain.decide import Decisions
from kite_brain.deps import ToolCall
from kite_brain.memory import ledger, maps
from kite_brain.seed import KID_ID
from kite_brain.turn import pipeline
from scripts.checks.ledger import CATALOG, NOW, T0, add, evidence
from scripts.checks.memory import candidates, fake_embed
from scripts.checks.pipeline import StandIns, deps_for

SCRIPT = [
    sim.PersonaMove(kind="ask", text="Why do dinosaurs have such big teeth?"),
    sim.PersonaMove(kind="teach", text="Light bounces off things and that is how we see."),
    sim.PersonaMove(kind="movie", text="Make me a movie about light."),
]


class SimStand(StandIns):
    """Answers every decision question with its first label, plays Maya from SCRIPT, and
    makes a movie when she asks for one."""

    def __init__(self):
        super().__init__()
        self.moves = itertools.cycle(SCRIPT)

    async def decide(self, context, questions):
        answers = {
            q.name: {a: float(a == ("covered" if q.name.startswith("teach_point") else q.answers[0])) for a in q.answers}
            for q in questions
        }
        return Decisions(answers, "decision1")

    async def parse(self, request, model_cls):
        return next(self.moves) if model_cls is sim.PersonaMove else candidates()

    async def stream(self, request):
        async for word in super().stream(request):
            yield word
        if "movie" in request.messages[0]["content"]:
            yield ToolCall(name="make_movie", topic="light", learning_goal="how we see")


def play(grades, turns):
    stand = SimStand()
    deps, _ = deps_for(stand)
    CATALOG.vectors = fake_embed([c.name for c in CATALOG.concepts])
    try:
        report = asyncio.run(sim.simulate(lambda: deps, grades, turns, 2015))
    finally:
        CATALOG.vectors = None
    return deps, report


def check_simulation_stamps_grade_and_year() -> None:
    original = pipeline.act_on_tool_call
    deps, report = play([1, 2], 3)
    assert report.turns == 6 and report.by_grade == {1: 3, 2: 3}, report
    assert report.teach_turns == 2, "one teach move per grade"
    evts = ledger.events(deps.conn, deps.keys, KID_ID, 12)
    assert {e.grade for e in evts} == {1, 2}, "events carry the grade being played"
    for e in evts:
        assert datetime(2015 + e.grade, 9, 1, tzinfo=e.at.tzinfo) <= e.at <= maps.school_year_end(2015, e.grade), (
            f"grade {e.grade} event at {e.at} is outside its school year"
        )
    rows = deps.conn.execute("SELECT at FROM session_turn").fetchall()
    assert len(rows) == 12, "kid and kite rows for six turns"
    ats = {g: [e.at for e in evts if e.grade == g] for g in (1, 2)}
    assert max(ats[1]) < min(ats[2]), "grades keep their own, ordered, clocks"
    assert deps.conn.execute("SELECT grade FROM kid").fetchone()[0] == 11, "Maya's real grade is restored"
    assert pipeline.act_on_tool_call is original, "the tool-call hook is restored"


def check_teach_moves_produce_evidence_and_creations() -> None:
    deps, _ = play([1, 2], 3)
    evts = ledger.events(deps.conn, deps.keys, KID_ID, 12)
    for grade in (1, 2):
        teach = [e for e in evts if e.grade == grade and isinstance(e.payload, ConceptEvidence)
                 and e.payload.source == "teach_back"]
        assert teach, f"grade {grade}: a teach move must leave teach-back evidence"
    chose = [e for e in evts if isinstance(e.payload, CuriositySignal) and e.payload.signal == "chose_creation"]
    assert [(e.grade, e.topic) for e in chose] == [(1, "light"), (2, "light")], "a movie only records chose_creation"


def check_no_turn_after_the_real_now() -> None:
    times = sim.turn_times(11, 2015, 30, NOW - timedelta(hours=1))
    assert len(times) == 30 and times == sorted(times), "ordered"
    assert times[0] >= datetime(2026, 9, 8, tzinfo=NOW.tzinfo) and times[-1] < NOW, "grade 11 stops before now"
    assert times[sim.PER_SESSION] - times[sim.PER_SESSION - 1] > timedelta(hours=1), "sittings are apart"
    assert times[1] - times[0] == sim.TURN_GAP, "turns inside a sitting are minutes apart"


def thin_and_rich():
    thin, _ = deps_for(StandIns())
    rich, _ = deps_for(StandIns())
    conn, keys = rich.conn, rich.keys
    add(conn, keys, CuriositySignal(signal="own_question"), grade=3, topic="dinosaurs")
    for concept in ("dino_what", "dino_diets"):
        for session in ("s1", "s2"):
            add(conn, keys, evidence("got_it"), grade=1, concept=concept, session=session)
    for session in ("s1", "s2"):
        add(conn, keys, evidence("partly"), grade=3, concept="ap_perimeter", session=session)
    taught = ConceptEvidence(outcome="got_it", source="teach_back", points={"p": "covered"})
    for concept in ("light_see", "light_shadows", "water_where"):
        add(conn, keys, taught, grade=5, concept=concept)
    for i in range(300):
        conn.execute(
            "INSERT INTO session_turn(id, kid_id, session_id, device, role, at, expires_at, text)"
            " VALUES (?, ?, 's', 'os', 'kid', ?, ?, x'00')", (f"t{i}", KID_ID, T0.isoformat(), NOW.isoformat()),
        )
    for i in range(2):
        conn.execute(
            "INSERT INTO big_question_card(id, kid_id, grade, at, topic, source_turn_id, summary, starter)"
            " VALUES (?, ?, 5, ?, 'death', 't0', x'00', x'00')", (f"c{i}", KID_ID, T0.isoformat()),
        )
    conn.commit()
    return thin, rich


def check_shape_reports_missing_growing_area() -> None:
    thin, rich = thin_and_rich()
    failures = assert_demo_shape(thin)
    for need in ("turns", "dinosaurs", "area_perimeter", "can_teach", "cards"):
        assert any(need in f for f in failures), f"thin data must report {need}: {failures}"
    assert assert_demo_shape(rich) == [], assert_demo_shape(rich)
    assert any("turns" in f for f in assert_demo_shape(rich, min_turns=301)), "300 turns is not 301"
    add(rich.conn, rich.keys, evidence("got_it"), grade=3, concept="ap_perimeter", session="s3")
    add(rich.conn, rich.keys, evidence("got_it"), grade=3, concept="ap_perimeter", session="s4")
    assert any("area_perimeter" in f for f in assert_demo_shape(rich)), "a mastered area concept is not growing"


def run() -> None:
    for check in (
        check_simulation_stamps_grade_and_year, check_teach_moves_produce_evidence_and_creations,
        check_no_turn_after_the_real_now, check_shape_reports_missing_growing_area,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
