/**
 * Scripted demo session for the live screen: S1 ("wait") then S4 (owner approval), PRODUCT.md §4.
 * Plays when no live session is available. `at` is seconds from the start of the call.
 * Money is integer cents. All data is synthetic.
 *
 * Numbers tie together: wait total 71700 = financing payoff 31200 + (99900 − promo 25400 − trade-in 34000);
 * upgrade-today total 93100 = 31200 + (99900 − trade-in 38000). Saved by waiting: 21400.
 */
window.SELLDIAL_SESSION = {
  line: "(206) 555-0142",
  channel: "voice",
  caller: { name: "Maya R.", phone: "•••• 0187" },
  owner: { name: "Priya", limit_cents: 30000 },
  clock_start: "14:01:30",

  signals: [
    { key: "household", label: "3-line household" },
    { key: "device_age", label: "Device age", value: "14 mo" },
    { key: "financing", label: "Financing", value: "$312 left" },
    { key: "tenure", label: "Tenure", value: "4 yr" },
    { key: "plan", label: "Plan", value: "Unlimited Plus, 3 lines" },
    { key: "tradein", label: "Trade-in", value: "$380, falling" },
    { key: "support", label: "Support contacts", value: "2 in 90 days" },
  ],

  guards: [
    { key: "verified", label: "Caller verified", rule: 2 },
    { key: "policy", label: "Discounts in policy", rule: 1 },
    { key: "approval", label: "Owner approval", rule: 3 },
    { key: "reason", label: "Reason and runner-up", rule: 4 },
    { key: "numbers", label: "Numbers from tools", rule: 7 },
  ],

  recommendation: {
    kind: "wait",
    best: "Wait 3 weeks, then upgrade",
    reason: "A promo starting in 3 weeks saves $254, and your trade-in only drops $40 in that time.",
    runner_up: "Upgrade today",
    runner_up_detail: "Costs $214 more overall, but you get the phone now.",
    ruled_out: "Switching plans: no savings for this household.",
    math: [
      { label: "Upgrade today, after $380 trade-in", cents: 93100 },
      { label: "Promo starting in 3 weeks", cents: -25400 },
      { label: "Trade-in value lost by waiting", cents: 4000 },
    ],
    math_total: { label: "Wait 3 weeks, then upgrade", cents: 71700 },
    saved_cents: 21400,
    options: [
      { id: "wait_3w", label: "Wait 3 weeks, then upgrade", today_cents: 0, monthly_cents: 1688, total_cents: 71700, delta_cents: 40500, role: "best" },
      { id: "buy_now", label: "Upgrade today", today_cents: 31200, monthly_cents: 2579, total_cents: 93100, delta_cents: 61900, role: "runner" },
      { id: "keep", label: "Keep current phone", today_cents: 0, monthly_cents: 2600, total_cents: 31200, delta_cents: 0, role: "current" },
    ],
    tradein: {
      weeks: [0, 1, 2, 3, 4, 5, 6, 7, 8],
      cents: [38000, 36700, 35300, 34000, 32800, 31700, 30700, 29800, 28900],
      now_week: 0,
      wait_week: 3,
    },
  },

  steps: [
    { at: 0.0, type: "call", live: true },
    { at: 0.6, type: "tool", name: "lookup_caller", label: "Matched caller ID to a 3-line household", detail: "household=hh_02 lines=3", signals: ["household", "device_age", "financing", "tenure", "plan"] },
    { at: 1.4, type: "say", who: "agent", text: "Hi Maya, I see you're on the 3-line plan and your phone is about 14 months old. Before I change anything, can you confirm your PIN?" },
    { at: 4.6, type: "say", who: "caller", text: "Sure, it's ••••." },
    { at: 5.4, type: "tool", name: "verify_caller", label: "PIN matched", detail: "verified=true", guard: { verified: "pass" }, verify: true },
    { at: 6.2, type: "say", who: "agent", text: "Thanks, you're verified. What can I help with?" },
    { at: 8.2, type: "say", who: "caller", text: "I want the new iPhone." },
    { at: 8.9, type: "thinking", label: "Comparing buy now vs. waiting" },
    { at: 9.3, type: "signals", keys: ["tradein", "support"] },
    { at: 10.8, type: "tool", name: "recommend_upgrade", label: "Compared buy now vs. wait", detail: "best=wait_3w runner_up=buy_now", recommendation: true, guard: { reason: "pass", numbers: "pass" }, savings_cents: 21400 },
    { at: 11.6, type: "say", who: "agent", text: "Honestly, I'd wait three weeks. A promo starts then that saves $254, and your trade-in only drops $40. That's $214 back to you. The runner-up is upgrading today." },
    { at: 16.4, type: "say", who: "caller", text: "I'd rather not wait. I need it for a trip." },
    { at: 17.4, type: "say", who: "agent", text: "That's fair. Upgrading today costs $214 more overall. It's $999 before trade-in, which is over Priya's limit. Want me to send it to her for approval?" },
    { at: 21.6, type: "say", who: "caller", text: "Yes, send it." },
    { at: 22.3, type: "tool", name: "check_policy", label: "No discount requested", detail: "discount=none", guard: { policy: "pass" } },
    { at: 22.9, type: "tool", name: "start_purchase", label: "Cart: iPhone 17, $999.00", detail: "amount=99900 limit=30000", checkout: { item: "iPhone 17", amount_cents: 99900, token: "tok_••••4821", approval: "pending", charged: false } },
    { at: 23.5, type: "tool", name: "request_owner_approval", label: "Texted Priya for approval", detail: "over_limit=69900", guard: { approval: "pending" } },
    { at: 24.3, type: "say", who: "agent", text: "Sent. Priya just needs to reply YES." },
    { at: 29.2, type: "owner", text: "Priya replied YES", guard: { approval: "pass" }, checkout: { approval: "approved" } },
    { at: 30.0, type: "tool", name: "checkout", label: "MOCK charge $999.00", detail: "token=tok_••••4821 status=captured", checkout: { charged: true } },
    { at: 30.8, type: "tool", name: "send_receipt", label: "Why receipt texted to Maya", detail: "channel=sms" },
    { at: 31.6, type: "say", who: "agent", text: "Done. Priya approved it, and your receipt is on its way. Anything else?" },
  ],
};
