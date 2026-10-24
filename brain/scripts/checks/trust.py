"""Task 24: GET /trust is parent-only and serves the two eval files.
Run from brain/: uv run python -m scripts.checks.trust"""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from kite_brain import config
from kite_brain.api import create_app
from kite_brain.seed import seed
from scripts.checks.ledger import NOW, fresh


def check_trust() -> None:
    conn, keys = fresh()
    tokens = seed(conn, keys, NOW).tokens
    client = TestClient(create_app(conn))
    bearer = lambda kind: {"Authorization": f"Bearer {tokens[kind]}"}  # noqa: E731

    with tempfile.TemporaryDirectory() as tmp, patch.object(config, "TRUST_DIR", Path(tmp)):
        assert client.get("/trust").status_code == 401, "no token is 401"
        for kind in ("os", "handheld", "counselor"):
            assert client.get("/trust", headers=bearer(kind)).status_code == 403, f"{kind} must get 403"

        r = client.get("/trust", headers=bearer("parent"))
        assert r.status_code == 404 and "scorecard.json" in r.json()["detail"], f"missing files: {r.status_code} {r.text}"

        (Path(tmp) / "scorecard.json").write_text(json.dumps({"alerts": {"handled": 9, "total": 10}}))
        r = client.get("/trust", headers=bearer("parent"))
        assert r.status_code == 404 and "readability.json" in r.json()["detail"], "one file missing is still 404"

        (Path(tmp) / "readability.json").write_text(json.dumps({"points": [{"band": "3-5", "fk": 4.1}]}))
        r = client.get("/trust", headers=bearer("parent"))
        assert r.status_code == 200, r.text
        assert r.json() == {
            "scorecard": {"alerts": {"handled": 9, "total": 10}},
            "readability": {"points": [{"band": "3-5", "fk": 4.1}]},
        }, r.json()


def run() -> None:
    check_trust()
    print("ok check_trust")


if __name__ == "__main__":
    run()
