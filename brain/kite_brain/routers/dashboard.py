from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from kite_brain import dashboard
from kite_brain.auth import Device, require
from kite_brain.contract import Creation, DashboardView, Grade, PolicyAction

router = APIRouter()


class PolicyBody(BaseModel):
    action: PolicyAction


@router.get("/kids/{kid_id}/dashboard", dependencies=[require("parent")])
async def get_dashboard(kid_id: str, request: Request, grade: Grade | None = Query(None)) -> DashboardView:
    deps = request.app.state.deps
    if grade is None:
        grade = dashboard.kid_row(deps, kid_id)["grade"]
    dashboard.receipt(deps, kid_id, f"dashboard grade={grade}")
    return dashboard.dashboard_view(deps, kid_id, grade)


@router.put("/families/{family_id}/policy/{topic}")
async def put_policy(
    family_id: str, topic: str, body: PolicyBody, request: Request, device: Device = require("parent")
) -> dict[str, str]:
    deps = request.app.state.deps
    if topic not in dashboard.SENSITIVE_TOPICS:
        raise HTTPException(422, f"topic must be one of {', '.join(dashboard.SENSITIVE_TOPICS)}")
    # require() only matches a kid in the path, so the family is checked here.
    if dashboard.kid_row(deps, device.kid_id)["family_id"] != family_id:
        raise HTTPException(403, "this device belongs to another family")
    dashboard.set_policy(deps, family_id, topic, body.action)
    return {"topic": topic, "action": body.action}


@router.get("/kids/{kid_id}/contacts", dependencies=[require("parent")])
async def get_contacts(kid_id: str, request: Request) -> list[dashboard.ContactView]:
    deps = request.app.state.deps
    dashboard.receipt(deps, kid_id, "contacts")
    return dashboard.contacts(deps, kid_id)


@router.get("/kids/{kid_id}/movies", dependencies=[require("parent")])
async def get_movies(kid_id: str, request: Request) -> list[Creation]:
    dashboard.receipt(request.app.state.deps, kid_id, "movies")
    return dashboard.movies()
