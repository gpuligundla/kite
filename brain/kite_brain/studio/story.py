"""Stories: a picture book Claude writes around a topic, which Kite reads aloud page by page with
sound effects on cue and a music bed underneath.

A learn story teaches its goal inside the plot and ends on a check question that records evidence.
A fun story is only for fun. A feelings story models a kind choice and may end on a reflection that
is never graded. Bedtime is any of them told slower and softer, ending on goodnight with no question.

A story that misses its 45 s deadline or fails along the way is replaced by the cached fallback
story, which is a fun one, so it asks nothing and records nothing. Sound effects and music are
optional: missing ones never fail a story.

On disk, `audio` holds file names beside creation.json: "{page}-{line}.mp3" for narration (with
word timings under the same keys), "sfx-{page}-{n}.mp3" for sound effects, and "check.mp3",
"reflection.mp3" and "music.mp3" when they came back."""

import asyncio
import hashlib
import logging
import shutil
import time
from collections.abc import Awaitable, Callable
from pathlib import Path

from elevenlabs import AsyncElevenLabs

from kite_brain import studio_pro
from kite_brain.config import get_settings
from kite_brain.contract import (
    Creation, CreationProgressEvent, CreationReadyEvent, Grade, KidView, Reflection, SoundCue, StoryMode, StoryPurpose,
    Storybook, Word,
)
from kite_brain.deps import Deps, LlmRequest
from kite_brain.policy import _kid_view_lines, band_for
from kite_brain.studio import store
from kite_brain.studio.movie import _kid_view, check_text
from kite_brain.studio.music import music_bed
from kite_brain.studio.sprites import canonical, sprite_names
from kite_brain.studio.storyboard import NO_CONCEPT
from kite_brain.voice import CHARACTER_VOICES, VoiceSpec, character_spec, voice_for

log = logging.getLogger(__name__)

STORY_DEADLINE_S = 45.0
AUDIO_PARALLEL = 3  # narration, the closing question and sound effects share it, in that order
ATTEMPTS = 2
WORD_CAP = 200  # the prompt asks for 120-170
GUEST_LINES = 4  # Kite narrates; one character in the story may say this many lines
MUSIC_S = 90.0  # about a story's length; the player loops it anyway
SFX_SECONDS = (1.0, 3.0)
SFX_INFLUENCE = 0.7  # close to the prompt, so a splash is a splash
FALLBACK_DIR = Path(__file__).with_name("fallback_story")
# Bedtime over the band's story voice: slower, steadier (v3 takes stability 0, 0.5 or 1 only) and no style.
BEDTIME_VOICE = {"speed": 0.85, "stability": 1.0, "style": 0.0}
MOODS = {
    "bedtime": "A slow, hushed lullaby with music box, celesta and warm pads, like drifting off to sleep.",
    "learn": "Bright and curious, with marimba and light pizzicato strings.",
    "fun": "Playful and whimsical, with bouncy pizzicato, woodwinds and glockenspiel.",
    "feelings": "Warm and tender, with soft piano and gentle strings.",
}

PURPOSES = {
    "learn": "Purpose: teach one idea inside the plot. The hero discovers it by trying, noticing or asking, and the "
    "idea is what solves the story's problem, never a lecture added on. Every fact is accurate.",
    "fun": "Purpose: pure fun. Silly, adventurous and imaginative, with the child's favorite character as the hero "
    "when they have one. Nothing to teach.",
    "feelings": "Purpose: a story about feelings and getting along (friendship, sharing, kindness, being brave, big "
    "feelings, being left out, saying sorry). The hero has a real feeling, makes a kind choice, and we see it help. "
    "Show it warmly and never preach: no moral stated at the end.",
}
BEDTIME = (
    "This is a bedtime story: slow, cozy and quiet. Only calm events and soft sounds (crickets, a gentle breeze, a "
    "sleepy yawn; no bangs or crashes), and it "
    "winds down to the hero falling asleep. Use [softly] or [whispers] often."
)
ENDINGS = {
    "check": '- End with one check question about the idea, with 2 to 4 choices and exactly one correct, in words the '
    'child knows. Set check.concept_id to "{no_concept}". Leave reflection empty.',
    "reflection": "- End with a reflection: one gentle question asking what the child would do or feel (\"What would "
    "you do if...?\"), with 2 or 3 kind answers, none of them wrong. Leave check empty.",
    "none": "- No question at the end: leave check and reflection empty.",
}

