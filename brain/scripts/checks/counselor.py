"""Task 26: the counselor inbox, as plain asserts, with a temp DB and stand-in Deps.
Run from brain/: uv run python -m scripts.checks.counselor"""

from kite_brain.memory import ledger
from scripts.checks.dashboard import client_with_data, seed_ledger
from scripts.checks.ledger import NOW


def check_inbox() -> None:
    client, deps, bearer = client_with_data()
    seed_ledger(deps)
    deps.conn.execute(
        "INSERT INTO kid(id, family_id, display_name, grade, school_start_year) VALUES ('sam', 'rivera', 'Sam', 3, 2023)"
    )
    ledger.record_alert(deps.conn, deps.keys, kid_id="sam", kinds=["abuse"], routed_to="counselor",
                        excerpt="sam's words", at=NOW)

    def receipts():
        return deps.conn.execute("SELECT who, kid_id, what FROM access_receipt ORDER BY id").fetchall()

    assert client.get("/counselor/alerts").status_code == 401, "no token is 401"
    for kind in ("parent", "os", "handheld"):
        r = client.get("/counselor/alerts", headers=bearer[kind])
        assert r.status_code == 403 and "private words" not in r.text, f"{kind} must get 403, got {r.status_code}"
    assert receipts() == [], "a refused request writes no receipt"
    print("ok parent and kid tokens get 403")

    r = client.get("/counselor/alerts", headers=bearer["counselor"])
    assert r.status_code == 200, r.text
    alerts = r.json()
    assert [a["kinds"] for a in alerts] == [["abuse"], ["abuse"]], f"the abuse alerts only, never bullying or SOS: {alerts}"
    assert all(a["excerpt"] == "private words" for a in alerts), "excerpts decrypt, and another kid's never show"
    assert alerts[0]["at"] > alerts[1]["at"], "newest first"
    print("ok the counselor sees the abuse alerts with excerpts, not the bullying ones")

    got = receipts()
    assert [tuple(r) for r in got] == [("counselor", "maya", f"alert {a['alert_id']}") for a in alerts], got
    print("ok one counselor receipt per excerpt read")


def run() -> None:
    check_inbox()


if __name__ == "__main__":
    run()
