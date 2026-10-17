/**
 * Demo data for the Selldial console. Used only when the backend /api/* is unreachable.
 * Times are minutes-ago so the demo always looks live. Money is integer cents everywhere.
 */
window.SELLDIAL_DEMO = {
  "line": {
    "number": "+1 (206) 555-0142",
    "carrier": "T-Mobile",
    "status": "live"
  },
  "conversations": [
    {
      "id": "c_1042",
      "customer": "Maya R.",
      "phone": "•••• 0187",
      "channel": "voice",
      "status": "live",
      "verified": true,
      "started": 4,
      "intent": "Upgrade from iPhone 13",
      "outcome": null,
      "amount_cents": null,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17 on Go5G Plus",
        "reason": "Her $830.00 trade-in credit covers 78% of the device and her plan already qualifies for the upgrade promo.",
        "runner_up": "Pixel 11: $120.00 cheaper, but she said she uses iMessage and AirDrop every day."
      },
      "events": [
        {
          "t": 4,
          "kind": "system",
          "text": "Inbound call on Photon voice"
        },
        {
          "t": 4,
          "kind": "customer",
          "text": "Hi, my iPhone 13 battery is dying and I'm thinking about upgrading."
        },
        {
          "t": 4,
          "kind": "tool",
          "name": "account.verify",
          "text": "PIN matched, caller verified as account member"
        },
        {
          "t": 4,
          "kind": "guard",
          "rule": 2,
          "ok": true,
          "text": "Caller verified. Account actions unlocked"
        },
        {
          "t": 3,
          "kind": "tool",
          "name": "tradein.quote",
          "text": "iPhone 13 128GB, good condition → 83000 cents credit"
        },
        {
          "t": 3,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=iphone_17_128 runner_up=pixel_11_128 wait=false"
        },
        {
          "t": 3,
          "kind": "guard",
          "rule": 4,
          "ok": true,
          "text": "Recommendation includes a reason and a runner-up"
        },
        {
          "t": 3,
          "kind": "guard",
          "rule": 7,
          "ok": true,
          "text": "All 3 numbers in the reply came from tool results"
        },
        {
          "t": 2,
          "kind": "agent",
          "text": "The iPhone 17 is the best fit. Your trade-in is worth $830.00, which covers most of it. The runner-up is the Pixel 11, which is $120.00 cheaper, but you'd lose iMessage."
        },
        {
          "t": 1,
          "kind": "customer",
          "text": "Can you knock another 15% off?"
        },
        {
          "t": 1,
          "kind": "guard",
          "rule": 1,
          "ok": false,
          "text": "Blocked: a 15% discount isn't in the policy table. Offered TRADEIN_BOOST instead"
        },
        {
          "t": 1,
          "kind": "agent",
          "text": "I can't do 15%, but you qualify for an extra $200.00 trade-in boost, which brings the device to $0.00 down."
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1041",
      "customer": "Dev P.",
      "phone": "•••• 4410",
      "channel": "imessage",
      "status": "closed",
      "verified": true,
      "started": 22,
      "intent": "Galaxy S26 upgrade",
      "outcome": "waited",
      "amount_cents": null,
      "saved_cents": 20000,
      "recommendation": {
        "pick": "Wait 9 days",
        "reason": "The Galaxy S26 trade-in promo on Oct 26 raises his credit from $300.00 to $500.00.",
        "runner_up": "Buy today at $699.99 after the $300.00 trade-in."
      },
      "events": [
        {
          "t": 22,
          "kind": "customer",
          "text": "is the s26 worth it rn? i have an s23"
        },
        {
          "t": 21,
          "kind": "tool",
          "name": "tradein.quote",
          "text": "Galaxy S23, good → 30000 cents today; 50000 cents from 2026-10-26"
        },
        {
          "t": 21,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=wait_9d runner_up=buy_now wait=true"
        },
        {
          "t": 21,
          "kind": "guard",
          "rule": 4,
          "ok": true,
          "text": "Recommendation includes a reason and a runner-up"
        },
        {
          "t": 20,
          "kind": "agent",
          "text": "Honestly, wait. On Oct 26 your S23 trade-in goes from $300.00 to $500.00. I'll text you that morning."
        },
        {
          "t": 19,
          "kind": "customer",
          "text": "oh nice ok thanks"
        },
        {
          "t": 19,
          "kind": "tool",
          "name": "reminders.schedule",
          "text": "Text Dev P. on 2026-10-26 09:00"
        }
      ],
      "region": "Bellevue"
    },
    {
      "id": "c_1040",
      "customer": "Jordan T.",
      "phone": "•••• 7731",
      "channel": "sms",
      "status": "awaiting_approval",
      "verified": true,
      "started": 11,
      "intent": "3 new lines for family",
      "outcome": null,
      "amount_cents": 184997,
      "saved_cents": 0,
      "recommendation": {
        "pick": "3× iPhone 17 on Go5G family",
        "reason": "The family plan's 3rd-line-free promo saves $1,080.00 over 24 months compared with three single lines.",
        "runner_up": "2× iPhone 17 + 1× iPhone 16e: $300.00 less up front."
      },
      "events": [
        {
          "t": 11,
          "kind": "customer",
          "text": "Want to get 3 iPhones for me and my kids"
        },
        {
          "t": 10,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=3x_iphone_17_family runner_up=mixed_16e"
        },
        {
          "t": 10,
          "kind": "guard",
          "rule": 4,
          "ok": true,
          "text": "Recommendation includes a reason and a runner-up"
        },
        {
          "t": 8,
          "kind": "customer",
          "text": "Yes let's do the 3 iPhone 17s"
        },
        {
          "t": 7,
          "kind": "tool",
          "name": "checkout.create",
          "text": "visa hold 184997 cents, pending owner approval"
        },
        {
          "t": 7,
          "kind": "guard",
          "rule": 3,
          "ok": false,
          "text": "Held: $1,849.97 is above the owner's $1,000.00 limit. Texted the owner"
        },
        {
          "t": 6,
          "kind": "agent",
          "text": "Got it. Since this is over the account limit, I've texted the account owner to approve. You'll get a confirmation as soon as they reply."
        }
      ],
      "region": "Tacoma"
    },
    {
      "id": "c_1039",
      "customer": "Unknown caller",
      "phone": "•••• 2208",
      "channel": "voice",
      "status": "handoff",
      "verified": false,
      "started": 9,
      "intent": "Change account owner",
      "outcome": "handoff",
      "amount_cents": null,
      "saved_cents": 0,
      "recommendation": null,
      "events": [
        {
          "t": 9,
          "kind": "customer",
          "text": "I need to transfer this account into my name today."
        },
        {
          "t": 9,
          "kind": "tool",
          "name": "account.verify",
          "text": "PIN failed twice"
        },
        {
          "t": 8,
          "kind": "guard",
          "rule": 2,
          "ok": false,
          "text": "Blocked account.transfer_owner: caller not verified"
        },
        {
          "t": 8,
          "kind": "guard",
          "rule": 5,
          "ok": true,
          "text": "Confidence low. Handing off to a human with a summary"
        },
        {
          "t": 8,
          "kind": "agent",
          "text": "I can't make that change on this call, but I'm connecting you with a specialist now."
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1038",
      "customer": "Priya S.",
      "phone": "•••• 5562",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 47,
      "intent": "Replace cracked Pixel",
      "outcome": "purchased",
      "amount_cents": 82999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Pixel 11",
        "reason": "Repairing the screen costs $279.00 on a phone whose trade-in value is only $110.00.",
        "runner_up": "Screen repair for $279.00, if she wants to keep it another year."
      },
      "events": [
        {
          "t": 47,
          "kind": "customer",
          "text": "cracked my pixel 8 screen, repair or new phone?"
        },
        {
          "t": 46,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=pixel_11 runner_up=repair_screen"
        },
        {
          "t": 45,
          "kind": "agent",
          "text": "A new Pixel 11 makes more sense. The repair is $279.00 and your phone is only worth $110.00."
        },
        {
          "t": 41,
          "kind": "tool",
          "name": "checkout.create",
          "text": "visa charge 82999 cents, below limit"
        },
        {
          "t": 41,
          "kind": "guard",
          "rule": 3,
          "ok": true,
          "text": "Under the owner's limit. No approval needed"
        },
        {
          "t": 40,
          "kind": "tool",
          "name": "receipts.send",
          "text": "Receipt texted"
        }
      ],
      "region": "Portland"
    },
    {
      "id": "c_1037",
      "customer": "Sam K.",
      "phone": "•••• 9014",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 74,
      "intent": "Upgrade from iPhone 15",
      "outcome": "waited",
      "amount_cents": null,
      "saved_cents": 71099,
      "recommendation": {
        "pick": "Keep the iPhone 15 and replace the battery",
        "reason": "Battery health is 79% and everything else is fine; an $89.00 battery fixes the problem he called about.",
        "runner_up": "iPhone 17 at $799.99 if he wants the camera upgrade."
      },
      "events": [
        {
          "t": 74,
          "kind": "customer",
          "text": "My phone dies by 3pm, I think I need a new one."
        },
        {
          "t": 73,
          "kind": "tool",
          "name": "device.diagnose",
          "text": "battery_health=79 other_issues=none"
        },
        {
          "t": 73,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=battery_replace runner_up=iphone_17 wait=true"
        },
        {
          "t": 72,
          "kind": "agent",
          "text": "You don't need a new phone. A battery replacement is $89.00 and fixes exactly this."
        }
      ],
      "region": "Spokane"
    },
    {
      "id": "c_1036",
      "customer": "Lena W.",
      "phone": "•••• 3385",
      "channel": "imessage",
      "status": "closed",
      "verified": true,
      "started": 118,
      "intent": "Switch from Verizon",
      "outcome": "purchased",
      "amount_cents": 99999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17 Pro + Go5G Plus",
        "reason": "The switcher credit pays off her remaining $640.00 Verizon balance.",
        "runner_up": "Keep her own phone and switch plan only: $0.00 today."
      },
      "events": [
        {
          "t": 118,
          "kind": "customer",
          "text": "Thinking of switching from Verizon, what's the deal"
        },
        {
          "t": 116,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=iphone_17_pro_switch runner_up=byod"
        },
        {
          "t": 110,
          "kind": "tool",
          "name": "checkout.create",
          "text": "visa charge 99999 cents, below limit"
        }
      ],
      "region": "Everett"
    }
  ],
  "approvals": [
    {
      "id": "ap_311",
      "conversation": "c_1040",
      "customer": "Jordan T.",
      "items": "3× iPhone 17 + Go5G family plan",
      "amount_cents": 184997,
      "limit_cents": 100000,
      "owner": "Alex T.",
      "owner_phone": "•••• 0193",
      "status": "texted",
      "sent": 7,
      "checkout": "Visa hold placed"
    },
    {
      "id": "ap_310",
      "conversation": "c_1031",
      "customer": "Chris B.",
      "items": "iPad Pro 13\" + cellular line",
      "amount_cents": 134900,
      "limit_cents": 120000,
      "owner": "Morgan B.",
      "owner_phone": "•••• 6620",
      "status": "approved",
      "sent": 96,
      "resolved": 90,
      "checkout": "Visa captured"
    },
    {
      "id": "ap_309",
      "conversation": "c_1027",
      "customer": "Taylor N.",
      "items": "Galaxy Z Fold 7",
      "amount_cents": 189999,
      "limit_cents": 150000,
      "owner": "Riley N.",
      "owner_phone": "•••• 1147",
      "status": "declined",
      "sent": 160,
      "resolved": 151,
      "checkout": "Visa hold released"
    }
  ],
  "handoffs": [
    {
      "id": "h_77",
      "conversation": "c_1039",
      "customer": "Unknown caller",
      "waiting": 8,
      "claimed_by": null,
      "reason": "Unverified caller asked to change account owner",
      "summary": "Caller wants the account moved into their name today. Failed PIN twice. Agent made no changes. Recommend ID verification in store."
    },
    {
      "id": "h_76",
      "conversation": "c_1033",
      "customer": "Marcus L.",
      "waiting": 31,
      "claimed_by": "Rae (Store 112)",
      "reason": "Asked for a discount outside policy",
      "summary": "Wants 40% off a Galaxy S26 Ultra to match a competitor's Black Friday ad. Only PRICE_MATCH (up to $100.00) applies. Customer is upset but polite."
    }
  ],
  "guards": [
    {
      "rule": 1,
      "name": "Discounts only from the policy table",
      "checks": 64,
      "blocks": 3
    },
    {
      "rule": 2,
      "name": "Verify the caller before account changes",
      "checks": 41,
      "blocks": 2
    },
    {
      "rule": 3,
      "name": "Owner texts yes above their limit",
      "checks": 18,
      "blocks": 4
    },
    {
      "rule": 4,
      "name": "Every pick has a reason and a runner-up",
      "checks": 37,
      "blocks": 1
    },
    {
      "rule": 5,
      "name": "Hand off to a human when unsure",
      "checks": 37,
      "blocks": 0
    },
    {
      "rule": 6,
      "name": "Log every action to the audit log",
      "checks": 412,
      "blocks": 0
    },
    {
      "rule": 7,
      "name": "Only state numbers from tool results",
      "checks": 88,
      "blocks": 5
    }
  ],
  "policy": {
    "default_owner_limit_cents": 100000,
    "discounts": [
      {
        "code": "TRADEIN_BOOST",
        "applies_to": "Flagship devices",
        "max_pct": null,
        "max_cents": 20000,
        "requires": "Eligible trade-in, good condition"
      },
      {
        "code": "PRICE_MATCH",
        "applies_to": "Devices",
        "max_pct": null,
        "max_cents": 10000,
        "requires": "Published competitor price"
      },
      {
        "code": "MILITARY",
        "applies_to": "Plans",
        "max_pct": 20,
        "max_cents": null,
        "requires": "Verified military status"
      },
      {
        "code": "FIRST_RESPONDER",
        "applies_to": "Plans",
        "max_pct": 20,
        "max_cents": null,
        "requires": "Verified first responder"
      },
      {
        "code": "LOYALTY_5Y",
        "applies_to": "Accessories",
        "max_pct": 10,
        "max_cents": null,
        "requires": "Customer for 5+ years"
      }
    ]
  },
  "audit": [
    {
      "t": 1,
      "actor": "guard",
      "action": "discount.blocked",
      "conversation": "c_1042",
      "detail": "15% requested; not in policy table"
    },
    {
      "t": 1,
      "actor": "agent",
      "action": "discount.offered",
      "conversation": "c_1042",
      "detail": "TRADEIN_BOOST 20000 cents"
    },
    {
      "t": 3,
      "actor": "agent",
      "action": "optimizer.recommend",
      "conversation": "c_1042",
      "detail": "iphone_17_128 over pixel_11_128"
    },
    {
      "t": 3,
      "actor": "agent",
      "action": "tradein.quote",
      "conversation": "c_1042",
      "detail": "83000 cents"
    },
    {
      "t": 4,
      "actor": "agent",
      "action": "account.verify",
      "conversation": "c_1042",
      "detail": "PIN ok"
    },
    {
      "t": 7,
      "actor": "payments",
      "action": "checkout.hold",
      "conversation": "c_1040",
      "detail": "Visa hold 184997 cents"
    },
    {
      "t": 7,
      "actor": "guard",
      "action": "approval.required",
      "conversation": "c_1040",
      "detail": "184997 > limit 100000"
    },
    {
      "t": 7,
      "actor": "agent",
      "action": "approval.texted",
      "conversation": "c_1040",
      "detail": "Owner •••• 0193"
    },
    {
      "t": 8,
      "actor": "guard",
      "action": "account.blocked",
      "conversation": "c_1039",
      "detail": "transfer_owner; caller unverified"
    },
    {
      "t": 8,
      "actor": "agent",
      "action": "handoff.created",
      "conversation": "c_1039",
      "detail": "h_77"
    },
    {
      "t": 19,
      "actor": "agent",
      "action": "reminder.scheduled",
      "conversation": "c_1041",
      "detail": "2026-10-26 09:00"
    },
    {
      "t": 21,
      "actor": "agent",
      "action": "optimizer.recommend",
      "conversation": "c_1041",
      "detail": "wait_9d over buy_now"
    },
    {
      "t": 31,
      "actor": "human",
      "action": "handoff.claimed",
      "conversation": "c_1033",
      "detail": "Rae (Store 112)"
    },
    {
      "t": 40,
      "actor": "agent",
      "action": "receipt.sent",
      "conversation": "c_1038",
      "detail": "SMS"
    },
    {
      "t": 41,
      "actor": "payments",
      "action": "checkout.charge",
      "conversation": "c_1038",
      "detail": "Visa 82999 cents"
    },
    {
      "t": 46,
      "actor": "agent",
      "action": "optimizer.recommend",
      "conversation": "c_1038",
      "detail": "pixel_11 over repair_screen"
    },
    {
      "t": 73,
      "actor": "agent",
      "action": "optimizer.recommend",
      "conversation": "c_1037",
      "detail": "battery_replace over iphone_17"
    },
    {
      "t": 90,
      "actor": "owner",
      "action": "approval.approved",
      "conversation": "c_1031",
      "detail": "Owner replied YES"
    },
    {
      "t": 90,
      "actor": "payments",
      "action": "checkout.capture",
      "conversation": "c_1031",
      "detail": "Visa 134900 cents"
    },
    {
      "t": 110,
      "actor": "payments",
      "action": "checkout.charge",
      "conversation": "c_1036",
      "detail": "Visa 99999 cents"
    },
    {
      "t": 151,
      "actor": "owner",
      "action": "approval.declined",
      "conversation": "c_1027",
      "detail": "Owner replied NO"
    },
    {
      "t": 151,
      "actor": "payments",
      "action": "checkout.release",
      "conversation": "c_1027",
      "detail": "Visa hold released"
    }
  ],
  "sales": {
    "window": "last 30 days",
    "synthetic": true,
    "funnel": {
      "contacts": 1240,
      "verified": 1016,
      "recommended": 902,
      "purchased": 318,
      "waited": 241,
      "no_change": 187,
      "dropped": 156
    },
    "revenue_cents": 19461600,
    "avg_order_cents": 61200,
    "saved_for_customers_cents": 5163000,
    "revenue_by_week_cents": [
      3980000,
      4510000,
      5220000,
      5751600
    ],
    "by_plan": [
      {
        "plan": "Experience Beyond 2.0",
        "orders": 121,
        "revenue_cents": 8833000
      },
      {
        "plan": "Experience More 2.0",
        "orders": 134,
        "revenue_cents": 7236000
      },
      {
        "plan": "Essentials 2.0",
        "orders": 48,
        "revenue_cents": 2448000
      },
      {
        "plan": "Magenta MAX (legacy)",
        "orders": 15,
        "revenue_cents": 944600
      }
    ],
    "by_channel": [
      {
        "channel": "Voice",
        "conversions": 171
      },
      {
        "channel": "SMS",
        "conversions": 84
      },
      {
        "channel": "iMessage",
        "conversions": 51
      },
      {
        "channel": "WhatsApp",
        "conversions": 12
      }
    ]
  }
};
