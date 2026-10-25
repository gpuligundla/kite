"""Story claims, with the studio's stand-in clients. Nothing here calls Claude or ElevenLabs.
Run from brain/: uv run python -m scripts.checks.story"""

import asyncio
import json
import tempfile
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import numpy as np
from pydantic import ValidationError

from kite_brain import studio_pro
from kite_brain.contract import Storybook
from kite_brain.deps import ToolCall
from kite_brain.llm import TOOLS
from kite_brain.policy import band_for
from kite_brain.seed import KID_ID
from kite_brain.studio import store, story
from kite_brain.turn.pipeline import TurnInput, _Turn, act_on_tool_call
from kite_brain.voice import EXPRESSIVE, character_spec, voice_for
from scripts.checks.audiences import drain
from scripts.checks.ledger import CATALOG
from scripts.checks.pipeline import StandIns, deps_for, make_decisions, route_decisions, settled_turn, types
from scripts.checks.studio import Studio, client_for, evidence_rows
from scripts.checks.voice import use_sample_voices

TOPIC, GOAL = "the moon", "The moon looks different each night because we see different parts of its sunny side."
DAY = {"sky": "#8fd3f4", "ground": "#7cc576", "time_of_day": "day"}


def kite(text):
    return {"speaker": "Kite", "voice": "kite", "text": text}


def book(mode="story", purpose="learn", pages=5, guest=None, sounds=None, **changes) -> Storybook:
    """A story as Claude might write it, with both a check question and a reflection: Storybook keeps the one that fits.
    `guest` is (speaker, voice, lines); `sounds` replaces every page's cues."""
    def page(i):
        lines = [kite(f"Page {i} begins with the moon."), kite(f"Page {i} ends with a soft splash.")]
        return {
            "background": "space", "palette": DAY, "lines": lines,
            "actors": [{"sprite": "moon", "entrance": "pop", "motion": "float"}],
            "sounds": [{"prompt": "a soft water splash", "line": 1, "word": "splash", "seconds": 9}] if sounds is None else sounds,
        }

    data = {
        "title": "Luna's moon", "mode": mode, "purpose": purpose, "pages": [page(i) for i in range(pages)],
        "check": {"question": "Why does the moon change?", "choices": ["We see more or less of its sunny side", "It melts"],
                  "correct_index": 0, "concept_id": "none"},
        "reflection": {"question": "What would you do if a friend felt left out?", "choices": ["Ask them to play", "Share a snack"]},
    }
    if guest:
        speaker, voice, count = guest
        said = [line for p in data["pages"] for line in p["lines"]][:count]
        for line in said:
            line["speaker"], line["voice"] = speaker, voice
    return Storybook.model_validate(data | changes)


async def no_music(topic, grade, seconds, mood=None):
    return None


async def no_sound(prompt, seconds):
    return None


class Telling(Studio):
    """Claude answers, then calls tell_story; `answers` are the stories it writes when asked."""

    def __init__(self, call, *answers, **kw):
        super().__init__(*answers, **kw)
        self.call = call

    async def stream(self, request):
        async for word in super().stream(request):
            yield word
        yield self.call

    async def parse(self, request, model_cls, *, deep=False):
        if model_cls is Storybook:
            return await super().parse(request, model_cls, deep=deep)
        return await StandIns.parse(self, request, model_cls)  # the memory writer's


def run_story(stand, *, mode="story", purpose="learn", goal=GOAL, grade=3, music=no_music, sfx=None, setup=None, **patches):
    """Start a story, wait for it, and return (deps, creation id, folder, events by device, sound-effect prompts asked for)."""
    deps, bus = deps_for(stand)
    if setup:
        setup(deps)
    folder = Path(tempfile.mkdtemp())
    made = []

    async def sound(prompt, seconds):
        made.append((prompt, seconds))
        return b"sfx"

    async def go():
        creation_id = await story.start_story(deps, KID_ID, TOPIC, goal, grade, mode=mode, purpose=purpose)
        await store.settle()
        return creation_id

    with ExitStack() as stack:
        stack.enter_context(patch.object(studio_pro, "CREATIONS_DIR", folder))
        stack.enter_context(patch.object(story, "music_bed", music))
        stack.enter_context(patch.object(story, "sound_effect", sfx or sound))
        for name, value in patches.items():
            stack.enter_context(patch.object(story, name, value))
        creation_id = asyncio.run(go())
    seen = {kind: asyncio.run(drain(bus, kind)) for kind in ("os", "parent", "counselor")}
    return deps, creation_id, folder, seen, made


