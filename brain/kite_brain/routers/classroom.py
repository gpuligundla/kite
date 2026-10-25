"""The kid's class as Kite OS shows it: the Classroom, To-do, Quizzes and Calendar apps all read this one route."""

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Request
from pydantic import BaseModel

from kite_brain.auth import require
from kite_brain.homework import _NUMBERED, Assignment, status, stored_assignments

router = APIRouter()

ClassStatus = Literal["upcoming", "open", "exam_live", "closed"]
# ponytail: a real LMS connector names each course and its teacher. The simulated class files each assignment under
# its concept's subject, with a teacher per subject.
TEACHERS = {"math": "Ms. Okafor", "science": "Mr. Lee"}


class Course(BaseModel):
    id: str
    name: str
    teacher: str


class ClassAssignment(BaseModel):
    id: str
    course_id: str
    title: str
    kind: Literal["homework", "quiz"]
    status: ClassStatus
    unlock_at: datetime | None
    due_at: datetime | None
    lock_at: datetime | None
    description: str
    questions: list[str]


class Classroom(BaseModel):
    courses: list[Course]
    assignments: list[ClassAssignment]


def class_status(a: Assignment, now: datetime) -> ClassStatus:
    """The guard's status, plus `upcoming` for work that hasn't unlocked yet."""
    return "upcoming" if a.unlock_at is not None and a.unlock_at > now else status(a, now)


@router.get("/kids/{kid_id}/classroom", dependencies=[require("os", "handheld")])
async def classroom(kid_id: str, request: Request) -> Classroom:
    """The stored class, the same rows and clock the homework guard uses, so the screen's status matches what
    Kite will do: hints for open work, a pause during a live quiz, worked explanations once it's closed."""
    deps = request.app.state.deps
    now = deps.clock()
    assignments = [a for a, _ in stored_assignments(deps.conn, deps.keys, kid_id)]
    subject = {a.id: deps.catalog.get(a.concept_id).subject for a in assignments}
    courses = sorted(set(subject.values()))
    return Classroom(
        courses=[Course(id=c, name=c.capitalize(), teacher=TEACHERS.get(c, "Your teacher")) for c in courses],
        assignments=[
            ClassAssignment(
                id=a.id, course_id=subject[a.id], title=a.title, kind=a.kind, status=class_status(a, now),
                unlock_at=a.unlock_at, due_at=a.due_at, lock_at=a.lock_at, description=a.description,
                questions=_NUMBERED.findall(a.description),
            )
            for a in assignments
        ],
    )
