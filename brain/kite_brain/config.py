from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# brain/kite_brain/config.py -> the repo root, in a checkout and in the container alike (/app/brain/kite_brain).
REPO_ROOT = Path(__file__).resolve().parents[2]
COLLAB_LOG_PATH = REPO_ROOT / "COLLAB_LOG.md"
TRUST_DIR = REPO_ROOT / "docs" / "trust"

# The red team's calibration half holds recall at 1.0 with no false alert anywhere from 0.15 to
# 0.50, so it cannot justify a higher value, and a safety threshold errs low.
ALERT_THRESHOLD = 0.20
ABOUT_KITE_THRESHOLD = 0.5
ABOUT_ME_THRESHOLD = 0.20
FORGET_THRESHOLD = 0.5
# The red team's calibration half: its jailbreaks scored 0.997 or more, everything else 0.32 or less.
JAILBREAK_THRESHOLD = 0.95
LEARNING_FACT_THRESHOLD = 0.80
ASSIGNED_WORK_THRESHOLD = 0.5
DECIDE_TIMEOUT_S = 1.5
MATCH_COSINE = 0.80
NEAR_QUIZ_COSINE = 0.60
CONTENT_SAFETY_SEVERITY_FLOOR = 4
DECIDE_TOTAL_TIMEOUT_S = 10.0  # the whole backend chain; Haiku alone takes up to 6 s
SAFETY_TIMEOUT_S = 3.0
RECALL_TIMEOUT_S = 3.0
UPLOAD_CAP_BYTES = 900_000
STUDIO_AGENT_TIMEOUT_S = 600.0  # the agent's 7 min of work plus a 1-3 min sandbox cold start

# Content Safety category to alert kind. Sexual and violence go to the counselor, the safer adult for ambiguous cases.
CS_MAP = {"SelfHarm": "self_harm", "Sexual": "abuse", "Violence": "abuse", "Hate": "bullying"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    FOUNDRY_ENDPOINT: str = ""
    FOUNDRY_KEY: str = ""
    ANSWER_DEPLOYMENT: str = ""
    FAST_DEPLOYMENT: str = ""
    DECISION_DEPLOYMENT: str = ""
    EMBED_DEPLOYMENT: str = ""
    OPENROUTER_KEY: str = ""
    CONTENT_SAFETY_ENDPOINT: str = ""
    CONTENT_SAFETY_KEY: str = ""
    ELEVENLABS_API_KEY: str = ""
    KITE_VOICES: str = "{}"
    KITE_MASTER_KEY: str = ""
    KITE_DB_PATH: str = "data/kite.db"
    STUDIO_AGENT_ENDPOINT: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