def creation_in(folder, creation_id):
    return store.Creation.model_validate_json((folder / creation_id / "creation.json").read_text())


def check_storybook_model() -> None:
    assert book().check and not book().reflection, "a learn story told by day ends on its check question"
    assert book(purpose="feelings").reflection and not book(purpose="feelings").check, "a feelings story ends on a reflection"
    for mode, purpose in (("bedtime", "learn"), ("bedtime", "feelings"), ("bedtime", "fun"), ("story", "fun")):
        told = book(mode=mode, purpose=purpose)
        assert told.check is None and told.reflection is None, f"a {mode} {purpose} story asks nothing"
    for why, bad in (
        ("4 pages", {"pages": 4}),
        ("9 pages", {"pages": 9}),
        ("3 sounds on a page", {"sounds": [{"prompt": "a", "line": 0, "word": "a", "seconds": 1}] * 3}),
    ):
        try:
            book(**bad)
        except ValidationError:
            continue
        raise AssertionError(f"{why} must not validate")
    page = book().pages[0].model_dump()
    for why, change in (("no actor", {"actors": []}), ("three lines", {"lines": [kite("a")] * 3}), ("no line", {"lines": []})):
        try:
            Storybook.model_validate(book().model_dump() | {"pages": [page | change] * 5})
        except ValidationError:
            continue
        raise AssertionError(f"a page with {why} must not validate")


def check_ready_story() -> None:
    stand = Studio(book())
    _, cid, folder, seen, made = run_story(stand)
    lines = 5 * 2
    kid = types(seen["os"])
    assert kid == ["creation.progress"] * (lines + 2) + ["creation.ready"], kid
    assert {e.kind for e in seen["os"]} == {"story"} and seen["os"][-1].status == "ready" and len(cid) == 32
    assert types(seen["parent"]) == kid and not seen["counselor"], "the parent gets a copy, never the counselor"
    creation = creation_in(folder, cid)
    assert creation.kind == "story" and creation.status == "ready" and creation.storybook.title == "Luna's moon"
    assert set(creation.timings) == {f"{p}-{n}" for p in range(5) for n in range(2)}, "timings for every line"
    sfx = {key for key in creation.audio if key.startswith("sfx-")}
    assert sfx == {f"sfx-{p}-0" for p in range(5)} and "check" in creation.audio and "reflection" not in creation.audio
    assert len(made) == 1 and made[0] == ("a soft water splash", 3.0), f"one prompt, one sound, kept to 3 s: {made}"
    assert {creation.audio[key] for key in sfx} == {"sfx-0-0.mp3"}, "every cue of one prompt plays the same file"
    assert all((folder / cid / name).exists() for name in creation.audio.values()), "audio saved beside the json"
    [(request, model_cls, deep)] = stand.parses
    assert model_cls is Storybook and deep, "stories use Sonnet through parse(deep=True)"
    assert story.ENDINGS["check"].format(no_concept="none") in request.system and story.BEDTIME not in request.system
    on_disk = json.loads((folder / cid / "creation.json").read_text())
    assert set(on_disk["sprites"]) == {"moon"} and on_disk["sprites"]["moon"].lstrip().startswith("<svg"), "sprites for the player"


def check_voice_rule() -> None:
    stand = Studio(book(guest=("Luna", "explorer", 4)))
    _, cid, folder, _, _ = run_story(stand, grade=3)
    kite = voice_for(band_for(3), "story")
    guest = character_spec("explorer")
    spoken = stand.spoken
    assert all(spec.model_id == EXPRESSIVE for spec in spoken.values()), "every line on eleven_v3"
    voiced = {text: spec.voice_id for text, spec in spoken.items()}
    lines = [line for page in creation_in(folder, cid).storybook.pages for line in page.lines]
    assert [voiced[line.text] for line in lines] == [guest.voice_id] * 4 + [kite.voice_id] * 6, "Kite narrates, one guest speaks"
    assert spoken[story.check_text(book().check)].voice_id == kite.voice_id, "Kite asks the question"

    for why, cast in (("two guests", None), ("five guest lines", ("Luna", "explorer", 5))):
        board = book(guest=cast) if cast else book(guest=("Luna", "explorer", 2))
        if cast is None:
            board.pages[3].lines[0].speaker, board.pages[3].lines[0].voice = "Rex", "professor"
        stand = Studio(board)
        _, cid, folder, _, _ = run_story(stand)
        assert len(stand.parses) == 2 and creation_in(folder, cid).status == "fallback", f"{why}: retried, then the fallback"
        assert "rejected" in stand.parses[1][0].messages[-1]["content"], f"{why}: the retry says why"

    stand = Studio(book(guest=("Luna", "explorer", 2)))
    run_story(stand, mode="bedtime", purpose="fun", goal="")
    for spec in stand.spoken.values():
        assert spec.settings["speed"] == 0.85 and spec.settings["stability"] == 1.0 and spec.settings["style"] == 0.0, spec
    assert {spec.voice_id for spec in stand.spoken.values()} == {kite.voice_id, guest.voice_id}, "bedtime keeps the same voices"
    day = Studio(book())
    run_story(day)
    assert all(spec.settings["stability"] == 0.5 for spec in day.spoken.values()), "by day the voice is the band's"


