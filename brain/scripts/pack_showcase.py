"""Store a studio-agent page in kite_brain/studio/showcase without its embedded sounds.

The brain injects narration and UI sounds into a page as base64 data URLs. Base64 audio is megabytes of text
that the secret guard can't tell from a key, so a showcase keeps each sound as an .mp3 under media/<KIT>/ and
leaves `window.<KIT> = {};` in the page. studio.store.seed_showcase puts them back when it copies the showcase.
Run from brain/: uv run python -m scripts.pack_showcase <creation folder>...
"""

import base64
import json
import re
import shutil
import sys
from pathlib import Path

from kite_brain.studio.store import MEDIA_BLOCK, SHOWCASE_DIR

PREFIX = "data:audio/mpeg;base64,"


def pack(source: Path) -> Path:
    target = SHOWCASE_DIR / source.name
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    shutil.copy(source / "creation.json", target / "creation.json")
    for page in source.glob("*.html"):
        def strip(m: re.Match) -> str:
            sounds = json.loads(m.group(3))
            folder = target / "media" / m.group(2)
            folder.mkdir(parents=True, exist_ok=True)
            for key, url in sounds.items():
                assert url.startswith(PREFIX), f"{key} is not an MP3 data URL"
                (folder / f"{key}.mp3").write_bytes(base64.b64decode(url[len(PREFIX):]))
            return m.group(1) + "{}" + m.group(4)

        (target / page.name).write_text(MEDIA_BLOCK.sub(strip, page.read_text()))
    return target


if __name__ == "__main__":
    for arg in sys.argv[1:]:
        print("packed", pack(Path(arg)))
