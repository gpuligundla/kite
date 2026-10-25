"""Movie and template-game claims, with stand-in clients and the stand-ins from checks/pipeline.py.
Nothing here calls Claude or ElevenLabs. Run from brain/: uv run python -m scripts.checks.studio"""

import asyncio
import inspect
import json
import tempfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import numpy as np
from fastapi.testclient import TestClient

from kite_brain import studio_pro
from kite_brain.api import create_app
from kite_brain.contract import ConceptEvidence, GameItem, GameSpec, InterestFact, KidView, Storyboard, Word
from kite_brain.deps import Deps, ToolCall
from kite_brain.memory import ledger, maps
from kite_brain.routers import creations
from kite_brain.seed import KID_ID, seed
from kite_brain.studio import game, movie, store
from kite_brain.studio.sprites import sprite_names, sprite_svg, svg_data_url
from kite_brain.studio.storyboard import write_storyboard
from kite_brain.turn.pipeline import TurnInput, _Turn, act_on_tool_call
from kite_brain.voice import CHARACTER_VOICES, allowed_voice_ids, character_spec
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG, NOW, add, evidence, fresh
from scripts.checks.memory import async_embed
from scripts.checks.pipeline import StandIns, deps_for, types
from scripts.checks.voice import use_sample_voices
from scripts.make_fallback_movie import STORYBOARD

TOPIC, GOAL = "light", "The sky looks blue because air scatters blue light."
SKY_CONCEPT = "light_sky_blue"
REQUIRED_SPRITES = {"trex", "dinosaur", "sun", "cloud", "star", "raindrop", "tree", "flower", "ruler",
                    "blue_square", "kid", "dog", "rocket", "planet", "rainbow"}
CATCH = GameSpec(
    template="catch", title="Catch the light", instructions="Catch the blue light.", concept_id="none",
    items=[GameItem(label="Blue", sprite="blue_circle", correct=True), GameItem(label="Red", sprite="red_circle", correct=False)],
)


def board(**changes) -> Storyboard:
    return STORYBOARD.model_copy(deep=True, update=changes)


class Studio(StandIns):
    """Claude and ElevenLabs stand-ins. `parse` returns the queued answers in order, then keeps
    returning the last. `speak_timed` records the voice it was asked for."""

    def __init__(self, *answers, tts_delay_s=0.0, tts_error=None, **kw):
        super().__init__(**kw)
        self.answers, self.tts_delay_s, self.tts_error = list(answers), tts_delay_s, tts_error
        self.parses, self.specs = [], []

    async def parse(self, request, model_cls, *, deep=False):
        self.parses.append((request, model_cls, deep))
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        return answer.model_copy(deep=True)

    async def speak_timed(self, text, spec):
        self.specs.append(spec)
        await asyncio.sleep(self.tts_delay_s)
        if self.tts_error:
            raise self.tts_error
        return b"mp3", [Word(text=w, start=i * 0.3, end=i * 0.3 + 0.25) for i, w in enumerate(text.split())]


def request_text(request) -> str:
    return "\n".join([request.system, request.context, *(m["content"] for m in request.messages)])


def run_job(stand, start, *, setup=None, read_only=False, **patches):
    """Start a creation and wait for its background jobs. Returns (deps, creation id, folder, events by device)."""
    deps, bus = deps_for(stand)
    if setup:
        setup(deps)
    folder = Path(tempfile.mkdtemp())

    async def go():
        creation_id = await start(deps, KID_ID, TOPIC, GOAL, 11, read_only=read_only)
        await store.settle()
        return creation_id

    # No director's cut unless a check asks for one: a configured endpoint must never be called from here.
    patches = patches | {"movie": {"start_directors_cut": lambda *a, **k: None} | patches.get("movie", {})}
    with ExitStack() as stack:
        stack.enter_context(patch.object(studio_pro, "CREATIONS_DIR", folder))
        for module in (movie, game):
            for name, value in patches.get(module.__name__.rsplit(".", 1)[1], {}).items():
                stack.enter_context(patch.object(module, name, value))
        creation_id = asyncio.run(go())
    seen = {kind: asyncio.run(drain(bus, kind)) for kind in ("os", "parent", "counselor")}
    return deps, creation_id, folder, seen


