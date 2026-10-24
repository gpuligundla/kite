"""What Kite may know when it answers. The kid view is the only part a child can be told;
guidance is instruction for this turn's concept and never states a level or score."""

from dataclasses import dataclass

import numpy as np

from kite_brain.catalog import Catalog
from kite_brain.config import ABOUT_ME_THRESHOLD
from kite_brain.contract import Grade, KidView, Moment, ProfileView, SkillsMap
from kite_brain.crypto import aad, open_sealed
from kite_brain.deps import Deps
from kite_brain.memory import ledger, maps
from kite_brain.memory.embed import top_k

HISTORY_TURNS = 10
TOP_MOMENTS = 5


@dataclass
class Recall:
    kid_view: KidView
    guidance: list[str]
    history: list[tuple[str, str]]  # (role, text), oldest first
    strength: list[str]  # strength topics, for the grown-up `recalled` event
    depth_topic: str | None  # the strength topic this turn's concept belongs to


def kid_view(profile: ProfileView, moments: list[str], strength: list[str]) -> KidView:
    return KidView(
        interests=profile.interests, characters=profile.characters, moments=moments, deep_topics=strength
    )


def guidance_for(skills: SkillsMap, concept_id: str, catalog: Catalog) -> list[str]:
    """Teaching instructions for this one concept. Other concepts never appear."""
    name = catalog.get(concept_id).kid_name
    level = {c.concept_id: c.level for c in skills.concepts}.get(concept_id)
    if concept_id in skills.growing:
        return [f"Check their steps carefully on {name}; it has tripped them up before. Go slowly."]
    if level in ("got_it", "can_teach"):
        return [f"They already know {name} well. Keep it brief and offer to go a step further."]
    return []


def _top_moments(deps: Deps, evts: list[ledger.LedgerEvent], query_vec: np.ndarray) -> list[str]:
    moments = [e for e in evts if isinstance(e.payload, Moment)]
    if not moments:
        return []
    marks = ",".join("?" * len(moments))
    blobs = dict(deps.conn.execute(
        f"SELECT event_id, embedding FROM moment_vector WHERE event_id IN ({marks})", [e.id for e in moments]
    ).fetchall())
    moments = [e for e in moments if e.id in blobs]
    matrix = np.array([np.frombuffer(blobs[e.id], dtype=np.float32) for e in moments])
    return [
        e.payload.text(deps.catalog.get(e.payload.concept_id).kid_name)
        for e in (moments[i] for i, _ in top_k(query_vec, matrix, TOP_MOMENTS))
    ]


def _history(deps: Deps, kid_id: str) -> list[tuple[str, str]]:
    rows = deps.conn.execute(
        "SELECT id, role, text FROM session_turn WHERE kid_id = ? ORDER BY at DESC, id DESC LIMIT ?",
        (kid_id, HISTORY_TURNS),
    ).fetchall()
    key = deps.keys.for_kid(kid_id)
    return [
        (r["role"], open_sealed(key, r["text"], aad("session_turn", kid_id, r["id"])).decode())
        for r in reversed(rows)
    ]


async def recall(
    deps: Deps, kid_id: str, grade: Grade, query_vec: np.ndarray, concept_id: str | None, about_me_p: float
) -> Recall:
    """Everything is read as of `grade`. Guidance is empty when the child may be asking
    about themselves, so an about-me answer cannot echo it."""
    start_year = deps.conn.execute("SELECT school_start_year FROM kid WHERE id = ?", (kid_id,)).fetchone()[0]
    evts = ledger.events(deps.conn, deps.keys, kid_id, grade)
    skills = maps.skills_map(evts, deps.catalog, grade)
    curiosity = maps.curiosity_map(evts, maps.school_year_end(start_year, grade))
    strength = maps.strength_topics(skills, curiosity, deps.catalog, grade)
    topic = deps.catalog.get(concept_id).topic if concept_id else None
    guidance = []
    if concept_id and about_me_p < ABOUT_ME_THRESHOLD:
        guidance = guidance_for(skills, concept_id, deps.catalog)
    return Recall(
        kid_view=kid_view(maps.profile_view(evts), _top_moments(deps, evts, query_vec), strength),
        guidance=guidance,
        history=_history(deps, kid_id),
        strength=strength,
        depth_topic=topic if topic in strength else None,
    )
