"""The kite-studio hosted agent. One Invocations call builds one brand-new KAPLAY game with
the Claude Agent SDK, play-tests it and returns a single self-contained game.html.

Hosted:  python agent.py                     (Foundry Invocations protocol on port 8088)
Local:   python agent.py --local request.json (same build, progress on stderr, result on stdout)

Request  {creation_id, topic, learning_goal, grade, kid_view}
Stream   newline-delimited JSON: {"progress": str}... then {"status", "html", "playtest"}
"""

import asyncio
import json
import os
import shutil
import subprocess
import sys
import time
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal

from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ClaudeSDKError,
    ResultMessage,
    TextBlock,
    ToolUseBlock,
    query,
)

HERE = Path(__file__).resolve().parent
KIT_DIR = Path(os.environ.get("KIT_DIR", HERE / "game-kit"))
INSTRUCTIONS = (HERE / "instructions.md").read_text()
TOOLS = ["Read", "Write", "Edit", "Bash"]
MAX_TURNS = 8
RUN_TIMEOUT_S = 180
PLAYTEST_TIMEOUT_S = 90
FOUNDRY_SCOPE = "https://ai.azure.com/.default"
KID_VIEW_FIELDS = ("interests", "characters", "moments", "deep_topics")


@dataclass
class Playtest:
    passed: bool
    errors: list[str]


@dataclass
class GameResult:
    status: Literal["ready", "failed"]
    html: str | None
    playtest: Playtest


def parse_request(data: object) -> dict:
    """The request as the brain sends it, or ValueError. Nothing else is trusted."""
    if not isinstance(data, dict):
        raise ValueError("request must be a JSON object")
    cid = data.get("creation_id")
    if not (isinstance(cid, str) and len(cid) == 32 and all(c in "0123456789abcdef" for c in cid)):
        raise ValueError("creation_id must be 32 hex characters")
    grade = data.get("grade")
    if not (isinstance(grade, int) and 0 <= grade <= 12):
        raise ValueError("grade must be 0..12")
    text = {}
    for field, cap in (("topic", 200), ("learning_goal", 300)):
        value = data.get(field)
        if not (isinstance(value, str) and value.strip()):
            raise ValueError(f"{field} must be a non-empty string")
        text[field] = value.strip()[:cap]
    view = data.get("kid_view") or {}
    if not isinstance(view, dict):
        raise ValueError("kid_view must be an object")
    kid_view = {f: [str(x)[:60] for x in view.get(f, [])][:10] for f in KID_VIEW_FIELDS}
    return {"creation_id": cid, "grade": grade, **text, "kid_view": kid_view}


def brief(req: dict) -> str:
    view = req["kid_view"]
    lines = [
        f"Topic: {req['topic']}",
        f"Learning goal: {req['learning_goal']}",
        f"Grade: {req['grade']}",
        f"Characters the kid loves: {', '.join(view['characters']) or 'none known, invent a friendly one'}",
        f"Interests: {', '.join(view['interests']) or 'none known'}",
        "Write game.html in this folder, run `npm run playtest`, fix until it passes, then stop.",
    ]
    return "\n".join(lines)


def game_dir() -> Path:
    """$HOME/game with the kit in it. Idempotent, so a retry on the same session is fine."""
    d = Path(os.environ.get("KITE_GAME_DIR") or Path.home() / "game")
    shutil.copytree(KIT_DIR, d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "dist", "samples"))
    modules = d / "node_modules"
    if not modules.exists():
        modules.symlink_to(KIT_DIR / "node_modules", target_is_directory=True)
    return d


def foundry_env() -> dict[str, str]:
    """On Foundry with no key, hand Claude Code an Entra token from the sandbox's own identity."""
    env = {"DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1"}
    if os.environ.get("CLAUDE_CODE_USE_FOUNDRY") and not (
        os.environ.get("ANTHROPIC_FOUNDRY_API_KEY") or os.environ.get("ANTHROPIC_FOUNDRY_AUTH_TOKEN")
    ):
        from azure.identity import DefaultAzureCredential

        env["ANTHROPIC_FOUNDRY_AUTH_TOKEN"] = DefaultAzureCredential().get_token(FOUNDRY_SCOPE).token
    return env