def check_sounds_and_music_are_optional() -> None:
    async def broken(prompt, seconds):
        raise RuntimeError("quota")

    async def silent(prompt, seconds):
        return None

    async def failed_music(*a, **k):
        raise RuntimeError("502")

    for why, kw in (("sounds raise", {"sfx": broken, "music": failed_music}), ("sounds come back empty", {"sfx": silent})):
        _, cid, folder, seen, _ = run_story(Studio(book()), **kw)
        creation = creation_in(folder, cid)
        assert creation.status == "ready" and seen["os"][-1].status == "ready", why
        assert not any(k.startswith("sfx-") for k in creation.audio) and "music" not in creation.audio, why

    asked = []

    async def music(topic, grade, seconds, mood=None):
        asked.append(mood)
        return b"music"

    _, cid, folder, _, _ = run_story(Studio(book()), music=music)
    assert creation_in(folder, cid).audio["music"] == "music.mp3" and (folder / cid / "music.mp3").read_bytes() == b"music"
    run_story(Studio(book()), music=music, mode="bedtime", purpose="feelings", goal="")
    assert asked == [story.MOODS["learn"], story.MOODS["bedtime"]], "a bedtime story gets the lullaby"

    calls = []

    async def counted(prompt, seconds):
        calls.append(prompt)
        return b"sfx"

    with patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())), patch.object(story, "sound_effect", counted):
        assert asyncio.run(story.cached_sound("An owl hooting", 2)) == b"sfx"
        assert asyncio.run(story.cached_sound("  an OWL   hooting ", 2)) == b"sfx"
        assert calls == ["An owl hooting"], "a repeated prompt comes from the cache"


def check_deadline_falls_back() -> None:
    for mode in ("story", "bedtime"):
        _, cid, folder, seen, _ = run_story(Studio(book(), tts_delay_s=2.0), mode=mode, STORY_DEADLINE_S=0.2)
        creation = creation_in(folder, cid)
        assert creation.status == "fallback" and creation.storybook.title == "Pip wants to fly", creation.status
        assert creation.storybook.mode == mode and creation.storybook.check is None, "the fallback is told as asked, with no quiz"
        assert all((folder / cid / name).exists() for name in creation.audio.values()), "its audio is copied"
        assert not (folder / cid / "0-0.mp3").exists() or "0-0" in creation.audio, "nothing left from the failed attempt"
        assert json.loads((folder / cid / "meta.json").read_text())["concept_id"] is None, "and it records nothing"
        for audience in ("os", "parent"):
            assert seen[audience][-1].type == "creation.ready" and seen[audience][-1].status == "fallback"
    assert story.STORY_DEADLINE_S == 45.0, "the real deadline is 45 s"
    for why, stand in (
        ("a Claude error", Studio(RuntimeError("502"))),
        ("a flagged story", Studio(book(title="BAD title"), flag_output="BAD")),
        ("a learn story with no question twice", Studio(book(check=None))),
        ("a narration error", Studio(book(), tts_error=RuntimeError("quota"))),
    ):
        _, cid, folder, _, _ = run_story(stand)
        assert creation_in(folder, cid).status == "fallback", why


