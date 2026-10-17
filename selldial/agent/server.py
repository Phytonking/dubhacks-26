"""FastAPI app: health check, the company console API, and the dashboard itself.

The console state is an in-memory copy of data/seeds/console.json until the repository layer
lands. Every console action appends to the audit log (rule 6). Money is integer cents.
"""

import copy
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "seeds" / "console.json"
DASHBOARD = ROOT / "dashboard"

app = FastAPI(title="Selldial")
_seed = json.loads(SEED.read_text(encoding="utf-8"))
state: dict = {}


def reset_state() -> None:
    """Reload the console state from the seed snapshot."""
    state.clear()
    state.update(copy.deepcopy(_seed))


reset_state()


def _find(collection: str, item_id: str) -> dict:
    for item in state[collection]:
        if item["id"] == item_id:
            return item
    raise HTTPException(status_code=404, detail=f"{item_id} not found")


def _audit(actor: str, action: str, conversation: str, detail: str) -> None:
    state["audit"].insert(0, {"t": 0, "actor": actor, "action": action, "conversation": conversation, "detail": detail})


def _pending_approval(approval_id: str) -> dict:
    approval = _find("approvals", approval_id)
    if approval["status"] != "texted":
        raise HTTPException(status_code=409, detail=f"{approval_id} is already {approval['status']}")
    return approval


class ClaimRequest(BaseModel):
    agent: str


class PromoRequest(BaseModel):
    code: str
    applies_to: str
    max_pct: int | None = None
    max_cents: int | None = None
    requires: str = ""
    active: bool = True


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/console")
def console() -> dict:
    return state


@app.post("/api/demo/reset")
def demo_reset() -> dict:
    """Reload the demo household and clear console actions (the live screen's Reset demo)."""
    reset_state()
    return {"status": "reset"}


@app.post("/api/promos")
def upsert_promo(body: PromoRequest) -> dict:
    """Create or update a promo code. The policy table is the only source of discounts (rule 1)."""
    if (body.max_pct is None) == (body.max_cents is None):
        raise HTTPException(status_code=422, detail="Set exactly one of max_pct or max_cents")
    if body.max_pct is not None and not 0 < body.max_pct <= 100:
        raise HTTPException(status_code=422, detail="max_pct must be between 1 and 100")
    if body.max_cents is not None and body.max_cents <= 0:
        raise HTTPException(status_code=422, detail="max_cents must be positive")
    promo = body.model_dump()
    promo["code"] = promo["code"].strip().upper()
    discounts = state["policy"]["discounts"]
    existing = next((d for d in discounts if d["code"] == promo["code"]), None)
    if existing:
        existing.update(promo)
    else:
        discounts.append(promo)
    _audit("human", "promo.updated" if existing else "promo.created", "-", promo["code"])
    return existing or promo


@app.post("/api/approvals/{approval_id}/resend")
def resend_approval(approval_id: str) -> dict:
    approval = _pending_approval(approval_id)
    approval["sent"] = 0
    _audit("human", "approval.resent", approval["conversation"], f"Owner {approval['owner_phone']}")
    return approval


@app.post("/api/approvals/{approval_id}/cancel")
def cancel_approval(approval_id: str) -> dict:
    approval = _pending_approval(approval_id)
    approval.update(status="cancelled", resolved=0, checkout="Visa hold released")
    _audit("human", "approval.cancelled", approval["conversation"], "Visa hold released")
    return approval


@app.post("/api/handoffs/{handoff_id}/claim")
def claim_handoff(handoff_id: str, body: ClaimRequest) -> dict:
    handoff = _find("handoffs", handoff_id)
    if handoff["claimed_by"]:
        raise HTTPException(status_code=409, detail=f"{handoff_id} is already claimed by {handoff['claimed_by']}")
    handoff["claimed_by"] = body.agent
    _audit("human", "handoff.claimed", handoff["conversation"], body.agent)
    return handoff


# Mounted last so the API routes above take precedence.
app.mount("/", StaticFiles(directory=DASHBOARD, html=True), name="dashboard")