def progress_lines(msg: object) -> list[str]:
    if isinstance(msg, AssistantMessage):
        out = []
        for block in msg.content:
            if isinstance(block, TextBlock) and block.text.strip():
                out.append(block.text.strip().splitlines()[0][:80])
            elif isinstance(block, ToolUseBlock):
                target = block.input.get("file_path") or block.input.get("command") or ""
                out.append(f"{block.name} {Path(target).name if block.name != 'Bash' else target}"[:80])
        return out
    if isinstance(msg, ResultMessage):
        return [f"Agent finished after {msg.num_turns} turns ({msg.subtype})"]
    return []


async def run_agent(req: dict, cwd: Path) -> AsyncIterator[str]:
    options = ClaudeAgentOptions(
        system_prompt=INSTRUCTIONS,
        tools=TOOLS,
        allowed_tools=TOOLS,
        cwd=str(cwd),
        max_turns=MAX_TURNS,
        setting_sources=[],
        env=foundry_env(),
        model=os.environ.get("ANTHROPIC_MODEL"),
        cli_path=shutil.which("claude"),
    )
    stream = query(prompt=brief(req), options=options)
    deadline = time.monotonic() + RUN_TIMEOUT_S
    try:
        while True:
            try:
                msg = await asyncio.wait_for(anext(stream), max(0.0, deadline - time.monotonic()))
            except StopAsyncIteration:
                return
            except TimeoutError:
                yield f"Out of time after {RUN_TIMEOUT_S} s, play-testing what is there"
                return
            except ClaudeSDKError as e:
                yield f"Agent stopped: {type(e).__name__}"
                return
            for line in progress_lines(msg):
                yield line
    finally:
        await stream.aclose()


def playtest(cwd: Path) -> Playtest:
    """The kit's verdict on game.html, run by us, not taken from the agent's word."""
    if not (cwd / "game.html").exists():
        return Playtest(False, ["NO_HTML: the agent never wrote game.html"])
    try:
        r = subprocess.run(
            ["npm", "run", "--silent", "playtest"], cwd=cwd, capture_output=True, text=True, timeout=PLAYTEST_TIMEOUT_S
        )
        verdict = json.loads(r.stdout.strip().splitlines()[-1])
    except (subprocess.TimeoutExpired, ValueError, IndexError) as e:
        return Playtest(False, [f"PLAYTEST_CRASHED: {type(e).__name__}"])
    return Playtest(bool(verdict.get("passed")), [str(x) for x in verdict.get("errors", [])])


async def build(req: dict) -> AsyncIterator[str | GameResult]:
    cwd = game_dir()
    (cwd / "game.html").unlink(missing_ok=True)
    yield f"Building a game about {req['topic']}"
    async for line in run_agent(req, cwd):
        yield line
    yield "Play-testing"
    result = await asyncio.to_thread(playtest, cwd)
    html = (cwd / "dist" / "game.html").read_text() if result.passed else None
    yield GameResult("ready" if html else "failed", html, result)


def event_line(item: str | GameResult) -> str:
    return json.dumps({"progress": item} if isinstance(item, str) else asdict(item)) + "\n"


def serve() -> None:
    from azure.ai.agentserver.invocations import InvocationAgentServerHost
    from starlette.requests import Request
    from starlette.responses import JSONResponse, StreamingResponse

    app = InvocationAgentServerHost()

    @app.invoke_handler
    async def handle(request: Request):
        try:
            req = parse_request(await request.json())
        except ValueError as e:
            return JSONResponse({"error": str(e)}, status_code=400)

        async def events():
            async for item in build(req):
                yield event_line(item)

        return StreamingResponse(events(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    app.run()


async def local(path: str) -> int:
    req = parse_request(json.loads(Path(path).read_text()))
    async for item in build(req):
        if isinstance(item, str):
            print(item, file=sys.stderr)
        else:
            print(event_line(item), end="")
            return 0 if item.status == "ready" else 1
    return 1


if __name__ == "__main__":
    if len(sys.argv) == 3 and sys.argv[1] == "--local":
        sys.exit(asyncio.run(local(sys.argv[2])))
    serve()
