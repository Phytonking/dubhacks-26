# Selldial: Product Spec

Selldial is a T-Mobile phone line that sells to you, argues against its own sale when waiting is better, and closes purchases through a Visa checkout the account owner controls.

One-liner for judges: "Every team built a chatbot that sells. We built the one that tells you when to wait, shows its math, and can't spend a dollar the account owner didn't approve."

All customer data, catalog items, prices, and (unless the Visa sandbox is live) payments are synthetic. Say so in the UI and in the demo.

## 1. Problem

Carrier sales agents and chatbots are built to upsell. Customers cannot tell whether advice serves them or the store, and household purchases happen without the account owner's input. T-Mobile's brief rewards recommendations that sometimes say "no good recommendation."

## 2. Users

| User | Who | What they need |
|---|---|---|
| Line holder (caller) | Existing customer on a household account | Honest advice on upgrades, plans, add-ons; help buying |
| Account owner | Pays the bill, sets the spending limit | Approve or deny purchases by text; see the reasoning |
| Prospect | Not a customer yet (unknown number) | Plan and phone recommendation for their lines, budget, usage |
| Human rep | Store or support staff | Take over when the agent is unsure, with a written summary |

## 3. Tracks and how we score

| Track | Feature that proves it |
|---|---|
| Visa: Reimagine Shopping (title) | Controlled checkout: limit, approval, tokenized credential, audit log |
| T-Mobile (side) | Decision engine combining 4+ signals; "wait" and "no change" answers |
| Photon (side) | Real phone number over voice and text; approval and receipt texts |
| VEYZL (side) | Repo audit finding, fix, and visible PR check before and after |

T-Mobile rubric: Customer value 30%, Use of signals 25%, Explainability and trust 20%, Feasibility and demo 25%.
DubHacks rubric: Functionality 30%, Track applicability 30%, Design 20%, Creativity 20%.

## 4. Core scenarios (must work end to end)

### S1. "Wait" (the signature scenario)

1. Line holder calls or texts. Caller ID matches the account; agent greets by name and states what it sees (device 14 months old, financing balance left).
2. Agent verifies with PIN or text code.
3. Caller: "I want the new iPhone."
4. Engine compares buy now vs. wait N weeks (trade-in decay curve, financing balance, eligible promos).
5. Agent recommends waiting, states the dollars saved, names the runner-up option.
6. Caller pushes back. Agent offers the best alternative and explains the trade-off without pressure.
7. "Why" receipt arrives by text.

### S2. "No change needed"

Engine finds the household's current setup is already the cheapest sensible option. Agent says so and states what it checked.

### S3. Household savings

Engine brute-forces plan combinations for the whole household and finds a cheaper arrangement. Agent states monthly and yearly savings and the runner-up.

### S4. Purchase with owner approval

1. Line holder wants a purchase above the owner's limit.
2. Owner gets a text: what, cost today, monthly change, savings, reason. Reply YES or NO.
3. On YES: checkout runs (Visa sandbox or labeled mock) with limit and token shown; every step is logged.
4. Receipt text goes to the caller; confirmation goes to the owner.

### S5. Prospect (stretch)

Unknown number. Agent asks lines, budget, usage; engine picks plan and phone; agent explains with runner-up.

## 5. Features and acceptance criteria

Build in this order. 1 to 4 are core and are never cut.

| # | Feature | Done when |
|---|---|---|
| 1 | Decision engine (Python, no LLM) | Optimizer and trade-in curve return ranked options with best, runner-up, and numbers; unit tests pass, including a "no change" case |
| 2 | "Wait" and "no change" answers | S1 and S2 run end to end by text |
| 3 | Caller context and verification | Caller ID loads account context; no account change is possible before verification (tested) |
| 4 | Household approval by text | S4 approval round trip works with a real phone |
| 5 | "Why" receipt | Text arrives after every conversation, using the template in DESIGN.md |
| 6 | Controlled checkout | Limit enforced, approval required, token shown, audit log complete; mock labeled MOCK |
| 7 | Reasoning panel | Dashboard shows transcript, signals, options, audit log, savings counter live |
| 8 | VEYZL audit | A real finding is fixed in a PR and the check passes |

Cut order if behind: savings counter, then voice (stay on text), then real Visa (use mock), then extra households.

## 6. Agent rules (enforced in agent/guards.py)

1. No discount outside the policy table.
2. No account change before verification.
3. Purchase above the owner's limit requires the owner's YES by text.
4. Every recommendation includes a one-sentence reason and the runner-up.
5. If unsure, hand off to a human with a written summary.
6. Every action is written to the audit log.
7. The agent only states numbers that came from tool results.

## 7. Signals (combine at least 4 per recommendation)

Caller ID account, household members, device age, financing balance, trade-in value, tenure, recent support contacts, current plan and usage.

## 8. Data model (synthetic, 8 to 10 customers, 3 households)

- Household: id, owner_customer_id, spending_limit_cents, discount_group
- Customer: id, name, phone, pin, household_id, tenure_months, recent_support_contacts
- Line: id, customer_id, plan_sku, device_sku, device_age_months, financing_balance_cents, monthly_installment_cents
- Plan: sku, name, per_line_prices_cents[], features, max_lines
- Device: sku, name, tier, price_cents, release_date, tradein_curve
- Addon: sku, name, kind, price_cents (include an accessory bundle, e.g. earbuds)
- Policy: promo_sku, rule, max_savings_cents (the ONLY source of discounts)
- Session: phone, channel, verified, transcript[], engine_results[], cart, status
- Approval: id, session_id, owner_phone, amount_cents, status (pending, yes, no)
- AuditEvent: ts, session_id, actor, action, inputs, outputs, guard_result

Money is integer cents everywhere.

Demo household: 3 lines; one phone 14 months old with a financing balance left; owner is a different person from the caller.

## 9. Agent tools (structured JSON in and out)

lookup_caller, verify_caller, recommend_upgrade (buy now vs. wait), optimize_household, check_policy, start_purchase, request_owner_approval, checkout, send_receipt, escalate_to_human.

## 10. Out of scope

Real T-Mobile systems or customer data, real payments outside the Visa sandbox, number porting, account creation, multilingual support.

## 11. Demo (about 3 minutes)

Scene on the dashboard, call in, verify, "I want the new iPhone" leads to wait with numbers, push back, household savings, owner approval on a teammate's phone, checkout with audit log, receipt text on screen, VEYZL before and after, one-liner.

Backup: recorded video, text-only path, scripted caller number.
