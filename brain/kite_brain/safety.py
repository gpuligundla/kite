"""Azure AI Content Safety on the kid's words and on each sentence Kite speaks, plus
Prompt Shields for jailbreaks. Both are plain REST calls on one httpx client."""

import asyncio

import httpx

from kite_brain.config import CONTENT_SAFETY_SEVERITY_FLOOR, CS_MAP, Settings
from kite_brain.deps import SafetyResult

ANALYZE = "/contentsafety/text:analyze?api-version=2023-10-01"
SHIELD = "/contentsafety/text:shieldPrompt?api-version=2024-09-01"


class AzureSafety:
    def __init__(self, settings: Settings):
        self._http = httpx.AsyncClient(
            base_url=settings.CONTENT_SAFETY_ENDPOINT.rstrip("/"),
            headers={"Ocp-Apim-Subscription-Key": settings.CONTENT_SAFETY_KEY},
        )

    async def _flagged(self, text: str) -> set[str]:
        """Content Safety categories at or above the severity floor."""
        r = await self._http.post(ANALYZE, json={"text": text, "categories": list(CS_MAP)})
        r.raise_for_status()
        return {
            c["category"] for c in r.json()["categoriesAnalysis"]
            if c.get("severity", 0) >= CONTENT_SAFETY_SEVERITY_FLOOR
        }

    async def _jailbreak(self, text: str) -> bool:
        r = await self._http.post(SHIELD, json={"userPrompt": text, "documents": []})
        r.raise_for_status()
        return bool(r.json()["userPromptAnalysis"]["attackDetected"])

    async def check_input(self, text: str) -> SafetyResult:
        flagged, jailbreak = await asyncio.gather(self._flagged(text), self._jailbreak(text))
        return SafetyResult({CS_MAP[c] for c in flagged if c in CS_MAP}, jailbreak)

    async def check_output(self, text: str) -> bool:
        """True when the sentence is safe to speak."""
        return not await self._flagged(text)