SYSTEM = """You write a picture-book story that Kite, the child's companion, reads aloud to them.
Reading level: grade {fk_max:g} or lower. Keep every sentence under {max_words} words.
Style for this age: {style}

{purpose}
{bedtime}

Rules:
- Set mode to "{mode}" and purpose to "{purpose_name}".
- A real story: a beginning that meets the hero, a problem or a wish in the middle, and an ending that resolves it, in 5 to 8 pages.
- Every page has 1 or 2 narration lines of one to three sentences. The whole story is 120 to 170 words, never more than {word_cap}.
- Each page's background is one of: sky, space, ocean, forest, town, classroom. Pick fitting palette colors and time of day.
- Each page shows 1 or 2 actors, using only these sprite names: {sprites}. Rexy is the sprite trex. A character the child already loves may star. Keep the same hero throughout.
- Kite narrates: every line has speaker "Kite" and voice "kite". Kite is heard, never seen: no actor plays Kite.
- One character in the story may speak aloud, as speaker under that character's name, in one of these voices: {voices}. They say at most {guest_lines} short lines, all in that one voice. No other speakers.
- Bring the telling to life with audio tags in square brackets where they help, such as [whispers], [laughs], [gasps], [excited] or [softly]. At most one tag per sentence.
- Sound effects bring the story to life: give at least half the pages one (2 at most), on a moment the listener would hear (a splash, a creaky door, an owl hooting). Each has a short prompt that describes only the sound (no music, no speech), the index of the line on its page it plays with, the one word in that line it lands on, and seconds between 1 and 3.
- Be kind and calm. Nothing scary, cruel or violent, and nothing about the child's personal details.
{ending}"""


def ending(mode: StoryMode, purpose: StoryPurpose) -> str:
    """Which closing question a story asks: Storybook keeps only the one that fits."""
    if mode == "story" and purpose == "learn":
        return "check"
    if mode == "story" and purpose == "feelings":
        return "reflection"
    return "none"


def story_request(
    topic: str, learning_goal: str, kid_view: KidView, grade: Grade, mode: StoryMode, purpose: StoryPurpose
) -> LlmRequest:
    band = band_for(grade)
    system = SYSTEM.format(
        fk_max=band.fk_max, max_words=band.max_words, style=band.style, purpose=PURPOSES[purpose],
        bedtime=BEDTIME if mode == "bedtime" else "", mode=mode, purpose_name=purpose, word_cap=WORD_CAP,
        sprites=", ".join(sorted(sprite_names())),
        voices="; ".join(f"{name} ({hint})" for name, hint in CHARACTER_VOICES.items()),
        guest_lines=GUEST_LINES, ending=ENDINGS[ending(mode, purpose)].format(no_concept=NO_CONCEPT),
    )
    context = "\n".join([f"The child is in grade {grade}.", *_kid_view_lines(kid_view)])
    task = f"Write the story. Topic: {topic}"
    if purpose == "learn" and learning_goal:
        task += f"\nWhat the child should understand: {learning_goal}"
    return LlmRequest(system=system, context=context, messages=[{"role": "user", "content": task}])


