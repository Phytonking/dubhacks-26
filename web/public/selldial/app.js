/** Selldial console: home, conversations, customers, sales, settings and about. */
(() => {
  const api = window.SelldialAPI;
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- formatting ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents, whole = false) => cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  const ago = (min) => {
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    if (min >= 1440) return `${Math.floor(min / 1440)}d ago`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const cap = (s) => String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const CHANNEL = { voice: "Voice", sms: "SMS", imessage: "iMessage", whatsapp: "WhatsApp" };
  const ICON = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    back: '<path d="M19 12H5M11 18l-6-6 6-6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    alert: '<circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  };
  const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  const profile = () => ({ name: "Eshaan" });

  // One outcome per conversation. A conversation waiting on the owner is Pending, not Not paid.
  const OUTCOMES = { paid: "Paid", pending: "Pending", notpaid: "Not paid", handoff: "Handed off", waited: "Advised to wait" };
  const OUTCOME_DOT = { paid: "ok", waited: "ok", pending: "warn", notpaid: "bad", handoff: "bad" };
  function outcomeOf(c) {
    if (c.outcome === "purchased") return "paid";
    if (c.outcome === "waited") return "waited";
    if (c.outcome === "handoff" || c.status === "handoff") return "handoff";
    if (c.status === "awaiting_approval") return "pending";
    return "notpaid";
  }
  function outcomeChip(c) {
    const o = outcomeOf(c);
    return `<span class="chip"><span class="dot ${OUTCOME_DOT[o]}"></span>${OUTCOMES[o]}</span>`;
  }
  const channelKind = (c) => c.channel === "voice" ? "Voice" : "Text";
  const statusChip = (st) => `<span class="chip"><span class="dot ${st === "Active" ? "ok" : "off"}"></span>${esc(st)}</span>`;

  const DAY = 1440; // minutes. Home counts today only; Sales looks further back.
  function stats(s) {
    const done = s.conversations.filter((c) => c.status !== "live" && c.started < DAY);
    const paid = done.filter((c) => c.outcome === "purchased");
    return {
      handled: done.length,
      paid: paid.length, paidCents: paid.reduce((n, c) => n + c.amount_cents, 0),
      notPaid: done.filter((c) => outcomeOf(c) === "notpaid").length,
      saved: done.reduce((n, c) => n + (c.saved_cents || 0), 0),
      live: s.conversations.find((c) => c.status === "live"),
      review: done.filter(isBad),
    };
  }

  // ---------- views ----------
  const VIEWS = {
    home: { label: "Home", render: renderHome },
    conversations: { label: "Conversations", render: renderConversations },
    customers: { label: "Customers", render: renderCustomers },
    sales: { label: "Sales", render: renderSales },
    settings: { label: "Settings", render: renderSettings },
    about: { label: "About", render: renderAbout },
  };
  const ui = { convOutcome: "all", convQuery: "", saleRegion: "all", saleTime: "30", salePay: "all", saleQuery: "", custQuery: "", custRegion: "all", custStatus: "all", set: {}, promoForm: null };

  function convRow(c) {
    return `<tr class="clickable" data-conv="${esc(c.id)}">
      <td><button class="row-link" type="button" data-conv="${esc(c.id)}" aria-label="Open conversation with ${esc(c.customer)}">${esc(c.customer)}</button></td>
      <td class="muted hide-sm">${channelKind(c)}</td>
      <td>${esc(c.intent)}</td>
      <td>${outcomeChip(c)}</td>
      <td class="right small muted num">${ago(c.started)}</td>
    </tr>`;
  }

  // A call "went badly" when it ended unpaid after a purchase attempt, was handed off, or failed verification.
  const isBad = (c) => c.outcome === "not_paid" || c.outcome === "handoff" || c.status === "handoff";
  const reviewKind = (c) => c.outcome === "not_paid" ? "Not paid" : c.verified ? "Handed off" : "Failed verification";
  function reviewReason(s, c) {
    const h = s.handoffs.find((x) => x.conversation === c.id);
    if (h) return h.reason;
    const a = s.approvals.find((x) => x.conversation === c.id && x.status === "declined");
    if (a) return `Owner declined ${money(a.amount_cents)}, over the ${money(a.limit_cents)} limit`;
    return c.intent;
  }

  function reviewRow(s, c) {
    return `<li class="review-row">
      <div class="review-main">
        <div class="row-head"><span class="title">${esc(c.customer)}</span><span class="chip"><span class="dot bad"></span>${reviewKind(c)}</span></div>
        <div class="small muted">${esc(reviewReason(s, c))}</div>
      </div>
      <span class="small muted num">${ago(c.started)}</span>
      <button class="btn" type="button" data-conv="${esc(c.id)}" aria-label="Open conversation with ${esc(c.customer)}">Open</button>
    </li>`;
  }

  function renderHome(s) {
    const k = stats(s);
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const recent = s.conversations.filter((c) => c.status !== "live").slice(0, 5);
    return `
      <div class="greeting"><h2>${hello}, ${esc(profile().name)}</h2><span class="muted">${today}</span></div>
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Calls handled</div><div class="value num">${k.handled}</div><div class="hint">voice and text today</div></div>
        <div class="card kpi"><div class="label">Sales paid</div><div class="value num">${k.paid}</div><div class="hint">${money(k.paidCents)} paid by agent</div></div>
        <div class="card kpi"><div class="label">Not paid</div><div class="value num">${k.notPaid}</div><div class="hint">after a purchase attempt</div></div>
        <div class="card kpi accent"><div class="label">Saved for customers</div><div class="value num">${money(k.saved)}</div><div class="hint">by advising to wait</div></div>
      </div>
      <div class="card section">
        <div class="card-head"><h2>Needs review</h2><span class="small muted num">${k.review.length}</span></div>
        ${k.review.length ? `<ul class="list">${k.review.map((c) => reviewRow(s, c)).join("")}</ul>` : `<div class="empty">Nothing needs review. Every call went well.</div>`}
      </div>
      <div class="card section">
        <div class="card-head"><h2>Recent conversations</h2><button class="btn ghost" type="button" data-go="conversations">View all</button></div>
        <div class="table-wrap"><table><tbody>${recent.map((c) => convRow(c)).join("")}</tbody></table></div>
      </div>
      ${k.live ? `<p class="active-line small">${icon("phone")}<b>Active now</b><span class="muted">${esc(k.live.customer)} is on a ${esc(CHANNEL[k.live.channel] === "Voice" ? "call" : "text thread")} about ${esc(k.live.intent.charAt(0).toLowerCase() + k.live.intent.slice(1))}.</span></p>` : ""}`;
  }

  function renderConversations(s) {
    const q = ui.convQuery.trim().toLowerCase();
    const rows = s.conversations
      .filter((c) => c.status !== "live")
      .filter((c) => ui.convOutcome === "all" || outcomeOf(c) === ui.convOutcome)
      .filter((c) => !q || [c.customer, c.intent].join(" ").toLowerCase().includes(q));
    const opt = (v, label) => `<option value="${v}"${v === ui.convOutcome ? " selected" : ""}>${label}</option>`;
    return `
      <div class="filters" style="margin-bottom:12px">
        <label class="select"><span>Outcome</span><select data-ui="convOutcome">${opt("all", "All outcomes")}${Object.entries(OUTCOMES).map(([v, l]) => opt(v, l)).join("")}</select></label>
        <input class="search push" id="conv-search" type="search" aria-label="Search conversations" placeholder="Search customer or topic" value="${esc(ui.convQuery)}">
      </div>
      <div class="card table-card"><div class="table-wrap flat"><table class="conv-table">
        <thead><tr><th>Customer</th><th class="hide-sm">Channel</th><th>About</th><th>Outcome</th><th class="right">Time</th></tr></thead>
        <tbody>${rows.map(convRow).join("") || `<tr><td colspan="5" class="empty">No conversations match. <button class="btn ghost" type="button" data-conv-clear>Clear filters</button></td></tr>`}</tbody>
      </table></div></div>`;
  }

  // Finished conversations for a customer, newest first. Live ones are summarised on Home only.
  const custConvs = (s, name) => s.conversations.filter((c) => c.customer === name && c.status !== "live").sort((a, b) => a.started - b.started);
  const custLive = (s, name) => s.conversations.some((c) => c.customer === name && c.status === "live");
  const lastSeen = (s, c) => s.conversations.filter((x) => x.customer === c.name).reduce((m, x) => Math.min(m, x.started), Infinity);

  function renderCustomers(s) {
    const all = [...(s.customers || [])].sort((a, b) => lastSeen(s, a) - lastSeen(s, b) || a.name.localeCompare(b.name));
    const regions = [...new Set(all.map((c) => c.region))].sort(), statuses = [...new Set(all.map((c) => c.status))].sort();
    const q = ui.custQuery.trim().toLowerCase(), digits = q.replace(/\D/g, "");
    const rows = all
      .filter((c) => ui.custRegion === "all" || c.region === ui.custRegion)
      .filter((c) => ui.custStatus === "all" || c.status === ui.custStatus)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || (digits && c.phone.replace(/\D/g, "").includes(digits)));
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const last = (c) => {
      if (custLive(s, c.name)) return `<span class="muted">On a call now</span>`;
      const l = custConvs(s, c.name)[0];
      return l ? `${esc(l.intent)}<div class="small muted num">${ago(l.started)}</div>` : `<span class="muted">—</span>`;
    };
    return `
      <div class="filters" style="margin-bottom:12px">
        <label class="select"><span>Region</span><select data-ui="custRegion">${opt("all", ui.custRegion, "All regions")}${regions.map((x) => opt(x, ui.custRegion, x)).join("")}</select></label>
        <label class="select"><span>Status</span><select data-ui="custStatus">${opt("all", ui.custStatus, "All statuses")}${statuses.map((x) => opt(x, ui.custStatus, x)).join("")}</select></label>
        <input class="search push" id="cust-search" type="search" aria-label="Search customers" placeholder="Search name or number" value="${esc(ui.custQuery)}">
      </div>
      <div class="card table-card"><div class="table-wrap flat"><table class="conv-table">
        <thead><tr><th>Name</th><th class="hide-sm">Phone</th><th class="hide-sm">Region</th><th>Status</th><th>Last conversation</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-cust="${esc(c.name)}">
          <td><button class="row-link" type="button" data-cust="${esc(c.name)}" aria-label="Open ${esc(c.name)}">${esc(c.name)}</button></td>
          <td class="mono hide-sm">${esc(c.phone)}</td>
          <td class="hide-sm">${esc(c.region)}</td>
          <td>${statusChip(c.status)}</td>
          <td>${last(c)}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">No customers match. <button class="btn ghost" type="button" data-cust-clear>Clear filters</button></td></tr>`}</tbody>
      </table></div></div>`;
  }

  // A sale is a finished purchase attempt: paid by the agent, or not paid. Advice-only conversations are not sales.
  const isSale = (c) => c.status !== "live" && (c.outcome === "purchased" || c.outcome === "not_paid");
  const TIMES = { 1: "Today", 7: "Last 7 days", 30: "Last 30 days" };
  const saleDate = (min) => {
    const d = new Date(Date.now() - min * 60000), days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    if (days === 0) return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
    return days === 1 ? "Yesterday" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };

  function renderSales(s) {
    const q = ui.saleQuery.trim().toLowerCase();
    const all = s.conversations.filter(isSale).sort((a, b) => a.started - b.started);
    const regions = [...new Set(all.map((c) => c.region))].sort();
    const rows = all
      .filter((c) => c.started < Number(ui.saleTime) * DAY)
      .filter((c) => ui.saleRegion === "all" || c.region === ui.saleRegion)
      .filter((c) => ui.salePay === "all" || (ui.salePay === "paid") === (c.outcome === "purchased"))
      .filter((c) => !q || c.customer.toLowerCase().includes(q));
    const paid = rows.filter((c) => c.outcome === "purchased").length;
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    const pay = (c) => c.outcome === "purchased" ? `<span class="chip"><span class="dot ok"></span>Paid by agent</span>` : `<span class="chip"><span class="dot bad"></span>Not paid</span>`;
    return `
      <div class="filters" style="margin-bottom:12px">
        <label class="select"><span>Region</span><select data-ui="saleRegion">${opt("all", ui.saleRegion, "All regions")}${regions.map((x) => opt(x, ui.saleRegion, x)).join("")}</select></label>
        <label class="select"><span>Time</span><select data-ui="saleTime">${Object.entries(TIMES).map(([v, l]) => opt(v, ui.saleTime, l)).join("")}</select></label>
        <label class="select"><span>Payment</span><select data-ui="salePay">${opt("all", ui.salePay, "All payments")}${opt("paid", ui.salePay, "Paid by agent")}${opt("notpaid", ui.salePay, "Not paid")}</select></label>
        <input class="search push" id="sale-search" type="search" aria-label="Search customer" placeholder="Search customer" value="${esc(ui.saleQuery)}">
      </div>
      <p class="small muted" style="margin:0 0 12px">${plural(rows.length, "sale")} · ${paid} paid by agent · ${rows.length - paid} not paid</p>
      <div class="card table-card"><div class="table-wrap flat"><table class="conv-table">
        <thead><tr><th>Customer</th><th class="hide-sm">Item</th><th class="right">Amount</th><th class="hide-sm">Region</th><th class="hide-sm">Date</th><th>Payment</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-conv="${esc(c.id)}">
          <td><button class="row-link" type="button" data-conv="${esc(c.id)}" aria-label="Open sale to ${esc(c.customer)}">${esc(c.customer)}</button><div class="small muted show-sm">${esc(c.item)} · ${saleDate(c.started)}</div></td>
          <td class="hide-sm">${esc(c.item)}</td>
          <td class="right num">${money(c.amount_cents)}</td>
          <td class="hide-sm">${esc(c.region)}</td>
          <td class="hide-sm muted num">${saleDate(c.started)}</td>
          <td>${pay(c)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No sales match. <button class="btn ghost" type="button" data-sale-clear>Clear filters</button></td></tr>`}</tbody>
      </table></div></div>`;
  }

  // ---------- settings (local state only: nothing here is saved) ----------
  const SET_DEFAULTS = { limit: 1000, askOwner: true, handoffAsk: true, fails: "3", voice: true, sms: true, imessage: true, whatsapp: true };
  const setting = (k) => (k in ui.set ? ui.set[k] : k.startsWith("offer:") ? true : SET_DEFAULTS[k]);
  const NOT_SAVED = `<span class="hint">Not saved in demo</span>`, READ_ONLY = `<span class="hint">Read-only in demo</span>`;
  const toggle = (key, label) => `<label class="toggle"><input type="checkbox" data-set="${esc(key)}"${setting(key) ? " checked" : ""}><span class="track" aria-hidden="true"></span><span class="sr-only">${esc(label)}</span><span class="toggle-text">${setting(key) ? "On" : "Off"}</span></label>`;
  const setRow = (title, desc, control, hint) => `<li class="set-row">
    <div class="grow"><div class="title">${title}</div>${desc ? `<div class="small muted">${desc}</div>` : ""}</div>
    <div class="set-control">${control}${hint}</div></li>`;
  const setCard = (title, sub, rows) => `<section class="card"><div class="card-head"><div><h2>${title}</h2><div class="small muted">${sub}</div></div></div><ul class="list">${rows}</ul></section>`;

  const amountText = (d) => d.max_pct != null ? `${d.max_pct}%` : money(d.max_cents, d.max_cents % 100 === 0);
  const offerDesc = (d) => d.added
    ? [`${amountText(d)} off`, d.max_uses ? `up to ${plural(d.max_uses, "use")}` : "", d.requires ? esc(d.requires) : ""].filter(Boolean).join(" · ") + "."
    : `${esc(d.applies_to)}, up to ${amountText(d)}. Needs: ${esc((d.requires || "nothing").toLowerCase())}.`;

  // Add-code form. Values and errors are kept in ui.promoForm so a failed save keeps what was typed.
  function promoForm(f) {
    const err = (k) => f.errors[k] ? `<span class="field-error" id="pf-${k}-err">${icon("alert")}${esc(f.errors[k])}</span>` : "";
    const bad = (k) => f.errors[k] ? ` aria-invalid="true" aria-describedby="pf-${k}-err"` : "";
    return `<form class="promo-form" id="promo-form" novalidate aria-label="Add promo code">
      <div class="pf-field"><label for="pf-code">Code name</label>
        <input id="pf-code" name="code" value="${esc(f.code)}" placeholder="SUMMER25" maxlength="40" autocomplete="off" autocapitalize="characters" spellcheck="false"${bad("code")}>${err("code")}</div>
      <div class="pf-field"><label for="pf-amount">Discount</label>
        <div class="pf-amount">
          <label class="money-input"><span aria-hidden="true" id="pf-unit">${f.kind === "pct" ? "%" : "$"}</span><input id="pf-amount" name="amount" type="number" min="0" step="any" inputmode="decimal" value="${esc(f.amount)}"${bad("amount")}></label>
          <div class="unit-toggle" role="radiogroup" aria-label="Discount type">
            <label><input type="radio" name="kind" value="cents"${f.kind === "cents" ? " checked" : ""}><span>Dollars</span></label>
            <label><input type="radio" name="kind" value="pct"${f.kind === "pct" ? " checked" : ""}><span>Percent</span></label>
          </div></div>${err("amount")}</div>
      <div class="pf-field"><label for="pf-uses">Maximum uses <span class="muted">(optional)</span></label>
        <input id="pf-uses" name="uses" type="number" min="1" step="1" inputmode="numeric" value="${esc(f.uses)}"${bad("uses")}>${err("uses")}</div>
      <div class="pf-field"><label for="pf-requires">Requirement <span class="muted">(optional)</span></label>
        <input id="pf-requires" name="requires" value="${esc(f.requires)}" placeholder="New lines only" maxlength="80" autocomplete="off"></div>
      <div class="pf-actions"><button class="btn primary" type="submit">Add code</button><button class="btn ghost" type="button" data-promo-cancel>Cancel</button><span class="hint">Not saved in demo</span></div>
    </form>`;
  }

  function validatePromo(f, existing) {
    const errors = {}, code = f.code.trim().toUpperCase(), amount = Number(f.amount), uses = f.uses.trim();
    if (!/^[A-Z0-9]{3,20}$/.test(code)) errors.code = "Use 3 to 20 letters or numbers, with no spaces.";
    else if (existing.some((d) => d.code.replace(/_/g, "") === code || d.code === code)) errors.code = `${code} is already in the list.`;
    if (f.amount.trim() === "" || !Number.isFinite(amount) || amount <= 0) errors.amount = "Enter an amount above zero.";
    else if (f.kind === "pct" && amount > 100) errors.amount = "A percent can't be more than 100.";
    if (uses && (!/^\d+$/.test(uses) || Number(uses) < 1)) errors.uses = "Use a whole number of 1 or more, or leave it empty.";
    return errors;
  }

  function renderSettings(s) {
    const offers = s.policy.discounts.map((d) => setRow(
      `<span class="mono">${esc(d.code)}</span>`,
      offerDesc(d),
      `<div class="ctl-row">${toggle(`offer:${d.code}`, `${d.code} offered`)}${d.added ? `<button class="btn ghost" type="button" data-promo-remove="${esc(d.code)}" aria-label="Remove ${esc(d.code)}">Remove</button>` : ""}</div>`, NOT_SAVED)).join("")
      + `<li class="promo-add">${ui.promoForm ? promoForm(ui.promoForm) : `<button class="btn" type="button" data-promo-open>${icon("plus")}Add promo code</button>`}</li>`;
    const spend = setRow("Owner approval limit", "Purchases above this need a text YES from the account owner.",
        `<label class="money-input"><span aria-hidden="true">$</span><input type="number" min="0" step="50" inputmode="numeric" data-set="limit" aria-label="Owner approval limit in dollars" value="${esc(setting("limit"))}"></label>`, NOT_SAVED)
      + setRow("Ask the owner above the limit", "When off, over-limit purchases are declined.", toggle("askOwner", "Ask the owner above the limit"), NOT_SAVED)
      + setRow("How the owner replies", "By text: YES to approve, NO to decline.", `<span class="muted">Text reply</span>`, READ_ONLY);
    const verify = setRow("Verify before account changes", "The agent checks a PIN first, every time.", `<span class="muted">Always on</span>`, READ_ONLY)
      + setRow("Hand off after failed PIN attempts", "Then a person takes the conversation.",
        `<select class="set-select" data-set="fails" aria-label="Failed PIN attempts before handoff">${["2", "3", "5"].map((n) => `<option value="${n}"${setting("fails") === n ? " selected" : ""}>${n} attempts</option>`).join("")}</select>`, NOT_SAVED)
      + setRow("Hand off when asked", "If the customer asks for a person, the agent passes them on.", toggle("handoffAsk", "Hand off when asked"), NOT_SAVED);
    const channels = [["voice", "Voice", "Phone calls"], ["sms", "SMS", "Text messages"], ["imessage", "iMessage", "Messages on Apple devices"], ["whatsapp", "WhatsApp", "Chats on WhatsApp"]]
      .map(([k, name, desc]) => setRow(name, desc, toggle(k, `${name} enabled`), NOT_SAVED)).join("");
    return `<div class="settings">
      ${setCard("Offers and discounts", "The agent can offer only these codes, and never above the maximum.", offers)}
      ${setCard("Spend and approvals", "When the owner has to say yes.", spend)}
      ${setCard("Verification and handoff", "How the agent protects an account and when it steps back.", verify)}
      ${setCard("Channels", "Where customers can reach your Selldial line.", channels)}
    </div>`;
  }

  function renderAbout() {
    const steps = [
      ["Listen and advise", "The agent verifies the caller, then recommends the best option and says why."],
      ["Ask the owner", "A purchase above the spend limit goes to the account owner by text."],
      ["Pay and confirm", "After a YES, checkout runs and a receipt is texted to the customer."],
    ];
    const rules = [
      ["Owner approval", "No purchase above the limit goes through without a text YES."],
      ["Spend limits", "The agent can't pass the household limit or offer a discount outside the policy."],
      ["Audit log", "Every action is recorded: what happened, who did it and why."],
    ];
    return `<div class="about">
      <header class="about-lead">
        <img src="selldial-logo-icon.png" alt="" width="53" height="64">
        <h2 class="about-title">Selldial is an AI phone and text line that helps customers buy easily.</h2>
      </header>
      <section>
        <h3 class="about-h">How a purchase goes</h3>
        <ol class="about-steps">${steps.map(([t, d], i) => `<li class="card"><span class="step-n mono">0${i + 1}</span><b>${t}</b><span class="muted">${d}</span></li>`).join("")}</ol>
      </section>
      <section>
        <h3 class="about-h">Trust rules</h3>
        <ul class="about-rules card">${rules.map(([t, d]) => `<li><b>${t}</b><span class="muted">${d}</span></li>`).join("")}</ul>
      </section>
      <p class="about-note small muted">Demo data only. All customers and payments are synthetic.</p>
    </div>`;
  }

  // ---------- drawers ----------
  let drawerOpener = null;
  function showDrawer(html, opener) {
    $("#drawer").innerHTML = html;
    if (!$("#drawer").classList.contains("open")) drawerOpener = opener || document.activeElement;
    $("#drawer").classList.add("open");
    $("#drawer").inert = false;
    $("#drawer-backdrop").hidden = false;
    $("#drawer-close").focus();
  }
  const drawerHead = (title, sub, back) => `<div class="drawer-head"><div class="row">
    ${back ? `<button class="btn ghost icon-btn" type="button" data-cust="${esc(back)}" aria-label="Back to ${esc(back)}">${icon("back")}</button>` : ""}
    <div class="grow"><h2 class="title" id="drawer-title" style="font-size:17px;margin:0">${esc(title)}</h2><div class="small muted">${sub}</div></div>
    <button class="btn ghost icon-btn" id="drawer-close" type="button" data-close aria-label="Close">${icon("close")}</button></div></div>`;

  function openConversation(id, opener, from) {
    const s = api.state, c = s.conversations.find((x) => x.id === id);
    if (!c || c.status === "live") return toast("That conversation isn't in this snapshot.");
    const r = c.recommendation, o = outcomeOf(c);
    const ap = s.approvals.find((a) => a.conversation === c.id);
    const h = s.handoffs.find((x) => x.conversation === c.id);
    const ask = c.events.find((e) => e.kind === "customer");
    const talk = c.events.filter((e) => e.kind === "customer" || e.kind === "agent");
    const apText = ap && {
      texted: `Waiting for the owner, ${ap.owner}, to reply YES. Texted ${ago(ap.sent)}.`,
      approved: `The owner, ${ap.owner}, approved it.`,
      declined: `The owner, ${ap.owner}, declined it.`,
      cancelled: "Cancelled before the owner replied.",
    }[ap.status];
    const advice = r
      ? `<div class="pick">${esc(r.pick)}</div>
         <ul class="why">${(r.reasons || [r.reason]).slice(0, 3).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
         <div class="small muted"><b>Runner-up:</b> ${esc(r.runner_up)}</div>`
      : `<div>The agent made no recommendation.</div>${h ? `<div class="small muted">${esc(h.reason)}. ${h.claimed_by ? `Claimed by ${esc(h.claimed_by)}.` : "Waiting for a person."}</div>` : ""}`;
    const sec = (label, body) => `<section class="report-sec"><p class="section-label">${label}</p>${body}</section>`;
    showDrawer(`${drawerHead(c.customer, `${channelKind(c)} · ${ago(c.started)}`, from)}
      <div class="drawer-body">
        <section class="report-head">${outcomeChip(c)}<p>${esc(c.summary || c.intent)}</p></section>
        ${sec("What the customer wanted", `<div class="title">${esc(c.intent)}</div>${ask ? `<div class="small muted">“${esc(ask.text)}”</div>` : ""}`)}
        ${sec("What the agent recommended", advice)}
        ${sec("Payment", `<div class="row-head"><span class="title">${o === "paid" ? "Paid by agent" : "Not paid"}</span>${c.amount_cents != null ? `<span class="num">${money(c.amount_cents)}</span><span class="chip">Mock</span>` : `<span class="muted">No purchase attempted</span>`}</div>`)}
        ${ap ? sec("Owner approval", `<div>${esc(apText)}</div><div class="small muted">${money(ap.amount_cents)} is over the ${money(ap.limit_cents)} limit.</div>`) : ""}
        <details class="transcript-box"><summary>Transcript <span class="muted">${plural(talk.length, "message")}</span></summary>
          <div class="transcript">${talk.map((e) => `<div class="ev ${e.kind}"><div class="time">${ago(e.t)}</div><div class="bubble">${esc(e.text)}</div></div>`).join("")}</div>
        </details>
      </div>`, opener);
    markSelected(from || c.id);
  }

  function markSelected(id) {
    document.querySelectorAll("tr[data-conv], tr[data-cust]").forEach((tr) => tr.classList.toggle("selected", (tr.dataset.conv || tr.dataset.cust) === id));
  }

  function openCustomer(name, opener) {
    const s = api.state, c = (s.customers || []).find((x) => x.name === name);
    if (!c) return;
    const convs = custConvs(s, c.name);
    showDrawer(`${drawerHead(c.name, "Customer")}
      <div class="drawer-body">
        <div class="meta cust">
          <div><span>Number</span><span class="mono">${esc(c.phone)}</span></div>
          <div><span>Region</span>${esc(c.region)}</div>
          <div><span>Status</span>${statusChip(c.status)}</div>
        </div>
        <section class="report-sec"><p class="section-label">Conversations</p>
          ${convs.length ? `<ul class="list">${convs.map((x) => `<li><button class="conv-pick" type="button" data-conv="${esc(x.id)}" data-from="${esc(c.name)}" aria-label="Open ${esc(x.intent)}">
            <span class="grow"><span class="title">${esc(x.intent)}</span><span class="small muted">${channelKind(x)} · ${ago(x.started)}</span></span>${outcomeChip(x)}</button></li>`).join("")}</ul>` : `<div class="muted">No finished conversations yet.</div>`}
        </section>
      </div>`, opener);
    markSelected(c.name);
  }

  function closeDrawer() {
    if (!$("#drawer").classList.contains("open")) return;
    $("#drawer").classList.remove("open");
    $("#drawer").inert = true;
    $("#drawer-backdrop").hidden = true;
    markSelected(null);
    if (drawerOpener?.isConnected) drawerOpener.focus();
    drawerOpener = null;
  }

  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => (t.hidden = true), 2400);
  }

  // ---------- shell ----------
  const current = () => { const v = location.hash.replace("#/", ""); return VIEWS[v] ? v : "home"; };

  function render() {
    const s = api.state, v = current(), k = stats(s), view = VIEWS[v];
    const counts = { home: k.review.length };
    $("#nav").innerHTML = Object.entries(VIEWS).map(([key, x]) => `
      <button class="nav-link" data-go="${key}" ${key === v ? 'aria-current="page"' : ""}>
        <span>${x.label}</span>${counts[key] ? `<span class="badge">${counts[key]}</span>` : ""}
      </button>`).join("");
    $("#view-title").textContent = view.title ? view.title() : view.label;
    $("#avatar").textContent = profile().name.trim().charAt(0).toUpperCase();
    $("#view").innerHTML = view.render(s);
    document.title = `${view.label} · Selldial`;
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-go],[data-close],[data-conv],[data-cust],[data-conv-clear],[data-cust-clear],[data-sale-clear],[data-promo-open],[data-promo-cancel],[data-promo-remove]");
    if (!el) return;
    const d = el.dataset;
    const opener = el.matches("tr") ? el.querySelector(".row-link") || el : el;
    try {
      if ("close" in d) closeDrawer();
      else if (d.go) location.hash = `#/${d.go}`;
      else if ("convClear" in d) { ui.convOutcome = "all"; ui.convQuery = ""; render(); }
      else if ("saleClear" in d) { ui.saleRegion = "all"; ui.saleTime = "30"; ui.salePay = "all"; ui.saleQuery = ""; render(); }
      else if ("custClear" in d) { ui.custRegion = "all"; ui.custStatus = "all"; ui.custQuery = ""; render(); }
      else if ("promoOpen" in d) { ui.promoForm = { code: "", kind: "cents", amount: "", uses: "", requires: "", errors: {} }; render(); $("#pf-code").focus(); }
      else if ("promoCancel" in d) { ui.promoForm = null; render(); $("[data-promo-open]").focus(); }
      else if (d.promoRemove) {
        await api.removePromo(d.promoRemove);
        delete ui.set[`offer:${d.promoRemove}`];
        render(); toast(`Removed ${d.promoRemove}`); $("[data-promo-open]").focus();
      }
      else if (d.cust) openCustomer(d.cust, opener);
      else if (d.conv) openConversation(d.conv, opener, d.from);
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id !== "promo-form") return;
    const d = Object.fromEntries(new FormData(e.target));
    const f = { code: d.code, kind: d.kind, amount: d.amount, uses: d.uses, requires: d.requires.trim() };
    const errors = validatePromo(f, api.state.policy.discounts);
    if (Object.keys(errors).length) {
      ui.promoForm = { ...f, errors };
      render();
      return $(`#pf-${Object.keys(errors)[0]}`).focus();
    }
    const code = f.code.trim().toUpperCase();
    try {
      await api.savePromo({ code, added: true, applies_to: "", requires: f.requires,
        max_pct: f.kind === "pct" ? Number(f.amount) : null, max_cents: f.kind === "cents" ? Math.round(Number(f.amount) * 100) : null,
        max_uses: f.uses.trim() ? Number(f.uses) : null });
      ui.promoForm = null;
      render(); toast(`${code} added to this list. Not saved in demo.`); $("[data-promo-open]").focus();
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "kind" && ui.promoForm) { ui.promoForm.kind = t.value; $("#pf-unit").textContent = t.value === "pct" ? "%" : "$"; }
    if (t.dataset.ui) { ui[t.dataset.ui] = t.value; render(); $(`[data-ui="${t.dataset.ui}"]`)?.focus(); }
    if (t.dataset.set) {
      ui.set[t.dataset.set] = t.type === "checkbox" ? t.checked : t.type === "number" ? Math.max(0, Number(t.value) || 0) : t.value;
      if (t.type === "checkbox") t.closest(".toggle").querySelector(".toggle-text").textContent = t.checked ? "On" : "Off";
    }
  });

  document.addEventListener("input", (e) => {
    const map = { "conv-search": "convQuery", "cust-search": "custQuery", "sale-search": "saleQuery" };
    const id = e.target.id;
    if (!map[id]) return;
    const pos = e.target.selectionStart;
    ui[map[id]] = e.target.value;
    render();
    const el = $(`#${id}`);
    el.focus();
    el.setSelectionRange(pos, pos);
  });

  $("#drawer-backdrop").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") return closeDrawer();
    if (e.key !== "Tab" || !$("#drawer").classList.contains("open")) return;
    const focusable = [...$("#drawer").querySelectorAll("button, [href], input, [tabindex]:not([tabindex='-1'])")];
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener("hashchange", () => { closeDrawer(); render(); });

  const byRecent = (s) => s.conversations.sort((a, b) => a.started - b.started);
  api.load().then(() => { byRecent(api.state); render(); });
})();
