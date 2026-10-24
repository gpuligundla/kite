"""Brand-new game claims (Studio Pro, M11), with a stand-in studio agent and the stand-ins from
checks/pipeline.py. Run from brain/: uv run python -m scripts.checks.studio_pro"""

import asyncio
import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from kite_brain import studio_pro
from kite_brain.api import create_app
from kite_brain.deps import Deps
from kite_brain.routers import games
from kite_brain.seed import KID_ID, seed
from kite_brain.studio_pro import GameResult, Playtest, build_custom_game, start_custom_game, text_strings
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG, NOW, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns, deps_for, types

TOPIC, GOAL = "light", "The sky looks blue because air scatters blue light."
GAME = """<!doctype html><html><head><title>Catch the blue light</title></head><body>
<script data-kit="kaplay">var kaplay = function () { "kit strings are ours" };</script>
<script>const title = kite.say("Catch the blue light!"); const label = 'HIDDEN'; const n = "42";</script>
</body></html>"""


class StandInAgent:
    """Records the request, streams two progress lines, then returns, raises or dawdles."""

    def __init__(self, result=None, error=None, delay_s=0.0):
        self.result, self.error, self.delay_s = result, error, delay_s
        self.requests = []

    async def build(self, request, progress):
        self.requests.append(request)
        progress("Write game.html")
        progress("Bash npm run playtest")
        await asyncio.sleep(self.delay_s)
        if self.error:
            raise self.error
        return self.result


def ready(html=GAME) -> GameResult:
    return GameResult("ready", html, Playtest(True, []))


def run_build(stand, agent, timeout_s=studio_pro.STUDIO_AGENT_TIMEOUT_S):
    deps, bus = deps_for(stand)
    folder = Path(tempfile.mkdtemp())

    async def go():
        cid = start_custom_game(deps, KID_ID, TOPIC, GOAL)
        return cid, await build_custom_game(deps, KID_ID, cid, TOPIC, GOAL, agent=agent)

    with patch.object(studio_pro, "CREATIONS_DIR", folder), patch.object(studio_pro, "STUDIO_AGENT_TIMEOUT_S", timeout_s):
        cid, creation = asyncio.run(go())
    seen = {kind: asyncio.run(drain(bus, kind)) for kind in ("os", "parent", "counselor")}
    return cid, creation, folder, seen


def expect_fallback(cid, creation, folder, seen, why):
    assert creation.status == "fallback" and creation.html_url is None, f"{why}: {creation}"
    assert not (folder / cid / "game.html").exists(), f"{why}: no game file may be saved"
    assert json.loads((folder / cid / "creation.json").read_text())["status"] == "fallback", why
    for kind in ("os", "parent"):
        assert seen[kind][-1].type == "creation.ready" and seen[kind][-1].status == "fallback", f"{why}: {kind} hears fallback"
    assert not seen["counselor"], "never the counselor"


def check_text_strings() -> None:
    got = text_strings(GAME)
    assert "Catch the blue light" in got and "Catch the blue light!" in got and "HIDDEN" in got, got
    assert "kit strings are ours" not in got, "the kit's own scripts are not screened"
    assert "42" not in got, "numbers are not text"


def check_success_publishes_ready_and_stores_html_url() -> None:
    agent = StandInAgent(ready())
    cid, creation, folder, seen = run_build(StandIns(decide=None), agent)
    assert len(cid) == 32 and creation.status == "ready" and creation.html_url == f"/creations/{cid}/game.html", creation
    assert (folder / cid / "game.html").read_text() == GAME, "the game is saved under the creation"
    assert json.loads((folder / cid / "creation.json").read_text())["html_url"] == creation.html_url
    kid = types(seen["os"])
    assert kid == ["creation.progress"] * 3 + ["creation.ready"], kid
    assert types(seen["parent"]) == kid and not seen["counselor"], "the parent gets a copy of each kid event"
    assert seen["os"][-1].status == "ready" and seen["parent"][-1].status == "ready"
    assert [e.step for e in seen["os"][:3]] == [0, 1, 2]
    [req] = agent.requests
    assert set(req) == {"creation_id", "topic", "learning_goal", "grade", "kid_view"}, req
    assert set(req["kid_view"]) == {"interests", "characters", "moments", "deep_topics"}, "the kid view, never levels"
    assert req["grade"] == 11 and req["creation_id"] == cid


def check_flagged_text_is_fallback() -> None:
    out = run_build(StandIns(decide=None, flag_output="HIDDEN"), StandInAgent(ready()))
    expect_fallback(*out, why="a flagged string")


def check_agent_failure_is_fallback() -> None:
    out = run_build(StandIns(decide=None), StandInAgent(error=RuntimeError("502")))
    expect_fallback(*out, why="an agent error")
    out = run_build(StandIns(decide=None), StandInAgent(GameResult("failed", None, Playtest(False, ["NO_READY"]))))
    expect_fallback(*out, why="an agent that gave up")


def check_timeout_is_fallback() -> None:
    out = run_build(StandIns(decide=None), StandInAgent(ready(), delay_s=0.5), timeout_s=0.05)
    expect_fallback(*out, why="a timeout")


def check_endpoint_is_for_kid_devices() -> None:
    conn, keys = fresh()
    tokens = seed(conn, keys, NOW).tokens
    app = create_app(conn)
    stand = StandIns(decide=None)
    app.state.deps = Deps(
        conn=conn, keys=keys, bus=app.state.bus, catalog=CATALOG, decide=stand.decide,
        llm=stand, embed=async_embed, safety=stand, stt=stand, tts=stand, clock=lambda: NOW,
    )
    app.include_router(games.router)  # api.py gets this include at merge
    client = TestClient(app)
    bearer = lambda kind: {"Authorization": f"Bearer {tokens[kind]}"}  # noqa: E731
    url, body = f"/kids/{KID_ID}/games/custom", {"topic": TOPIC, "learning_goal": GOAL}
    folder = Path(tempfile.mkdtemp())
    with patch.object(studio_pro, "CREATIONS_DIR", folder), patch.object(studio_pro, "default_agent", lambda: StandInAgent(ready())):
        for kind in ("parent", "counselor"):
            assert client.post(url, json=body, headers=bearer(kind)).status_code == 403, f"{kind} cannot order a game"
        assert client.post(url, json=body).status_code == 401
        assert client.post(url, json={"topic": "", "learning_goal": GOAL}, headers=bearer("os")).status_code == 422
        assert client.get(f"/creations/{'0' * 32}/game.html").status_code == 404, "unknown id"
        assert client.get(f"/creations/{'z' * 32}/game.html").status_code == 404, "malformed id"
        r = client.post(url, json=body, headers=bearer("handheld"))
        assert r.status_code == 200, r.text
        cid = r.json()["creation_id"]
        assert len(cid) == 32
        page = client.get(f"/creations/{cid}/game.html")  # the test client ran the background build already
        assert page.status_code == 200 and page.text == GAME, page.status_code
        assert page.headers["content-security-policy"].startswith("default-src 'none'"), "no network from the game"
    kid = asyncio.run(drain(app.state.bus, "os"))
    assert kid[-1].type == "creation.ready" and kid[-1].status == "ready" and kid[-1].creation_id == cid


def run() -> None:
    check_text_strings()
    check_success_publishes_ready_and_stores_html_url()
    check_flagged_text_is_fallback()
    check_agent_failure_is_fallback()
    check_timeout_is_fallback()
    check_endpoint_is_for_kid_devices()


if __name__ == "__main__":
    run()
    print("ok")
