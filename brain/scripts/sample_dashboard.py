"""Print a compact dashboard summary for grades 2, 7 and 11 from a database.
Run from brain/ with KITE_MASTER_KEY set (the key the database was sealed with):
    uv run python -m scripts.sample_dashboard path/to/kite.db [kid_id]
Read-only: it writes no access receipt."""

import json
import sys

from kite_brain.catalog import Catalog
from kite_brain.config import get_settings
from kite_brain.crypto import FamilyKeys, master_key
from kite_brain.dashboard import dashboard_view
from kite_brain.db import connect
from kite_brain.deps import Deps

GRADES = (2, 7, 11)


def main() -> None:
    path, kid_id = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "maya")
    conn = connect(path)
    # dashboard_view reads only conn, keys and catalog.
    deps = Deps(conn=conn, keys=FamilyKeys(conn, master_key(get_settings().KITE_MASTER_KEY)),
                catalog=Catalog.load(), bus=None, decide=None, llm=None, embed=None, safety=None,
                stt=None, tts=None, clock=None)
    out = {}
    for grade in GRADES:
        v = dashboard_view(deps, kid_id, grade)
        out[grade] = {
            "interests": v.profile.interests,
            "top_curiosity": [(t.topic, round(t.score, 2)) for t in v.curiosity.topics[:3]],
            "concepts": len(v.skills.concepts),
            "growing": v.skills.growing,
            "can_teach": v.skills.can_teach,
            "cards": [(c.grade, c.topic) for c in v.cards],
            "alerts": [(a.kinds, a.at.date().isoformat()) for a in v.alerts],
            "moments": {g: len(m) for g, m in v.moments_by_grade.items()},
            "policy": v.policy,
        }
    print(json.dumps(out, separators=(",", ":")))


if __name__ == "__main__":
    main()
