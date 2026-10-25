"""The kite-studio hosted agent. One Invocations call builds one brand-new game or one
director's-cut movie with the Claude Agent SDK, play-tests it and returns a single self-contained
HTML page.

Hosted:  python agent.py                     (Foundry Invocations protocol on port 8088)
Local:   python agent.py --local request.json (same build, progress on stderr, result on stdout)

Request  {kind: "game", creation_id, topic, learning_goal, grade, kid_view}
         {kind: "movie", ...the same, storyboard, timings}   (no kind means a game)
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
TOOLS = ["Read", "Write", "Edit", "Bash"]
# The cloud sandbox has 2 vCPUs: a director's cut that took 5.7 min locally ran out at 420 s there.
MAX_TURNS = 18
RUN_TIMEOUT_S = 660
PLAYTEST_TIMEOUT_S = 120
FOUNDRY_SCOPE = "https://ai.azure.com/.default"
KID_VIEW_FIELDS = ("interests", "characters", "moments", "deep_topics")
MOVIE_DATA_CAP = 100_000  # bytes of storyboard and timings; a real one is about 15 KB
# kite-movie.js's clock, repeated so the brief can show times; the movie's code reads kite.movie.
CLOCK_INTRO_S, CLOCK_GAP_S, CLOCK_OUTRO_S = 1.2, 0.6, 3.5


@dataclass(frozen=True)
class Kind:
    kit: Path
    instructions: str
    page: str  # the one file the agent writes


KINDS = {
    "game": Kind(Path(os.environ.get("KIT_DIR", HERE / "game-kit")), (HERE / "instructions.md").read_text(), "game.html"),
    "movie": Kind(
        Path(os.environ.get("MOVIE_KIT_DIR", HERE / "movie-kit")), (HERE / "movie-instructions.md").read_text(), "movie.html"
    ),
}


@dataclass
class Playtest:
    passed: bool
    errors: list[str]


@dataclass
class Result:
    status: Literal["ready", "failed"]
    html: str | None
    playtest: Playtest


def parse_request(data: object) -> dict:
    """The request as the brain sends it, or ValueError. Nothing else is trusted."""
    if not isinstance(data, dict):
        raise ValueError("request must be a JSON object")
    kind = data.get("kind", "game")
    if kind not in KINDS:
        raise ValueError("kind must be game or movie")
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
    req = {"kind": kind, "creation_id": cid, "grade": grade, **text, "kid_view": kid_view}
    return req | (parse_movie(data) if kind == "movie" else {})


def parse_movie(data: dict) -> dict:
    """The storyboard and its word timings, shaped the way kite-movie.js reads them."""
    board, timings = data.get("storyboard"), data.get("timings")
    scenes = board.get("scenes") if isinstance(board, dict) else None
    if not (
        isinstance(scenes, list) and 1 <= len(scenes) <= 5 and isinstance(board.get("title"), str)
        and all(isinstance(s, dict) and isinstance(s.get("lines"), list) and s["lines"] for s in scenes)
        and all(isinstance(line, dict) and isinstance(line.get("text"), str) for s in scenes for line in s["lines"])
    ):
        raise ValueError("storyboard must have a title and 1 to 5 scenes, each with lines of text")
    if not (
        isinstance(timings, dict)
        and all(isinstance(words, list) for words in timings.values())
        and all(isinstance(w, dict) and isinstance(w.get("start"), int | float) and isinstance(w.get("end"), int | float)
                for words in timings.values() for w in words)
    ):
        raise ValueError("timings must map line keys to lists of words with start and end")
    if len(json.dumps([board, timings])) > MOVIE_DATA_CAP:
        raise ValueError("storyboard and timings are too large")
    return {"storyboard": board, "timings": timings}


def brief(req: dict) -> str:
    view = req["kid_view"]
    lines = [
        f"Topic: {req['topic']}",
        f"Learning goal: {req['learning_goal']}",
        f"Grade: {req['grade']}",
        f"Characters the kid loves: {', '.join(view['characters']) or 'none known, invent a friendly one'}",
        f"Interests: {', '.join(view['interests']) or 'none known'}",
    ]
    if req["kind"] == "movie":
        board = req["storyboard"]
        lines += ["", f"Storyboard: {board['title']}. Times are seconds on the clock; in code, take them from kite.movie."]
        t = CLOCK_INTRO_S
        for s, scene in enumerate(board["scenes"]):
            actors = ", ".join(a.get("name") or a.get("sprite", "") for a in scene.get("actors", []) if isinstance(a, dict))
            head, start = len(lines), t
            for n, line in enumerate(scene["lines"]):
                words = req["timings"].get(f"{s}-{n}") or []
                length = max((w["end"] for w in words), default=0) or len(line["text"].split()) * 0.35
                lines.append(f"  {s}-{n} {t:.1f}-{t + length:.1f} {line.get('speaker', '')}: {line['text']}")
                t += length
            lines.insert(head, f"Scene {s} {start:.1f}-{t:.1f} s ({scene.get('background', '')}, {scene.get('camera', '')} camera; "
                               f"template actors: {actors or 'none'})")
            t += CLOCK_GAP_S
        t += CLOCK_OUTRO_S - CLOCK_GAP_S
        lines += [f"Outro card until {t:.1f} s, the end of the movie.", "",
                  "Your instructions document the kit, so don't read gsap.js, kite-movie.js, movie-data.js or playtest.mjs."]
    lines.append(f"Write {KINDS[req['kind']].page} in this folder, run `npm run playtest`, fix until it passes, "
                 "then Read the shots, critique them, revise at least once, and stop.")
    return "\n".join(lines)


def work_home() -> Path:
    """A home this process can write to. The hosted platform sets HOME to its session folder,
    which the image's non-root user cannot write, so the page, Claude Code's config and npm's
    cache all live here instead."""
    for candidate in (os.environ.get("KITE_WORK_HOME"), os.environ.get("HOME"), "/home/agent"):
        if candidate:
            path = Path(candidate)
            try:
                path.mkdir(parents=True, exist_ok=True)
            except OSError:
                continue
            if os.access(path, os.W_OK):
                return path
    raise PermissionError("no writable home for the page")


def work_dir(kind: str) -> Path:
    """<work home>/<kind> with the kit in it and last run's page and frames gone. Idempotent."""
    kit = KINDS[kind].kit
    d = work_home() / kind
    shutil.copytree(kit, d, dirs_exist_ok=True, ignore=shutil.ignore_patterns("node_modules", "dist", "samples", "shots", "check-samples.mjs"))
    modules = d / "node_modules"
    if not modules.exists():
        modules.symlink_to(kit / "node_modules", target_is_directory=True)
    (d / KINDS[kind].page).unlink(missing_ok=True)
    for old in ("dist", "shots"):
        shutil.rmtree(d / old, ignore_errors=True)
    return d


