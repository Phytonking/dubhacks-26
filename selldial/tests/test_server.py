def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_console_snapshot(client):
    body = client.get("/api/console").json()
    assert {"conversations", "approvals", "handoffs", "guards", "policy", "audit"} <= body.keys()
    assert all(isinstance(a["amount_cents"], int) for a in body["approvals"])


def test_cancel_approval_releases_hold_and_audits(client):
    res = client.post("/api/approvals/ap_311/cancel")
    assert res.json()["status"] == "cancelled"
    assert client.get("/api/console").json()["audit"][0]["action"] == "approval.cancelled"
    assert client.post("/api/approvals/ap_311/resend").status_code == 409


def test_claim_handoff_once(client):
    assert client.post("/api/handoffs/h_77/claim", json={"agent": "Rae"}).json()["claimed_by"] == "Rae"
    assert client.post("/api/handoffs/h_77/claim", json={"agent": "Sam"}).status_code == 409


def test_demo_reset_restores_seed(client):
    client.post("/api/approvals/ap_311/cancel")
    assert client.post("/api/demo/reset").json() == {"status": "reset"}
    assert client.get("/api/console").json()["approvals"][0]["status"] == "texted"


def test_dashboard_pages_served(client):
    assert "Selldial" in client.get("/").text
    assert "Selldial" in client.get("/console.html").text


def test_promo_upsert_validates_and_updates(client):
    assert client.post("/api/promos", json={"code": "x", "applies_to": "Devices"}).status_code == 422
    res = client.post("/api/promos", json={"code": "fall25", "applies_to": "Devices", "max_cents": 5000})
    assert res.json()["code"] == "FALL25"
    client.post("/api/promos", json={"code": "FALL25", "applies_to": "Devices", "max_cents": 7500})
    codes = {d["code"]: d for d in client.get("/api/console").json()["policy"]["discounts"]}
    assert codes["FALL25"]["max_cents"] == 7500
