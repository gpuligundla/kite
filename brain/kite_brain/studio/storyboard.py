"""The storyboard writer (spec section 9). It sees the topic, the goal, the grade and the kid view,
and nothing else: never levels, growing areas, cards, alerts or policies."""

import logging

from kite_brain.contract import Grade, KidView, Storyboard
from kite_brain.deps import Deps, LlmRequest
from kite_brain.policy import _kid_view_lines, band_for
from kite_brain.studio.sprites import canonical, sprite_names
from kite_brain.voice import CHARACTER_VOICES

log = logging.getLogger(__name__)

NARRATION_WORD_CAP = 150  # about 50 s at the pace the voices speak; the prompt asks for 80-110
ATTEMPTS = 2
NO_CONCEPT = "none"  # the brain fills in the concept, so Claude never names one
GUEST_LINES = 2  # Kite narrates; one favorite character may say this many lines

SYSTEM = """You write storyboards for short animated movies that teach one idea to a child.
Reading level: grade {fk_max:g} or lower. Keep every sentence under {max_words} words.
Style for this age: {style}

Rules:
- At most 5 scenes. Every scene has 1 to 3 actors and at most 2 narration lines. Keep each line to one or two sentences and under 14 words, so the whole narration stays between 80 and 110 words.
- Each scene's background is one of: sky, space, ocean, forest, town, classroom. Pick fitting colors and time of day.
- Actors use only these sprite names: {sprites}. Rexy is the sprite trex. A character the child already loves may star.
- Narration flows in full sentences, like a warm science-show host talking to this child. No strings of short punchy lines, no lists of numbers.
- Kite, the child's own companion, narrates the movie: every line has speaker "Kite" and voice "kite". Kite is heard, never seen: no actor plays Kite.
- One guest may speak: a favorite character from the child's list, as speaker under that character's name, in one of these voices: {voices}. The guest says at most {guest_lines} short lines, all in that one voice. No other speakers. With no favorite character, Kite reads every line.
- You may start a line with one audio tag in square brackets, such as [excited] or [whispers].
- End with one check question with 2 to 4 choices, exactly one correct, in words the child knows. Set check.concept_id to "{no_concept}".
- Be kind, accurate and calm. Nothing scary, violent or about the child's personal details."""


def storyboard_request(topic: str, learning_goal: str, kid_view: KidView, grade: Grade) -> LlmRequest:
    band = band_for(grade)
    system = SYSTEM.format(
        fk_max=band.fk_max, max_words=band.max_words, style=band.style, no_concept=NO_CONCEPT,
        sprites=", ".join(sorted(sprite_names())),
        voices="; ".join(f"{name} ({hint})" for name, hint in CHARACTER_VOICES.items()),
        guest_lines=GUEST_LINES,
    )
    context = "\n".join([f"The child is in grade {grade}.", *_kid_view_lines(kid_view)])
    task = f"Write the storyboard. Topic: {topic}\nWhat the child should understand: {learning_goal}"
    return LlmRequest(system=system, context=context, messages=[{"role": "user", "content": task}])


def validate(storyboard: Storyboard) -> Storyboard:
    """Sprites must come from the set (named by their canonical names), narration must fit the cap,
    and Kite narrates with at most one guest speaker in one voice for GUEST_LINES lines.
    KeyError or ValueError otherwise."""
    for scene in storyboard.scenes:
        for actor in scene.actors:
            actor.sprite = canonical(actor.sprite)
    guests = [line for scene in storyboard.scenes for line in scene.lines if line.voice != "kite"]
    cast = {(line.speaker.casefold(), line.voice) for line in guests}
    if len(cast) > 1 or len(guests) > GUEST_LINES:
        raise ValueError(
            f"Kite narrates every line; one guest may speak at most {GUEST_LINES} lines in one voice, "
            f"but {len(guests)} lines use guests {sorted(cast)}"
        )
    words = sum(len(line.text.split()) for scene in storyboard.scenes for line in scene.lines)
    if words > NARRATION_WORD_CAP:
        raise ValueError(f"narration is {words} words, the cap is {NARRATION_WORD_CAP}")
    return storyboard


def narration_lines(storyboard: Storyboard) -> list[tuple[str, str]]:
    """Every line as (key, text), keyed "{scene}-{line}" counting from 0. Audio and timings use the same keys."""
    return [
        (f"{s}-{n}", line.text) for s, scene in enumerate(storyboard.scenes) for n, line in enumerate(scene.lines)
    ]


def readable_text(storyboard: Storyboard) -> list[str]:
    """Everything a kid will read or hear, for the safety screen."""
    texts = [storyboard.title, storyboard.check.question, *storyboard.check.choices]
    texts += [line.text for scene in storyboard.scenes for line in scene.lines]
    texts += [actor.name for scene in storyboard.scenes for actor in scene.actors if actor.name]
    return texts


async def write_storyboard(deps: Deps, topic: str, learning_goal: str, kid_view: KidView, grade: Grade) -> Storyboard:
    """Sonnet with adaptive thinking at medium effort. One retry when the board uses a sprite
    outside the set, runs long or casts more than one guest, with the reason added so the second
    attempt can fix it."""
    request = storyboard_request(topic, learning_goal, kid_view, grade)
    for attempt in range(ATTEMPTS):
        storyboard = await deps.llm.parse(request, Storyboard, deep=True)
        try:
            return validate(storyboard)
        except (KeyError, ValueError) as e:
            log.warning("storyboard attempt %d rejected: %s", attempt + 1, e)
            if attempt + 1 == ATTEMPTS:
                raise
            retry = {"role": "user", "content": f"That storyboard was rejected: {e}. Write it again and fix that."}
            request.messages = [*request.messages, {"role": "assistant", "content": storyboard.model_dump_json()}, retry]
