from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

ALERT_THRESHOLD = 0.20
ABOUT_ME_THRESHOLD = 0.20
LEARNING_FACT_THRESHOLD = 0.80
ASSIGNED_WORK_THRESHOLD = 0.5
DECIDE_TIMEOUT_S = 1.5
MATCH_COSINE = 0.80
NEAR_QUIZ_COSINE = 0.60
CONTENT_SAFETY_SEVERITY_FLOOR = 4

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
