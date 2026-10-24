"""Checks for decide(): the alert set rule and the backend fallback order, with local stand-in backends.

Run from brain/: uv run python -m scripts.checks.decide
"""

import asyncio

from pydantic import ValidationError

from kite_brain.decide import (
    DecideUnavailable,
    Decisions,
    HaikuBackend,
    alert_kinds,
    answer_model,
    decide,
    read_probabilities,
    request_body,
    top,
)
from kite_brain.questions import ABOUT_ME, SAFETY

QUESTIONS = [SAFETY, ABOUT_ME]
ANSWERS = {"safety": {"ok": 1.0}, "about_me": {"no": 1.0}}


class Stub:
    def __init__(self, label, delay=0.0, fail=False, timeout_s=None):
        self.label, self.delay, self.fail, self.timeout_s = label, delay, fail, timeout_s

    async def ask(self, context, questions):
        await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("down")
        return ANSWERS


class StubLlm:
    async def parse(self, request, model_cls):
        return model_cls(safety="alert_stranger", about_me="no")


def check_alert_kinds_is_a_set() -> None:
    got = alert_kinds({"bullying": 0.45, "abuse": 0.35, "ok": 0.2}, 0.2)
    assert got == {"bullying", "abuse"}, f"every alert label at or above threshold, ok excluded: {got}"
    labels = {"alert_stranger": 0.25, "alert_self_harm": 0.05, "ok": 0.7}
    assert alert_kinds(labels, 0.2) == {"stranger"}, "alert_ prefix stripped, below-threshold dropped"


def check_falls_through_on_timeout() -> None:
    slow, fast = Stub("decision1", delay=1.0), Stub("openrouter")
    got = asyncio.run(decide("hi", QUESTIONS, backends=[slow, fast], timeout_s=0.05))
    assert got.backend == "openrouter", f"slow first backend falls through: {got.backend}"


def check_falls_through_on_error() -> None:
    got = asyncio.run(decide("hi", QUESTIONS, backends=[Stub("decision1", fail=True), Stub("haiku")], timeout_s=1))
    assert got.backend == "haiku", "erroring backend falls through and its name is recorded"


def check_first_backend_wins() -> None:
    got = asyncio.run(decide("hi", QUESTIONS, backends=[Stub("decision1"), Stub("openrouter")], timeout_s=1))
    assert isinstance(got, Decisions) and got.backend == "decision1", "first healthy backend answers"


def check_raises_when_all_fail() -> None:
    backends = [Stub("decision1", fail=True), Stub("openrouter", delay=1.0), Stub("haiku", fail=True)]
    try:
        asyncio.run(decide("hi", QUESTIONS, backends=backends, timeout_s=0.05))
    except DecideUnavailable:
        return
    raise AssertionError("all backends failing must raise DecideUnavailable")


def check_answer_model_rejects_unknown_label() -> None:
    model = answer_model(QUESTIONS)
    model(safety="ok", about_me="yes")
    try:
        model(safety="alert_dragons", about_me="yes")
    except ValidationError:
        return
    raise AssertionError("answer_model must reject a label outside the question's answers")


def check_haiku_is_one_hot() -> None:
    got = asyncio.run(decide("hi", QUESTIONS, backends=[HaikuBackend(StubLlm())], timeout_s=1))
    assert got.backend == "haiku", "haiku backend named"
    assert got.answers["safety"]["alert_stranger"] == 1.0, "picked label is 1.0"
    assert sum(got.answers["safety"].values()) == 1.0, "every other label is 0.0"
    assert top(got.answers["safety"]) == "alert_stranger", "top picks the one-hot label"


def check_decision1_shape() -> None:
    body = request_body("dep", "hi", QUESTIONS)
    assert body["questions"]["safety"]["type"] == "choice", "every question is a choice question"
    assert set(body["questions"]["about_me"]["criteria"]) == {"yes", "no"}, "criteria keyed by answer"
    payload = {
        "answers": {
            "safety": {"type": "choice", "choice": "alert_stranger", "probabilities": {"alert_stranger": 0.9, "ok": 0.1}},
            "about_me": {"type": "choice", "choice": "no"},
        }
    }
    got = read_probabilities(payload, QUESTIONS)
    assert got["safety"]["alert_stranger"] == 0.9 and got["safety"]["alert_abuse"] == 0.0, "missing labels are 0.0"
    assert got["about_me"] == {"yes": 0.0, "no": 1.0}, "labels-only answer becomes one-hot"
    payload["answers"]["about_me"] = {"choice": "maybe", "probabilities": {"maybe": 1.0}}
    try:
        read_probabilities(payload, QUESTIONS)
    except ValueError:
        return
    raise AssertionError("a label outside the question's answers must be rejected")


def run() -> None:
    check_alert_kinds_is_a_set()
    check_falls_through_on_timeout()
    check_falls_through_on_error()
    check_first_backend_wins()
    check_raises_when_all_fail()
    check_answer_model_rejects_unknown_label()
    check_haiku_is_one_hot()
    check_decision1_shape()
    print("decide checks passed")


if __name__ == "__main__":
    run()
