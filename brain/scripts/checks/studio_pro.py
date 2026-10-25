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
from kite_brain.studio import game, movie, store
from kite_brain.studio_pro import PageResult, Playtest, build_custom_game, start_page, text_strings
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG, NOW, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns, deps_for, types
from scripts.checks.studio import SKY_CONCEPT, Studio, board, client_for, creation_in, evidence_rows, run_job
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


def ready(html=GAME) -> PageResult:
    return PageResult("ready", html, Playtest(True, []))


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
    out = run_build(StandIns(decide=None), StandInAgent(PageResult("failed", None, Playtest(False, ["NO_READY"]))))
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
    """The movie job with the studio agent on and no MP4 render. Returns (creation id, folder, its events by device)."""
    use_sample_voices()

    async def music_bed(topic, grade, seconds):
        return music

    patches = {"direct": partial(movie.direct, agent=agent), "music_bed": music_bed, "RENDER_SCRIPT": Path(tempfile.mkdtemp()) / "absent.mjs"}
    with patch.object(studio_pro, "STUDIO_AGENT_TIMEOUT_S", timeout_s), patch.object(studio_pro, "directing", lambda agent=None: True):
        _, cid, folder, seen = run_job(Studio(board()), movie.start_movie, movie=patches)
    return cid, folder, seen


def check_directed_movie_is_the_cut_with_the_template_inside() -> None:
    agent = StandInAgent(ready(MOVIE))
    cid, folder, seen = run_cut(agent)
    made = creation_in(folder, cid)
    assert made.kind == "movie" and made.status == "ready" and made.html_url == f"/creations/{cid}/movie.html", made
    assert made.storyboard is not None and made.storyboard.title == board().title, "the template's storyboard stays"
    assert made.audio["check"] == "check.mp3" and made.audio["music"] == "music.mp3", "and its question and bed"
    page = (folder / cid / "movie.html").read_text()
    audio = json.loads(re.search(r'<script data-kit="KITE_AUDIO">window\.KITE_AUDIO = (\{.*?\});</script>', page).group(1))
    url = lambda data: "data:audio/mpeg;base64," + base64.b64encode(data).decode()  # noqa: E731
    assert audio.pop("music") == url(b"music"), "the template's music bed, not a second composition"
    assert set(audio) == set(made.timings) and set(audio.values()) == {url(b"mp3")}, "every narration line, inlined"
    quiet, quiet_folder, _ = run_cut(StandInAgent(ready(MOVIE)), music=None)
    assert "music" not in json.loads(re.search(r"window\.KITE_AUDIO = (\{.*?\});", (quiet_folder / quiet / "movie.html").read_text()).group(1)), (
        "no music bed still makes a movie"
    )
    [req] = agent.requests
    assert set(req) == {"kind", "creation_id", "topic", "learning_goal", "grade", "kid_view", "storyboard", "timings"}, req
    assert req["kind"] == "movie" and req["creation_id"] == cid and req["grade"] == 11
    assert req["storyboard"] == made.storyboard.model_dump(mode="json") and set(req["timings"]) == set(made.timings)
    kid = [e for e in seen["os"] if e.creation_id == cid]
    assert [e.type for e in kid].count("creation.ready") == 1 and kid[-1].type == "creation.ready" and kid[-1].status == "ready", types(kid)
    assert any(e.type == "creation.progress" and e.steps_total == studio_pro.STEPS_TOTAL for e in kid), "the screen sees the agent at work"
    assert types([e for e in seen["parent"] if e.creation_id == cid]) == types(kid) and not seen["counselor"], "a copy for the parent only"
    app = FastAPI()
    app.include_router(games.router)
    client = TestClient(app)
    with patch.object(studio_pro, "CREATIONS_DIR", folder):
        r = client.get(f"/creations/{cid}/movie.html")
        assert r.status_code == 200 and r.text == page, r.status_code
        assert r.headers["content-security-policy"] == games.CSP and games.CSP.startswith("default-src 'none'"), "no network"
        assert client.get(f"/creations/{cid}/game.html").status_code == 404, "a movie has no game page"
    kid_client, deps, bearer = client_for()
    with patch.object(studio_pro, "CREATIONS_DIR", folder):
        body = kid_client.get(f"/creations/{cid}").json()
        assert body["html_url"] == made.html_url and body["storyboard"]["check"] == made.storyboard.check.model_dump(), body
        assert kid_client.get(body["audio"]["check"]).content == b"mp3", "the spoken question beside it"
        store.save_meta(cid, store.load_meta(cid).model_copy(update={"concept_id": SKY_CONCEPT}))
        r = kid_client.post(f"/creations/{cid}/answer", json={"choice": made.storyboard.check.correct_index}, headers=bearer["os"])
        assert r.status_code == 200 and r.json()["correct"] is True and r.json()["recorded"] is True, r.text
        [row] = evidence_rows(deps)
        assert row.concept_id == SKY_CONCEPT and row.payload.source == "check_question", "the cut's answer is evidence"