def creation_in(folder: Path, creation_id: str):
    return store.Creation.model_validate_json((folder / creation_id / "creation.json").read_text())


def check_progress_then_ready() -> None:
    stand = Studio(board())
    deps, cid, folder, seen = run_job(stand, movie.start_movie)
    lines = sum(len(s.lines) for s in STORYBOARD.scenes)
    kid = types(seen["os"])
    assert kid == ["creation.progress"] * (lines + 2) + ["creation.ready"], kid
    assert [e.step for e in seen["os"][:-1]] == list(range(lines + 2)), "step 0, the storyboard, then each line"
    assert seen["os"][-1].status == "ready" and seen["os"][0].creation_id == cid and len(cid) == 32
    assert types(seen["parent"]) == kid and not seen["counselor"], "the parent gets a copy, never the counselor"
    creation = creation_in(folder, cid)
    assert creation.status == "ready" and set(creation.audio) == set(creation.timings) and len(creation.audio) == lines
    assert all((folder / cid / name).read_bytes() == b"mp3" for name in creation.audio.values()), "narration saved beside the json"
    assert creation.storyboard.check.concept_id == "none", "no vectors, so no concept; Claude's guess is never kept"
    [(request, model_cls, deep)] = stand.parses
    assert model_cls is Storyboard and deep, "storyboards use Sonnet through parse(deep=True)"
    assert not (folder / cid / "movie.mp4").exists()


def check_video_render() -> None:
    script = Path(tempfile.mkdtemp()) / "render.mjs"
    script.write_text(
        "import {readFileSync, writeFileSync, existsSync} from 'node:fs'; import {dirname, join} from 'node:path';"
        "const c = JSON.parse(readFileSync(process.argv[2], 'utf8')); const d = dirname(process.argv[2]);"
        "const ok = Object.keys(c.sprites).length > 0 && Object.values(c.audio).every((a) => !a.startsWith('/') && existsSync(join(d, a)))"
        " && Object.keys(c.audio).every((k) => c.timings[k].length > 0);"
        "if (!ok) process.exit(2); writeFileSync(join(d, 'movie.mp4'), 'mp4');"
    )
    _, cid, folder, seen = run_job(Studio(board()), movie.start_movie, movie={"RENDER_SCRIPT": script})
    video = seen["os"][-1]
    assert video.type == "creation.video" and video.video_url == f"/creations/{cid}/files/movie.mp4", types(seen["os"])
    assert types(seen["parent"])[-1] == "creation.video" and not seen["counselor"]
    assert creation_in(folder, cid).video_url == video.video_url, "creation.json carries the video"
    script.write_text("process.exit(1);")
    _, _, _, seen = run_job(Studio(board()), movie.start_movie, movie={"RENDER_SCRIPT": script})
    assert types(seen["os"])[-1] == "creation.ready", "a failed render only means no MP4"
    _, _, _, seen = run_job(Studio(board()), movie.start_movie, movie={"RENDER_SCRIPT": script.with_name("absent.mjs")})
    assert types(seen["os"])[-1] == "creation.ready", "no render CLI is skipped with a warning"


def expect_fallback(folder, cid, seen, why):
    creation = creation_in(folder, cid)
    assert creation.status == "fallback" and creation.storyboard.title == STORYBOARD.title, why
    assert creation.storyboard.check.concept_id == SKY_CONCEPT, why
    assert all((folder / cid / name).exists() for name in creation.audio.values()), f"{why}: the fallback audio is copied"
    for audience in ("os", "parent"):
        ready = [e for e in seen[audience] if e.type == "creation.ready"]
        assert ready[-1].status == "fallback", why
        assert seen[audience][-1].type == "creation.video", f"{why}: the rendered fallback plays at once"
    assert creation.video_url == f"/creations/{cid}/files/movie.mp4" and not seen["counselor"], why


