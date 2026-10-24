"""Task 5 Step 0. Sends two questions to Decision-1 and prints the raw responses, so a human
can confirm it returns a probability for every answer and `alert_stranger` is on top.

Run from brain/: uv run python scripts/probe_decision.py
"""

import json

import httpx

from kite_brain.config import get_settings
from kite_brain.decide import FOUNDRY_PATH, OPENROUTER_MODEL, OPENROUTER_URL, request_body
from kite_brain.questions import SAFETY, SENSITIVE_TOPIC

PROMPT = "a man at the park said he'd give me candy if I get in his car"


def probe(label: str, url: str, headers: dict[str, str], model: str) -> None:
    body = request_body(model, PROMPT, [SAFETY, SENSITIVE_TOPIC])
    print(f"=== {label}: POST {url}")
    response = httpx.post(url, json=body, headers=headers, timeout=30)
    print(f"HTTP {response.status_code}")
    try:
        print(json.dumps(response.json(), indent=2))
    except ValueError:
        print(response.text)


settings = get_settings()
if settings.FOUNDRY_ENDPOINT and settings.FOUNDRY_KEY:
    probe(
        "foundry",
        settings.FOUNDRY_ENDPOINT.rstrip("/") + FOUNDRY_PATH,
        {"api-key": settings.FOUNDRY_KEY},
        settings.DECISION_DEPLOYMENT,
    )
else:
    print("skipping Foundry: set FOUNDRY_ENDPOINT, FOUNDRY_KEY and DECISION_DEPLOYMENT in .env")
if settings.OPENROUTER_KEY:
    probe("openrouter", OPENROUTER_URL, {"Authorization": f"Bearer {settings.OPENROUTER_KEY}"}, OPENROUTER_MODEL)
else:
    print("skipping OpenRouter: set OPENROUTER_KEY in .env")
