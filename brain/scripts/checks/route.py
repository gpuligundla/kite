"""Checks for route(): every row of the plan's Task 9 table, plus the alert-set edge cases.

Run from brain/: uv run python -m scripts.checks.route
"""

from kite_brain.decide import Decisions
from kite_brain.deps import SafetyResult
from kite_brain.turn.route import ALERT_REPLY, FALLBACK, HomeworkSignal, UNHEARD, route

POLICY = {"death": "answer_and_tell", "religion": "answer", "bodies": "ask_parent", "war": "answer", "divorce": "answer"}
NO_HOMEWORK = HomeworkSignal(None, None, False)
OPEN_HW = HomeworkSignal("open", "Area and perimeter", False)
CLOSED_HW = HomeworkSignal("closed", "Light and color quiz", False)
NEAR_QUIZ = HomeworkSignal("exam_live", "Water cycle quiz", True)
ALL_ALERTS = ("ok", "alert_bullying", "alert_stranger", "alert_abuse", "alert_self_harm")
TOPICS = ("death", "religion", "bodies", "war", "divorce", "none")


def decisions(alerts=None, topic="none", about_me=0.0, attack=0.0) -> Decisions:
    safety = {label: 0.0 for label in ALL_ALERTS} | {f"alert_{k}": p for k, p in (alerts or {}).items()}
    return Decisions(
        {
            "safety": safety,
            "sensitive_topic": {t: float(t == topic) for t in TOPICS},
            "about_me": {"yes": about_me, "no": 1 - about_me},
            "jailbreak": {"other": 1 - attack, "about_kite": 0.0, "attack": attack},
        },
        "decision1",
    )


OK = decisions()
CLEAN = SafetyResult(set())

# name, route() kwargs, expected plan fields, whether it must be a no-LLM no-memory turn
ROWS = [
    (
        "bullying .45 + abuse .35",
        dict(decisions=decisions({"bullying": 0.45, "abuse": 0.35}), safety=CLEAN),
        dict(route="alert", audience="counselor", alert_to="counselor", alert_kinds=["abuse", "bullying"], situation="alert"),
        False,
    ),
    (
        "self_harm .3",
        dict(decisions=decisions({"self_harm": 0.3}), safety=CLEAN),
        dict(route="alert", audience="parent", alert_to="parent", alert_kinds=["self_harm"]),
        False,
    ),
    (
        "content safety abuse, decisions ok",
        dict(decisions=OK, safety=SafetyResult({"abuse"})),
        dict(route="alert", audience="counselor", alert_to="counselor"),
        False,
    ),
    ("decisions None, no flag", dict(decisions=None, safety=CLEAN), dict(route="fallback", reply=FALLBACK), True),
    (
        "decisions None, content safety self_harm",
        dict(decisions=None, safety=SafetyResult({"self_harm"})),
        dict(route="alert", alert_to="parent"),
        False,
    ),
    ("jailbreak", dict(decisions=OK, safety=SafetyResult(set(), jailbreak=True)), dict(route="fallback"), True),
    ("decision-1 jailbreak .95", dict(decisions=decisions(attack=0.95), safety=CLEAN), dict(route="fallback"), True),
    ("just under the jailbreak threshold", dict(decisions=decisions(attack=0.94), safety=CLEAN), dict(route="answer"), False),
    (
        "alert beats a jailbreak",
        dict(decisions=decisions({"self_harm": 0.5}, attack=1.0), safety=SafetyResult(set(), jailbreak=True)),
        dict(route="alert", alert_to="parent"),
        False,
    ),
    ("content safety down", dict(decisions=OK, safety=None), dict(route="fallback"), True),
    ("near live quiz in teach mode", dict(decisions=OK, safety=CLEAN, homework=NEAR_QUIZ, mode="teach"), dict(route="pause", homework_mode="pause"), True),
    (
        "death with ask_parent",
        dict(decisions=decisions(topic="death"), safety=CLEAN, policy=POLICY | {"death": "ask_parent"}),
        dict(route="ask_parent", card_topic="death", action="ask_parent", call_llm=False, situation="big_question"),
        False,
    ),
    ("teach mode", dict(decisions=OK, safety=CLEAN, mode="teach"), dict(route="teach", call_llm=True, situation="listen"), False),
    (
        "open homework",
        dict(decisions=OK, safety=CLEAN, homework=OPEN_HW),
        dict(route="homework", homework_mode="help", assignment_title="Area and perimeter", situation="homework_help"),
        False,
    ),
    ("closed homework", dict(decisions=OK, safety=CLEAN, homework=CLOSED_HW), dict(route="homework", homework_mode="explain", situation="explain"), False),
    ("about_me .25", dict(decisions=decisions(about_me=0.25), safety=CLEAN), dict(route="about_me", call_llm=True), False),
    ("ok", dict(decisions=OK, safety=CLEAN), dict(route="answer", call_llm=True, write_memory=True, card_topic=None, alert_to=None), False),
    (
        "death with answer_and_tell",
        dict(decisions=decisions(topic="death"), safety=CLEAN),
        dict(route="answer", card_topic="death", action="answer_and_tell", call_llm=True),
        False,
    ),
    ("text_empty", dict(decisions=OK, safety=CLEAN, text_empty=True), dict(route="unheard", reply=UNHEARD), True),
    (
        "text_empty beats a content safety flag",
        dict(decisions=None, safety=SafetyResult({"abuse"}), text_empty=True),
        dict(route="unheard"),
        True,
    ),
    (
        "alert beats live quiz pause",
        dict(decisions=decisions({"self_harm": 0.5}), safety=CLEAN, homework=NEAR_QUIZ),
        dict(route="alert"),
        False,
    ),
    (
        "ask_parent beats teach and homework",
        dict(decisions=decisions(topic="bodies"), safety=CLEAN, mode="teach", homework=OPEN_HW),
        dict(route="ask_parent", card_topic="bodies"),
        False,
    ),
    ("teach beats homework", dict(decisions=OK, safety=CLEAN, mode="teach", homework=OPEN_HW), dict(route="teach"), False),
    ("homework beats about_me", dict(decisions=decisions(about_me=0.9), safety=CLEAN, homework=OPEN_HW), dict(route="homework"), False),
    ("just under the alert threshold", dict(decisions=decisions({"abuse": 0.19}), safety=CLEAN), dict(route="answer"), False),
]


def run() -> None:
    for name, given, expected, inert in ROWS:
        plan = route(**{"policy": POLICY, "homework": NO_HOMEWORK, "mode": "talk", "text_empty": False} | given)
        for field, want in expected.items():
            got = getattr(plan, field)
            assert got == want, f"{name}: {field} was {got!r}, expected {want!r}"
        if inert:
            assert plan.call_llm is False and plan.write_memory is False, f"{name}: must not call the LLM or write memory"
        print(f"ok  {name:44} -> {plan.route}")

    self_harm = route(decisions(), SafetyResult({"self_harm"}), POLICY, NO_HOMEWORK, "talk", False)
    assert "988" in self_harm.reply and "1-800-422-4453" in self_harm.reply, "self-harm reply carries both crisis numbers"
    both = route(decisions({"abuse": 0.5, "self_harm": 0.5}), CLEAN, POLICY, NO_HOMEWORK, "talk", False)
    assert both.alert_to == "counselor" and "988" in both.reply, "abuse plus self-harm goes to the counselor with the crisis numbers"
    assert set(ALERT_REPLY) == {"self_harm", "abuse", "stranger", "bullying"}, "a fixed reply for every routable kind"
    print("route checks passed")


if __name__ == "__main__":
    run()