def check_bedtime_and_purposes() -> None:
    rows = np.eye(len(CATALOG.concepts), dtype=np.float32)
    target = next(i for i, c in enumerate(CATALOG.concepts) if c.id == "light_rainbow")

    async def embed(texts):
        return rows[[target]]

    client, deps, bearer = client_for()
    deps.embed = embed
    folder = Path(tempfile.mkdtemp())

    async def make(mode, purpose):
        deps.llm = deps.tts = Studio(book(purpose=purpose))  # written with its day question; bedtime must drop it
        creation_id = await story.start_story(deps, KID_ID, TOPIC, GOAL if purpose == "learn" else "", 3, mode=mode, purpose=purpose)
        await store.settle()
        return creation_id

    told = {}
    with (patch.object(studio_pro, "CREATIONS_DIR", folder), patch.object(CATALOG, "vectors", rows),
          patch.object(story, "music_bed", no_music), patch.object(story, "sound_effect", no_sound)):
        for mode in ("story", "bedtime"):
            for purpose in ("learn", "fun", "feelings"):
                told[mode, purpose] = asyncio.run(make(mode, purpose))
        for (mode, purpose), cid in told.items():
            creation, meta = creation_in(folder, cid), json.loads((folder / cid / "meta.json").read_text())
            asks = {"check", "reflection"} & set(creation.audio)
            r = client.post(f"/creations/{cid}/answer", json={"choice": 0}, headers=bearer["os"])
            if (mode, purpose) == ("story", "learn"):
                assert creation.storybook.check.concept_id == "light_rainbow" and meta["concept_id"] == "light_rainbow"
                assert asks == {"check"} and r.status_code == 200 and r.json()["recorded"] is True, r.text
            else:
                assert r.status_code == 409 and creation.storybook.check is None, f"{mode} {purpose}: no quiz"
            if purpose != "learn":
                assert meta["concept_id"] is None, f"a {purpose} story teaches no concept"
            if (mode, purpose) == ("story", "feelings"):
                assert asks == {"reflection"} and creation.storybook.reflection, "a feelings story ends on a reflection"
            elif (mode, purpose) != ("story", "learn"):
                assert not asks and creation.storybook.reflection is None, f"{mode} {purpose}: no question at all"
            assert creation.storybook.mode == mode and creation.storybook.purpose == purpose
        [row] = evidence_rows(deps)
        assert row.payload.source == "check_question" and row.concept_id == "light_rainbow", "evidence only from a learn story"
    request = Studio(book())
    run_story(request, mode="bedtime", purpose="fun", goal="")
    system = request.parses[0][0].system
    assert story.BEDTIME in system and story.ENDINGS["none"] in system and story.PURPOSES["fun"] in system


def check_tool_is_offered_and_acted_on() -> None:
    [tool] = [t for t in TOOLS if t["name"] == "tell_story"]
    schema = tool["input_schema"]
    assert schema["required"] == ["topic", "purpose", "bedtime", "learning_goal"] and tool["strict"]
    assert schema["properties"]["purpose"]["enum"] == ["learn", "fun", "feelings"]
    for words in ("tell me a story about X", "tell me a bedtime story about X", "only when the child's latest message asks"):
        assert words in tool["description"], words

    async def act(call, concept, **inp):
        stand = Studio(book())
        deps, bus = deps_for(stand)
        turn = _Turn(TurnInput(kid_id=KID_ID, device="os", mode="talk", text="x", **inp), deps, "t1")
        turn.load_kid()
        turn.concept_id = concept  # what the turn's own decision found it was about
        assert act_on_tool_call(call, "t1", turn) is None, "a story speaks no extra line"
        await store.settle()
        return stand, bus

    def made_in(folder):
        [made] = [creation_in(folder, p.name) for p in folder.iterdir() if p.name != "sfx-cache"]
        return made, json.loads((folder / made.id / "meta.json").read_text())

    with (patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())) as folder,
          patch.object(story, "music_bed", no_music), patch.object(story, "sound_effect", no_sound)):
        call = ToolCall("tell_story", "the stars", "", purpose="feelings", bedtime=True)
        stand, bus = asyncio.run(act(call, "light_rainbow", as_of_grade=1))
        made, meta = made_in(folder)
        assert made.kind == "story" and made.storybook.mode == "bedtime" and made.storybook.purpose == "feelings"
        assert story.BEDTIME in stand.parses[0][0].system and "grade 1" in stand.parses[0][0].context
        assert meta["read_only"] is True and meta["grade"] == 1, "a time-travel turn's story is read-only"
        assert meta["concept_id"] is None, "a feelings story teaches no concept, whatever the turn was about"
        assert asyncio.run(drain(bus, "os"))[-1].kind == "story"

    with (patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())) as folder,
          patch.object(story, "music_bed", no_music), patch.object(story, "sound_effect", no_sound)):
        asyncio.run(act(ToolCall("tell_story", "rainbows", "Light bends into colors.", purpose="learn"), "light_rainbow"))
        made, meta = made_in(folder)
        assert meta["concept_id"] == "light_rainbow" and made.storybook.check.concept_id == "light_rainbow", \
            "a learn story asked for by voice teaches the turn's concept"

    # By voice: the tool runs only inside Claude's answer, which route() allows. A family that sends a topic to
    # the grown-ups gets no story, while the default policy lets the same ask through.
    for action, expect_story in (("ask_parent", False), ("answer", True)):
        decide = route_decisions(topic="divorce")
        decide.answers["initiative"] = make_decisions().answers["initiative"]
        stand = Telling(ToolCall("tell_story", "a family that lives in two houses", "", purpose="feelings"), book(),
                        decide=decide, heard="tell me a story about my parents' divorce")
        deps, bus = deps_for(stand)
        deps.conn.execute("UPDATE policy SET action = ? WHERE topic = 'divorce'", (action,))
        with (patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())) as folder,
              patch.object(story, "music_bed", no_music), patch.object(story, "sound_effect", no_sound)):
            seen = settled_turn(deps, bus, f"div-{action}")
            stories = [p for p in folder.iterdir() if p.name != "sfx-cache"]
        routed = [e for e in seen["parent"] if e.type == "routed"][0].route
        [done] = [e for e in seen["os"] if e.type == "answer.done"]
        assert done.route == routed, f"the turn finished on its own route, not {done.route}"
        if expect_story:
            assert stand.llm_calls == 1 and stand.requests[0].tools and len(stories) == 1, "the family allows it"
        else:
            assert routed == "ask_parent" and stand.llm_calls == 0 and not stories, "route() runs before any tool"


