"""The wire contract. Everything the brain streams or stores is typed here, and
`export_openapi.py` turns these models into the TypeScript types the apps use."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field, conlist, constr, model_validator

Grade = Annotated[int, Field(ge=0, le=12)]  # 0 is K
Slug = constr(pattern=r"^[a-z0-9_-]{1,40}$")
Hex = constr(pattern=r"^#[0-9a-fA-F]{6}$")

DeviceKind = Literal["os", "handheld", "parent", "counselor"]
Audience = Literal["kid", "parent", "counselor"]
AlertKind = Literal["bullying", "stranger", "abuse", "self_harm", "sos"]
PolicyAction = Literal["answer", "answer_and_tell", "ask_parent"]
SensitiveTopic = Literal["death", "religion", "bodies", "war", "divorce", "none"]
Mode = Literal["talk", "teach"]
RouteName = Literal[
    "alert", "pause", "ask_parent", "teach", "homework", "about_me", "forget", "answer", "unheard", "fallback"
]
HomeworkMode = Literal["help", "pause", "explain"]
Initiative = Literal["own_question", "follow_up_why", "assigned_work"]
Outcome = Literal["got_it", "partly", "not_yet"]
Verdict = Literal["covered", "partly", "missing", "wrong"]
PayloadKind = Literal["concept_evidence", "curiosity_signal", "profile_fact", "moment"]
CreationKind = Literal["movie", "game"]
CharacterVoiceName = Literal["narrator", "professor", "explorer", "storyteller", "robot_buddy"]
LearningStyle = Literal["story", "game", "picture", "explain", "hands_on"]

# ---- Events -----------------------------------------------------------------

KID_EVENT_TYPES = {
    "heard", "answer.sentence", "answer.done",
    "creation.progress", "creation.ready", "creation.video",
}


class _Event(BaseModel):
    type: str
    kid_id: str
    turn_id: str | None
    at: datetime
    audience: Audience
    id: int = 0

    @model_validator(mode="after")
    def _kid_sees_only_kid_events(self):
        if self.audience == "kid" and self.type not in KID_EVENT_TYPES:
            raise ValueError(f"{self.type} must never have the kid audience")
        return self


class HeardEvent(_Event):
    type: Literal["heard"] = "heard"
    text: str


class DecidedEvent(_Event):
    type: Literal["decided"] = "decided"
    backend: Literal["decision1", "openrouter", "haiku"]
    safety: dict[str, float]
    sensitive_topic: SensitiveTopic
    initiative: Initiative
    concept_id: str | None
    about_me: float


class RecalledEvent(_Event):
    type: Literal["recalled"] = "recalled"
    moments: list[str]
    strength_topics: list[str]
    guidance_used: bool


class RoutedEvent(_Event):
    type: Literal["routed"] = "routed"
    route: RouteName
    alert_kinds: list[AlertKind] = []
    action: PolicyAction | None = None
    homework_mode: HomeworkMode | None = None
    assignment_title: str | None = None


class AnswerSentenceEvent(_Event):
    type: Literal["answer.sentence"] = "answer.sentence"
    index: Annotated[int, Field(ge=0)]
    text: str
    audio_b64: str


class AnswerDoneEvent(_Event):
    type: Literal["answer.done"] = "answer.done"
    text: str
    fk_grade: float | None
    depth_override: bool
    route: RouteName


class TaughtEvent(_Event):
    type: Literal["taught"] = "taught"
    concept_id: str
    points: dict[str, Verdict]
    outcome: Outcome


class MemorySavedEvent(_Event):
    type: Literal["memory.saved"] = "memory.saved"
    count: Annotated[int, Field(ge=0)]
    kinds: list[PayloadKind]


class AlertEvent(_Event):
    type: Literal["alert"] = "alert"
    alert_id: str
    kinds: conlist(AlertKind, min_length=1)
    routed_to: Literal["parent", "counselor"]
    lat: float | None = None
    lng: float | None = None

    @model_validator(mode="after")
    def _audience_is_the_route(self):
        if self.audience != self.routed_to:
            raise ValueError("an alert's audience must be the adult it is routed to")
        return self


class CardEvent(_Event):
    type: Literal["card"] = "card"
    card_id: str
    topic: str


class CreationProgressEvent(_Event):
    type: Literal["creation.progress"] = "creation.progress"
    creation_id: str
    kind: CreationKind
    step: int
    steps_total: int


class CreationReadyEvent(_Event):
    type: Literal["creation.ready"] = "creation.ready"
    creation_id: str
    kind: CreationKind
    status: Literal["ready", "fallback"]


class CreationVideoEvent(_Event):
    type: Literal["creation.video"] = "creation.video"
    creation_id: str
    video_url: str


KiteEvent = Annotated[
    HeardEvent | DecidedEvent | RecalledEvent | RoutedEvent | AnswerSentenceEvent
    | AnswerDoneEvent | TaughtEvent | MemorySavedEvent | AlertEvent | CardEvent
    | CreationProgressEvent | CreationReadyEvent | CreationVideoEvent,
    Field(discriminator="type"),
]

# ---- Ledger payloads --------------------------------------------------------


class ConceptEvidence(BaseModel):
    kind: Literal["concept_evidence"] = "concept_evidence"
    outcome: Outcome
    source: Literal["teach_back", "check_question", "game"]
    points: dict[str, Verdict] | None = None


class CuriositySignal(BaseModel):
    kind: Literal["curiosity_signal"] = "curiosity_signal"
    signal: Literal["own_question", "follow_up_why", "return_visit", "chose_creation"]


class InterestFact(BaseModel):
    kind: Literal["profile_fact"] = "profile_fact"
    fact_kind: Literal["interest"] = "interest"
    topic: str  # a catalog topic id


class CharacterFact(BaseModel):
    kind: Literal["profile_fact"] = "profile_fact"
    fact_kind: Literal["favorite_character"] = "favorite_character"
    name: constr(max_length=40)  # the only free text the ledger accepts
    sprite: Slug


class StyleFact(BaseModel):
    kind: Literal["profile_fact"] = "profile_fact"
    fact_kind: Literal["learning_style"] = "learning_style"
    style: LearningStyle


ProfileFact = Annotated[InterestFact | CharacterFact | StyleFact, Field(discriminator="fact_kind")]

_MOMENT_TEMPLATES = {
    "answer": "Figured out {name}",
    "movie": "Watched a movie about {name}",
    "game": "Played a game about {name}",
    "teach_back": "You taught Kite about {name}",
}


class Moment(BaseModel):
    kind: Literal["moment"] = "moment"
    concept_id: str
    character: constr(max_length=40) | None = None
    source: Literal["answer", "movie", "game", "teach_back"]

    def text(self, concept_name: str) -> str:
        line = _MOMENT_TEMPLATES[self.source].format(name=concept_name)
        return f"{line}, with {self.character}" if self.character else line


LearningPayload = Annotated[
    ConceptEvidence | CuriositySignal | ProfileFact | Moment, Field(discriminator="kind")
]

# ---- Views ------------------------------------------------------------------


class KidView(BaseModel):
    interests: list[str]
    characters: list[str]
    moments: list[str]
    deep_topics: list[str]


class ProfileView(BaseModel):
    interests: list[str]
    characters: list[str]
    styles: list[LearningStyle]


class ConceptLevel(BaseModel):
    concept_id: str
    name: str
    level: Literal["not_yet", "learning", "got_it", "can_teach"]


class SkillsMap(BaseModel):
    concepts: list[ConceptLevel]
    frontier: list[str]
    growing: list[str]
    can_teach: list[str]


class TopicScore(BaseModel):
    topic: str
    score: Annotated[float, Field(ge=0, le=1)]
    by_grade: dict[int, float]


class CuriosityMap(BaseModel):
    topics: list[TopicScore]


class CardView(BaseModel):
    card_id: str
    grade: Grade
    at: datetime
    topic: str
    summary: str
    starter: str


class AlertView(BaseModel):
    alert_id: str
    kinds: list[AlertKind]
    at: datetime
    lat: float | None = None
    lng: float | None = None


class CounselorAlertView(BaseModel):
    alert_id: str
    kinds: list[AlertKind]
    at: datetime
    excerpt: str  # the flagged message plus the 2 turns before it


class DashboardView(BaseModel):
    profile: ProfileView
    curiosity: CuriosityMap
    skills: SkillsMap
    cards: list[CardView]
    alerts: list[AlertView]
    moments_by_grade: dict[int, list[str]]
    policy: dict[str, PolicyAction]
    how_she_learns: dict[str, float] | None = None


# ---- Studio -----------------------------------------------------------------


class Word(BaseModel):
    text: str
    start: Annotated[float, Field(ge=0)]
    end: Annotated[float, Field(ge=0)]

    @model_validator(mode="after")
    def _ends_after_start(self):
        if self.end < self.start:
            raise ValueError("word ends before it starts")
        return self


class Palette(BaseModel):
    sky: Hex
    ground: Hex
    time_of_day: Literal["morning", "day", "evening", "night"]


class Actor(BaseModel):
    sprite: Slug
    name: constr(max_length=40) | None = None
    entrance: Literal["left", "right", "pop"]
    motion: Literal["bounce", "float", "walk"]


class NarrationLine(BaseModel):
    speaker: str
    voice: CharacterVoiceName
    text: str


class Scene(BaseModel):
    background: Literal["sky", "space", "ocean", "forest", "town", "classroom"]
    palette: Palette
    actors: conlist(Actor, max_length=3)
    lines: conlist(NarrationLine, min_length=1)
    camera: Literal["still", "pan", "zoom"]


class CheckQuestion(BaseModel):
    question: str
    choices: conlist(str, min_length=2, max_length=4)
    correct_index: Annotated[int, Field(ge=0)]
    concept_id: str

    @model_validator(mode="after")
    def _answer_is_a_choice(self):
        if self.correct_index >= len(self.choices):
            raise ValueError("correct_index is out of range")
        return self


class Storyboard(BaseModel):
    title: str
    scenes: conlist(Scene, min_length=1, max_length=5)
    check: CheckQuestion


class GameItem(BaseModel):
    label: str
    sprite: Slug
    correct: bool | None = None  # catch template
    bin: str | None = None  # sort template


class GameSpec(BaseModel):
    template: Literal["catch", "sort"]
    title: str
    instructions: str
    concept_id: str
    items: conlist(GameItem, min_length=2)
    bins: list[str] = []

    @model_validator(mode="after")
    def _items_fit_the_template(self):
        if self.template == "catch":
            ok = all(i.correct is not None for i in self.items)
        else:
            ok = 2 <= len(self.bins) <= 3 and all(i.bin in self.bins for i in self.items)
        if not ok:
            raise ValueError(f"items do not fit the {self.template} template")
        return self


class Creation(BaseModel):
    id: str
    kind: CreationKind
    status: Literal["pending", "ready", "fallback"]
    storyboard: Storyboard | None = None
    game: GameSpec | None = None
    audio: dict[str, str] = {}
    timings: dict[str, list[Word]] = {}
    video_url: str | None = None
    html_url: str | None = None  # M11: a brand-new game built by the studio agent
