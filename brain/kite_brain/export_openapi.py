import json
import sys

from kite_brain.api import create_app


def build_schema() -> dict:
    return create_app().openapi()


if __name__ == "__main__":
    json.dump(build_schema(), sys.stdout, indent=2)
