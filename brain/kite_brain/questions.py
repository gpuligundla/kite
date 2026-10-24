"""Every question Kite asks the decision model. The wording and answer sets live only here."""

from dataclasses import dataclass, field

from kite_brain.catalog import Concept


@dataclass(frozen=True)
class Question:
    """`meanings` describes each answer for the model. An answer with no entry is described by its own label."""

    name: str
    text: str
    answers: tuple[str, ...]
    meanings: dict[str, str] = field(default_factory=dict)


YES_NO = {"yes": "Yes", "no": "No"}

SAFETY = Question(
    "safety",
    "A child wrote or said this to a learning companion. Does it show the child may be in danger or being hurt?",
    ("ok", "alert_bullying", "alert_stranger", "alert_abuse", "alert_self_harm"),
    {
        "ok": "Nothing worrying. Ordinary curiosity, including questions about scary or sad topics in general.",
        "alert_bullying": "The child is being picked on, excluded, threatened or humiliated by other kids.",
        "alert_stranger": "An unknown or unsafe adult is approaching the child, offering things, or asking to meet or go somewhere.",
        "alert_abuse": "A person is hurting, touching or frightening the child, or the child is being neglected.",
        "alert_self_harm": "The child talks about hurting themselves, not wanting to live, or feeling hopeless.",
    },
)

SENSITIVE_TOPIC = Question(
    "sensitive_topic",
    "Is the child asking about one of these sensitive topics?",
    ("death", "religion", "bodies", "war", "divorce", "none"),
    {
        "death": "Death, dying, or someone or something that died",
        "religion": "God, faith, or religious beliefs and practices",
        "bodies": "Puberty, private body parts, sex, or where babies come from",
        "war": "War, fighting between countries, weapons, or violence in the news",
        "divorce": "Parents separating or divorcing",
        "none": "None of these",
    },
)

INITIATIVE = Question(
    "initiative",
    "Where did this question come from?",
    ("own_question", "follow_up_why", "assigned_work"),
    {
        "own_question": "The child is curious about something new on their own",
        "follow_up_why": "The child is asking why or how about something they were just told",
        "assigned_work": "The child is asking for help with schoolwork, homework or a test that a teacher assigned",
    },
)

ABOUT_ME = Question(
    "about_me",
    "Is the child asking Kite about themselves, such as what Kite remembers about them or what they are good at?",
    ("yes", "no"),
    YES_NO,
)

FORGET_REQUEST = Question(
    "forget_request",
    "Is the child asking Kite to forget something they said earlier?",
    ("yes", "no"),
    YES_NO,
)

ABOUT_KITE = Question(
    "about_kite",
    "Is the child asking about Kite itself, such as what Kite is or how Kite works?",
    ("yes", "no"),
    YES_NO,
)


def concept_question(ids: list[str], names: dict[str, str] | None = None) -> Question:
    """`names` maps a concept id to a readable name, so the model sees more than an id."""
    names = names or {}
    return Question(
        "concept",
        "Which of these ideas is the child asking about?",
        (*ids, "none"),
        {**{i: names[i] for i in ids if i in names}, "none": "None of these"},
    )


def teach_point_questions(concept: Concept) -> list[Question]:
    return [
        Question(
            f"teach_point:{i}",
            f"The child was asked to explain {concept.name}. Did they explain this point: {point}",
            ("covered", "partly", "missing", "wrong"),
            {
                "covered": "Clearly and correctly explained",
                "partly": "Touched on but incomplete or vague",
                "missing": "Not mentioned",
                "wrong": "Stated incorrectly",
            },
        )
        for i, point in enumerate(concept.key_points)
    ]


def learning_fact_questions(facts: list[str]) -> list[Question]:
    """One question per candidate fact. A fact is only safe to store when it is about a
    fictional or public character, never about a real person in the child's life."""
    return [
        Question(
            f"is_learning_fact:{i}",
            f"Is '{fact}' about a fictional or public character, such as from a book, show or game, "
            "and not about a real person or event in the child's life?",
            ("yes", "no"),
            YES_NO,
        )
        for i, fact in enumerate(facts)
    ]
