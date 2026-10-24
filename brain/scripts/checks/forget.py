"""Task 28: forgetting the previous turn, and the kid-safe "what Kite remembers" view.
Run from brain/: uv run python -m scripts.checks.forget"""

import asyncio
import re

from kite_brain.seed import KID_ID
from kite_brain.turn.route import FORGOT
from scripts.checks.audiences import drain
from scripts.checks.dashboard import client_with_data, seed_ledger
from scripts.checks.ledger import CATALOG
from scripts.checks.memory import BANNED
from scripts.checks.pipeline import make_decisions
from scripts.checks.voice import use_sample_voices

SKILL_WORDS = re.compile(r"skills|frontier|can_teach|got_it|not_yet|learning\b", re.I)
SKY, DINO = (f"Figured out {CATALOG.get(c).kid_name}" for c in ("light_see", "dino_what"))


def decisions(forget=0.0, alerts=None):
    d = make_decisions(alerts)
    d.answers["forget_request"] = {"yes": forget, "no": 1 - forget}
    return d


def setup():
    client, deps, bearer = client_with_data()
    stand = deps.llm  # client_with_data's StandIns
    stand.asked = []

    async def decide(context, questions):
        stand.asked.append({q.name for q in questions})
        return stand.decide_result

    deps.decide = decide

    def say(text, decided, **form):
        stand.decide_result = decided
        r = client.post("/turns", data={"kid_id": KID_ID, "device": "os", "text": text} | form, headers=bearer["os"])
        assert r.status_code == 200, r.text
        tid = r.json()["turn_id"]
        mine = [e for e in asyncio.run(drain(deps.bus, "parent")) if e.turn_id == tid]
        return {e.type: e for e in mine}

    def moments():
        return client.get(f"/kids/{KID_ID}/kid-view", headers=bearer["os"]).json()["moments"]

    return deps, stand, say, moments


def rows(deps, sql):
    return deps.conn.execute(sql).fetchone()[0]


def check_forget_request_removes_previous_turn() -> None:
    deps, stand, say, moments = setup()
    say("what is a dinosaur?", decisions(), concept_id="dino_what")
    say("why is the sky blue?", decisions(), concept_id="light_see")
    assert [m.split(",")[0] for m in moments()] == [SKY, DINO], f"both moments, newest first: {moments()}"
    calls, events = stand.llm_calls, rows(deps, "SELECT COUNT(*) FROM learning_event")

    seen = say("forget what I just said", decisions(forget=0.9))
    assert "forget_request" in stand.asked[-1], f"the turn asks the forget question: {stand.asked[-1]}"
    assert seen["answer.done"].text == FORGOT and stand.llm_calls == calls, "the fixed reply, no model call"
    assert seen["routed"].route == "about_me", "forget reuses the about_me route name while RouteName is frozen"
    assert moments() == [DINO], f"the sky moment is forgotten, the dinosaur one stays: {moments()}"
    assert rows(deps, "SELECT COUNT(*) FROM session_turn") == 2, "only the earlier turn's kid and kite rows are left"
    assert rows(deps, "SELECT COUNT(*) FROM learning_event") < events, "the previous turn's events are gone"
    assert rows(deps, "SELECT COUNT(*) FROM moment_vector") == 1, "and its moment vector"

    say("forget that too", decisions(forget=0.5))
    assert moments() == [] and rows(deps, "SELECT COUNT(*) FROM session_turn") == 0, "0.5 is enough, and a second request forgets the turn before"
    seen = say("forget it again", decisions(forget=0.9))
    assert seen["answer.done"].text == FORGOT, "nothing left to forget still gets the reply"


def check_forget_only_when_asked() -> None:
    deps, stand, say, moments = setup()
    say("why is the sky blue?", decisions(), concept_id="light_see")
    before = rows(deps, "SELECT COUNT(*) FROM learning_event")

    seen = say("I forgot my lunch", decisions(forget=0.49), concept_id="light_see")
    assert seen["answer.done"].text != FORGOT and seen["routed"].route == "answer", "0.49 answers normally"
    seen = say("forget that", decisions(forget=0.9), as_of_grade="3")
    assert seen["answer.done"].text == FORGOT, "a time-travel turn still replies"
    seen = say("forget it, someone hurts me", decisions(forget=0.9, alerts={"abuse": 0.9}))
    assert seen == {}, "an abuse turn reaches no parent event at all"
    assert rows(deps, "SELECT COUNT(*) FROM alert") == 1, "the alert is still the safety record"
    assert rows(deps, "SELECT COUNT(*) FROM learning_event") > before, "neither time travel nor an alert forgot anything"
    assert rows(deps, "SELECT COUNT(*) FROM session_turn") == 4, "both stored turns are intact"


def check_kid_view_endpoint_has_no_skills() -> None:
    client, deps, bearer = client_with_data()
    seed_ledger(deps)  # interests, moments, and a full teach-back that makes light_see can_teach
    path = f"/kids/{KID_ID}/kid-view"
    assert client.get(path).status_code == 401, "no token is 401"
    for kind in ("parent", "counselor"):
        assert client.get(path, headers=bearer[kind]).status_code == 403, f"{kind} must get 403"
    assert client.get("/kids/sam/kid-view", headers=bearer["os"]).status_code == 403, "another kid is 403"

    for kind in ("os", "handheld"):
        r = client.get(path, headers=bearer[kind])
        assert r.status_code == 200, r.text
        view = r.json()
        assert set(view) == {"interests", "characters", "moments", "deep_topics"}, view
        assert not BANNED.search(r.text) and not SKILL_WORDS.search(r.text), f"no levels or scores: {r.text}"
    assert view["interests"] == ["light", "gravity"] and view["moments"][-1].startswith(SKY), view
    assert rows(deps, "SELECT COUNT(*) FROM access_receipt") == 0, "the kid reading their own view is not a grown-up access"


def run() -> None:
    use_sample_voices()
    for check in (check_forget_request_removes_previous_turn, check_forget_only_when_asked,
                  check_kid_view_endpoint_has_no_skills):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