def validate(book: Storybook, mode: StoryMode, purpose: StoryPurpose) -> Storybook:
    """The book as asked for (its mode and purpose, and the ending they allow), with sprites under their
    canonical names, Kite narrating with at most one guest voice, narration under the cap, and sound cues
    that point at a real line. KeyError or ValueError when it can't be fixed here."""
    book = Storybook.model_validate(book.model_dump() | {"mode": mode, "purpose": purpose})
    for page in book.pages:
        for actor in page.actors:
            actor.sprite = canonical(actor.sprite)
        page.sounds = [cue for cue in page.sounds if cue.line < len(page.lines) and cue.prompt.strip()]
        for cue in page.sounds:
            cue.seconds = min(max(cue.seconds, SFX_SECONDS[0]), SFX_SECONDS[1])
    guests = [line for page in book.pages for line in page.lines if line.voice != "kite"]
    cast = {(line.speaker.casefold(), line.voice) for line in guests}
    if len(cast) > 1 or len(guests) > GUEST_LINES:
        raise ValueError(
            f"Kite narrates every line; one character may speak at most {GUEST_LINES} lines in one voice, "
            f"but {len(guests)} lines use {sorted(cast)}"
        )
    words = sum(len(line.text.split()) for page in book.pages for line in page.lines)
    if words > WORD_CAP:
        raise ValueError(f"the story is {words} words, the cap is {WORD_CAP}")
    if ending(mode, purpose) == "check" and book.check is None:
        raise ValueError("a learn story ends on a check question")
    return book


async def write_story(
    deps: Deps, topic: str, learning_goal: str, kid_view: KidView, grade: Grade, mode: StoryMode, purpose: StoryPurpose
) -> Storybook:
    """Sonnet with adaptive thinking at medium effort, and one retry that is told what was wrong."""
    request = story_request(topic, learning_goal, kid_view, grade, mode, purpose)
    for attempt in range(ATTEMPTS):
        book = await deps.llm.parse(request, Storybook, deep=True)
        try:
            return validate(book, mode, purpose)
        except (KeyError, ValueError) as e:
            log.warning("story attempt %d rejected: %s", attempt + 1, e)
            if attempt + 1 == ATTEMPTS:
                raise
            retry = {"role": "user", "content": f"That story was rejected: {e}. Write it again and fix that."}
            request.messages = [*request.messages, {"role": "assistant", "content": book.model_dump_json()}, retry]


def narration_lines(book: Storybook) -> list[tuple[str, str]]:
    """Every line as (key, text), keyed "{page}-{line}" counting from 0. Audio and timings use the same keys."""
    return [(f"{p}-{n}", line.text) for p, page in enumerate(book.pages) for n, line in enumerate(page.lines)]


def readable_text(book: Storybook) -> list[str]:
    """Everything a kid will read or hear, sound prompts included, for the safety screen."""
    texts = [book.title, *(line.text for page in book.pages for line in page.lines)]
    texts += [actor.name for page in book.pages for actor in page.actors if actor.name]
    texts += [cue.prompt for page in book.pages for cue in page.sounds]
    if book.check:
        texts += [book.check.question, *book.check.choices]
    if book.reflection:
        texts += [book.reflection.question, *book.reflection.choices]
    return texts


def reflection_text(reflection: Reflection) -> str:
    """The reflection as Kite asks it: the question, then each answer offered gently."""
    offers = (f"{'Maybe' if i == 0 else 'Or maybe'} {c.rstrip('.')}." for i, c in enumerate(reflection.choices))
    return " ".join([reflection.question, *offers])


def voices(book: Storybook, grade: Grade) -> tuple[VoiceSpec, list[VoiceSpec]]:
    """Kite's band voice, and each line's voice in narration order. Bedtime calms all of them."""
    def calm(spec: VoiceSpec) -> VoiceSpec:
        return VoiceSpec(spec.voice_id, spec.model_id, spec.settings | BEDTIME_VOICE) if book.mode == "bedtime" else spec

    kite = calm(voice_for(band_for(grade), "story"))
    return kite, [kite if line.voice == "kite" else calm(character_spec(line.voice)) for page in book.pages for line in page.lines]


