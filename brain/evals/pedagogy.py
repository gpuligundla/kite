"""The pedagogy check: does Kite's reading level follow the grade band (spec section 6)?
Each question is asked as a grade below Maya's own, so the turns are read-only and leave
the database as they found it."""

from dataclasses import dataclass, replace
from statistics import mean

from ulid import ULID

from evals import TapBus, answer_of
from evals.simulate import NoTts
from kite_brain.deps import Deps
from kite_brain.policy import band_for, fk_grade
from kite_brain.seed import KID_ID
from kite_brain.turn.pipeline import TurnInput, run_turn

QUESTIONS = [
    "Why is the sky blue?",
    "How do plants make their food?",
    "What makes a rainbow?",
    "Why do things fall down?",
]
GRADES = (1, 2, 3, 5, 6, 8, 9, 10)  # the first and last grade of each band below Maya's grade 11


@dataclass(frozen=True)
class ReadingPoint:
    band: str
    grade: int
    fk_mean: float | None  # None when no turn answered
    fk_max: float  # the band's ceiling
    n: int


async def run_pedagogy(deps: Deps) -> list[ReadingPoint]:
    tap = TapBus()
    deps = replace(deps, bus=tap, tts=NoTts())
    points = []
    for grade in GRADES:
        grades = []
        for question in QUESTIONS:
            inp = TurnInput(kid_id=KID_ID, device="os", mode="talk", text=question, as_of_grade=grade)
            await run_turn(inp, deps, str(ULID()))
            if answer := answer_of(tap.take()):
                grades.append(fk_grade(answer))
        band = band_for(grade)
        fk_mean = round(mean(grades), 2) if grades else None
        points.append(ReadingPoint(band.name, grade, fk_mean, band.fk_max, len(grades)))
    return points
