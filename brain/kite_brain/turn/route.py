"""Which path a turn takes. One pure function, checked in the order of spec section 4."""

from dataclasses import dataclass
from typing import Literal

from kite_brain.config import ABOUT_ME_THRESHOLD, ALERT_THRESHOLD, FORGET_THRESHOLD
from kite_brain.contract import AlertKind, HomeworkMode, Mode, PolicyAction, RouteName
from kite_brain.decide import Decisions, alert_kinds, top
from kite_brain.deps import SafetyResult
from kite_brain.voice import Situation

UNHEARD = "I didn't catch that. Hold the button and try again."
FALLBACK = "Let me think about that one later. Ask a grown-up too!"
ASK_PARENT = "That's a big question, and a grown-up who loves you is the best person to talk it through. I'll let them know you asked."
PAUSE_REPLY = "That looks like it could be for your quiz right now, so I can't help with it. You've got this! Ask me again once it's over."
TEACH_START = "I'm all ears! Teach me everything you know about {concept}."
FORGOT = "Okay, I forgot that."


def teach_start_line(concept_name: str) -> str:
    return TEACH_START.format(concept=concept_name[:1].lower() + concept_name[1:])

_CRISIS = "You can call or text 988 any time, or call Childhelp at 1-800-422-4453. Both are free, and a grown-up will listen."
ALERT_REPLY: dict[str, str] = {
    "self_harm": f"I'm really glad you told me. Your feelings matter, and you deserve help from a real person right now. {_CRISIS}",
    "abuse": f"Thank you for telling me. It's not your fault, and you deserve to feel safe. Please talk to a trusted grown-up today. {_CRISIS}",
    "stranger": "Thank you for telling me. Please stay close to a grown-up you trust and don't go anywhere with someone you don't know.",
    "bullying": "I'm sorry that's happening. It isn't your fault. Please tell a grown-up you trust so they can help.",
}
# When one turn raises several kinds, the reply that points to the most urgent help wins.
ALERT_REPLY_PRIORITY = ("self_harm", "abuse", "stranger", "bullying")

Audience = Literal["parent", "counselor"]


@dataclass(frozen=True)
class HomeworkSignal:
    status: Literal["exam_live", "open", "closed"] | None
    title: str | None
    near_live_quiz: bool


@dataclass(frozen=True)
class RoutePlan:
    route: RouteName
    audience: Audience
    alert_kinds: list[AlertKind]
    alert_to: Audience | None
    reply: str | None
    action: PolicyAction | None
    homework_mode: HomeworkMode | None
    assignment_title: str | None
    card_topic: str | None
    call_llm: bool
    write_memory: bool
    situation: Situation
    forget: bool = False  # forget the kid's previous turn before replying


def route(
    decisions: Decisions | None,
    safety: SafetyResult | None,
    policy: dict[str, PolicyAction],
    homework: HomeworkSignal,
    mode: Mode,
    text_empty: bool,
    recall_ok: bool = True,
) -> RoutePlan:
    def plan(route_name: RouteName, **fields) -> RoutePlan:
        defaults = dict(
            route=route_name, audience="parent", alert_kinds=[], alert_to=None, reply=None, action=None,
            homework_mode=None, assignment_title=None, card_topic=None, call_llm=False, write_memory=False,
            situation="answer",
        )
        return RoutePlan(**{**defaults, **fields})

    if text_empty:
        return plan("unheard", reply=UNHEARD)

    kinds: set[AlertKind] = set(safety.kinds) if safety else set()
    if decisions:
        kinds |= alert_kinds(decisions.answers["safety"], ALERT_THRESHOLD)
    if kinds:
        to: Audience = "counselor" if "abuse" in kinds else "parent"
        reply = ALERT_REPLY[next(k for k in ALERT_REPLY_PRIORITY if k in kinds)]
        return plan("alert", audience=to, alert_to=to, alert_kinds=sorted(kinds), reply=reply, situation="alert")

    if decisions is None or safety is None or safety.jailbreak or not recall_ok:
        return plan("fallback", reply=FALLBACK)

    if decisions.answers.get("forget_request", {}).get("yes", 0.0) >= FORGET_THRESHOLD:
        # ponytail: reuses about_me because RouteName is frozen for the UI; a "forget" name once it thaws.
        return plan("about_me", reply=FORGOT, forget=True)

    if homework.near_live_quiz or homework.status == "exam_live":
        return plan("pause", reply=PAUSE_REPLY, homework_mode="pause", assignment_title=homework.title)

    answers = decisions.answers
    topic = top(answers["sensitive_topic"])
    action = policy[topic] if topic != "none" else None

    if action == "ask_parent":
        return plan("ask_parent", reply=ASK_PARENT, action=action, card_topic=topic, situation="big_question")
    if mode == "teach":
        return plan("teach", call_llm=True, write_memory=True, situation="listen")
    if homework.status in ("open", "closed"):
        help_mode = homework.status == "open"
        return plan(
            "homework", homework_mode="help" if help_mode else "explain", assignment_title=homework.title,
            call_llm=True, write_memory=True, situation="homework_help" if help_mode else "explain",
        )
    if answers["about_me"]["yes"] >= ABOUT_ME_THRESHOLD:
        return plan("about_me", call_llm=True, write_memory=True)
    return plan(
        "answer", action=action, call_llm=True, write_memory=True,
        card_topic=topic if action == "answer_and_tell" else None,
        situation="big_question" if action else "answer",
    )
