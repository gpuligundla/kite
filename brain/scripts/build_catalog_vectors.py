"""Embed every catalog concept into data/concept_vectors.npy, one row per concept in file order.
Run from brain/: uv run python -m scripts.build_catalog_vectors"""

import asyncio
from pathlib import Path

import numpy as np

from kite_brain.catalog import VECTORS_PATH, Catalog
from kite_brain.config import get_settings
from kite_brain.memory.embed import FoundryEmbed


async def build_catalog_vectors(catalog: Catalog | None = None, embed=None, path: Path = VECTORS_PATH) -> np.ndarray:
    catalog = catalog or Catalog.load()
    embed = embed or FoundryEmbed(get_settings())
    vectors = await embed([f"{c.name}. {' '.join(c.key_points)}" for c in catalog.concepts])
    path.parent.mkdir(parents=True, exist_ok=True)
    np.save(path, vectors)
    return vectors


if __name__ == "__main__":
    print("wrote", asyncio.run(build_catalog_vectors()).shape, "to", VECTORS_PATH)
