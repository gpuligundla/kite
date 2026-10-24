"""Claude on Foundry: streamed answers (Sonnet) and structured parses (Haiku)."""

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
EFFORT_LOW = {"effort": "low"}

TOOLS = [
    {
        "name": name,
        "description": description,
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {"topic": {"type": "string"}, "learning_goal": {"type": "string"}},
            "required": ["topic", "learning_goal"],
            "additionalProperties": False,
        },
    }
    for name, description in (
        ("make_movie", "Make a short animated movie that teaches the topic."),
        ("make_game", "Make a simple game that practices the topic."),
    )
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
                               learning_goal=block.input["learning_goal"])

    async def parse(self, req: LlmRequest, model_cls: type[T]) -> T:
        """Haiku with structured output. Raises LlmRefused on a refusal."""
        response = await self.client.messages.parse(
            model=self.fast_model,
            max_tokens=PARSE_MAX_TOKENS,
            system=_system(req),
            messages=_messages(req),
            thinking={"type": "adaptive"},  # Foundry: structured output on 5.5 models needs adaptive thinking
            output_config=EFFORT_LOW,
            output_format=model_cls,
        )
        if response.stop_reason == "refusal":
            raise LlmRefused("parse refused")
        if response.parsed_output is None:
            raise ValueError(f"no parsed output (stop_reason={response.stop_reason})")
        return response.parsed_output