def check_deadline_falls_back() -> None:
    _, cid, folder, seen = run_job(Studio(board(), tts_delay_s=2.0), movie.start_movie, movie={"MOVIE_DEADLINE_S": 0.2})
    expect_fallback(folder, cid, seen, "a slow narrator")
    assert movie.MOVIE_DEADLINE_S == 45.0, "the real deadline is 45 s"


def check_errors_fall_back() -> None:
    cases = {
        "a tts error": Studio(board(), tts_error=RuntimeError("quota")),
        "a storyboard error": Studio(RuntimeError("502")),
        "a flagged storyboard": Studio(board(title="BAD title"), flag_output="BAD"),
        "a bad sprite twice": Studio(board().model_copy(update={"scenes": [_with_sprite("nope")]})),
    }
    for why, stand in cases.items():
        _, cid, folder, seen = run_job(stand, movie.start_movie)
        expect_fallback(folder, cid, seen, why)


def _with_sprite(sprite: str):
    scene = STORYBOARD.scenes[0].model_copy(deep=True)
    scene.actors[0].sprite = sprite
    return scene


def check_storyboard_takes_the_kid_view_only() -> None:
    params = inspect.signature(write_storyboard).parameters
    assert params["kid_view"].annotation is KidView and set(params) == {"deps", "topic", "learning_goal", "kid_view", "grade"}, params
    growing = next(c for c in CATALOG.concepts if c.topic == "area_perimeter")

    def setup(deps):
        for session in ("s1", "s2"):
            add(deps.conn, deps.keys, evidence("not_yet"), grade=5, session=session, concept=growing.id)
        add(deps.conn, deps.keys, InterestFact(topic="dinosaurs"), grade=5)
        view = maps.skills_map(ledger.events(deps.conn, deps.keys, KID_ID, 11), CATALOG, 11)
        assert growing.id in view.growing, "the setup really makes a growing area"

    stand = Studio(board())
    run_job(stand, movie.start_movie, setup=setup)
    [(request, _, _)] = stand.parses
    text = request_text(request)
    for secret in (growing.id, growing.name, growing.kid_name, growing.topic, "growing", "not_yet", "got_it"):
        assert secret.lower() not in text.lower(), f"the storyboard request leaks {secret!r}"
    assert "dinosaurs" in text, "the kid view does reach the writer"
    stand = Studio(CATCH)
    run_job(stand, game.start_game, setup=setup)
    assert growing.name.lower() not in request_text(stand.parses[0][0]).lower(), "nor does the game request"


def check_voices_are_allowlisted() -> None:
    stand = Studio(board())
    run_job(stand, movie.start_movie)
    assert stand.specs and {s.voice_id for s in stand.specs} <= allowed_voice_ids(), "narration voices"
    for name in CHARACTER_VOICES:
        assert character_spec(name).voice_id in allowed_voice_ids(), f"{name} is on the allowlist"
    voices = {line.voice for scene in STORYBOARD.scenes for line in scene.lines}
    assert voices <= set(CHARACTER_VOICES), "the fallback uses character voices only"
    bad = board()
    bad.scenes[0].lines[0].voice = "child"
    try:
        Storyboard.model_validate(bad.model_dump())
    except ValueError:
        pass
    else:
        raise AssertionError("a voice outside the character list must not validate")


