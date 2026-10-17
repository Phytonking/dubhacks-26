"""Import customers, plans and aggregate analytics from the mageshkumarj/dubhacks sandbox.db.

Usage: python data/import_sandbox.py path/to/sandbox.db

Writes data/seeds/customers.json and dashboard/customers-data.js (the same data, for the dashboard's
offline fallback). Names and regions are not in the source data; they are generated deterministically
and are synthetic. Money is integer cents.
"""

import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

FIRST = ["Maya", "Dev", "Jordan", "Priya", "Sam", "Lena", "Chris", "Taylor", "Marcus", "Alex", "Riley", "Morgan",
         "Noah", "Ava", "Leo", "Zoe", "Omar", "Ivy", "Kai", "Nina", "Ezra", "Lila", "Theo", "Rosa", "Jae"]
LAST = ["R.", "P.", "T.", "S.", "K.", "W.", "B.", "N.", "L.", "M.", "H.", "G.", "D.", "C.", "F."]
REGIONS = ["Seattle", "Tacoma", "Bellevue", "Spokane", "Portland", "Everett"]

PERKS = {
    "streaming-video-ads": "Netflix Standard with ads",
    "streaming-video-bundle": "Netflix, Apple TV+ and Hulu bundle",
    "satellite-connectivity": "T-Satellite texting",
    "streaming-video-offer-3usd": "Streaming add-on for $3/mo",
}

# Legacy plans customers still have; not in the sandbox data, so marked synthetic.
LEGACY_PLANS = [
    {"sku": "LEGACY-MAGENTA", "name": "Magenta", "family": "legacy", "first_line_cents": 7000,
     "features": ["Netflix Basic on 2+ lines", "In-flight Wi-Fi on Alaska Airlines", "5GB high-speed hotspot",
                  "Texting and 2G data in 215+ countries", "Scam Shield"], "synthetic": True},
    {"sku": "LEGACY-MAGENTA-MAX", "name": "Magenta MAX", "family": "legacy", "first_line_cents": 8500,
     "features": ["Netflix Standard on 2+ lines", "Apple TV+ included", "In-flight Wi-Fi on Alaska Airlines",
                  "40GB high-speed hotspot", "4K UHD streaming", "Unlimited premium data"], "synthetic": True},
]


def main(db_path: str) -> None:
    c = sqlite3.connect(db_path)
    c.row_factory = sqlite3.Row

    plans = []
    for p in c.execute("select * from plans where status is null or status != 'retired' order by family, sku"):
        features = [PERKS.get(k, k) for k in (p["perks"] or "").split(",") if k]
        if p["video_quality"]:
            features.append(f"{p['video_quality'].upper()} video")
        if p["hotspot_high_speed_gb"]:
            features.append(f"{p['hotspot_high_speed_gb']}GB high-speed hotspot")
        if p["intl_data_gb"]:
            features.append(f"{p['intl_data_gb']}GB international data")
        if p["price_guarantee_years"]:
            features.append(f"{p['price_guarantee_years']}-year price guarantee")
        plans.append({"sku": p["sku"], "name": p["name"], "family": p["family"], "variant": p["variant"],
                      "first_line_cents": int(p["line_prices"].split(",")[0]), "features": features or ["Unlimited talk, text and data"],
                      "synthetic": False})

    plan_names = {p["sku"]: p["name"] for p in plans}
    customers = []
    for i, r in enumerate(c.execute("""
        select a.account_id, a.segment, a.tenure_months, a.contact_preference, a.credit_tier, p.title, p.primary_theme,
               s.port_out_inquiry, s.competitor_research_score
        from personas p join accounts a on a.account_id = p.account_id
        left join account_signals s on s.account_id = a.account_id
        where p.kind = 'customer' order by p.persona_id""")):
        lines = c.execute("select plan_sku, financing_balance_cents from lines where account_id = ?", (r["account_id"],)).fetchall()
        bill = c.execute("select total_cents from billing_history where account_id = ? order by month desc limit 1", (r["account_id"],)).fetchone()
        support = c.execute("select count(*) from support_interactions where account_id = ?", (r["account_id"],)).fetchone()[0]
        top_plan = max((l["plan_sku"] for l in lines), key=[l["plan_sku"] for l in lines].count) if lines else None
        customers.append({
            "id": r["account_id"], "name": f"{FIRST[i % len(FIRST)]} {LAST[(i * 7) % len(LAST)]}",
            "region": REGIONS[(i * 5) % len(REGIONS)], "segment": r["segment"], "tenure_months": r["tenure_months"],
            "lines": len(lines), "plan": plan_names.get(top_plan, top_plan), "monthly_cents": bill[0] if bill else None,
            "financing_cents": sum(l["financing_balance_cents"] or 0 for l in lines), "support_contacts": support,
            "contact_preference": r["contact_preference"], "theme": r["primary_theme"], "note": r["title"],
            "churn_risk": "high" if r["port_out_inquiry"] else ("medium" if (r["competitor_research_score"] or 0) > 0.6 else "low"),
        })

    analytics = {
        "accounts": c.execute("select count(*) from accounts").fetchone()[0],
        "lines": c.execute("select count(*) from lines").fetchone()[0],
        "segments": {r[0]: r[1] for r in c.execute("select segment, count(*) from accounts group by segment order by 2 desc")},
        "support_channels": {r[0]: r[1] for r in c.execute("select channel, count(*) from support_interactions group by channel order by 2 desc")},
        "avg_bill_by_segment_cents": {r[0]: int(r[1]) for r in c.execute("""
            select a.segment, avg(b.total_cents) from billing_history b join accounts a using (account_id)
            where b.month = (select max(month) from billing_history) group by a.segment order by 2 desc""")},
        "plan_mix": {plan_names.get(r[0], r[0]): r[1] for r in c.execute("select plan_sku, count(*) from lines group by plan_sku order by 2 desc")},
    }

    out = {"source": "github.com/mageshkumarj/dubhacks data/sandbox.db (synthetic names and regions added)",
           "customers": customers, "plans": plans + LEGACY_PLANS, "analytics": analytics}
    (ROOT / "data" / "seeds" / "customers.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    (ROOT / "dashboard" / "customers-data.js").write_text(
        "/* Generated by data/import_sandbox.py. Do not edit by hand. */\nwindow.SELLDIAL_CUSTOMERS = " + json.dumps(out) + ";\n", encoding="utf-8")
    print(f"{len(customers)} customers, {len(plans) + len(LEGACY_PLANS)} plans, {analytics['accounts']} accounts")


if __name__ == "__main__":
    main(sys.argv[1])
