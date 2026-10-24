"""The demo's shape (spec section 13, step 3): what the night shift must have produced."""

import argparse
import sys

from kite_brain.api import build_deps
from kite_brain.bus import EventBus
from kite_brain.config import get_settings
from kite_brain.db import connect
from kite_brain.deps import Deps
from kite_brain.memory import ledger, maps
from kite_brain.seed import KID_ID

MIN_TURNS = 300
MIN_CAN_TEACH = 3
MIN_CARDS = 2
# Grade 8, not 7: the first night shift had dinosaurs dip in grade 7 when the harder ideas arrived
# (birds are dinosaurs, a timeline slip) and come back for good in grade 8. The dip is real; the demo shows 8.
DINOSAUR_GRADE, AREA_GRADE = 8, 5


def assert_demo_shape(deps: Deps, min_turns: int = MIN_TURNS) -> list[str]:
    """The failures, empty when the demo's shape is right. A turn counts when it was
    persisted, so alert, pause and fallback turns do not."""
    conn, keys, catalog = deps.conn, deps.keys, deps.catalog
    kid = conn.execute("SELECT grade, school_start_year FROM kid WHERE id = ?", (KID_ID,)).fetchone()
    failures = []

    turns = conn.execute("SELECT COUNT(*) FROM session_turn WHERE role = 'kid'").fetchone()[0]
    if turns < min_turns:
        failures.append(f"only {turns} turns, need {min_turns}")

    def view(grade: int):
        evts = ledger.events(conn, keys, KID_ID, grade)
        curiosity = maps.curiosity_map(evts, maps.school_year_end(kid["school_start_year"], grade))
        return maps.skills_map(evts, catalog, grade), curiosity

    skills, curiosity = view(DINOSAUR_GRADE)
    if "dinosaurs" not in maps.strength_topics(skills, curiosity, catalog, DINOSAUR_GRADE):
        failures.append(f"dinosaurs is not a strength topic at grade {DINOSAUR_GRADE}")
    skills, _ = view(AREA_GRADE)
    if not any(catalog.get(c).topic == "area_perimeter" for c in skills.growing):
        failures.append(f"no area_perimeter concept is growing at grade {AREA_GRADE}")
    can_teach = len(view(kid["grade"])[0].can_teach)
    if can_teach < MIN_CAN_TEACH:
        failures.append(f"only {can_teach} can_teach concepts, need {MIN_CAN_TEACH}")
    cards = conn.execute("SELECT COUNT(*) FROM big_question_card").fetchone()[0]
    if cards < MIN_CARDS:
        failures.append(f"only {cards} big-question cards, need {MIN_CARDS}")
    return failures


def main() -> None:
    parser = argparse.ArgumentParser(description="Check the simulated childhood has the demo's shape.")
    parser.add_argument("--min-turns", type=int, default=MIN_TURNS)
    args = parser.parse_args()
    settings = get_settings()
    deps = build_deps(connect(settings.KITE_DB_PATH), EventBus(), settings)
    failures = assert_demo_shape(deps, args.min_turns)
    for failure in failures:
        print("SHAPE FAIL:", failure, file=sys.stderr)
    print("demo shape:", "FAILED" if failures else "ok")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