def check_unknown_sprite_rejected() -> None:
    assert REQUIRED_SPRITES <= sprite_names(), REQUIRED_SPRITES - sprite_names()
    assert all("<script" not in sprite_svg(n) for n in sprite_names()), "vendored sprites hold no script"
    assert sprite_svg("rexy") == sprite_svg("trex"), "Rexy is the t-rex"
    try:
        sprite_svg("nope")
    except KeyError:
        pass
    else:
        raise AssertionError("an unknown sprite must raise KeyError")
    assert svg_data_url("<svg/>").startswith("data:image/svg+xml;base64,")
    try:
        svg_data_url("<svg>" + "x" * 4096 + "</svg>")
    except ValueError:
        pass
    else:
        raise AssertionError("an inline SVG over 4 KB must be refused")
    deps, _ = deps_for(Studio(board().model_copy(update={"scenes": [_with_sprite("nope")]}), board()))
    stand = deps.llm
    got = asyncio.run(write_storyboard(deps, TOPIC, GOAL, KidView(interests=[], characters=[], moments=[], deep_topics=[]), 5))
    assert got.scenes[0].actors[0].sprite == "sun" and len(stand.parses) == 2, "one retry fixes a bad sprite"
    assert "rejected" in stand.parses[1][0].messages[-1]["content"], "the retry says why"
    deps, _ = deps_for(Studio(board().model_copy(update={"scenes": [_with_sprite("nope")]})))
    try:
        asyncio.run(write_storyboard(deps, TOPIC, GOAL, KidView(interests=[], characters=[], moments=[], deep_topics=[]), 5))
    except KeyError:
        pass
    else:
        raise AssertionError("a storyboard that keeps an unknown sprite must raise")
    long = board()
    long.scenes[0].lines[0].text = "word " * 200
    deps, _ = deps_for(Studio(long))
    try:
        asyncio.run(write_storyboard(deps, TOPIC, GOAL, KidView(interests=[], characters=[], moments=[], deep_topics=[]), 5))
    except ValueError:
        pass
    else:
        raise AssertionError("narration over the cap must raise")


def check_game() -> None:
    stand = Studio(CATCH.model_copy(update={"items": [*CATCH.items, GameItem(label="Nope", sprite="rexy", correct=True)]}))
    _, cid, folder, seen = run_job(stand, game.start_game)
    created = creation_in(folder, cid)
    assert created.status == "ready" and created.kind == "game" and created.game.items[-1].sprite == "trex", "Rexy becomes trex"
    assert types(seen["os"]) == ["creation.progress", "creation.ready"] and types(seen["parent"]) == types(seen["os"])
    assert stand.parses[0][1] is GameSpec and stand.parses[0][2], "game specs use Sonnet through parse(deep=True)"
    for why, spec in {
        "an unknown sprite": CATCH.model_copy(update={"items": [GameItem(label="x", sprite="nope", correct=True), *CATCH.items]}),
        "nothing to let go": CATCH.model_copy(update={"items": [GameItem(label=str(i), sprite="sun", correct=True) for i in range(3)]}),
        "too many items": CATCH.model_copy(update={"items": [GameItem(label=str(i), sprite="sun", correct=bool(i % 2)) for i in range(20)]}),
    }.items():
        _, cid, folder, _ = run_job(Studio(spec), game.start_game)
        assert creation_in(folder, cid).game == game.SKY_GAME, why
    _, cid, folder, seen = run_job(Studio(RuntimeError("502")), game.start_game)
    fallback = creation_in(folder, cid)
    assert fallback.status == "fallback" and fallback.game.template == "catch" and fallback.game.concept_id == SKY_CONCEPT
    assert seen["os"][-1].status == "fallback" and seen["parent"][-1].status == "fallback"
    _, cid, folder, seen = run_job(Studio(CATCH, tts_delay_s=0), game.start_game, game={"GAME_DEADLINE_S": 0.0})
    assert creation_in(folder, cid).status == "fallback", "a game that misses its deadline falls back"
    assert game.GAME_DEADLINE_S == 20.0, "the real deadline is 20 s"
    _, cid, folder, _ = run_job(Studio(CATCH, flag_output="Catch the light"), game.start_game)
    assert creation_in(folder, cid).status == "fallback", "a flagged game falls back"


def client_for(stand=None):
    conn, keys = fresh()
    tokens = seed(conn, keys, NOW).tokens
    app = create_app(conn)
    stand = stand or Studio(board())
    app.state.deps = Deps(
        conn=conn, keys=keys, bus=app.state.bus, catalog=CATALOG, decide=stand.decide,
        llm=stand, embed=async_embed, safety=stand, stt=stand, tts=stand, clock=lambda: NOW,
    )
    return TestClient(app), app.state.deps, {kind: {"Authorization": f"Bearer {t}"} for kind, t in tokens.items()}