def write_movie_data(req: dict, cwd: Path) -> None:
    """movie-data.js from the request. `<` is escaped so no narration can close the inlined script."""
    data = {"title": req["storyboard"]["title"], "grade": req["grade"], "storyboard": req["storyboard"], "timings": req["timings"]}
    (cwd / "movie-data.js").write_text("window.KITE_MOVIE = " + json.dumps(data).replace("<", "\\u003c") + ";\n")


def foundry_env() -> dict[str, str]:
    """On Foundry with no key, hand Claude Code an Entra token from the sandbox's own identity."""
    env = {"DISABLE_AUTOUPDATER": "1", "DISABLE_TELEMETRY": "1", "HOME": str(work_home())}
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
        system_prompt=KINDS[req["kind"]].instructions,
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


def playtest(kind: str, cwd: Path) -> Playtest:
    """The verdict of the image's own kit, not the copy the agent could edit, and not its word."""
    page = cwd / KINDS[kind].page
    if not page.exists():
        return Playtest(False, [f"NO_HTML: the agent never wrote {page.name}"])
    try:
        r = subprocess.run(
            ["node", str(KINDS[kind].kit / "playtest.mjs"), str(page)], cwd=cwd, capture_output=True, text=True,
            timeout=PLAYTEST_TIMEOUT_S, env={**os.environ, "HOME": str(work_home())},
        )
        verdict = json.loads(r.stdout.strip().splitlines()[-1])
    except (subprocess.TimeoutExpired, ValueError, IndexError) as e:
        return Playtest(False, [f"PLAYTEST_CRASHED: {type(e).__name__}"])
    return Playtest(bool(verdict.get("passed")), [str(x) for x in verdict.get("errors", [])])


async def build(req: dict) -> AsyncIterator[str | Result]:
    kind = req["kind"]
    cwd = work_dir(kind)
    if kind == "movie":
        write_movie_data(req, cwd)
    yield f"Building a {kind} about {req['topic']}"
    page, before = cwd / KINDS[kind].page, cwd / "before-critic.html"
    async for line in run_agent(req, cwd):
        if line.startswith("Read ") and line.endswith(".png") and page.exists() and not before.exists():
            shutil.copy(page, before)  # what the page was when the critic first looked, for review
        yield line
    yield "Play-testing"
    if kind == "movie":
        write_movie_data(req, cwd)  # the data that ships is ours, whatever the agent did to its copy
    result = await asyncio.to_thread(playtest, kind, cwd)
    html = (cwd / "dist" / KINDS[kind].page).read_text() if result.passed else None
    yield Result("ready" if html else "failed", html, result)


def event_line(item: str | Result) -> str:
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
            try:
                async for item in build(req):
                    yield event_line(item)
            except Exception as e:  # a crash still ends the stream with a result the brain can read
                yield event_line(Result("failed", None, Playtest(False, [f"AGENT_CRASHED: {type(e).__name__}"])))

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
