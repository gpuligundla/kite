"""Teach Kite (spec section 11): grade a child's explanation against the concept's key
points, merge attempts within a session, and brief Claude on how to respond."""

from dataclasses import dataclass

from kite_brain.catalog import Concept
from kite_brain.contract import ConceptEvidence, Outcome, Verdict
from kite_brain.decide import Decisions, top
from kite_brain.memory.ledger import LedgerEvent

RANK: dict[Verdict, int] = {"covered": 2, "partly": 1, "missing": 0, "wrong": 0}
TRY_AGAIN = "Want to try that part again?"


@dataclass(frozen=True)
class TeachGrade:
    verdicts: dict[str, Verdict]  # key point text -> verdict
    outcome: Outcome
    all_covered: bool

    @classmethod
    def of(cls, verdicts: dict[str, Verdict]) -> "TeachGrade":
        covered = sum(v == "covered" for v in verdicts.values())
        outcome: Outcome = (
            "got_it" if covered == len(verdicts) else "partly" if covered * 2 >= len(verdicts) else "not_yet"
        )
        return cls(verdicts, outcome, covered == len(verdicts))


def grade_teach(decisions: Decisions, concept: Concept) -> TeachGrade:
    return TeachGrade.of({
        point: top(decisions.answers[f"teach_point:{i}"])  # type: ignore[misc]
        for i, point in enumerate(concept.key_points)
    })


def merge_attempts(prev: TeachGrade | None, new: TeachGrade) -> TeachGrade:
    """Each point keeps its best verdict: covered over partly over missing or wrong."""
    if prev is None:
        return new
    return TeachGrade.of({
        point: v if RANK[v] >= RANK[prev.verdicts.get(point, "missing")] else prev.verdicts[point]
        for point, v in new.verdicts.items()
    })


def earlier_attempts(evts: list[LedgerEvent], concept_id: str, session_id: str) -> TeachGrade | None:
    """This session's teach-back evidence for the concept, merged. `evts` is oldest first."""
    merged = None
    for e in evts:
        p = e.payload
        if (
            e.concept_id == concept_id and e.session_id == session_id
            and isinstance(p, ConceptEvidence) and p.source == "teach_back" and p.points
        ):
            merged = merge_attempts(merged, TeachGrade.of(p.points))
    return merged


def _first_gap(grade: TeachGrade) -> tuple[str, Verdict]:
    """The first missing or wrong point, else the first partly one."""
    for wanted in (("missing", "wrong"), ("partly",)):
        for point, v in grade.verdicts.items():
            if v in wanted:
                return point, v
    raise ValueError("no gap in a fully covered grade")


def teach_feedback_context(kid_name: str, grade: int, concept: Concept, grade_: TeachGrade, words: str) -> str:
    lines = [
        f"The child is {kid_name}, in grade {grade}. They just taught you about {concept.kid_name}, and you listened.",
        f"What they said: {words}",
        "The points a good explanation covers, and how they did on each:",
        *(f"- {point}: {v}" for point, v in grade_.verdicts.items()),
    ]
    if grade_.all_covered:
        lines.append(
            "They covered every point. Celebrate with specifics: say what they explained well, in your own words. "
            "Add no new facts."
        )
    else:
        gap, verdict = _first_gap(grade_)
        lines.append("Start by praising, specifically, what they got right.")
        lines.append(f"Then ask ONE guiding question about this point, without giving the answer away: {gap}")
        if verdict == "wrong":
            lines.append(
                "They said it wrongly. Treat it as a misconception and check it gently, for example by offering "
                "two choices, without saying they were wrong."
            )
        lines.append(f'End with exactly: "{TRY_AGAIN}"')
    return "\n".join(lines)