def make(deps, start, read_only=False):
    """A fallback creation (so it has a concept) inside `deps`, on disk in the active CREATIONS_DIR."""
    async def go():
        creation_id = await start(deps, KID_ID, TOPIC, GOAL, 11, read_only=read_only)
        await store.settle()
        return creation_id

    with patch.object(movie, "MOVIE_DEADLINE_S", 0.0), patch.object(game, "GAME_DEADLINE_S", 0.0):
        return asyncio.run(go())


def check_reads_need_no_token() -> None:
    client, deps, _ = client_for()
    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())):
        cid = make(deps, movie.start_movie)
        r = client.get(f"/creations/{cid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["id"] == cid and body["status"] == "fallback" and body["storyboard"]["title"] == STORYBOARD.title
        assert body["audio"]["0-0"] == f"/creations/{cid}/files/0-0.mp3", "the API serves audio as URLs"
        assert store.load(cid).audio["0-0"] == "0-0.mp3", "creation.json keeps file names for the renderer"
        on_disk = json.loads((store.folder(cid) / "creation.json").read_text())
        used = {a["sprite"] for s in body["storyboard"]["scenes"] for a in s["actors"]}
        assert set(body["sprites"]) == used == set(on_disk["sprites"]) and body["sprites"]["sun"].lstrip().startswith("<svg"), "sprites map for player and renderer"
        mp3 = client.get(body["audio"]["0-0"])
        assert mp3.status_code == 200 and mp3.headers["content-type"] == "audio/mpeg" and mp3.content[:1], "audio needs no token"
        for bad in ("meta.json", "creation.json", "..%2Fmeta.json", "nope.mp3", "game.html"):
            assert client.get(f"/creations/{cid}/files/{bad}").status_code == 404, f"{bad} is not served"
        assert client.get(f"/creations/{'0' * 32}").status_code == 404 and client.get("/creations/xyz").status_code == 404
        sprite = client.get("/creations/sprites/trex")
        assert sprite.status_code == 200 and sprite.headers["content-type"] == "image/svg+xml" and "<svg" in sprite.text
        assert client.get("/creations/sprites/nope").status_code == 404
        for _ in range(310):
            assert client.get(f"/creations/{cid}").status_code == 200, "reads are not rate limited"


def check_endpoints_are_for_kid_devices() -> None:
    client, deps, bearer = client_for()
    started = []

    async def fake_start(deps_, kid_id, topic, goal, grade, **kw):
        started.append((kid_id, topic, goal, grade))
        return "a" * 32

    body = {"kind": "movie", "topic": TOPIC, "learning_goal": GOAL}
    with patch.object(creations, "start_movie", fake_start), patch.object(creations, "start_game", fake_start):
        for kind in ("parent", "counselor"):
            assert client.post("/creations", json=body, headers=bearer[kind]).status_code == 403, f"{kind} cannot order one"
        assert client.post("/creations", json=body).status_code == 401
        assert client.post("/creations", json=body | {"kind": "song"}, headers=bearer["os"]).status_code == 422
        assert client.post("/creations", json=body | {"topic": " "}, headers=bearer["os"]).status_code == 422
        for kind in ("os", "handheld"):
            for what in ("movie", "game"):
                r = client.post("/creations", json=body | {"kind": what}, headers=bearer[kind])
                assert r.status_code == 200 and r.json() == {"creation_id": "a" * 32}, r.text
    assert started[0] == (KID_ID, TOPIC, GOAL, 11), "the kid's current grade, from her own token"
    cid = "b" * 32
    for url, payload in ((f"/creations/{cid}/answer", {"choice": 0}), (f"/creations/{cid}/result", {"correct": 1, "total": 2})):
        for kind in ("parent", "counselor"):
            assert client.post(url, json=payload, headers=bearer[kind]).status_code == 403, f"{kind} cannot post {url}"
        assert client.post(url, json=payload).status_code == 401


def evidence_rows(deps):
    return [e for e in ledger.events(deps.conn, deps.keys, KID_ID, 12) if isinstance(e.payload, ConceptEvidence)]


def check_answer_and_result_record_evidence() -> None:
    client, deps, bearer = client_for()
    os = bearer["os"]
    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())):
        movie_id, game_id = make(deps, movie.start_movie), make(deps, game.start_game)
        answer = f"/creations/{movie_id}/answer"
        assert client.post(answer, json={"choice": 9}, headers=os).status_code == 422, "no such choice"
        assert client.post(f"/creations/{game_id}/answer", json={"choice": 0}, headers=os).status_code == 409, "a game has no check question"
        assert not evidence_rows(deps), "nothing is recorded before a valid answer"
        r = client.post(answer, json={"choice": STORYBOARD.check.correct_index}, headers=os)
        assert r.status_code == 200 and r.json() == {"correct": True, "correct_index": 0, "recorded": True}, r.text
        [row] = evidence_rows(deps)
        assert row.concept_id == SKY_CONCEPT and row.grade == 11 and row.payload.source == "check_question" and row.payload.outcome == "got_it"
        r = client.post(answer, json={"choice": 1}, headers=os)
        assert r.json()["correct"] is False and r.json()["recorded"] is False and len(evidence_rows(deps)) == 1, "only the first answer counts"

        result = f"/creations/{game_id}/result"
        for bad in ({"correct": 6, "total": 5}, {"correct": 0, "total": 0}, {"correct": -1, "total": 5}):
            assert client.post(result, json=bad, headers=os).status_code == 422, bad
        assert client.post(f"/creations/{movie_id}/result", json={"correct": 1, "total": 2}, headers=os).status_code == 409
        r = client.post(result, json={"correct": 2, "total": 5}, headers=bearer["handheld"])
        assert r.status_code == 200 and r.json() == {"recorded": True}, r.text
        game_row = evidence_rows(deps)[-1]
        assert game_row.payload.source == "game" and game_row.payload.outcome == "not_yet" and game_row.concept_id == SKY_CONCEPT
        assert client.post(result, json={"correct": 5, "total": 5}, headers=os).json() == {"recorded": False}, "only the first result counts"
        assert len(evidence_rows(deps)) == 2

        for correct, outcome in ((5, "got_it"), (3, "partly"), (2, "not_yet")):
            client2, deps2, bearer2 = client_for()
            other = make(deps2, game.start_game)
            client2.post(f"/creations/{other}/result", json={"correct": correct, "total": 5}, headers=bearer2["os"])
            assert evidence_rows(deps2)[0].payload.outcome == outcome, f"{correct} of 5 is {outcome}"

        client3, deps3, bearer3 = client_for()
        movie3, game3 = make(deps3, movie.start_movie, read_only=True), make(deps3, game.start_game, read_only=True)
        r = client3.post(f"/creations/{movie3}/answer", json={"choice": 0}, headers=bearer3["os"])
        assert r.status_code == 200 and r.json()["correct"] is True and r.json()["recorded"] is False
        assert client3.post(f"/creations/{game3}/result", json={"correct": 5, "total": 5}, headers=bearer3["os"]).json() == {"recorded": False}
        assert not evidence_rows(deps3), "a time-travel turn's creations record nothing"

        client4, deps4, bearer4 = client_for()
        studio_game = "c" * 32
        studio_pro.save(studio_game, "game", "ready", "<html></html>")
        r = client4.post(f"/creations/{studio_game}/result", json={"correct": 5, "total": 5}, headers=bearer4["os"])
        assert r.status_code == 200 and r.json() == {"recorded": False} and not evidence_rows(deps4), "a brand-new studio game has no concept to score"


