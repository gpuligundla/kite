"""Brand-new game claims (Studio Pro, M11), with a stand-in studio agent and the stand-ins from
checks/pipeline.py. Run from brain/: uv run python -m scripts.checks.studio_pro"""

import asyncio
import base64
import json
import re
import tempfile
from functools import partial
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from kite_brain import studio_pro
from kite_brain.api import create_app
from kite_brain.deps import Deps
from kite_brain.routers import games
from kite_brain.seed import KID_ID, seed
from kite_brain.studio import movie
from kite_brain.studio_pro import GameResult, Playtest, build_custom_game, start_page, text_strings
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG, NOW, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns, deps_for, types
from scripts.checks.studio import Studio, board, creation_in, run_job
from scripts.checks.voice import use_sample_voices

TOPIC, GOAL = "light", "The sky looks blue because air scatters blue light."
GAME = """<!doctype html><html><head><title>Catch the blue light</title></head><body>
<script data-kit="kaplay">var kaplay = function () { "kit strings are ours" };</script>
<script data-kit="KITE_SOUNDS">window.KITE_SOUNDS = {};</script>
<script>const title = kite.say("Catch the blue light!"); const label = 'HIDDEN'; const n = "42";</script>
</body></html>"""


def with_sounds(page: str) -> bool:
    """The game's sound slot holds the kid UI's four MP3s."""
    sounds = json.loads(re.search(r'<script data-kit="KITE_SOUNDS">window\.KITE_SOUNDS = (\{.*?\});</script>', page).group(1))
    return sounds == {name: "data:audio/mpeg;base64," + base64.b64encode(path.read_bytes()).decode() for name, path in studio_pro.GAME_SOUNDS.items()}


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
        cid = start_page(deps, KID_ID, "game")
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
    saved = (folder / cid / "game.html").read_text()
    assert with_sounds(saved) and saved == studio_pro.inject(GAME, "KITE_SOUNDS", studio_pro.GAME_SOUNDS), "saved with its sounds, otherwise as built"
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
    no_slot = GAME.replace('<script data-kit="KITE_SOUNDS">window.KITE_SOUNDS = {};</script>', "")
    out = run_build(StandIns(decide=None), StandInAgent(ready(no_slot)))
    expect_fallback(*out, why="a game page with no sound slot")


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
        assert page.status_code == 200 and with_sounds(page.text), page.status_code
        assert page.headers["content-security-policy"].startswith("default-src 'none'"), "no network from the game"
    kid = asyncio.run(drain(app.state.bus, "os"))
    assert kid[-1].type == "creation.ready" and kid[-1].status == "ready" and kid[-1].creation_id == cid


MOVIE = """<!doctype html><html><body><div id="stage"><p>Magma rises</p></div>
<script data-kit="KITE_AUDIO">window.KITE_AUDIO = {};</script>
<script>kite.ready();</script></body></html>"""


def run_cut(agent, timeout_s=studio_pro.STUDIO_AGENT_TIMEOUT_S, music=b"music"):
    """The template movie job with its director's cut on and no MP4 render.
    Returns (template id, cut id, folder, the cut's events by device, every event by device)."""
    use_sample_voices()

    async def music_bed(topic, grade, seconds):
        assert seconds > 10, "the bed covers the whole movie"
        return music

    patches = {
        "start_directors_cut": partial(movie.start_directors_cut, agent=agent), "music_bed": music_bed,
        "RENDER_SCRIPT": Path(tempfile.mkdtemp()) / "absent.mjs",
    }
    with patch.object(studio_pro, "STUDIO_AGENT_TIMEOUT_S", timeout_s):
        _, template, folder, seen = run_job(Studio(board()), movie.start_movie, movie=patches)
    [cut] = {e.creation_id for e in seen["os"]} - {template}
    return template, cut, folder, {kind: [e for e in seen[kind] if e.creation_id == cut] for kind in ("os", "parent")}, seen