def check_directed_movie_failures_play_the_template() -> None:
    for why, agent, timeout_s in (
        ("an agent error", StandInAgent(error=RuntimeError("502")), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("an agent that gave up", StandInAgent(PageResult("failed", None, Playtest(False, ["SAME_FRAMES"]))), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("a page with no audio slot", StandInAgent(ready()), studio_pro.STUDIO_AGENT_TIMEOUT_S),
        ("a timeout", StandInAgent(ready(MOVIE), delay_s=0.5), 0.05),
    ):
        cid, folder, seen = run_cut(agent, timeout_s)
        made = creation_in(folder, cid)
        assert made.status == "ready" and made.html_url is None and made.storyboard, f"{why}: the template is her movie"
        assert not (folder / cid / "movie.html").exists(), why
        for kind in ("os", "parent"):
            last = [e for e in seen[kind] if e.creation_id == cid][-1]
            assert last.type == "creation.ready" and last.status == "ready", f"{why}: {kind} hears the template is ready"
        assert not seen["counselor"], why


def check_directed_game_is_the_agents_page() -> None:
    from scripts.checks.studio import CATCH  # noqa: PLC0415
    for why, agent, html in (("a page", StandInAgent(ready()), True), ("an agent error", StandInAgent(error=RuntimeError("502")), False)):
        with patch.object(studio_pro, "directing", lambda agent=None: True):
            _, cid, folder, seen = run_job(Studio(CATCH), game.start_game, game={"build_brand_new": partial(game.build_brand_new, agent=agent)})
        made = creation_in(folder, cid)
        assert made.status == "ready" and made.game is not None, f"{why}: the template game stays as the stand-in"
        if html:
            assert made.html_url == f"/creations/{cid}/game.html" and with_sounds((folder / cid / "game.html").read_text()), why
        else:
            assert made.html_url is None and not (folder / cid / "game.html").exists(), f"{why}: the template game plays"
        assert [e.type for e in seen["os"] if e.creation_id == cid].count("creation.ready") == 1, f"{why}: one ready, at the end"


def check_kits_play_test_under_the_served_policy() -> None:
    kits = Path(__file__).resolve().parents[3] / "studio-agent"
    for kit in ("game-kit", "movie-kit"):
        assert games.CSP in (kits / kit / "playtest.mjs").read_text(), f"{kit} play-tests under the policy the brain serves"


def check_no_endpoint_no_directors_cut() -> None:
    with patch.object(studio_pro, "get_settings", lambda: SimpleNamespace(STUDIO_AGENT_ENDPOINT="")):
        assert not studio_pro.directing(), "no endpoint: the template is the movie and the game"
        assert studio_pro.directing(StandInAgent()), "a stand-in agent directs"


def run() -> None:
    check_text_strings()
    check_success_publishes_ready_and_stores_html_url()
    check_flagged_text_is_fallback()
    check_agent_failure_is_fallback()
    check_timeout_is_fallback()
    check_endpoint_is_for_kid_devices()
    check_directed_movie_is_the_cut_with_the_template_inside()
    check_directed_movie_failures_play_the_template()
    check_directed_game_is_the_agents_page()
    check_no_endpoint_no_directors_cut()
    check_kits_play_test_under_the_served_policy()


if __name__ == "__main__":
    run()
    print("ok")
