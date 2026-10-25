"""Movies (spec section 9): a storyboard, one narrated line at a time, playable at about 20 s, then
an MP4 rendered in the background. A movie that misses its 45 s deadline or fails along the way
is replaced by the cached fallback, so the kid always gets a movie. Kite narrates in the kid's band
voice and asks the check question aloud; a music bed composed alongside goes under it when it is
back in time.

On disk, `audio` holds file names beside creation.json ("0-0.mp3", keyed scene-line, plus
"check.mp3" and "music.mp3" under "check" and "music" when they came back). The API
turns them into URLs, and packages/movie's render.mjs reads them from creation.json's folder."""

import asyncio
import logging
import shutil
from pathlib import Path

from kite_brain import studio_pro
from kite_brain.config import get_settings
from kite_brain.contract import (
    CheckQuestion, Creation, CreationProgressEvent, CreationReadyEvent, CreationVideoEvent, Grade, KidView, Word,
)
from kite_brain.deps import Deps
from kite_brain.memory.recall import recall
from kite_brain.policy import band_for
from kite_brain.studio import store
from kite_brain.studio.music import music_bed
from kite_brain.studio.storyboard import NO_CONCEPT, narration_lines, readable_text, write_storyboard
from kite_brain.voice import VoiceSpec, character_spec, voice_for

log = logging.getLogger(__name__)

MOVIE_DEADLINE_S = 45.0
RENDER_TIMEOUT_S = 300.0
NARRATION_PARALLEL = 3
MUSIC_PAD_S = 8.0  # the director's cut adds a title beat, scene gaps and an outro around the narration
TEMPLATE_MUSIC_S = 60.0  # longer than a template movie, composed in about 8 s; the player loops it anyway
VIDEO_NAME = "movie.mp4"
FALLBACK_DIR = Path(__file__).with_name("fallback")
RENDER_SCRIPT = Path(__file__).resolve().parents[3] / "packages" / "movie" / "render.mjs"


def video_url(creation_id: str) -> str:
    return f"/creations/{creation_id}/files/{VIDEO_NAME}"


def _progress(deps: Deps, kid_id: str, creation_id: str, step: int, total: int) -> None:
    store.publish(deps, kid_id, CreationProgressEvent, "movie", creation_id=creation_id, step=step, steps_total=total)


async def start_movie(
    deps: Deps, kid_id: str, topic: str, learning_goal: str, grade: Grade, *, read_only: bool = False
) -> str:
    """A pending creation under an unguessable id, announced as step 0 of 1. build_movie runs in the background."""
    creation_id = store.new_id()
    store.save(Creation(id=creation_id, kind="movie", status="pending"))
    store.save_meta(creation_id, store.Meta(kid_id=kid_id, grade=grade, read_only=read_only))
    _progress(deps, kid_id, creation_id, 0, 1)
    store.spawn(build_movie(deps, kid_id, creation_id, topic, learning_goal, grade))
    return creation_id


async def _kid_view(deps: Deps, kid_id: str, grade: Grade) -> KidView:
    try:
        return (await recall(deps, kid_id, grade, None, None, 0.0)).kid_view
    except Exception as e:  # a movie without personalization beats the fallback
        log.warning("movie kid view failed (%s)", type(e).__name__)
        return KidView(interests=[], characters=[], moments=[], deep_topics=[])


def check_text(check: CheckQuestion) -> str:
    """The check question as Kite asks it: the question, then each choice by its letter."""
    return " ".join([check.question, *(f"{chr(65 + i)}: {choice.rstrip('.')}." for i, choice in enumerate(check.choices))])