def check_directors_cut_gets_the_narration_and_no_network() -> None:
    agent = StandInAgent(ready(MOVIE))
    template_id, cut, folder, events, seen = run_cut(agent)
    template = creation_in(folder, template_id)
    assert template.status == "ready" and template.html_url is None, "the template stays her movie"
    made = creation_in(folder, cut)
    assert made.kind == "movie" and made.status == "ready" and made.html_url == f"/creations/{cut}/movie.html", made
    page = (folder / cut / "movie.html").read_text()
    audio = json.loads(re.search(r'<script data-kit="KITE_AUDIO">window\.KITE_AUDIO = (\{.*?\});</script>', page).group(1))
    url = lambda data: "data:audio/mpeg;base64," + base64.b64encode(data).decode()  # noqa: E731
    music = audio.pop("music")
    assert set(audio) == set(template.audio) and set(audio.values()) == {url(b"mp3")}, "every narration line, inlined"
    assert music == url(b"music"), "and the music bed"
    _, quiet, quiet_folder, _, _ = run_cut(StandInAgent(ready(MOVIE)), music=None)
    assert "music" not in json.loads(re.search(r"window\.KITE_AUDIO = (\{.*?\});", (quiet_folder / quiet / "movie.html").read_text()).group(1)), (
        "no music bed still makes a movie"
    )
    [req] = agent.requests
    assert set(req) == {"kind", "creation_id", "topic", "learning_goal", "grade", "kid_view", "storyboard", "timings"}, req
    assert req["kind"] == "movie" and req["creation_id"] == cut and req["grade"] == 11
    assert req["storyboard"] == template.storyboard.model_dump(mode="json") and set(req["timings"]) == set(template.audio)
    kid = events["os"]
    assert types(kid) == ["creation.progress"] * 3 + ["creation.ready"] and kid[-1].status == "ready" and kid[-1].kind == "movie", types(kid)
    assert types(events["parent"]) == types(kid) and not seen["counselor"], "the parent gets a copy, never the counselor"
    app = FastAPI()
    app.include_router(games.router)
    client = TestClient(app)
    with patch.object(studio_pro, "CREATIONS_DIR", folder):
        r = client.get(f"/creations/{cut}/movie.html")
        assert r.status_code == 200 and r.text == page, r.status_code
        assert r.headers["content-security-policy"] == games.CSP and games.CSP.startswith("default-src 'none'"), "no network"
        assert client.get(f"/creations/{cut}/game.html").status_code == 404, "a movie has no game page"
        assert client.get(f"/creations/{cut}/creation.html").status_code == 404, "only game and movie pages are served"


def check_directors_cut_failures_keep_the_template() -> None:
    for why, agent, timeout_s in (
        ("an agent error", StandInAgent(error=RuntimeError("502")), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("an agent that gave up", StandInAgent(GameResult("failed", None, Playtest(False, ["SAME_FRAMES"]))), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("a page with no audio slot", StandInAgent(ready()), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("a timeout", StandInAgent(ready(MOVIE), delay_s=0.5), 0.05),
    ):
        template_id, cut, folder, events, seen = run_cut(agent, timeout_s)
        made = creation_in(folder, cut)
        assert made.status == "fallback" and made.html_url is None and not (folder / cut / "movie.html").exists(), why
        assert creation_in(folder, template_id).status == "ready", f"{why}: the template still plays"
        for kind, cut_events in events.items():
            last = cut_events[-1]
            assert last.type == "creation.ready" and last.status == "fallback" and last.kind == "movie", f"{why}: {kind} hears fallback"
        assert not seen["counselor"], why


def check_kits_play_test_under_the_served_policy() -> None:
    kits = Path(__file__).resolve().parents[3] / "studio-agent"
    for kit in ("game-kit", "movie-kit"):
        assert games.CSP in (kits / kit / "playtest.mjs").read_text(), f"{kit} play-tests under the policy the brain serves"


def check_no_endpoint_no_directors_cut() -> None:
    with patch.object(movie, "get_settings", lambda: SimpleNamespace(STUDIO_AGENT_ENDPOINT="")):
        assert movie.start_directors_cut(None, KID_ID, None, TOPIC, GOAL, 11) is None


def run() -> None:
    check_text_strings()
    check_success_publishes_ready_and_stores_html_url()
    check_flagged_text_is_fallback()
    check_agent_failure_is_fallback()
    check_timeout_is_fallback()
    check_endpoint_is_for_kid_devices()
    check_directors_cut_gets_the_narration_and_no_network()
    check_directors_cut_failures_keep_the_template()
    check_no_endpoint_no_directors_cut()
    check_kits_play_test_under_the_served_policy()


if __name__ == "__main__":
    run()
    print("ok")
