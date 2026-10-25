"""Claude on Foundry: streamed answers (Sonnet) and structured parses (Haiku, or Sonnet for the studio)."""

import base64
from collections.abc import AsyncIterator
from typing import Any, TypeVar

from anthropic import AsyncAnthropicFoundry, omit
from pydantic import BaseModel

from kite_brain.config import Settings
from kite_brain.deps import LlmRequest, ToolCall

T = TypeVar("T", bound=BaseModel)

ANSWER_MAX_TOKENS = 2048
PARSE_MAX_TOKENS = 1024
DEEP_PARSE_MAX_TOKENS = 8192  # a storyboard plus the thinking that comes before it
EFFORT_LOW = {"effort": "low"}
EFFORT_MEDIUM = {"effort": "medium"}

_TOPIC = {"type": "string", "description": "What it is about, in a few words, e.g. 'volcanoes'."}
_GOAL = {
    "type": "string",
    "description": "The one idea the child should come away with, as a plain sentence of fact. Not a greeting.",
}
# Kids talk to Kite out loud, so they ask in passing and point back ("that", "it") at what was just said. A
# conversation with earlier asks in it once made Claude start a movie for every later question, hence "latest".
_ASKING = (
    "Call it only when the child's latest message asks for one, in any words. Never start one on your own or because "
    "they asked for one earlier; you can offer it in words instead. When they say 'that' or 'it', take the topic from "
    "the recent conversation. Say one short sentence telling them what you're making, then call this."
)


def _tool(name: str, description: str, goal: bool = True) -> dict[str, Any]:
    properties = {"topic": _TOPIC, "learning_goal": _GOAL} if goal else {"topic": _TOPIC}
    return {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": {
            "type": "object", "properties": properties, "required": list(properties), "additionalProperties": False,
        },
    }


TOOLS = [
    _tool("make_movie", "Make a short animated movie that teaches a topic. Use it whenever the child asks for a "
          f"movie, video, cartoon, film or show to watch. {_ASKING}"),
    _tool("make_game", "Make a quick game that practices a topic. Use it whenever the child asks to play or make a "
          f"game, unless they ask for a brand-new one. {_ASKING}"),
    _tool("build_new_game", "Build a brand-new game from scratch, made just for this child. It takes a few minutes. "
          "Use it instead of make_game only when the child asks for a new, custom, different or brand-new game, or "
          f"one built or designed for them. {_ASKING}"),
    _tool("teach_kite", "Start Teach Kite: the child explains a topic and you listen. Use it only when the child's "
          "latest message says they want to teach you, explain something to you, or show you what they know. Kite opens the lesson with "
          "its own line, so don't ask about the topic or explain it yourself.", goal=False),
]


class LlmRefused(Exception):
    """Claude ended with stop_reason `refusal`. The pipeline turns this into the FALLBACK line."""


def _system(req: LlmRequest) -> list[dict[str, Any]]:
    """The cached persona first, then the per-turn context, so the cache prefix never changes."""
    blocks: list[dict[str, Any]] = [
        {"type": "text", "text": req.system, "cache_control": {"type": "ephemeral"}}
    ]
    if req.context:
        blocks.append({"type": "text", "text": req.context})
    return blocks


def _messages(req: LlmRequest) -> list[dict[str, Any]]:
    messages: list[dict[str, Any]] = [dict(m) for m in req.messages]
    if req.image:
        media = "image/png" if req.image.startswith(b"\x89PNG") else "image/jpeg"
        image = {
            "type": "image",
            "source": {"type": "base64", "media_type": media, "data": base64.b64encode(req.image).decode()},
        }
        last = messages[-1]
        messages[-1] = {**last, "content": [image, {"type": "text", "text": last["content"]}]}
    return messages


class FoundryLlm:
    def __init__(self, settings: Settings):
        self.client = AsyncAnthropicFoundry(
            api_key=settings.FOUNDRY_KEY, base_url=settings.FOUNDRY_ENDPOINT.rstrip("/") + "/anthropic/"
        )
        self.answer_model = settings.ANSWER_DEPLOYMENT
        self.fast_model = settings.FAST_DEPLOYMENT

    async def stream(self, req: LlmRequest) -> AsyncIterator[str | ToolCall]:
        """Text deltas as they arrive, then any tool call. Raises LlmRefused on a refusal."""
        async with self.client.messages.stream(
            model=self.answer_model,
            max_tokens=ANSWER_MAX_TOKENS,
            system=_system(req),
            messages=_messages(req),
            thinking={"type": "between_tools"},
            output_config=EFFORT_LOW,
            tools=TOOLS if req.tools else omit,
        ) as stream:
            async for text in stream.text_stream:
                yield text
            final = await stream.get_final_message()
        if final.stop_reason == "refusal":
            raise LlmRefused("answer refused")
        for block in final.content:
            if block.type == "tool_use":
                yield ToolCall(name=block.name, topic=block.input["topic"],
                               learning_goal=block.input.get("learning_goal", ""))

    async def parse(self, req: LlmRequest, model_cls: type[T], *, deep: bool = False) -> T:
        """Haiku with structured output, or with `deep` Sonnet at medium effort (storyboards and
        game specs). Raises LlmRefused on a refusal."""
        response = await self.client.messages.parse(
            model=self.answer_model if deep else self.fast_model,
            max_tokens=DEEP_PARSE_MAX_TOKENS if deep else PARSE_MAX_TOKENS,
            system=_system(req),
            messages=_messages(req),
            thinking={"type": "adaptive"},  # Foundry: structured output on 5.5 models needs adaptive thinking
            output_config=EFFORT_MEDIUM if deep else EFFORT_LOW,
            output_format=model_cls,
        )
        if response.stop_reason == "refusal":
            raise LlmRefused("parse refused")
        if response.parsed_output is None:
            raise ValueError(f"no parsed output (stop_reason={response.stop_reason})")
        return response.parsed_output
