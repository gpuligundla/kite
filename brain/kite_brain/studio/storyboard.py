"""The storyboard writer (spec section 9). It sees the topic, the goal, the grade and the kid view,
and nothing else: never levels, growing areas, cards, alerts or policies."""

import logging

from kite_brain.contract import Grade, KidView, Storyboard
from kite_brain.deps import Deps, LlmRequest
from kite_brain.policy import _kid_view_lines, band_for
from kite_brain.studio.sprites import canonical, sprite_names
from kite_brain.voice import CHARACTER_VOICES

log = logging.getLogger(__name__)

NARRATION_WORD_CAP = 130  # about 40 s at the pace the voices speak; the prompt asks for 100
ATTEMPTS = 2
NO_CONCEPT = "none"  # the brain fills in the concept, so Claude never names one

SYSTEM = """You write storyboards for short animated movies that teach one idea to a child.
Reading level: grade {fk_max:g} or lower. Keep every sentence under {max_words} words.
Style for this age: {style}

Rules:
- At most 5 scenes and about 100 words of narration in total. Every scene has 1 to 3 actors and 1 to 3 narration lines.
- Each scene's background is one of: sky, space, ocean, forest, town, classroom. Pick fitting colors and time of day.
- Actors use only these sprite names: {sprites}. Rexy is the sprite trex. A character the child already loves may star.
- Each narration line names a speaker and a voice. Voices: {voices}.
- You may start a line with one audio tag in square brackets, such as [excited] or [whispers].
- End with one check question with 2 to 4 choices, exactly one correct, in words the child knows. Set check.concept_id to "{no_concept}".
- Be kind, accurate and calm. Nothing scary, violent or about the child's personal details."""


def storyboard_request(topic: str, learning_goal: str, kid_view: KidView, grade: Grade) -> LlmRequest:
    band = band_for(grade)
    system = SYSTEM.format(
        fk_max=band.fk_max, max_words=band.max_words, style=band.style, no_concept=NO_CONCEPT,
        sprites=", ".join(sorted(sprite_names())),
        voices="; ".join(f"{name} ({hint})" for name, hint in CHARACTER_VOICES.items()),
    )
    context = "\n".join([f"The child is in grade {grade}.", *_kid_view_lines(kid_view)])
    task = f"Write the storyboard. Topic: {topic}\nWhat the child should understand: {learning_goal}"
    return LlmRequest(system=system, context=context, messages=[{"role": "user", "content": task}])


def validate(storyboard: Storyboard) -> Storyboard:
    """Sprites must come from the set (named by their canonical names), narration must fit the cap.
    KeyError or ValueError otherwise."""
    for scene in storyboard.scenes:
        for actor in scene.actors:
            actor.sprite = canonical(actor.sprite)
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
    outside the set or runs long, with the reason added so the second attempt can fix it."""
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
            request.messages = [*request.messages, retry]