def check_concept_comes_from_the_brain() -> None:
    rows = np.eye(len(CATALOG.concepts), dtype=np.float32)
    target = next(i for i, c in enumerate(CATALOG.concepts) if c.id == "light_rainbow")
    stand = Studio(board())

    async def embed(texts):
        return rows[[target]]

    def setup(deps):
        deps.embed = embed

    with patch.object(CATALOG, "vectors", rows):
        deps, cid, folder, _ = run_job(stand, movie.start_movie, setup=setup)
        assert creation_in(folder, cid).storyboard.check.concept_id == "light_rainbow", "the brain's own match fills the concept"
        assert json.loads((folder / cid / "meta.json").read_text())["concept_id"] == "light_rainbow"
        assert "light_rainbow" not in request_text(stand.parses[0][0]), "and Claude never saw it"

        async def far(texts):
            return (rows[[target]] + rows[[target + 1]]) / np.sqrt(2)  # cosine 0.71, under MATCH_COSINE

        _, cid, folder, _ = run_job(Studio(board()), movie.start_movie, setup=lambda d: setattr(d, "embed", far))
        assert creation_in(folder, cid).storyboard.check.concept_id == "none", "a weak match names no concept"


def check_tool_call_starts_the_right_job() -> None:
    async def go(call, **inp):
        stand = Studio(board(), tts_delay_s=0)
        deps, bus = deps_for(stand)
        turn = _Turn(TurnInput(kid_id=KID_ID, device="os", mode="talk", text="x", **inp), deps, "t1")
        turn.load_kid()
        act_on_tool_call(call, "t1", turn)
        await store.settle()
        return deps, bus, stand

    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())), patch.object(movie, "start_directors_cut", lambda *a, **k: None):
        folder = studio_pro.CREATIONS_DIR
        deps, bus, stand = asyncio.run(go(ToolCall("make_movie", TOPIC, GOAL)))
        made = [creation_in(folder, p.name) for p in folder.iterdir()]
        assert [(c.kind, c.status) for c in made] == [("movie", "ready")], made
        assert stand.parses[0][1] is Storyboard
        assert json.loads((folder / made[0].id / "meta.json").read_text()) == {
            "kid_id": KID_ID, "grade": 11, "read_only": False, "concept_id": None, "scored": False}
        kid = asyncio.run(drain(bus, "os"))
        assert kid[0].type == "creation.progress" and kid[-1].type == "creation.ready" and kid[-1].kind == "movie"
        assert {e.audience for e in asyncio.run(drain(bus, "parent"))} == {"parent"}, "and the grown-up copy"

    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())):
        folder = studio_pro.CREATIONS_DIR
        deps, bus, stand = asyncio.run(go(ToolCall("make_game", TOPIC, GOAL), as_of_grade=3))
        [made] = [creation_in(folder, p.name) for p in folder.iterdir()]
        assert made.kind == "game" and stand.parses[0][1] is GameSpec and made.status == "fallback", made
        meta = json.loads((folder / made.id / "meta.json").read_text())
        assert meta["read_only"] is True and meta["grade"] == 3, "a time-travel turn's creation is read-only"
        assert asyncio.run(drain(bus, "os"))[-1].kind == "game"

    assert inspect.signature(act_on_tool_call).parameters["turn"].default is None, "the simulator's two-argument patch still works"
    act_on_tool_call(ToolCall("make_movie", TOPIC, GOAL), "t2")  # no turn, no job, no error


