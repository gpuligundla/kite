"""Foundry embeddings (OpenAI-compatible endpoint) and cosine search."""

import numpy as np
from openai import AsyncOpenAI

from kite_brain.config import Settings


class FoundryEmbed:
    """Await it with a list of texts. Returns one unit-length float32 row per text."""

    def __init__(self, settings: Settings):
        self.client = AsyncOpenAI(
            api_key=settings.FOUNDRY_KEY, base_url=settings.FOUNDRY_ENDPOINT.rstrip("/") + "/openai/v1/"
        )
        self.model = settings.EMBED_DEPLOYMENT

    async def __call__(self, texts: list[str]) -> np.ndarray:
        response = await self.client.embeddings.create(model=self.model, input=texts)
        rows = np.array([d.embedding for d in sorted(response.data, key=lambda d: d.index)], dtype=np.float32)
        return rows / np.linalg.norm(rows, axis=1, keepdims=True)


def top_k(q: np.ndarray, mat: np.ndarray, k: int) -> list[tuple[int, float]]:
    """The k rows of `mat` closest to `q` by cosine, best first, as (row index, cosine)."""
    if len(mat) == 0:
        return []
    sims = (mat @ q) / (np.linalg.norm(mat, axis=1) * np.linalg.norm(q))
    best = np.argsort(-sims)[:k]
    return [(int(i), float(sims[i])) for i in best]