async def sound_effect(prompt: str, seconds: float) -> bytes | None:
    """An ElevenLabs sound effect, short and close to its prompt. None with no key or a failed call."""
    key = get_settings().ELEVENLABS_API_KEY
    if not key:
        return None
    try:
        chunks = AsyncElevenLabs(api_key=key).text_to_sound_effects.convert(
            text=prompt, duration_seconds=seconds, prompt_influence=SFX_INFLUENCE, output_format="mp3_44100_64",
        )
        return b"".join([c async for c in chunks])
    except Exception as e:
        log.warning("sound effect failed (%s)", type(e).__name__)
        return None


def sfx_cache() -> Path:
    return studio_pro.CREATIONS_DIR / "sfx-cache"


def sound_key(prompt: str) -> str:
    return hashlib.sha256(" ".join(prompt.casefold().split()).encode()).hexdigest()[:24]


async def cached_sound(prompt: str, seconds: float) -> bytes | None:
    """A sound effect made once per prompt: a repeated cue costs nothing."""
    path = sfx_cache() / f"{sound_key(prompt)}.mp3"
    if path.exists():
        return path.read_bytes()
    sound = await sound_effect(prompt, seconds)
    if sound:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(sound)
    return sound


def _progress(deps: Deps, kid_id: str, creation_id: str, step: int, total: int) -> None:
    store.publish(deps, kid_id, CreationProgressEvent, "story", creation_id=creation_id, step=step, steps_total=total)


async def _voice(
    deps: Deps, kid_id: str, creation_id: str, book: Storybook, grade: Grade
) -> tuple[dict[str, str], dict[str, list[Word]]]:
    """Every line in its voice, then the closing question, then the sound effects, through one gate so
    narration goes first. Progress counts finished lines; step 1 was the writing. A failed line cancels
    the rest; a failed question or sound only leaves it out."""
    folder = store.folder(creation_id)
    folder.mkdir(parents=True, exist_ok=True)
    audio: dict[str, str] = {}
    timings: dict[str, list[Word]] = {}
    gate = asyncio.Semaphore(AUDIO_PARALLEL)
    kite, line_voices = voices(book, grade)
    lines = narration_lines(book)

    async def narrate(key: str, text: str, voice: VoiceSpec) -> None:
        async with gate:
            mp3, words = await deps.tts.speak_timed(text, voice)
        (folder / f"{key}.mp3").write_bytes(mp3)
        audio[key], timings[key] = f"{key}.mp3", words
        _progress(deps, kid_id, creation_id, 1 + len(timings), len(lines) + 1)

    async def optional(keys: list[str], make: Callable[[], Awaitable[bytes | None]]) -> None:
        """One file under the first key, which every key plays."""
        try:
            async with gate:
                data = await make()
        except Exception as e:
            log.warning("story %s: no %s (%s)", creation_id, keys[0], type(e).__name__)
            return
        if data:
            (folder / f"{keys[0]}.mp3").write_bytes(data)
            audio.update(dict.fromkeys(keys, f"{keys[0]}.mp3"))

    async def spoken(text: str) -> bytes:
        return (await deps.tts.speak_timed(text, kite))[0]

    sounds: dict[str, tuple[SoundCue, list[str]]] = {}  # one sound per prompt, however many cues use it
    for p, page in enumerate(book.pages):
        for n, cue in enumerate(page.sounds):
            sounds.setdefault(sound_key(cue.prompt), (cue, []))[1].append(f"sfx-{p}-{n}")
    async with asyncio.TaskGroup() as group:
        for (key, text), voice in zip(lines, line_voices, strict=True):
            group.create_task(narrate(key, text, voice))
        if book.check:
            group.create_task(optional(["check"], lambda: spoken(check_text(book.check))))
        if book.reflection:
            group.create_task(optional(["reflection"], lambda: spoken(reflection_text(book.reflection))))
        for cue, keys in sounds.values():
            group.create_task(optional(keys, lambda cue=cue: cached_sound(cue.prompt, cue.seconds)))
    return audio, timings


