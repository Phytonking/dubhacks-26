/**
 * Data layer for the Selldial console.
 *
 * Backend contract (agent/server.py), all money in integer cents:
 *   GET  /api/console                   -> snapshot shaped like window.SELLDIAL_DEMO
 *   POST /api/approvals/{id}/resend     -> re-text the owner
 *   POST /api/approvals/{id}/cancel     -> release the Visa hold
 *   POST /api/handoffs/{id}/claim       -> body {"agent": "<name>"}
 *   POST /api/promos                    -> body {code, max_pct | max_cents, max_uses, requires}; returns the saved code
 *   POST /api/promos/{code}/remove      -> remove a code
 *
 *   GET  /api/console/stream            -> server-sent events; "update" means refetch /api/console
 *
 * The snapshot is read from MongoDB (web/src/lib/console-snapshot.ts). If the backend is unreachable,
 * the console runs on demo data and actions update local state.
 */
window.SelldialAPI = (() => {
  let mode = "demo";
  let state = structuredClone(window.SELLDIAL_DEMO);

  async function load() {
    try {
      const res = await fetch("/api/console", { headers: { Accept: "application/json" } });
      if (!res.ok) throw new Error(res.status);
      state = await res.json();
      mode = "live";
    } catch {
      mode = "demo";
    }
    return state;
  }

  // Refetch the live snapshot. Calls that overlap share one request.
  let inflight = null;
  function refresh() {
    if (mode !== "live") return Promise.resolve(state);
    inflight ??= fetch("/api/console", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then((res) => { if (!res.ok) throw new Error(res.status); return res.json(); })
      .then((next) => { state = next; return state; })
      .finally(() => { inflight = null; });
    return inflight;
  }

  // Live updates: the server pings on any change; we refetch and tell the page. Minutes-ago text goes stale
  // between changes, so also refresh once a minute and when the tab comes back.
  function subscribe(onChange, onStatus = () => {}) {
    if (mode !== "live") return () => {};
    const tick = () => refresh().then(onChange).catch(() => onStatus("offline"));
    const es = new EventSource("/api/console/stream");
    es.addEventListener("ready", () => onStatus("live"));
    es.addEventListener("update", tick);
    es.onerror = () => onStatus("reconnecting");
    const minute = setInterval(tick, 60000);
    const onVisible = () => { if (!document.hidden) tick(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { es.close(); clearInterval(minute); document.removeEventListener("visibilitychange", onVisible); };
  }

  async function post(path, body) {
    if (mode !== "live") return null;
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
    if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
    return res.json();
  }

  function audit(actor, action, conversation, detail) {
    state.audit.unshift({ t: 0, actor, action, conversation, detail });
  }

  return {
    load,
    refresh,
    subscribe,
    get mode() { return mode; },
    get state() { return state; },

    async resendApproval(id) {
      await post(`/api/approvals/${id}/resend`);
      if (mode === "live") return refresh();
      const ap = state.approvals.find((a) => a.id === id);
      ap.sent = 0;
      audit("human", "approval.resent", ap.conversation, `Owner ${ap.owner_phone}`);
    },

    async cancelApproval(id) {
      await post(`/api/approvals/${id}/cancel`);
      if (mode === "live") return refresh();
      const ap = state.approvals.find((a) => a.id === id);
      ap.status = "cancelled";
      ap.resolved = 0;
      ap.checkout = "Visa hold released";
      audit("human", "approval.cancelled", ap.conversation, "Visa hold released");
    },

    // Owner decision on an over-limit order. Approving lets the agent send the customer their payment link.
    async decideApproval(id, decision) {
      await post(`/api/approvals/${id}/${decision}`);
      if (mode === "live") return refresh();
      const ap = state.approvals.find((a) => a.id === id);
      if (ap) { ap.status = decision === "approve" ? "approved" : "declined"; ap.resolved = 0; }
      const c = state.conversations.find((x) => x.id === ap?.conversation);
      if (c) { c.pending = null; if (decision === "decline") c.status = "closed"; }
      audit("human", `approval.${decision === "approve" ? "approved" : "declined"}`, ap?.conversation || "-", "");
    },

    // Confirm a pending deal was paid: the backend records the order, which the console counts as a sale.
    async markPaid(conversationId, { amount_cents, item }) {
      await post(`/api/conversations/${conversationId}/order`, { amount_cents, item });
      if (mode === "live") return refresh();
      const c = state.conversations.find((x) => x.id === conversationId);
      c.outcome = "purchased"; c.status = "closed"; c.amount_cents = amount_cents; c.item = item || c.item;
      audit("human", "order.paid", conversationId, c.item || "");
    },

    async claimHandoff(id, agent) {
      await post(`/api/handoffs/${id}/claim`, { agent });
      if (mode === "live") return refresh();
      const h = state.handoffs.find((x) => x.id === id);
      h.claimed_by = agent;
      audit("human", "handoff.claimed", h.conversation, agent);
    },

    async savePromo(promo) {
      const saved = (await post("/api/promos", promo)) || { ...promo, code: promo.code.trim().toUpperCase() };
      const list = state.policy.discounts;
      const i = list.findIndex((d) => d.code === saved.code);
      if (i >= 0) list[i] = { ...list[i], ...saved };
      else list.push(saved);
      if (mode === "live") await refresh();
      else audit("human", i >= 0 ? "promo.updated" : "promo.created", "-", saved.code);
      return saved;
    },

    async removePromo(code) {
      await post(`/api/promos/${encodeURIComponent(code)}/remove`);
      if (mode === "live") return refresh();
      state.policy.discounts = state.policy.discounts.filter((d) => d.code !== code);
      audit("human", "promo.removed", "-", code);
    },
  };
})();
