"""One call that answers all of a turn's questions, over three backends tried in order."""

import asyncio
from dataclasses import dataclass
from typing import Any, Literal, Protocol, get_args

import httpx
from pydantic import BaseModel, create_model

from kite_brain.contract import AlertKind
from kite_brain.deps import LlmRequest
from kite_brain.questions import Question

BackendName = Literal["decision1", "openrouter", "haiku"]
Probs = dict[str, float]

FOUNDRY_PATH = "/providers/microsoft/v1/systemone"
OPENROUTER_URL = "https://openrouter.ai/api/alpha/decisions"
OPENROUTER_MODEL = "microsoft/microsoft-decision-1"


class DecideUnavailable(Exception):
    """Every backend failed or timed out."""


@dataclass
class Decisions:
    answers: dict[str, Probs]
    backend: BackendName


class Backend(Protocol):
    label: BackendName
    timeout_s: float | None  # None means use decide()'s timeout

    async def ask(self, context: str, questions: list[Question]) -> dict[str, Probs]: ...


def request_body(model: str, context: str, questions: list[Question]) -> dict[str, Any]:
    """The Decision-1 request, from Microsoft's Foundry docs: every question is a `choice`
    question, yes/no included, so each one gets a probability per answer."""
    return {
        "model": model,
        "state": context,
        "questions": {
            q.name: {
                "type": "choice",
                "instructions": q.text,
                "criteria": {a: q.meanings.get(a, a) for a in q.answers},
            }
            for q in questions
        },
    }


def read_probabilities(payload: dict[str, Any], questions: list[Question]) -> dict[str, Probs]:
    """Parse `answers.<question>.probabilities`. A choice answer with no probabilities
    becomes one-hot on the chosen label. An answer outside the question's set is an error."""
    out: dict[str, Probs] = {}
    for q in questions:
        answer = payload["answers"][q.name]
        probs = answer.get("probabilities") or {answer["choice"]: 1.0}
        unknown = set(probs) - set(q.answers)
        if unknown:
            raise ValueError(f"{q.name}: unexpected labels {sorted(unknown)}")
        out[q.name] = {a: float(probs.get(a, 0.0)) for a in q.answers}
    return out


class Decision1Backend:
    """Decision-1 on Foundry (`api-key` header) or OpenRouter (bearer token). `endpoint` is
    the full URL, `name` is the Foundry deployment name or the OpenRouter model id."""

    timeout_s = None

    def __init__(
        self, endpoint: str, key: str, name: str, *, label: BackendName = "decision1", bearer: bool = False
    ):
        self.endpoint, self.name, self.label = endpoint, name, label
        self._headers = {"Authorization": f"Bearer {key}"} if bearer else {"api-key": key}
        self._http = httpx.AsyncClient()

    async def ask(self, context: str, questions: list[Question]) -> dict[str, Probs]:
        response = await self._http.post(
            self.endpoint, json=request_body(self.name, context, questions), headers=self._headers
        )
        response.raise_for_status()
        return read_probabilities(response.json(), questions)


def foundry_backend(endpoint: str, key: str, deployment: str) -> Decision1Backend:
    return Decision1Backend(endpoint.rstrip("/") + FOUNDRY_PATH, key, deployment)


def openrouter_backend(key: str) -> Decision1Backend:
    return Decision1Backend(OPENROUTER_URL, key, OPENROUTER_MODEL, label="openrouter", bearer=True)


def answer_model(questions: list[Question]) -> type[BaseModel]:
    """A model with one required field per question, typed as a Literal of its answers."""
    fields: dict[str, Any] = {q.name: (Literal[q.answers], ...) for q in questions}  # type: ignore[valid-type]
    return create_model("Answers", **fields)


class HaikuBackend:
    """The fallback. Haiku picks one label per question, reported as probability 1.0."""

    label: BackendName = "haiku"
    timeout_s = 6.0

    def __init__(self, llm: Any):
        self.llm = llm

    async def ask(self, context: str, questions: list[Question]) -> dict[str, Probs]:
        request = LlmRequest(
            system="Answer each question about a child's message by picking exactly one label.",
            context="",
            messages=[{"role": "user", "content": _haiku_prompt(context, questions)}],
        )
        picked = await self.llm.parse(request, answer_model(questions))
        return {q.name: {a: float(a == getattr(picked, q.name)) for a in q.answers} for q in questions}


def _haiku_prompt(context: str, questions: list[Question]) -> str:
    lines = [f"Message:\n{context}\n"]
    for q in questions:
        lines.append(f"Question {q.name}: {q.text}")
        lines += [f"  - {a}: {q.meanings.get(a, a)}" for a in q.answers]
    return "\n".join(lines)


async def decide(
    context: str, questions: list[Question], *, backends: list[Backend], timeout_s: float
) -> Decisions:
    for backend in backends:
        try:
            answers = await asyncio.wait_for(
                backend.ask(context, questions), backend.timeout_s or timeout_s
            )
        except Exception:  # any failure means try the next backend
            continue
        return Decisions(answers, backend.label)
    raise DecideUnavailable("no decision backend answered")


def alert_kinds(safety_probs: Probs, threshold: float) -> set[AlertKind]:
    """Every alert label at or above the threshold, so one turn can raise several kinds."""
    valid = get_args(AlertKind)
    kinds = {label.removeprefix("alert_") for label, p in safety_probs.items() if p >= threshold}
    return {k for k in kinds if k in valid}  # type: ignore[misc]


def top(probs: Probs) -> str:
    return max(probs, key=probs.__getitem__)