async def _make(
    deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, grade: Grade,
    mode: StoryMode, purpose: StoryPurpose,
) -> Creation:
    started = time.monotonic()
    music = asyncio.create_task(music_bed(topic, grade, MUSIC_S, MOODS["bedtime" if mode == "bedtime" else purpose]))
    try:
        known = store.load_meta(creation_id).concept_id
        kid_view, concept = await asyncio.gather(
            _kid_view(deps, kid_id, grade),
            store.resolve_concept(deps, topic, learning_goal) if purpose == "learn" and not known else asyncio.sleep(0, known),
        )
        book = await write_story(deps, topic, learning_goal, kid_view, grade, mode, purpose)
        if not await store.strings_are_safe(deps, readable_text(book)):
            raise ValueError("the story was flagged")
        written = time.monotonic()
        if book.check:
            book.check.concept_id = concept or NO_CONCEPT
        _progress(deps, kid_id, creation_id, 1, len(narration_lines(book)) + 1)
        audio, timings = await _voice(deps, kid_id, creation_id, book, grade)
        # Never waits: a bed that is not back yet, or failed, means a story without music.
        if music.done() and not music.exception() and (bed := music.result()):
            (store.folder(creation_id) / "music.mp3").write_bytes(bed)
            audio["music"] = "music.mp3"
    finally:
        music.cancel()
    log.info("story %s: written in %.1f s, voiced in %.1f s", creation_id, written - started, time.monotonic() - written)
    store.save_meta(creation_id, store.load_meta(creation_id).model_copy(update={"concept_id": concept}))
    creation = Creation(id=creation_id, kind="story", status="ready", storybook=book, audio=audio, timings=timings)
    store.save(creation)
    return creation


def use_fallback(creation_id: str, mode: StoryMode) -> Creation:
    """The cached story under this creation's id, told in the mode that was asked for. It is a fun one,
    so it has no question in either mode and its meta names no concept."""
    target = store.folder(creation_id)
    target.mkdir(parents=True, exist_ok=True)
    for partial in target.glob("*.mp3"):  # what the failed attempt had already saved
        partial.unlink()
    for source in FALLBACK_DIR.glob("*.mp3"):
        shutil.copy(source, target / source.name)
    cached = Creation.model_validate_json((FALLBACK_DIR / "creation.json").read_text())
    book = cached.storybook.model_copy(update={"mode": mode})
    creation = cached.model_copy(update={"id": creation_id, "status": "fallback", "storybook": book})
    store.save(creation)
    return creation


async def build_story(
    deps: Deps, kid_id: str, creation_id: str, topic: str, learning_goal: str, grade: Grade,
    mode: StoryMode, purpose: StoryPurpose,
) -> Creation:
    """Never raises. The story is ready when its narration is, else the fallback story plays."""
    try:
        creation = await asyncio.wait_for(
            _make(deps, kid_id, creation_id, topic, learning_goal, grade, mode, purpose), STORY_DEADLINE_S
        )
    except Exception as e:  # includes the deadline's TimeoutError
        log.warning("story %s falls back: %s", creation_id, type(e).__name__)
        creation = use_fallback(creation_id, mode)
    store.publish(deps, kid_id, CreationReadyEvent, "story", creation_id=creation_id, status=creation.status)
    return creation


async def start_story(
    deps: Deps, kid_id: str, topic: str, learning_goal: str, grade: Grade, *,
    mode: StoryMode = "story", purpose: StoryPurpose = "learn", read_only: bool = False, concept_id: str | None = None,
) -> str:
    """A pending creation under an unguessable id, announced as step 0 of 1. build_story runs in the background.
    `concept_id` is the concept the asking turn was about: a learn story teaches it when given, since the
    turn's decision is a surer match than looking the topic up again."""
    creation_id = store.new_id()
    store.save(Creation(id=creation_id, kind="story", status="pending"))
    concept = concept_id if purpose == "learn" else None
    store.save_meta(creation_id, store.Meta(kid_id=kid_id, grade=grade, read_only=read_only, concept_id=concept))
    _progress(deps, kid_id, creation_id, 0, 1)
    store.spawn(build_story(deps, kid_id, creation_id, topic, learning_goal, grade, mode, purpose))
    return creation_id
