"""Writes the OpenAPI schema to stdout, plus the stream schemas OpenAPI can't describe."""

import json
import sys

from pydantic import TypeAdapter

from kite_brain.api import create_app
from kite_brain.contract import Creation, KidView, KiteEvent, LearningPayload, Storyboard

STREAM_SCHEMAS = {
    "KiteEvent": KiteEvent,
    "LearningPayload": LearningPayload,
    "Storyboard": Storyboard,
    "Creation": Creation,
    "KidView": KidView,
}


def _drop_nested_mappings(node) -> None:
    # Pydantic inlines a nested discriminated union (ProfileFact) as a mapping
    # value, which is invalid OpenAPI. oneOf alone still gives TypeScript the union.
    if isinstance(node, dict):
        mapping = node.get("discriminator", {}).get("mapping", {})
        for tag in [t for t, target in mapping.items() if not isinstance(target, str)]:
            del mapping[tag]
        for child in node.values():
            _drop_nested_mappings(child)
    elif isinstance(node, list):
        for child in node:
            _drop_nested_mappings(child)


def build_schema() -> dict:
    schema = create_app().openapi()
    schemas = schema.setdefault("components", {}).setdefault("schemas", {})
    for name, tp in STREAM_SCHEMAS.items():
        one = TypeAdapter(tp).json_schema(
            ref_template="#/components/schemas/{model}", mode="serialization"
        )
        schemas.update(one.pop("$defs", {}))
        schemas[name] = one
    _drop_nested_mappings(schemas)
    return schema


if __name__ == "__main__":
    json.dump(build_schema(), sys.stdout, indent=2)
