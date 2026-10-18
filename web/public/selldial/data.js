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
          "kind": "customer",
          "text": "Hi, my iPhone 13 battery is dying and I'm thinking about upgrading."
        },
        {
          "t": 4,
          "kind": "agent",
          "text": "Hi Maya. Before I change anything, can you confirm the PIN on your account?"
        },
        {
          "t": 3,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 3,
          "kind": "agent",
          "text": "Thanks, you're verified. I see you're on the 3-line plan and your iPhone 13 is about 3 years old."
        },
        {
          "t": 2,
          "kind": "customer",
          "text": "Yeah, it barely makes it to lunch now."
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
          "kind": "agent",
          "text": "I can't do 15%, but you qualify for an extra $200.00 trade-in boost, which brings the device to $0.00 down."
        },
        {
          "t": 0,
          "kind": "customer",
          "text": "Okay, that's actually good. What happens next?"
        },
        {
          "t": 4,
          "kind": "system",
          "text": "Inbound call on Photon voice"
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
          "t": 1,
          "kind": "guard",
          "rule": 1,
          "ok": false,
          "text": "Blocked: a 15% discount isn't in the policy table. Offered TRADEIN_BOOST instead"
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1041",
      "summary": "Dev asked about the Galaxy S26. The agent advised waiting 9 days to save $200.00.",
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
        "reasons": [
          "The Galaxy S26 trade-in promo on Oct 26 raises his credit from $300.00 to $500.00.",
          "Waiting costs him nothing: the agent will text him that morning."
        ],
        "runner_up": "Buy today at $699.99 after the $300.00 trade-in."
      },
      "events": [
        {
          "t": 29,
          "kind": "customer",
          "text": "is the s26 worth it rn? i have an s23"
        },
        {
          "t": 28,
          "kind": "agent",
          "text": "Hi Dev. It's a solid upgrade, but the timing matters. Let me check your trade-in value first."
        },
        {
          "t": 27,
          "kind": "customer",
          "text": "ok"
        },
        {
          "t": 26,
          "kind": "agent",
          "text": "Your S23 is worth $300.00 today. On Oct 26 a trade-in promo raises that to $500.00."
        },
        {
          "t": 25,
          "kind": "customer",
          "text": "so i should wait?"
        },
        {
          "t": 24,
          "kind": "agent",
          "text": "Honestly, wait. Nine days saves you $200.00 on the same phone. Buying today is the runner-up if you need it now."
        },
        {
          "t": 23,
          "kind": "customer",
          "text": "oh nice ok thanks"
        },
        {
          "t": 22,
          "kind": "agent",
          "text": "I'll text you the morning of Oct 26 with a link to order."
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
      "summary": "Jordan chose 3 iPhone 17s. Not paid yet: the owner has to approve it first.",
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
          "t": 18,
          "kind": "customer",
          "text": "Want to get 3 iPhones for me and my kids"
        },
        {
          "t": 17,
          "kind": "agent",
          "text": "Hi Jordan, happy to help. Can you confirm your account PIN first?"
        },
        {
          "t": 16,
          "kind": "customer",
          "text": "Sure, ••••"
        },
        {
          "t": 15,
          "kind": "agent",
          "text": "Thanks, you're verified. Three iPhone 17s on the family plan is the best fit: the third line is free for 24 months."
        },
        {
          "t": 14,
          "kind": "customer",
          "text": "What's the total?"
        },
        {
          "t": 13,
          "kind": "agent",
          "text": "$1,849.97 for the three phones. The runner-up is two iPhone 17s and one iPhone 17e, which is $300.00 less."
        },
        {
          "t": 12,
          "kind": "customer",
          "text": "Yes let's do the 3 iPhone 17s"
        },
        {
          "t": 11,
          "kind": "agent",
          "text": "Got it. Since $1,849.97 is over the account's $1,500.00 limit, I've texted the account owner, Alex, to approve. You'll get a confirmation as soon as they reply."
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
          "text": "Held: $1,849.97 is above the owner's $1,500.00 limit. Texted the owner"
        }
      ],
      "region": "Tacoma"
    },
    {
      "id": "c_1039",
      "summary": "A caller asked to change the account owner and failed verification twice. Handed off to a person.",
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
          "t": 16,
          "kind": "customer",
          "text": "I need to transfer this account into my name today."
        },
        {
          "t": 15,
          "kind": "agent",
          "text": "I can help with account changes once you're verified. What's the PIN on the account?"
        },
        {
          "t": 14,
          "kind": "customer",
          "text": "It's ••••."
        },
        {
          "t": 13,
          "kind": "agent",
          "text": "That PIN doesn't match. Can you try once more?"
        },
        {
          "t": 12,
          "kind": "customer",
          "text": "Try ••••."
        },
        {
          "t": 11,
          "kind": "agent",
          "text": "That one doesn't match either, so I can't make account changes on this call."
        },
        {
          "t": 10,
          "kind": "customer",
          "text": "This is ridiculous, it's my account."
        },
        {
          "t": 9,
          "kind": "agent",
          "text": "I understand. I'm connecting you with a specialist now who can verify you another way."
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
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1038",
      "item": "Pixel 11",
      "summary": "Priya bought a Pixel 11. Paid by agent.",
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
          "t": 56,
          "kind": "customer",
          "text": "cracked my pixel 8 screen, repair or new phone?"
        },
        {
          "t": 55,
          "kind": "agent",
          "text": "Sorry to hear that, Priya. Let me compare both for you."
        },
        {
          "t": 54,
          "kind": "customer",
          "text": "thanks"
        },
        {
          "t": 53,
          "kind": "agent",
          "text": "The screen repair is $279.00, and your Pixel 8 is only worth $110.00 as a trade-in. A new Pixel 11 makes more sense."
        },
        {
          "t": 52,
          "kind": "customer",
          "text": "how much is the pixel 11"
        },
        {
          "t": 51,
          "kind": "agent",
          "text": "$829.99. The runner-up is the $279.00 repair if you'd rather keep this phone another year."
        },
        {
          "t": 50,
          "kind": "customer",
          "text": "ok lets get the pixel 11"
        },
        {
          "t": 49,
          "kind": "agent",
          "text": "That's under the owner's limit, so no approval is needed. Here's your secure payment link."
        },
        {
          "t": 48,
          "kind": "customer",
          "text": "done"
        },
        {
          "t": 47,
          "kind": "agent",
          "text": "Paid. Your Pixel 11 receipt is on its way by text."
        },
        {
          "t": 46,
          "kind": "tool",
          "name": "optimizer.recommend",
          "text": "pick=pixel_11 runner_up=repair_screen"
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
      "summary": "Sam asked about a new iPhone. The agent advised a battery replacement, saving him $710.99.",
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
          "t": 81,
          "kind": "customer",
          "text": "My phone dies by 3pm, I think I need a new one."
        },
        {
          "t": 80,
          "kind": "agent",
          "text": "Hi Sam. Before you buy anything, let me run a quick check on your iPhone 15."
        },
        {
          "t": 79,
          "kind": "customer",
          "text": "Sure, go ahead."
        },
        {
          "t": 78,
          "kind": "agent",
          "text": "Your battery health is 79% and nothing else is wrong. That's why it dies early."
        },
        {
          "t": 77,
          "kind": "customer",
          "text": "So what should I do?"
        },
        {
          "t": 76,
          "kind": "agent",
          "text": "You don't need a new phone. A battery replacement is $89.00 and fixes exactly this. The runner-up is the iPhone 17 at $799.99 if you want the new camera."
        },
        {
          "t": 75,
          "kind": "customer",
          "text": "Huh. Okay, I'll just do the battery."
        },
        {
          "t": 74,
          "kind": "agent",
          "text": "Good call. I'll text you the nearest store with an open slot today."
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
        }
      ],
      "region": "Spokane"
    },
    {
      "id": "c_1036",
      "item": "iPhone 17 Pro",
      "summary": "Lena switched from Verizon and bought an iPhone 17 Pro. Paid by agent.",
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
          "t": 125,
          "kind": "customer",
          "text": "Thinking of switching from Verizon, what's the deal"
        },
        {
          "t": 124,
          "kind": "agent",
          "text": "Hi Lena. How much do you still owe Verizon on your phone?"
        },
        {
          "t": 123,
          "kind": "customer",
          "text": "About $640 I think"
        },
        {
          "t": 122,
          "kind": "agent",
          "text": "Switching pays off your remaining $640.00 Verizon balance. The iPhone 17 Pro is the best fit. The runner-up is keeping your phone and switching plan only."
        },
        {
          "t": 121,
          "kind": "customer",
          "text": "How much is the Pro?"
        },
        {
          "t": 120,
          "kind": "agent",
          "text": "$999.99, and that's under your limit, so it can go through today."
        },
        {
          "t": 119,
          "kind": "customer",
          "text": "Let's do the Pro."
        },
        {
          "t": 118,
          "kind": "agent",
          "text": "Done. Payment went through and your number will move over within the hour. Receipt is on its way."
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
    },
    {
      "id": "c_1033",
      "summary": "Marcus wanted 40% off a Galaxy S26 Ultra. Handed off to Rae at Store 112.",
      "customer": "Marcus L.",
      "phone": "•••• 3302",
      "channel": "voice",
      "status": "handoff",
      "verified": true,
      "started": 34,
      "intent": "Galaxy S26 Ultra price match",
      "outcome": "handoff",
      "amount_cents": null,
      "saved_cents": 0,
      "recommendation": null,
      "events": [
        {
          "t": 41,
          "kind": "customer",
          "text": "A competitor has the S26 Ultra at 40% off. Match it."
        },
        {
          "t": 40,
          "kind": "agent",
          "text": "Hi Marcus. Let me check what I'm allowed to match."
        },
        {
          "t": 39,
          "kind": "customer",
          "text": "It's on their site right now."
        },
        {
          "t": 38,
          "kind": "agent",
          "text": "I can match up to $100.00 with a published competitor price, but not 40%."
        },
        {
          "t": 37,
          "kind": "customer",
          "text": "That's nowhere close. I've been a customer for 6 years."
        },
        {
          "t": 36,
          "kind": "agent",
          "text": "I hear you. I can't go past the $100.00 price match myself."
        },
        {
          "t": 35,
          "kind": "customer",
          "text": "Then get me someone who can."
        },
        {
          "t": 34,
          "kind": "agent",
          "text": "Let me bring in a teammate who can look at your options. Rae at Store 112 will have our full conversation."
        },
        {
          "t": 33,
          "kind": "guard",
          "rule": 1,
          "ok": false,
          "text": "Blocked: 40% isn't in the policy table. Only PRICE_MATCH (up to $100.00) applies"
        },
        {
          "t": 31,
          "kind": "guard",
          "rule": 5,
          "ok": true,
          "text": "Customer upset. Handed off to Rae (Store 112) with a summary"
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1027",
      "item": "Galaxy Z Fold 7",
      "summary": "Taylor tried to buy a Galaxy Z Fold 7. The owner declined, so it was not paid.",
      "customer": "Taylor N.",
      "phone": "•••• 5090",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 165,
      "intent": "Galaxy Z Fold 7",
      "outcome": "not_paid",
      "amount_cents": 189999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Galaxy Z Fold 7",
        "reason": "She asked for a foldable, and the Fold 7 is the current model with the best trade-in offer.",
        "runner_up": "Galaxy S26 Ultra at $1,299.99, if the price is the concern."
      },
      "events": [
        {
          "t": 172,
          "kind": "customer",
          "text": "I want the Fold 7. Can you set it up?"
        },
        {
          "t": 171,
          "kind": "agent",
          "text": "Hi Taylor. The Galaxy Z Fold 7 is $1,899.99. Want me to start the order?"
        },
        {
          "t": 170,
          "kind": "customer",
          "text": "Yes please."
        },
        {
          "t": 169,
          "kind": "agent",
          "text": "That's over the account's $1,500.00 limit, so I've texted the account owner, Riley, to approve."
        },
        {
          "t": 168,
          "kind": "customer",
          "text": "Ok, I'll wait."
        },
        {
          "t": 167,
          "kind": "agent",
          "text": "Riley replied NO, so the account owner declined this one and I haven't charged you."
        },
        {
          "t": 166,
          "kind": "customer",
          "text": "Ugh. Anything cheaper?"
        },
        {
          "t": 165,
          "kind": "agent",
          "text": "The Galaxy S26 is $899.99 and fits under the limit. Want me to set that up instead?"
        },
        {
          "t": 162,
          "kind": "tool",
          "name": "checkout.create",
          "text": "visa hold 189999 cents, pending owner approval"
        },
        {
          "t": 162,
          "kind": "guard",
          "rule": 3,
          "ok": false,
          "text": "Held: $1,899.99 is above the owner's $1,500.00 limit. Texted the owner"
        },
        {
          "t": 151,
          "kind": "tool",
          "name": "approval.declined",
          "text": "Owner replied NO. Visa hold released"
        }
      ],
      "region": "Bellevue"
    },
    {
      "id": "c_1034",
      "summary": "Omar bought a Galaxy S26 Ultra. Paid by agent.",
      "customer": "Omar T.",
      "phone": "•••• 1936",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 1500,
      "intent": "Upgrade my Galaxy S23",
      "item": "Galaxy S26 Ultra",
      "outcome": "purchased",
      "amount_cents": 129999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Galaxy S26 Ultra",
        "reason": "His trade-in credit of $540.00 covers 42% of the price and his S23 no longer gets updates.",
        "runner_up": "Galaxy S26 at $899.99, if he can live without the zoom camera."
      },
      "events": [
        {
          "t": 1507,
          "kind": "customer",
          "text": "I'd like the Galaxy S26 Ultra. Can you set it up?"
        },
        {
          "t": 1506,
          "kind": "agent",
          "text": "Hi Omar. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 1505,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 1504,
          "kind": "agent",
          "text": "Thanks, you're verified. The Galaxy S26 Ultra comes to $1,299.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 1503,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 1502,
          "kind": "agent",
          "text": "$1,299.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 1501,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 1500,
          "kind": "agent",
          "text": "Payment went through. Your Galaxy S26 Ultra receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Tacoma"
    },
    {
      "id": "c_1032",
      "summary": "Leo bought a iPhone 17. Paid by agent.",
      "customer": "Leo S.",
      "phone": "•••• 0694",
      "channel": "imessage",
      "status": "closed",
      "verified": true,
      "started": 2900,
      "intent": "New phone for work",
      "item": "iPhone 17",
      "outcome": "purchased",
      "amount_cents": 79999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17",
        "reason": "The $200.00 work-line promo applies, and his iPhone 14 is 3 years old.",
        "runner_up": "iPhone 16e at $599.99, if the budget is tight."
      },
      "events": [
        {
          "t": 2907,
          "kind": "customer",
          "text": "I'd like the iPhone 17. Can you set it up?"
        },
        {
          "t": 2906,
          "kind": "agent",
          "text": "Hi Leo. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 2905,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 2904,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPhone 17 comes to $799.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 2903,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 2902,
          "kind": "agent",
          "text": "$799.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 2901,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 2900,
          "kind": "agent",
          "text": "Payment went through. Your iPhone 17 receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Portland"
    },
    {
      "id": "c_1030",
      "summary": "Noah tried to buy a Pixel 11 Pro. The card was declined and he did not try another one. Not paid.",
      "customer": "Noah M.",
      "phone": "•••• 6108",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 4400,
      "intent": "Pixel with a good camera",
      "item": "Pixel 11 Pro",
      "outcome": "not_paid",
      "amount_cents": 99999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Pixel 11 Pro",
        "reason": "He wants the best camera and the Pixel 11 Pro leads on low light.",
        "runner_up": "Pixel 11 at $799.99, with a slightly smaller sensor."
      },
      "events": [
        {
          "t": 4409,
          "kind": "customer",
          "text": "I'd like the Pixel 11 Pro. Can you set it up?"
        },
        {
          "t": 4408,
          "kind": "agent",
          "text": "Hi Noah. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 4407,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 4406,
          "kind": "agent",
          "text": "Thanks, you're verified. The Pixel 11 Pro comes to $999.99. Want me to place the order?"
        },
        {
          "t": 4405,
          "kind": "customer",
          "text": "Yes, let's do it."
        },
        {
          "t": 4404,
          "kind": "agent",
          "text": "Here's your secure payment link."
        },
        {
          "t": 4403,
          "kind": "customer",
          "text": "Entered my card."
        },
        {
          "t": 4402,
          "kind": "agent",
          "text": "Your bank declined the payment, so nothing was charged. Want to try another card?"
        },
        {
          "t": 4401,
          "kind": "customer",
          "text": "Not now, I'll sort it out with my bank."
        },
        {
          "t": 4400,
          "kind": "agent",
          "text": "No problem. Reply here if you want to try again."
        }
      ],
      "region": "Everett"
    },
    {
      "id": "c_1029",
      "summary": "Dev bought a iPhone 17 Pro Max. Paid by agent.",
      "customer": "Dev P.",
      "phone": "•••• 4410",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 5800,
      "intent": "Bigger screen iPhone",
      "item": "iPhone 17 Pro Max",
      "outcome": "purchased",
      "amount_cents": 119999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17 Pro Max",
        "reason": "His plan qualifies for the Pro Max promo, and he reads on his phone daily.",
        "runner_up": "iPhone 17 Pro at $1,099.99, a smaller phone with the same camera."
      },
      "events": [
        {
          "t": 5807,
          "kind": "customer",
          "text": "I'd like the iPhone 17 Pro Max. Can you set it up?"
        },
        {
          "t": 5806,
          "kind": "agent",
          "text": "Hi Dev. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 5805,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 5804,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPhone 17 Pro Max comes to $1,199.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 5803,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 5802,
          "kind": "agent",
          "text": "$1,199.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 5801,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 5800,
          "kind": "agent",
          "text": "Payment went through. Your iPhone 17 Pro Max receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Bellevue"
    },
    {
      "id": "c_1028",
      "summary": "Ava bought a Apple Watch Series 11. Paid by agent.",
      "customer": "Ava P.",
      "phone": "•••• 8842",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 8600,
      "intent": "Watch to go with my iPhone",
      "item": "Apple Watch Series 11",
      "outcome": "purchased",
      "amount_cents": 39999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Apple Watch Series 11",
        "reason": "It adds to her line for $10.00 a month, and her iPhone is compatible.",
        "runner_up": "Apple Watch SE at $249.99, without the always-on display."
      },
      "events": [
        {
          "t": 8607,
          "kind": "customer",
          "text": "I'd like the Apple Watch Series 11. Can you set it up?"
        },
        {
          "t": 8606,
          "kind": "agent",
          "text": "Hi Ava. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 8605,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 8604,
          "kind": "agent",
          "text": "Thanks, you're verified. The Apple Watch Series 11 comes to $399.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 8603,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 8602,
          "kind": "agent",
          "text": "$399.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 8601,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 8600,
          "kind": "agent",
          "text": "Payment went through. Your Apple Watch Series 11 receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Portland"
    },
    {
      "id": "c_1026",
      "summary": "Sam tried to buy a Galaxy S26. He left before paying and did not answer the follow-up text. Not paid.",
      "customer": "Sam K.",
      "phone": "•••• 9014",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 11500,
      "intent": "Replace a broken phone",
      "item": "Galaxy S26",
      "outcome": "not_paid",
      "amount_cents": 89999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Galaxy S26",
        "reason": "Repair costs $329.00 on a phone worth $90.00 in trade.",
        "runner_up": "Screen repair for $329.00, if he wants to keep it a bit longer."
      },
      "events": [
        {
          "t": 11507,
          "kind": "customer",
          "text": "I'd like the Galaxy S26. Can you set it up?"
        },
        {
          "t": 11506,
          "kind": "agent",
          "text": "Hi Sam. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 11505,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 11504,
          "kind": "agent",
          "text": "Thanks, you're verified. The Galaxy S26 comes to $899.99. Want me to place the order?"
        },
        {
          "t": 11503,
          "kind": "customer",
          "text": "Yes, let's do it."
        },
        {
          "t": 11502,
          "kind": "agent",
          "text": "Here's your secure payment link. It works for 24 hours."
        },
        {
          "t": 11501,
          "kind": "customer",
          "text": "Gotta run, I'll do it later."
        },
        {
          "t": 11500,
          "kind": "agent",
          "text": "Following up: your Galaxy S26 is still waiting. Want to finish checkout?"
        }
      ],
      "region": "Spokane"
    },
    {
      "id": "c_1025",
      "summary": "Zoe bought a iPad Air. Paid by agent.",
      "customer": "Zoe H.",
      "phone": "•••• 7420",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 14400,
      "intent": "Tablet for school",
      "item": "iPad Air",
      "outcome": "purchased",
      "amount_cents": 59999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPad Air",
        "reason": "The student offer takes $100.00 off, and a cellular line adds only $10.00 a month.",
        "runner_up": "iPad 11th generation at $349.99, with a slower chip."
      },
      "events": [
        {
          "t": 14407,
          "kind": "customer",
          "text": "I'd like the iPad Air. Can you set it up?"
        },
        {
          "t": 14406,
          "kind": "agent",
          "text": "Hi Zoe. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 14405,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 14404,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPad Air comes to $599.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 14403,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 14402,
          "kind": "agent",
          "text": "$599.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 14401,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 14400,
          "kind": "agent",
          "text": "Payment went through. Your iPad Air receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Spokane"
    },
    {
      "id": "c_1024",
      "summary": "Priya bought a Pixel Buds Pro 3. Paid by agent.",
      "customer": "Priya S.",
      "phone": "•••• 5562",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 20200,
      "intent": "Earbuds for my Pixel",
      "item": "Pixel Buds Pro 3",
      "outcome": "purchased",
      "amount_cents": 24999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Pixel Buds Pro 3",
        "reason": "They pair at once with her Pixel 11 and are $50.00 off with her plan.",
        "runner_up": "Pixel Buds A at $99.99, with no noise cancelling."
      },
      "events": [
        {
          "t": 20207,
          "kind": "customer",
          "text": "I'd like the Pixel Buds Pro 3. Can you set it up?"
        },
        {
          "t": 20206,
          "kind": "agent",
          "text": "Hi Priya. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 20205,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 20204,
          "kind": "agent",
          "text": "Thanks, you're verified. The Pixel Buds Pro 3 comes to $249.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 20203,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 20202,
          "kind": "agent",
          "text": "$249.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 20201,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 20200,
          "kind": "agent",
          "text": "Payment went through. Your Pixel Buds Pro 3 receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Portland"
    },
    {
      "id": "c_1023",
      "summary": "Jordan bought a iPhone 17e. Paid by agent.",
      "customer": "Jordan T.",
      "phone": "•••• 7731",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 25800,
      "intent": "Cheaper phone for my son",
      "item": "iPhone 17e",
      "outcome": "purchased",
      "amount_cents": 59999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17e",
        "reason": "It is the lowest-priced current iPhone and the first line is free with the promo.",
        "runner_up": "Used iPhone 15 at $399.99, with no warranty."
      },
      "events": [
        {
          "t": 25807,
          "kind": "customer",
          "text": "I'd like the iPhone 17e. Can you set it up?"
        },
        {
          "t": 25806,
          "kind": "agent",
          "text": "Hi Jordan. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 25805,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 25804,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPhone 17e comes to $599.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 25803,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 25802,
          "kind": "agent",
          "text": "$599.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 25801,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 25800,
          "kind": "agent",
          "text": "Payment went through. Your iPhone 17e receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Tacoma"
    },
    {
      "id": "c_1022",
      "summary": "Lena tried to buy a Galaxy Watch 8. The payment link expired before she paid. Not paid.",
      "customer": "Lena W.",
      "phone": "•••• 3385",
      "channel": "imessage",
      "status": "closed",
      "verified": true,
      "started": 30100,
      "intent": "Watch for running",
      "item": "Galaxy Watch 8",
      "outcome": "not_paid",
      "amount_cents": 34999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "Galaxy Watch 8",
        "reason": "It tracks runs with GPS and works with the Galaxy phone she plans to buy.",
        "runner_up": "Galaxy Fit 4 at $99.99, with fewer sensors."
      },
      "events": [
        {
          "t": 30107,
          "kind": "customer",
          "text": "I'd like the Galaxy Watch 8. Can you set it up?"
        },
        {
          "t": 30106,
          "kind": "agent",
          "text": "Hi Lena. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 30105,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 30104,
          "kind": "agent",
          "text": "Thanks, you're verified. The Galaxy Watch 8 comes to $349.99. Want me to place the order?"
        },
        {
          "t": 30103,
          "kind": "customer",
          "text": "Yes, let's do it."
        },
        {
          "t": 30102,
          "kind": "agent",
          "text": "Here's your secure payment link. It's valid for 30 minutes."
        },
        {
          "t": 30101,
          "kind": "customer",
          "text": "I'll pay after my run."
        },
        {
          "t": 30100,
          "kind": "agent",
          "text": "That payment link expired before it was used, so nothing was charged. Reply PAY for a new one."
        }
      ],
      "region": "Everett"
    },
    {
      "id": "c_1021",
      "summary": "Marcus bought a iPhone 17 Pro. Paid by agent.",
      "customer": "Marcus L.",
      "phone": "•••• 3302",
      "channel": "voice",
      "status": "closed",
      "verified": true,
      "started": 36000,
      "intent": "Upgrade after a lost phone",
      "item": "iPhone 17 Pro",
      "outcome": "purchased",
      "amount_cents": 109999,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPhone 17 Pro",
        "reason": "His insurance claim credits $300.00 and he needs a phone this week.",
        "runner_up": "iPhone 17 at $799.99, if he can give up the telephoto lens."
      },
      "events": [
        {
          "t": 36007,
          "kind": "customer",
          "text": "I'd like the iPhone 17 Pro. Can you set it up?"
        },
        {
          "t": 36006,
          "kind": "agent",
          "text": "Hi Marcus. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 36005,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 36004,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPhone 17 Pro comes to $1,099.99. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 36003,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 36002,
          "kind": "agent",
          "text": "$1,099.99 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 36001,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 36000,
          "kind": "agent",
          "text": "Payment went through. Your iPhone 17 Pro receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Seattle"
    },
    {
      "id": "c_1020",
      "summary": "Chris bought a iPad Pro 13\". Paid by agent.",
      "customer": "Chris B.",
      "phone": "•••• 2271",
      "channel": "sms",
      "status": "closed",
      "verified": true,
      "started": 41500,
      "intent": "iPad for design work",
      "item": "iPad Pro 13\"",
      "outcome": "purchased",
      "amount_cents": 134900,
      "saved_cents": 0,
      "recommendation": {
        "pick": "iPad Pro 13\"",
        "reason": "The M5 chip handles his drawing apps, and the trade-in takes $200.00 off.",
        "runner_up": "iPad Air 13\" at $799.99, if he does not need the faster screen."
      },
      "events": [
        {
          "t": 41507,
          "kind": "customer",
          "text": "I'd like the iPad Pro 13\". Can you set it up?"
        },
        {
          "t": 41506,
          "kind": "agent",
          "text": "Hi Chris. Before I set anything up, can you confirm the PIN on your account?"
        },
        {
          "t": 41505,
          "kind": "customer",
          "text": "Sure, it's ••••."
        },
        {
          "t": 41504,
          "kind": "agent",
          "text": "Thanks, you're verified. The iPad Pro 13\" comes to $1,349.00. I checked for upcoming promos and none beat today's price, so buying now makes sense."
        },
        {
          "t": 41503,
          "kind": "customer",
          "text": "Great, let's do it."
        },
        {
          "t": 41502,
          "kind": "agent",
          "text": "$1,349.00 is under the owner's limit, so no approval is needed. I'm texting you a secure payment link now."
        },
        {
          "t": 41501,
          "kind": "customer",
          "text": "Paid."
        },
        {
          "t": 41500,
          "kind": "agent",
          "text": "Payment went through. Your iPad Pro 13\" receipt is on its way by text. Anything else?"
        }
      ],
      "region": "Seattle"
    }
  ],
  "customers": [
    {
      "name": "Maya R.",
      "phone": "(206) 555-0187",
      "region": "Seattle",
      "status": "Active"
    },
    {
      "name": "Dev P.",
      "phone": "(425) 555-4410",
      "region": "Bellevue",
      "status": "Active"
    },
    {
      "name": "Jordan T.",
      "phone": "(253) 555-7731",
      "region": "Tacoma",
      "status": "Active"
    },
    {
      "name": "Priya S.",
      "phone": "(503) 555-5562",
      "region": "Portland",
      "status": "Active"
    },
    {
      "name": "Sam K.",
      "phone": "(509) 555-9014",
      "region": "Spokane",
      "status": "Active"
    },
    {
      "name": "Lena W.",
      "phone": "(425) 555-3385",
      "region": "Everett",
      "status": "Active"
    },
    {
      "name": "Marcus L.",
      "phone": "(206) 555-3302",
      "region": "Seattle",
      "status": "Inactive"
    },
    {
      "name": "Taylor N.",
      "phone": "(425) 555-5090",
      "region": "Bellevue",
      "status": "Inactive"
    },
    {
      "name": "Chris B.",
      "phone": "(206) 555-2271",
      "region": "Seattle",
      "status": "Active"
    },
    {
      "name": "Noah M.",
      "phone": "(425) 555-6108",
      "region": "Everett",
      "status": "Active"
    },
    {
      "name": "Ava P.",
      "phone": "(503) 555-8842",
      "region": "Portland",
      "status": "Inactive"
    },
    {
      "name": "Omar T.",
      "phone": "(253) 555-1936",
      "region": "Tacoma",
      "status": "Active"
    },
    {
      "name": "Zoe H.",
      "phone": "(509) 555-7420",
      "region": "Spokane",
      "status": "Inactive"
    },
    {
      "name": "Leo S.",
      "phone": "(503) 555-0694",
      "region": "Portland",
      "status": "Active"
    }
  ],
  "approvals": [
    {
      "id": "ap_311",
      "conversation": "c_1040",
      "customer": "Jordan T.",
      "items": "3× iPhone 17 + Go5G family plan",
      "amount_cents": 184997,
      "limit_cents": 150000,
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
      "amount_cents": 164900,
      "limit_cents": 150000,
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
    "default_owner_limit_cents": 150000,
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
      "detail": "184997 > limit 150000"
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
  "trends": {
    "handled": {
      "delta": 3,
      "hourly": [
        0,
        1,
        0,
        2,
        1,
        1,
        0,
        1,
        2,
        1,
        0,
        1
      ]
    },
    "paid": {
      "delta": 1,
      "hourly": [
        0,
        0,
        0,
        1,
        0,
        0,
        0,
        0,
        1,
        0,
        0,
        0
      ]
    },
    "notPaid": {
      "delta": -1,
      "hourly": [
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        1,
        0,
        0
      ]
    },
    "saved": {
      "delta_cents": 41200,
      "hourly": [
        0,
        0,
        0,
        0,
        0,
        71099,
        0,
        0,
        0,
        0,
        20000,
        0
      ]
    }
  }
};