def check_endpoint() -> None:
    client, deps, bearer = client_for()
    started = []

    async def fake_start(deps_, kid_id, topic, goal, grade, **kw):
        started.append((topic, goal, grade, kw))
        return "a" * 32

    learn = {"kind": "story", "topic": TOPIC, "learning_goal": GOAL}
    with patch("kite_brain.routers.creations.start_story", fake_start):
        for kind in ("parent", "counselor"):
            assert client.post("/creations", json=learn, headers=bearer[kind]).status_code == 403, f"{kind} cannot order one"
        assert client.post("/creations", json=learn).status_code == 401
        for bad in ({"mode": "nap"}, {"purpose": "scary"}, {"learning_goal": ""}, {"topic": " "}):
            assert client.post("/creations", json=learn | bad, headers=bearer["os"]).status_code == 422, bad
        for kind in ("os", "handheld"):
            r = client.post("/creations", json=learn, headers=bearer[kind])
            assert r.status_code == 200 and r.json() == {"creation_id": "a" * 32}, r.text
        fun = {"kind": "story", "topic": "a dragon who sneezes", "mode": "bedtime", "purpose": "fun"}
        assert client.post("/creations", json=fun, headers=bearer["os"]).status_code == 200, "fun needs no learning goal"
        movie = {"kind": "movie", "topic": TOPIC}
        assert client.post("/creations", json=movie, headers=bearer["os"]).status_code == 422, "a movie still needs one"
    assert started[0] == (TOPIC, GOAL, 11, {"mode": "story", "purpose": "learn"}), started[0]
    assert started[-1] == ("a dragon who sneezes", "", 11, {"mode": "bedtime", "purpose": "fun"}), started[-1]

    with (patch.object(studio_pro, "CREATIONS_DIR", Path(tempfile.mkdtemp())),
          patch.object(story, "music_bed", no_music), patch.object(story, "sound_effect", no_sound)):
        deps.llm = deps.tts = Studio(book())

        async def go():
            cid = await story.start_story(deps, KID_ID, TOPIC, GOAL, 11)
            await store.settle()
            return cid

        cid = asyncio.run(go())
        body = client.get(f"/creations/{cid}").json()
        assert body["kind"] == "story" and body["storybook"]["pages"][0]["actors"][0]["sprite"] == "moon"
        assert body["audio"]["0-0"] == f"/creations/{cid}/files/0-0.mp3" and set(body["sprites"]) == {"moon"}
        assert client.get(body["audio"]["0-0"]).status_code == 200, "story audio needs no token"
        assert client.post(f"/creations/{cid}/answer", json={"choice": 0}).status_code == 401
        assert client.post(f"/creations/{cid}/answer", json={"choice": 0}, headers=bearer["parent"]).status_code == 403
        assert client.post(f"/creations/{cid}/result", json={"correct": 1, "total": 1}, headers=bearer["os"]).status_code == 409


def run() -> None:
    use_sample_voices()
    for check in (
        check_storybook_model, check_ready_story, check_voice_rule, check_sounds_and_music_are_optional,
        check_deadline_falls_back, check_bedtime_and_purposes, check_tool_is_offered_and_acted_on, check_endpoint,
    ):
        check()
        print("ok", check.__name__)


if __name__ == "__main__":
    run()
