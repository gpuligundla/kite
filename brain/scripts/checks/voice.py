"""Voice and policy checks. Run: uv run python -m scripts.checks.voice"""

import json
import os

from kite_brain import voice
from kite_brain.config import get_settings
from kite_brain.contract import KidView
from kite_brain.policy import (
    BANDS,
    about_me_context,
    band_for,
    depth_line,
    fk_grade,
    system_prompt,
    turn_context,
)

SAMPLE = json.dumps(
    {
        "bands": {b.name: f"band-{b.name}" for b in BANDS},
        "characters": {n: f"char-{n}" for n in voice.CHARACTER_VOICES},
    }
)


def use_sample_voices() -> None:
    os.environ["KITE_VOICES"] = SAMPLE
    get_settings.cache_clear()


def check_bands() -> None:
    assert [band_for(g).name for g in (0, 5, 8, 12)] == ["K-2", "3-5", "6-8", "9-12"], "band boundaries"


def check_depth_and_privacy() -> None:
    assert "up to grade 7" in depth_line("dinosaurs", 4), "depth line at grade 4"
    assert depth_line(None, 4) == "", "no strength, no depth line"
    view = KidView(interests=["dinosaurs"], characters=["Rexy"], moments=["built a volcano"], deep_topics=["light"])
    assert "Rexy" in about_me_context("Maya", 4, view)
    assert "grow" not in about_me_context("Maya", 4, view).lower(), "about_me must carry no skills data"
    prompt = system_prompt(band_for(4), "No scary topics.")
    assert "Rexy" not in prompt and "Maya" not in prompt, "system prompt must hold no kid memory"
    assert "Rexy" in turn_context("Maya", 4, view, None, None, [], ""), "turn context carries the kid view"


def check_fk() -> None:
    assert fk_grade("The cat sat on the mat.") < fk_grade(
        "Photosynthesis converts electromagnetic radiation into biochemical energy."
    ), "fk_grade orders simple below complex"


def check_voice_allowlist() -> None:
    """No voice outside KITE_VOICES can be returned, so no child voice can sneak in."""
    use_sample_voices()
    allowed = voice.allowed_voice_ids()
    assert allowed, "allowlist is empty"
    for band in BANDS:
        for situation in voice.Situation.__args__:
            spec = voice.voice_for(band, situation)
            assert spec.voice_id in allowed, f"{band.name}/{situation} voice off the allowlist"
    for name in voice.CHARACTER_VOICES:
        assert voice.character_spec(name).voice_id in allowed, f"character {name} off the allowlist"
    try:
        voice.load_voices(json.dumps({"bands": {}, "characters": {}}))
    except ValueError:
        pass
    else:
        raise AssertionError("an incomplete KITE_VOICES must be rejected")


def check_alert_delivery() -> None:
    use_sample_voices()
    for band in BANDS:
        answer = voice.voice_for(band, "answer").settings
        alert = voice.voice_for(band, "alert").settings
        assert alert["speed"] < answer["speed"], f"{band.name}: alert must be slower than answer"
        assert alert["stability"] > answer["stability"], f"{band.name}: alert must be steadier than answer"
        assert alert["style"] == 0, f"{band.name}: alert has no expressive style"


def check_alignment() -> None:
    words = voice.words_from_alignment(list("Hi Rexy"), [i * 0.1 for i in range(7)], [i * 0.1 + 0.1 for i in range(7)])
    assert [(w.text, round(w.start, 2), round(w.end, 2)) for w in words] == [("Hi", 0.0, 0.2), ("Rexy", 0.3, 0.7)]
    tagged = voice.words_from_alignment(list("[excited] Hi"), [i * 0.1 for i in range(12)], [i * 0.1 + 0.1 for i in range(12)])
    assert [w.text for w in tagged] == ["Hi"], "audio tags are not words"


def check_spoken_text_is_plain() -> None:
    from kite_brain.turn.speak import SentenceSplitter

    split = SentenceSplitter()
    out = split.feed("- **Six vertical bars:** red, green and blue.\n- ## The `sky` is blue! ") + split.flush()
    assert out == ["Six vertical bars: red, green and blue.", "The sky is blue!"], out
    assert SentenceSplitter().feed("Bees are 2 inches long. ") == ["Bees are 2 inches long."], "plain text is untouched"


def run() -> None:
    check_bands()
    check_depth_and_privacy()
    check_fk()
    check_voice_allowlist()
    check_alert_delivery()
    check_alignment()
    check_spoken_text_is_plain()


if __name__ == "__main__":
    run()
    print("voice checks ok")
