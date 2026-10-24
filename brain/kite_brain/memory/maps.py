"""Views over the ledger as of a grade: profile, skills, curiosity, strengths."""

from collections import defaultdict
from datetime import datetime, timezone

from kite_brain.catalog import Catalog
from kite_brain.contract import (
    CharacterFact, ConceptEvidence, ConceptLevel, CuriosityMap, CuriositySignal, Grade,
    InterestFact, ProfileView, SkillsMap, StyleFact, TopicScore,
)
from kite_brain.memory.ledger import LedgerEvent

SIGNAL_WEIGHT = {"own_question": 1, "follow_up_why": 2, "return_visit": 3, "chose_creation": 3}
HALF_LIFE_DAYS = 180
TOP_CURIOSITY = 3
STRENGTH_CONCEPTS = 2
STRENGTH_SCORE = 0.6
STRENGTH_SHARE = 0.75  # one shaky concept among several mastered ones doesn't erase a strength
MASTERED = ("got_it", "can_teach")


def school_year_end(start_year: int, grade: Grade) -> datetime:
    """The kid is in grade 0 (K) in the school year that starts in `start_year`."""
    return datetime(start_year + grade + 1, 6, 15, tzinfo=timezone.utc)


def _unique(items):
    return list(dict.fromkeys(items))


def profile_view(evts: list[LedgerEvent]) -> ProfileView:
    facts = [e.payload for e in evts]
    return ProfileView(
        interests=_unique(f.topic for f in facts if isinstance(f, InterestFact)),
        characters=_unique(f.name for f in facts if isinstance(f, CharacterFact)),
        styles=_unique(f.style for f in facts if isinstance(f, StyleFact)),
    )


def _level(evidence: list[LedgerEvent]) -> str:
    """`evidence` is one concept's concept_evidence events, oldest first."""
    outcomes = [e.payload.outcome for e in evidence]
    full_teach_back = any(
        e.payload.source == "teach_back" and e.payload.points
        and all(v == "covered" for v in e.payload.points.values())
        for e in evidence
    )
    if full_teach_back:
        return "can_teach"
    if outcomes[-2:] == ["got_it", "got_it"]:
        return "got_it"
    if all(o == "not_yet" for o in outcomes):
        return "not_yet"
    return "learning"


def skills_map(evts: list[LedgerEvent], catalog: Catalog, grade: Grade) -> SkillsMap:
    by_concept: dict[str, list[LedgerEvent]] = defaultdict(list)
    for e in evts:
        if isinstance(e.payload, ConceptEvidence) and e.concept_id:
            by_concept[e.concept_id].append(e)
    levels = {cid: _level(ev) for cid, ev in by_concept.items()}
    growing = [
        cid for cid, ev in by_concept.items()
        if levels[cid] not in MASTERED and len({e.session_id for e in ev}) >= 2
    ]
    frontier = [
        c.id for c in catalog.concepts
        if c.grade <= grade and c.id not in levels
        and all(levels.get(p) in MASTERED for p in c.prereqs)
    ]
    return SkillsMap(
        concepts=[ConceptLevel(concept_id=cid, name=catalog.get(cid).name, level=lv)
                  for cid, lv in levels.items()],
        frontier=frontier,
        growing=growing,
        can_teach=[cid for cid, lv in levels.items() if lv == "can_teach"],
    )


def curiosity_map(evts: list[LedgerEvent], as_of: datetime) -> CuriosityMap:
    """Decayed signal weight per topic and grade, divided by the kid's top topic total."""
    by_grade: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    for e in evts:
        if isinstance(e.payload, CuriositySignal) and e.topic:
            age_days = max((as_of - e.at).total_seconds() / 86400, 0)
            by_grade[e.topic][e.grade] += SIGNAL_WEIGHT[e.payload.signal] * 0.5 ** (age_days / HALF_LIFE_DAYS)
    totals = {t: sum(g.values()) for t, g in by_grade.items()}
    top = max(totals.values(), default=1)
    return CuriosityMap(topics=sorted(
        (TopicScore(topic=t, score=totals[t] / top,
                    by_grade={g: w / top for g, w in sorted(by_grade[t].items())})
         for t in totals),
        key=lambda s: -s.score,
    ))


def strength_topics(skills: SkillsMap, curiosity: CuriosityMap, catalog: Catalog, grade: Grade) -> list[str]:
    """Spec 6: a top-3 curiosity topic scoring at least 0.6 with at least 2 evidenced concepts
    at or below `grade` at got_it or better, making up at least 75% of its evidenced concepts."""
    levels: dict[str, list[str]] = defaultdict(list)
    for c in skills.concepts:
        concept = catalog.get(c.concept_id)
        if concept.grade <= grade:
            levels[concept.topic].append(c.level)
    return [
        t.topic
        for t in curiosity.topics[:TOP_CURIOSITY]
        if t.score >= STRENGTH_SCORE
        and (mastered := sum(level in MASTERED for level in levels[t.topic])) >= STRENGTH_CONCEPTS
        and mastered >= STRENGTH_SHARE * len(levels[t.topic])
    ]