async def _narrate(
    deps: Deps, kid_id: str, creation_id: str, lines: list[tuple[str, str, VoiceSpec]], check: tuple[str, VoiceSpec]
) -> tuple[dict, dict]:
    """Every line spoken in its voice, then the check question, three at a time. Progress counts
    finished lines; step 1 was the storyboard. A failed line cancels the rest; a failed question
    only leaves the movie without it."""
    audio: dict[str, str] = {}
    timings: dict[str, list[Word]] = {}
    gate = asyncio.Semaphore(NARRATION_PARALLEL)
    total = len(lines) + 1

    async def one(key: str, text: str, voice: VoiceSpec) -> None:
        async with gate:
            mp3, words = await deps.tts.speak_timed(text, voice)
        (store.folder(creation_id) / f"{key}.mp3").write_bytes(mp3)
        audio[key], timings[key] = f"{key}.mp3", words
        _progress(deps, kid_id, creation_id, 1 + len(timings), total)

    async def ask(text: str, voice: VoiceSpec) -> None:
        try:
            async with gate:
                mp3, _ = await deps.tts.speak_timed(text, voice)
        except Exception as e:
            log.warning("movie %s: check question unspoken (%s)", creation_id, type(e).__name__)
            return
        (store.folder(creation_id) / "check.mp3").write_bytes(mp3)
        audio["check"] = "check.mp3"

    store.folder(creation_id).mkdir(parents=True, exist_ok=True)
    async with asyncio.TaskGroup() as group:
        for key, text, voice in lines:
            group.create_task(one(key, text, voice))
        group.create_task(ask(*check))
    return audio, timings


async def _make(deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, grade: Grade) -> Creation:
    music = asyncio.create_task(music_bed(topic, grade, TEMPLATE_MUSIC_S))  # composes while Claude writes
    try:
        kid_view = await _kid_view(deps, kid_id, grade)
        concept = await store.resolve_concept(deps, topic, learning_goal)
        storyboard = await write_storyboard(deps, topic, learning_goal, kid_view, grade)
        if not await store.strings_are_safe(deps, readable_text(storyboard)):
            raise ValueError("the storyboard was flagged")
        storyboard.check.concept_id = concept or NO_CONCEPT
        kite = voice_for(band_for(grade), "story")
        voices = [kite if line.voice == "kite" else character_spec(line.voice) for scene in storyboard.scenes for line in scene.lines]
        lines = [(key, text, voice) for (key, text), voice in zip(narration_lines(storyboard), voices, strict=True)]
        _progress(deps, kid_id, creation_id, 1, len(lines) + 1)
        audio, timings = await _narrate(deps, kid_id, creation_id, lines, (check_text(storyboard.check), kite))
        # Never waits: a bed that is not back yet, or failed, means a movie without music.
        if music.done() and not music.exception() and (bed := music.result()):
            (store.folder(creation_id) / "music.mp3").write_bytes(bed)
            audio["music"] = "music.mp3"
    finally:
        music.cancel()
    meta = store.load_meta(creation_id)
    store.save_meta(creation_id, meta.model_copy(update={"concept_id": concept}))
    creation = Creation(id=creation_id, kind="movie", status="ready", storyboard=storyboard, audio=audio, timings=timings)
    store.save(creation)
    return creation


def use_fallback(creation_id: str) -> Creation:
    """The cached sky movie under this creation's id, with its MP4 when one has been rendered."""
    target = store.folder(creation_id)
    target.mkdir(parents=True, exist_ok=True)
    for partial in target.glob("*.mp3"):  # narration the failed attempt had already saved
        partial.unlink()
    for source in FALLBACK_DIR.iterdir():
        if source.suffix in (".mp3", ".mp4"):
            shutil.copy(source, target / source.name)
    cached = Creation.model_validate_json((FALLBACK_DIR / "creation.json").read_text())
    has_video = (target / VIDEO_NAME).exists()
    creation = cached.model_copy(update={"id": creation_id, "video_url": video_url(creation_id) if has_video else None})
    store.save(creation)
    meta = store.load_meta(creation_id)
    store.save_meta(creation_id, meta.model_copy(update={"concept_id": creation.storyboard.check.concept_id}))
    return creation


async def build_movie(deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, grade: Grade) -> Creation:
    """Never raises. The movie is ready when its narration is, else the fallback plays."""
    try:
        creation = await asyncio.wait_for(
            _make(deps, kid_id, creation_id, topic, learning_goal, grade), MOVIE_DEADLINE_S
        )
    except Exception as e:  # includes the deadline's TimeoutError
        log.warning("movie %s falls back: %s", creation_id, type(e).__name__)
        creation = use_fallback(creation_id)
    store.publish(deps, kid_id, CreationReadyEvent, "movie", creation_id=creation_id, status=creation.status)
    if creation.status == "ready":
        store.spawn(render_video(deps, kid_id, creation_id))
        start_directors_cut(deps, kid_id, creation, topic, learning_goal, grade)
    elif creation.video_url:
        store.publish(deps, kid_id, CreationVideoEvent, "movie", creation_id=creation_id, video_url=creation.video_url)
    return creation


