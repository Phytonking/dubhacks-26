/**
 * Data layer for the Selldial console.
 *
 * Backend contract (agent/server.py), all money in integer cents:
 *   GET  /api/console                   -> snapshot shaped like window.SELLDIAL_DEMO
 *   POST /api/approvals/{id}/resend     -> re-text the owner
 *   POST /api/approvals/{id}/cancel     -> release the Visa hold
 *   POST /api/handoffs/{id}/claim       -> body {"agent": "<name>"}
 *
 * If the backend is unreachable, the console runs on demo data and actions update local state.
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
    get mode() { return mode; },
    get state() { return state; },

    async resendApproval(id) {
      await post(`/api/approvals/${id}/resend`);
      const ap = state.approvals.find((a) => a.id === id);
      ap.sent = 0;
      audit("human", "approval.resent", ap.conversation, `Owner ${ap.owner_phone}`);
    },

    async cancelApproval(id) {
      await post(`/api/approvals/${id}/cancel`);
      const ap = state.approvals.find((a) => a.id === id);
      ap.status = "cancelled";
      ap.resolved = 0;
      ap.checkout = "Visa hold released";
      audit("human", "approval.cancelled", ap.conversation, "Visa hold released");
    },

    async savePromo(promo) {
      const saved = (await post("/api/promos", promo)) || { ...promo, code: promo.code.trim().toUpperCase() };
      const list = state.policy.discounts;
      const i = list.findIndex((d) => d.code === saved.code);
      if (i >= 0) list[i] = { ...list[i], ...saved };
      else list.push(saved);
      audit("human", i >= 0 ? "promo.updated" : "promo.created", "-", saved.code);
      return saved;
    },

    async claimHandoff(id, agent) {
      await post(`/api/handoffs/${id}/claim`, { agent });
      const h = state.handoffs.find((x) => x.id === id);
      h.claimed_by = agent;
      audit("human", "handoff.claimed", h.conversation, agent);
    },
  };
})();
