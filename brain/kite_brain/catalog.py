import json
from pathlib import Path
from typing import Annotated

import numpy as np
from pydantic import BaseModel, Field, conlist

from kite_brain.contract import Grade

DEFAULT_PATH = Path(__file__).with_name("concepts.json")
VECTORS_PATH = Path("data/concept_vectors.npy")  # built by seed --assets, relative to brain/


class Concept(BaseModel):
    id: str
    name: str
    kid_name: str
    subject: str
    grade: Grade
    standard: str
    prereqs: list[str]
    topic: str
    key_points: conlist(Annotated[str, Field(min_length=1)], min_length=3, max_length=5)


class Catalog:
    """The concept list, loaded once. `vectors` holds one embedding row per concept, in
    file order, and is filled in by `seed --assets`."""

    def __init__(self, concepts: list[Concept]):
        self.concepts = concepts
        self._by_id = {c.id: c for c in concepts}
        self.vectors: np.ndarray | None = None

    @classmethod
    def load(cls, path: Path = DEFAULT_PATH) -> "Catalog":
        raw = json.loads(Path(path).read_text())
        catalog = cls([Concept.model_validate(c) for c in raw])
        catalog._check_references()
        return catalog

    def _check_references(self) -> None:
        if len(self._by_id) != len(self.concepts):
            raise ValueError("duplicate concept id")
        for c in self.concepts:
            for p in c.prereqs:
                if p not in self._by_id:
                    raise ValueError(f"{c.id} has unknown prereq {p}")

    def get(self, concept_id: str) -> Concept:
        return self._by_id[concept_id]

    def by_topic(self, topic: str) -> list[Concept]:
        return [c for c in self.concepts if c.topic == topic]

    @property
    def topics(self) -> list[str]:
        return sorted({c.topic for c in self.concepts})