async def render_video(deps: Deps, kid_id: str, creation_id: str) -> None:
    """packages/movie's CLI turns creation.json into movie.mp4 beside it. A missing CLI, a failed
    or slow render only means there is no MP4: the live movie already plays."""
    if not RENDER_SCRIPT.exists():
        log.warning("movie %s: %s is missing, no MP4", creation_id, RENDER_SCRIPT)
        return
    folder = store.folder(creation_id).resolve()
    try:
        process = await asyncio.create_subprocess_exec(
            "node", str(RENDER_SCRIPT), str(folder / "creation.json"),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            code = await asyncio.wait_for(process.wait(), RENDER_TIMEOUT_S)
        except BaseException:
            process.kill()
            raise
        if code != 0 or not (folder / VIDEO_NAME).exists():
            raise RuntimeError(f"render exited {code}")
    except Exception as e:
        log.warning("movie %s: render failed (%s)", creation_id, type(e).__name__)
        return
    url = video_url(creation_id)
    store.save(store.load(creation_id).model_copy(update={"video_url": url}))
    store.publish(deps, kid_id, CreationVideoEvent, "movie", creation_id=creation_id, video_url=url)


def start_directors_cut(
    deps: Deps, kid_id: str, movie: Creation, topic: str, learning_goal: str, grade: Grade, *, agent: studio_pro.StudioAgent | None = None
) -> str | None:
    """A second movie creation: the studio agent hand-animates this movie's narration as one page,
    and the brain adds the narration's MP3s and a music bed composed while the agent works. A
    ready cut carries the template's storyboard, spoken check question and evidence trail, so its
    question card scores like the template's. The template stays her movie unless the cut is
    ready. None when no studio agent is configured."""
    if agent is None and not get_settings().STUDIO_AGENT_ENDPOINT:
        return None
    creation_id = studio_pro.start_page(deps, kid_id, "movie")
    store.save_meta(creation_id, store.load_meta(movie.id))
    narration = {key: store.folder(movie.id) / movie.audio[key] for key in movie.timings}
    question = {"check": "check.mp3"} if "check" in movie.audio else {}
    seconds = sum(max((w.end for w in words), default=0) for words in movie.timings.values()) + MUSIC_PAD_S
    music = asyncio.create_task(music_bed(topic, grade, seconds))

    def finish(html: str) -> str:
        """The narration, and the music if it came in time. A movie without music still plays."""
        files = dict(narration)
        if music.done() and (bed := music.result()):
            (path := store.folder(creation_id) / "music.mp3").write_bytes(bed)
            files["music"] = path
        music.cancel()
        if question:
            shutil.copy(store.folder(movie.id) / movie.audio["check"], store.folder(creation_id) / "check.mp3")
        return studio_pro.inject(html, "KITE_AUDIO", files)

    store.spawn(studio_pro.build_page(
        deps, kid_id, creation_id, "movie", _directors_cut_request(deps, kid_id, creation_id, movie, topic, learning_goal, grade),
        finish, agent=agent, ready_fields={"storyboard": movie.storyboard, "audio": question},
    ))
    return creation_id


async def _directors_cut_request(
    deps: Deps, kid_id: str, creation_id: str, movie: Creation, topic: str, learning_goal: str, grade: Grade
) -> dict:
    """What a game request carries, plus the storyboard and its word timings. Never levels."""
    return {
        "kind": "movie", "creation_id": creation_id, "topic": topic, "learning_goal": learning_goal, "grade": grade,
        "kid_view": (await _kid_view(deps, kid_id, grade)).model_dump(),
        "storyboard": movie.storyboard.model_dump(mode="json"),
        "timings": {key: [w.model_dump() for w in words] for key, words in movie.timings.items()},
    }
