"""Task 23: COLLAB_LOG.md reaches the model only on an about-Kite turn.
Run from brain/: uv run python -m scripts.checks.about_kite"""

import json
import re

from kite_brain.config import COLLAB_LOG_PATH
from scripts.checks.pipeline import StandIns, deps_for, make_decisions, turn
from scripts.checks.voice import use_sample_voices


def whole_request(about_kite: float) -> str:
    decisions = make_decisions()
    decisions.answers["about_kite"] = {"yes": about_kite, "no": 1 - about_kite}
    stand = StandIns(decide=decisions)
    deps, bus = deps_for(stand)
    turn(deps, bus, stand)
    req = stand.requests[0]
    return json.dumps([req.system, req.context, req.messages])


def check_log_only_when_asked() -> None:
    headings = re.findall(r"^## .+$", COLLAB_LOG_PATH.read_text(), re.M)
    assert len(headings) > 1, "COLLAB_LOG.md has no headings to look for"
    heading = json.dumps(headings[1])[1:-1]
    assert heading in whole_request(0.9), "an about_kite turn's request must contain the log"
    assert whole_request(0.5).count(heading) == 1, "0.5 is enough, and the log is added once"
    assert heading not in whole_request(0.49), "a normal turn's request must not contain the log"


def run() -> None:
    use_sample_voices()
    check_log_only_when_asked()
    print("ok check_log_only_when_asked")


if __name__ == "__main__":
    run()
