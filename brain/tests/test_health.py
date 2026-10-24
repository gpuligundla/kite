from fastapi.testclient import TestClient

from kite_brain.api import create_app


def test_health_is_public():
    r = TestClient(create_app()).get("/health")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