def check_showcase_seeds_once() -> None:
    showcase = sorted(p.name for p in store.SHOWCASE_DIR.iterdir() if p.is_dir())
    assert showcase, "the repo keeps showcase creations"
    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())) as folder:
        store.seed_showcase()
        (folder / showcase[0] / "creation.json").write_text((folder / showcase[0] / "creation.json").read_text())
        store.seed_showcase()  # a second start leaves what is there alone
        for cid in showcase:
            creation = creation_in(folder, cid)
            page = "game.html" if creation.kind == "game" else "movie.html"
            assert creation.html_url and (folder / cid / page).stat().st_size > 100_000, f"{cid} plays from its own page"
            sounds = [json.loads(m.group(3)) for m in store.MEDIA_BLOCK.finditer((folder / cid / page).read_text())]
            assert sounds and all(sounds), f"{cid}: the sounds kept beside the page are back inside it"


def run() -> None:
    use_sample_voices()
    for check in (
        check_progress_then_ready, check_video_render, check_deadline_falls_back, check_errors_fall_back,
        check_storyboard_takes_the_kid_view_only, check_voices_are_allowlisted, check_unknown_sprite_rejected,
        check_game, check_reads_need_no_token, check_endpoints_are_for_kid_devices,
        check_answer_and_result_record_evidence, check_concept_comes_from_the_brain, check_tool_call_starts_the_right_job,
        check_showcase_seeds_once,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
