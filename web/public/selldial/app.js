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
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 7v5l3 2"/>',
    home: '<path d="M3 11.5 12 4l9 7.5M5.5 10v10h13V10"/>',
    chat: '<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.7a3.5 3.5 0 0 1 0 6.6M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/>',
    sales: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 11v5M12 8h.01"/>',
    msg: '<rect x="3" y="5" width="18" height="12" rx="3"/><path d="M8 21l3-4"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  };
  const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  const NAV_ICON = { home: "home", conversations: "chat", customers: "users", sales: "sales", settings: "gear", about: "info" };
  const initials = (name) => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const avatar = (name) => `<span class="ava ${[...String(name)].reduce((n, ch) => n + ch.charCodeAt(0), 0) % 3 === 0 ? "v" : ""}" aria-hidden="true">${esc(initials(name))}</span>`;
  const via = (c) => `<span class="via">${icon(c.channel === "voice" ? "phone" : "msg")}${channelKind(c)}</span>`;

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
  const statusChip = (st) => `<span class="chip"><span class="dot ${["Active", "Loyal"].includes(st) ? "ok" : st === "At risk" ? "bad" : "off"}"></span>${esc(st)}</span>`;

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
  const ui = { convOutcome: "all", convQuery: "", saleTab: "list", saleRegion: "all", saleTime: "30", salePay: "all", saleQuery: "", custQuery: "", custRegion: "all", custStatus: "all", set: {}, promoForm: null };

  function convRow(c) {
    return `<tr class="clickable" data-conv="${esc(c.id)}">
      <td><span class="who">${avatar(c.customer)}<button class="row-link" type="button" data-conv="${esc(c.id)}" aria-label="Open conversation with ${esc(c.customer)}">${esc(c.customer)}</button></span></td>
      <td class="muted hide-sm">${via(c)}</td>
      <td>${esc(c.intent)}</td>
      <td>${outcomeChip(c)}</td>
      <td class="right"><span class="t-mono">${ago(c.started)}</span></td>
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

  const arrowLink = (label, attrs, aria = "") => `<button class="link-btn" type="button" ${attrs} ${aria ? `aria-label="${esc(aria)}"` : ""}>${label}${icon("arrow")}</button>`;

  function reviewRow(s, c) {
    return `<li class="line review-line">
      <div class="line-who">${avatar(c.customer)}<div class="line-main">
        <div class="row-head"><span class="title">${esc(c.customer)}</span><span class="chip"><span class="dot bad"></span>${reviewKind(c)}</span></div>
        <div class="small muted">${esc(reviewReason(s, c))}</div>
      </div></div>
      <div class="line-side stack"><span class="t-mono">${ago(c.started)}</span>${arrowLink("Open", `data-conv="${esc(c.id)}"`, `Open conversation with ${c.customer}`)}</div>
    </li>`;
  }

  function recentRow(c) {
    return `<li class="line"><button class="line-btn" type="button" data-conv="${esc(c.id)}" aria-label="Open conversation with ${esc(c.customer)}">
      <span class="line-who">${avatar(c.customer)}<span class="line-main"><span class="title">${esc(c.customer)}</span><span class="small muted">${esc(c.intent)} · ${via(c)}</span></span></span>
      <span class="line-side stack">${outcomeChip(c)}<span class="t-mono">${ago(c.started)}</span></span>
    </button></li>`;
  }

  function renderHome(s) {
    const k = stats(s);
    const hour = new Date().getHours();
    const hello = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    const recent = s.conversations.filter((c) => c.status !== "live").slice(0, 5);
    const n = k.review.length;
    const lead = n ? `<em>${plural(n, "conversation")}</em> ${n === 1 ? "needs" : "need"} you.` : "Nothing needs you.";
    const figure = (label, value, cls, dot, note) => `<div><dt><span class="dot ${dot}"></span>${label}</dt><dd class="num ${cls}">${value}${note ? `<small>${note}</small>` : ""}</dd></div>`;
    return `
      <section class="hero">
        <p class="eyebrow">${hello}, ${esc(profile().name)} <span aria-hidden="true">·</span> ${today}</p>
        <h2 class="hero-line">${lead} <span>${money(k.paidCents)} paid by the agent today.</span></h2>
        <dl class="figures card">
          ${figure("Calls handled", k.handled, "", "", "today")}${figure("Sales paid", k.paid, "accent", "", money(k.paidCents))}${figure("Not paid", k.notPaid, "bad", "bad", "after a purchase attempt")}${figure("Saved for customers", money(k.saved), "save", "ok", "from advice and offers")}
        </dl>
        ${k.live ? `<p class="active-line small">${icon("phone")}<b>Active now</b><span class="muted">${esc(k.live.customer)} is on a ${esc(CHANNEL[k.live.channel] === "Voice" ? "call" : "text thread")} about ${esc(k.live.intent.charAt(0).toLowerCase() + k.live.intent.slice(1))}.</span></p>` : ""}
      </section>
      <div class="home-cols">
        <section class="block">
          <header class="block-head"><h2>Needs review</h2><span class="tally">${n}</span></header>
          <div class="card panel-list">${n ? `<ul class="lines">${k.review.map((c) => reviewRow(s, c)).join("")}</ul>` : `<p class="empty">Nothing needs review. Every call went well.</p>`}</div>
        </section>
        <section class="block">
          <header class="block-head"><h2>Recent conversations</h2>${arrowLink("View all", 'data-go="conversations"')}</header>
          <div class="card panel-list"><ul class="lines">${recent.map(recentRow).join("")}</ul></div>
        </section>
      </div>`;
  }

  const filterConvs = (s) => {
    const q = ui.convQuery.trim().toLowerCase();
    return s.conversations
      .filter((c) => c.status !== "live")
      .filter((c) => ui.convOutcome === "all" || outcomeOf(c) === ui.convOutcome)
      .filter((c) => !q || [c.customer, c.intent].join(" ").toLowerCase().includes(q));
  };

  function renderConversations(s) {
    const rows = filterConvs(s);
    const opt = (v, label) => `<option value="${v}"${v === ui.convOutcome ? " selected" : ""}>${label}</option>`;
    return `
      <div class="filters toolbar">
        <label class="select"><span>Outcome</span><select data-ui="convOutcome">${opt("all", "All outcomes")}${Object.entries(OUTCOMES).map(([v, l]) => opt(v, l)).join("")}</select></label>
        <input class="search push" id="conv-search" type="search" aria-label="Search conversations" placeholder="Search customer or topic" value="${esc(ui.convQuery)}">
      </div>
      <p class="count-line"><span class="tally">${rows.length}</span> ${rows.length === 1 ? "conversation" : "conversations"}, most recent first</p>
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
      return l ? `${esc(l.intent)}<div class="t-mono">${ago(l.started)}</div>` : `<span class="muted">—</span>`;
    };
    return `
      <div class="filters toolbar">
        <label class="select"><span>Region</span><select data-ui="custRegion">${opt("all", ui.custRegion, "All regions")}${regions.map((x) => opt(x, ui.custRegion, x)).join("")}</select></label>
        <label class="select"><span>Status</span><select data-ui="custStatus">${opt("all", ui.custStatus, "All statuses")}${statuses.map((x) => opt(x, ui.custStatus, x)).join("")}</select></label>
        <input class="search push" id="cust-search" type="search" aria-label="Search customers" placeholder="Search name or number" value="${esc(ui.custQuery)}">
      </div>
      <p class="count-line"><span class="tally">${rows.length}</span> ${rows.length === 1 ? "customer" : "customers"}, most recent first</p>
      <div class="card table-card"><div class="table-wrap flat"><table class="conv-table">
        <thead><tr><th>Name</th><th class="hide-sm">Phone</th><th class="hide-sm">Region</th><th>Status</th><th>Last conversation</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-cust="${esc(c.id ?? c.name)}">
          <td><span class="who">${avatar(c.name)}<button class="row-link" type="button" data-cust="${esc(c.id ?? c.name)}" aria-label="Open ${esc(c.name)}">${esc(c.name)}</button></span></td>
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

  // Region and time narrow both tabs, so the list and the charts always count the same sales.
  const salesInScope = (s) => s.conversations.filter(isSale).sort((a, b) => a.started - b.started)
    .filter((c) => c.started < Number(ui.saleTime) * DAY)
    .filter((c) => ui.saleRegion === "all" || c.region === ui.saleRegion);
  const isPaid = (c) => c.outcome === "purchased";
  const optHtml = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;

  function renderSales(s) {
    const scope = salesInScope(s);
    const regions = [...new Set(s.conversations.filter(isSale).map((c) => c.region))].sort();
    const list = ui.saleTab === "list";
    const tab = (id, label) => `<button class="tab" type="button" role="tab" id="tab-${id}" data-sale-tab="${id}" aria-selected="${ui.saleTab === id}" aria-controls="sale-panel"${ui.saleTab === id ? "" : ' tabindex="-1"'}>${label}</button>`;
    return `
      <div class="tabs" role="tablist" aria-label="Sales views">${tab("list", "Sales")}${tab("analytics", "Analytics")}</div>
      <div class="filters toolbar">
        <label class="select"><span>Region</span><select data-ui="saleRegion">${optHtml("all", ui.saleRegion, "All regions")}${regions.map((x) => optHtml(x, ui.saleRegion, x)).join("")}</select></label>
        <label class="select"><span>Time</span><select data-ui="saleTime">${Object.entries(TIMES).map(([v, l]) => optHtml(v, ui.saleTime, l)).join("")}</select></label>
        ${list ? `<label class="select"><span>Payment</span><select data-ui="salePay">${optHtml("all", ui.salePay, "All payments")}${optHtml("paid", ui.salePay, "Paid by agent")}${optHtml("notpaid", ui.salePay, "Not paid")}</select></label>
        <input class="search push" id="sale-search" type="search" aria-label="Search customer" placeholder="Search customer" value="${esc(ui.saleQuery)}">` : ""}
      </div>
      <div id="sale-panel" role="tabpanel" aria-labelledby="tab-${ui.saleTab}">${list ? renderSaleList(scope) : renderAnalytics(scope)}</div>`;
  }

  function renderSaleList(scope) {
    const q = ui.saleQuery.trim().toLowerCase();
    const rows = scope
      .filter((c) => ui.salePay === "all" || (ui.salePay === "paid") === isPaid(c))
      .filter((c) => !q || c.customer.toLowerCase().includes(q));
    const paid = rows.filter(isPaid).length;
    const pay = (c) => isPaid(c) ? `<span class="chip"><span class="dot ok"></span>Paid by agent</span>` : `<span class="chip"><span class="dot bad"></span>Not paid</span>`;
    return `
      <dl class="mini-figs">
        <div><dt>Sales</dt><dd>${rows.length}</dd></div>
        <div><dt><span class="dot ok"></span>Paid by agent</dt><dd class="accent">${paid}</dd></div>
        <div><dt><span class="dot bad"></span>Not paid</dt><dd>${rows.length - paid}</dd></div>
        <div><dt>Paid total</dt><dd class="mono accent">${money(sumCents(rows.filter(isPaid)))}</dd></div>
      </dl>
      <div class="card table-card"><div class="table-wrap flat"><table class="conv-table">
        <thead><tr><th>Customer</th><th class="hide-sm">Item</th><th class="right">Amount</th><th class="hide-sm">Region</th><th class="hide-sm">Date</th><th>Payment</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-conv="${esc(c.id)}">
          <td><span class="who">${avatar(c.customer)}<span><button class="row-link" type="button" data-conv="${esc(c.id)}" aria-label="Open sale to ${esc(c.customer)}">${esc(c.customer)}</button><div class="small muted show-sm">${esc(c.item)} · ${saleDate(c.started)}</div></span></span></td>
          <td class="hide-sm">${esc(c.item)}</td>
          <td class="right money">${money(c.amount_cents)}</td>
          <td class="hide-sm">${esc(c.region)}</td>
          <td class="hide-sm"><span class="t-mono">${saleDate(c.started)}</span></td>
          <td>${pay(c)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">No sales match. <button class="btn ghost" type="button" data-sale-clear>Clear filters</button></td></tr>`}</tbody>
      </table></div></div>`;
  }

  // ---------- analytics: plain SVG and CSS, counted from the same sales as the list ----------
  const chartBlock = (title, takeaway, body) => `<section class="chart card"><h3>${title}</h3><p class="small muted">${takeaway}</p>${body}</section>`;
  const sumCents = (rows) => rows.reduce((n, c) => n + (c.amount_cents || 0), 0);
  const group = (rows, key) => rows.reduce((m, c) => ((m[key(c)] ||= []).push(c), m), {});
  const hbars = (items) => { // items: [{label, value, note}]; bar width is relative to the largest
    const max = Math.max(...items.map((i) => i.value), 1);
    return `<ul class="hbars">${items.map((i) => `<li><span class="hb-label">${esc(i.label)}</span><span class="hb-track"><span class="hb-fill" style="width:${Math.max(2, (i.value / max) * 100)}%"></span></span><span class="hb-note">${i.note}</span></li>`).join("")}</ul>`;
  };

  function renderAnalytics(rows) {
    if (!rows.length) return `<p class="empty">No sales in this range. <button class="btn ghost" type="button" data-sale-clear>Clear filters</button></p>`;
    const days = Number(ui.saleTime), paid = rows.filter(isPaid), notPaid = rows.length - paid.length;
    const span = days === 1 ? "the last 24 hours" : `the last ${days} days`;

    // 1. Sales per day (per hour when the range is one day), paid and not paid stacked.
    const unit = days === 1 ? 60 : DAY, n = days === 1 ? 24 : days, W = 20, H = 150;
    const buckets = Array.from({ length: n }, () => ({ paid: 0, notPaid: 0 }));
    rows.forEach((c) => { buckets[n - 1 - Math.floor(c.started / unit)][isPaid(c) ? "paid" : "notPaid"]++; });
    const top = Math.max(...buckets.map((b) => b.paid + b.notPaid), 1);
    const busiest = buckets.reduce((m, b, i) => (b.paid + b.notPaid > m.t ? { i, t: b.paid + b.notPaid } : m), { i: 0, t: 0 });
    const bucketName = (i) => {
      const ago = n - 1 - i;
      if (days === 1) return ago ? `${ago}h ago` : "the last hour";
      return ago === 0 ? "today" : new Date(Date.now() - ago * DAY * 60000).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    };
    const bars = buckets.map((b, i) => {
      const hp = (b.paid / top) * H, hn = (b.notPaid / top) * H, x = i * W + 3;
      return `<g><title>${bucketName(i)}: ${b.paid} paid, ${b.notPaid} not paid</title><rect x="${x}" y="0" width="14" height="${H}" fill="transparent"/>${b.paid ? `<rect x="${x}" y="${H - hp}" width="14" height="${hp}" fill="var(--ok)"/>` : ""}${b.notPaid ? `<rect x="${x}" y="${H - hp - hn}" width="14" height="${hn}" fill="var(--bad)"/>` : ""}</g>`;
    }).join("");
    const grid = Array.from({ length: top }, (_, k) => { const y = H - ((k + 1) / top) * H; return `<line x1="0" x2="${n * W}" y1="${y}" y2="${y}" stroke="var(--line)" stroke-width="1" vector-effect="non-scaling-stroke"/>`; }).join("");
    const perDay = chartBlock(days === 1 ? "Sales per hour" : "Sales per day",
      `${paid.length} paid by agent and ${notPaid} not paid in ${span}. Busiest ${days === 1 ? "hour" : "day"}: ${bucketName(busiest.i)}, ${plural(busiest.t, "sale")}.`,
      `<svg class="bars-svg" viewBox="0 0 ${n * W} ${H}" preserveAspectRatio="none" role="img" aria-label="Paid and not paid sales per ${days === 1 ? "hour" : "day"}">${grid}${bars}<line x1="0" x2="${n * W}" y1="${H}" y2="${H}" stroke="var(--color-muted)" stroke-width="1" vector-effect="non-scaling-stroke"/></svg>
      <div class="axis small muted"><span>${days === 1 ? "24h ago" : `${days} days ago`}</span><span>${days === 1 ? "Now" : "Today"}</span></div>
      <div class="legend small"><span><span class="dot ok"></span>Paid by agent</span><span><span class="dot bad"></span>Not paid</span><span class="muted">Grid lines: 1 sale each</span></div>`);

    // 2. Revenue paid by the agent, by region.
    const byRegion = Object.entries(group(paid, (c) => c.region)).map(([r, cs]) => ({ label: r, cents: sumCents(cs) })).sort((a, b) => b.cents - a.cents);
    const revenue = chartBlock("Revenue by region",
      !byRegion.length ? "Nothing was paid by the agent in this range."
        : byRegion.length === 1 ? `The agent was paid ${money(byRegion[0].cents)} in ${byRegion[0].label}.`
        : `${byRegion[0].label} brings in the most: ${money(byRegion[0].cents)} of ${money(sumCents(paid))} paid by the agent.`,
      byRegion.length ? hbars(byRegion.map((r) => ({ label: r.label, value: r.cents, note: `<span class="mono">${money(r.cents)}</span>` }))) : "");

    // 3. Payment rate: paid / attempted, with a small trend across the range.
    const pct = (x) => `${Math.round(x * 100)}%`;
    const size = days === 30 ? 6 : 1, count = days === 1 ? 0 : Math.ceil(days / size);
    const pts = Array.from({ length: count }, (_, i) => rows.filter((c) => Math.floor(c.started / (size * DAY)) === count - 1 - i))
      .map((cs) => cs.length ? cs.filter(isPaid).length / cs.length : null);
    const real = pts.map((v, i) => ({ v, i })).filter((p) => p.v != null);
    let trend = `<p class="small muted">Pick a longer range to see a trend.</p>`, note = "";
    if (real.length >= 2) {
      const x = (i) => 4 + (i / Math.max(count - 1, 1)) * 152, y = (v) => 4 + (1 - v) * 40;
      const line = real.map((p) => `${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" "), end = real[real.length - 1];
      trend = `<svg class="spark" viewBox="0 0 160 48" role="img" aria-label="Payment rate over time, from ${pct(real[0].v)} to ${pct(end.v)}"><polyline points="${line}" fill="none" stroke="var(--color-accent)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(end.i).toFixed(1)}" cy="${y(end.v).toFixed(1)}" r="4" fill="var(--color-accent)"/></svg>`;
      const d = Math.round((end.v - real[0].v) * 100);
      note = d === 0 ? "about the same as at the start of the range" : `${d > 0 ? "up" : "down"} ${Math.abs(d)} points since the start of the range`;
    }
    const payRate = chartBlock("Payment rate",
      `${paid.length} of ${plural(rows.length, "attempted sale")} ${paid.length === 1 ? "was" : "were"} paid by the agent${note ? `, ${note}` : ""}.`,
      `<div class="rate"><span class="rate-fig">${pct(paid.length / rows.length)}</span>${trend}</div>
      <div class="split-bar" role="img" aria-label="${paid.length} paid, ${notPaid} not paid"><span class="ok" style="flex:${paid.length}"></span><span class="bad" style="flex:${notPaid}"></span></div>
      <div class="legend small"><span><span class="dot ok"></span>${paid.length} paid by agent</span><span><span class="dot bad"></span>${notPaid} not paid</span></div>`);

    // 4. Top items sold: paid sales, ranked by revenue.
    const items = Object.entries(group(paid, (c) => c.item)).map(([item, cs]) => ({ item, n: cs.length, cents: sumCents(cs) })).sort((a, b) => b.cents - a.cents || b.n - a.n).slice(0, 5);
    const topItems = chartBlock("Top items sold",
      items.length ? `${items[0].item} leads with ${money(items[0].cents)} from ${plural(items[0].n, "sale")}.` : "Nothing was paid by the agent in this range.",
      items.length ? hbars(items.map((i) => ({ label: i.item, value: i.cents, note: `<span class="mono">${money(i.cents)}</span> <span class="muted">· ${i.n}</span>` }))) : "");

    return `<div class="analytics">${perDay}${revenue}${payRate}${topItems}</div>`;
  }

  // ---------- settings (local state only: nothing here is saved) ----------
  const SET_DEFAULTS = { limit: 1500, askOwner: true, handoffAsk: true, fails: "3", voice: true, sms: true, imessage: true, whatsapp: true };
  const setting = (k) => (k in ui.set ? ui.set[k] : k.startsWith("offer:") ? true : SET_DEFAULTS[k]);
  const toggle = (key, label) => `<label class="toggle"><input type="checkbox" data-set="${esc(key)}"${setting(key) ? " checked" : ""}><span class="track" aria-hidden="true"></span><span class="sr-only">${esc(label)}</span><span class="toggle-text">${setting(key) ? "On" : "Off"}</span></label>`;
  const setRow = (title, desc, control) => `<li class="set-row">
    <div class="grow"><div class="title">${title}</div>${desc ? `<div class="small muted">${desc}</div>` : ""}</div>
    <div class="set-control">${control}</div></li>`;
  const setCard = (title, sub, rows) => `<section class="block"><header class="block-head"><h2>${title}</h2></header><p class="small muted set-sub">${sub}</p><div class="card panel-list"><ul class="lines">${rows}</ul></div></section>`;

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
      <div class="pf-actions"><button class="btn primary" type="submit">Add code</button><button class="btn ghost" type="button" data-promo-cancel>Cancel</button></div>
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
      `<div class="ctl-row">${toggle(`offer:${d.code}`, `${d.code} offered`)}${d.added ? `<button class="btn ghost" type="button" data-promo-remove="${esc(d.code)}" aria-label="Remove ${esc(d.code)}">Remove</button>` : ""}</div>`)).join("")
      + `<li class="promo-add">${ui.promoForm ? promoForm(ui.promoForm) : `<button class="btn" type="button" data-promo-open>${icon("plus")}Add promo code</button>`}</li>`;
    const spend = setRow("Owner approval limit", "Purchases above this need a text YES from the account owner.",
        `<label class="money-input"><span aria-hidden="true">$</span><input type="number" min="0" step="50" inputmode="numeric" data-set="limit" aria-label="Owner approval limit in dollars" value="${esc(setting("limit"))}"></label>`)
      + setRow("Ask the owner above the limit", "When off, over-limit purchases are declined.", toggle("askOwner", "Ask the owner above the limit"))
      + setRow("How the owner replies", "By text: YES to approve, NO to decline.", `<span class="muted">Text reply</span>`);
    const verify = setRow("Verify before account changes", "The agent checks a PIN first, every time.", `<span class="muted">Always on</span>`)
      + setRow("Hand off after failed PIN attempts", "Then a person takes the conversation.",
        `<select class="set-select" data-set="fails" aria-label="Failed PIN attempts before handoff">${["2", "3", "5"].map((n) => `<option value="${n}"${setting("fails") === n ? " selected" : ""}>${n} attempts</option>`).join("")}</select>`)
      + setRow("Hand off when asked", "If the customer asks for a person, the agent passes them on.", toggle("handoffAsk", "Hand off when asked"));
    const channels = [["voice", "Voice", "Phone calls"], ["sms", "SMS", "Text messages"], ["imessage", "iMessage", "Messages on Apple devices"], ["whatsapp", "WhatsApp", "Chats on WhatsApp"]]
      .map(([k, name, desc]) => setRow(name, desc, toggle(k, `${name} enabled`))).join("");
    const theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const appearance = setRow("Theme", "Saved in this browser only.",
      `<div class="unit-toggle" role="radiogroup" aria-label="Theme">${["dark", "light"].map((v) => `<label><input type="radio" name="theme" value="${v}"${theme === v ? " checked" : ""}><span>${cap(v)}</span></label>`).join("")}</div>`);
    return `<div class="settings">
      <p class="set-note small">${icon("alert")}${api.mode === "live" ? "Promo codes you add or remove are saved. Switches and limits on this page are not saved yet." : "Offer, approval and channel changes are not saved in this demo."}</p>
      ${setCard("Appearance", "How the console looks on this device.", appearance)}
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
      ["Owner approval", "No purchase above $1,500 goes through without a text YES from the account owner."],
      ["Spend limits", "The agent can't pass the household limit or offer a discount outside the policy."],
      ["Audit log", "Every action is recorded: what happened, who did it and why."],
    ];
    return `<div class="about">
      <header class="about-lead">
        <img src="selldial-logo-icon.png" alt="" width="66" height="80">
        <div><h2 class="about-title">An AI phone and text line that helps customers <em>buy easily.</em></h2></div>
      </header>
      <section>
        <h3 class="about-h">How a purchase goes</h3>
        <ol class="about-steps">${steps.map(([t, d], i) => `<li><span class="step-n">0${i + 1}</span><b>${t}</b><span class="muted">${d}</span></li>`).join("")}</ol>
      </section>
      <section>
        <h3 class="about-h">Trust rules</h3>
        <ul class="about-rules">${rules.map(([t, d]) => `<li><b>${t}</b><span class="muted">${d}</span></li>`).join("")}</ul>
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
    ${avatar(title)}<div class="grow"><h2 class="title" id="drawer-title" style="font-size:17px;margin:0">${esc(title)}</h2><div class="small muted">${sub}</div></div>
    <button class="btn ghost icon-btn" id="drawer-close" type="button" data-close aria-label="Close">${icon("close")}</button></div></div>`;

  // The conversations an operator can step through: the customer's own when opened from a customer, otherwise the Conversations list as filtered.
  function reportList(s, id, from) {
    if (from) return custConvs(s, from);
    const list = filterConvs(s);
    return list.some((c) => c.id === id) ? list : s.conversations.filter((c) => c.status !== "live");
  }

  // The report is the transcript: what the customer and the agent (or owner) actually said.
  // Decision steps, recommendations and tool/guardrail events are left out for now; they are still in the snapshot.
  const talkOf = (c) => c.events.filter((e) => e.kind === "customer" || e.kind === "agent" || e.kind === "owner");
  const transcriptHtml = (talk) => talk.length
    ? talk.map((e) => `<div class="ev ${e.kind}"><div class="time">${ago(e.t)}</div><div class="bubble">${esc(e.text)}</div></div>`).join("")
    : `<p class="empty">No messages yet.</p>`;
  let openConvId = null;

  function openConversation(id, opener, from, step) {
    const s = api.state, c = s.conversations.find((x) => x.id === id);
    if (!c || c.status === "live") return toast("That conversation isn't in this snapshot.");
    const talk = talkOf(c);
    openConvId = c.id;
    const list = reportList(s, c.id, from), at = list.findIndex((x) => x.id === c.id);
    const go = (dir, label, ic) => {
      const t = list[at + dir];
      return `<button class="btn ghost" type="button" ${t ? `data-conv="${esc(t.id)}" ${from ? `data-from="${esc(from)}"` : ""} data-step="${dir > 0 ? "next" : "prev"}"` : "disabled"}>${dir < 0 ? icon("back") : ""}${label}${dir > 0 ? icon("arrow") : ""}</button>`;
    };
    showDrawer(`${drawerHead(c.customer, `${channelKind(c)} · ${ago(c.started)}`, from)}
      <div class="drawer-body">
        <section class="report-head"><p class="section-label">Summary</p><p class="summary">${esc(c.summary || c.intent)}</p></section>
        <section class="transcript-main" aria-label="Transcript">
          <p class="section-label">Transcript <span class="muted">${plural(talk.length, "message")}</span></p>
          <div class="transcript" id="transcript">${transcriptHtml(talk)}</div>
        </section>
      </div>
      <nav class="pager" aria-label="Conversations">${go(-1, "Previous")}<span class="small muted num">${at + 1} of ${list.length}</span>${go(1, "Next")}</nav>`, opener);
    $("#drawer").scrollTop = 0;
    if (step) $(`#drawer [data-step="${step}"]`)?.focus();
    markSelected(from || c.id);
  }

  function markSelected(id) {
    document.querySelectorAll("tr[data-conv], tr[data-cust]").forEach((tr) => tr.classList.toggle("selected", (tr.dataset.conv || tr.dataset.cust) === id));
  }

  // T-Mobile sandbox household details (synced from Atlas). Synthetic data; backstory is invented colour, not an account fact.
  const usd = (c) => (c == null ? "—" : `$${(c / 100).toFixed(2)}`);
  function tmoSections(t) {
    const row = (k, v) => (v == null || v === "" ? "" : `<div><span>${esc(k)}</span>${v}</div>`);
    const tenure = t.tenure_months != null ? `${Math.floor(t.tenure_months / 12)}y ${t.tenure_months % 12}m` : "";
    return `
        <section class="report-sec"><p class="section-label">${t.account_id ? `Account ${esc(t.account_id)}` : "Prospect"}</p>
          <div class="meta cust">
            ${row("Segment", esc(t.segment || ""))}${row("Plan", esc(t.plan || ""))}${row("Lines", t.line_count != null ? esc(String(t.line_count)) : "")}
            ${row(t.account_id ? "Monthly bill" : "Budget", t.bill_cents != null ? esc(usd(t.bill_cents)) + (t.bill_change_pct ? ` <span class="small muted">${t.bill_change_pct > 0 ? "+" : ""}${(t.bill_change_pct * 100).toFixed(1)}% vs recent</span>` : "") : "")}
            ${row("Tenure", esc(tenure))}${row("Credit", esc(t.credit_tier || ""))}${row("Phone financing", t.financing_cents ? esc(usd(t.financing_cents)) + " owed" : t.account_id ? "Paid off" : "")}
            ${row("Support (90d)", t.support_90d != null ? `${t.support_90d}${t.unresolved_90d ? ` · ${t.unresolved_90d} open` : ""}` : "")}${row("Upgrade-ready lines", t.upgrade_lines != null && t.account_id ? esc(String(t.upgrade_lines)) : "")}
          </div>
          ${t.devices?.length ? `<p class="small muted">${t.devices.map(esc).join(" · ")}</p>` : ""}
          ${t.household?.length > 1 ? `<p class="small muted">Household: ${t.household.map((h) => esc(`${h.name} (${h.label})`)).join(", ")}</p>` : ""}
        </section>
        ${t.persona ? `<section class="report-sec"><p class="section-label">Demo persona · ${esc(String(t.persona.theme).replaceAll("_", " "))}</p><p><b>${esc(t.persona.title)}</b></p><p class="muted">${esc(t.persona.scenario)}</p></section>` : ""}
        <section class="report-sec"><p class="section-label">How the agent sees them</p>
          <div class="meta cust">${row("Relationship", esc(t.relationship || ""))}${row("Language", esc(t.language || ""))}${row("Tone", esc(t.tone || ""))}${row("Prefers", esc(t.channel_pref || ""))}</div>
          ${t.sensitivities?.length ? `<ul class="list">${t.sensitivities.map((x) => `<li><span class="small">${esc(x)}</span></li>`).join("")}</ul>` : ""}
          ${t.backstory ? `<p class="small muted">Backstory (${t.backstory_source === "llm" ? "LLM-written" : "rule-based"}, invented): ${esc(t.backstory)}</p>` : ""}
          ${t.facts?.length ? `<p class="small muted">They told us: ${t.facts.map(esc).join(" · ")}</p>` : ""}
        </section>
        ${t.voice_notes?.length ? `<section class="report-sec"><p class="section-label">Voice agent notes</p><ul class="list">${t.voice_notes.map((x) => `<li><span class="small">${esc(x)}</span></li>`).join("")}</ul></section>` : ""}`;
  }

  function openCustomer(name, opener) {
    const s = api.state, c = (s.customers || []).find((x) => (x.id ?? x.name) === name) || (s.customers || []).find((x) => x.name === name);
    if (!c) return;
    const key = c.id ?? c.name;
    const convs = custConvs(s, c.name);
    showDrawer(`${drawerHead(c.name, "Customer")}
      <div class="drawer-body">
        <div class="meta cust">
          <div><span>Number</span><span class="mono">${esc(c.phone)}</span></div>
          <div><span>Region</span>${esc(c.region)}</div>
          <div><span>Status</span>${statusChip(c.status)}</div>
        </div>
        ${c.tmo ? tmoSections(c.tmo) : ""}
        <section class="report-sec"><p class="section-label">Conversations</p>
          ${convs.length ? `<ul class="list">${convs.map((x) => `<li><button class="conv-pick" type="button" data-conv="${esc(x.id)}" data-from="${esc(c.name)}" aria-label="Open ${esc(x.intent)}">
            <span class="grow"><span class="title">${esc(x.intent)}</span><span class="small muted">${channelKind(x)} · ${ago(x.started)}</span></span>${outcomeChip(x)}</button></li>`).join("")}</ul>` : `<div class="muted">No finished conversations yet.</div>`}
        </section>
      </div>`, opener);
    markSelected(key);
  }

  function closeDrawer() {
    if (!$("#drawer").classList.contains("open")) return;
    $("#drawer").classList.remove("open");
    $("#drawer").inert = true;
    $("#drawer-backdrop").hidden = true;
    markSelected(null);
    openConvId = null;
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

  function setMenu(open) {
    $(".nav").classList.toggle("open", open);
    $("[data-menu]").setAttribute("aria-expanded", String(open));
  }

  function render() {
    const s = api.state, v = current(), k = stats(s), view = VIEWS[v];
    const counts = { home: k.review.length };
    $("#nav").innerHTML = Object.entries(VIEWS).map(([key, x]) => `
      <button class="nav-link" data-go="${key}" ${key === v ? 'aria-current="page"' : ""}>
        ${icon(NAV_ICON[key]).replace('class="icon"', 'class="icon nav-ico"')}<span>${x.label}</span>${counts[key] ? `<span class="count" title="${counts[key]} need review"><span class="sr-only">${counts[key]} need review</span><span aria-hidden="true">${counts[key]}</span></span>` : ""}
      </button>`).join("");
    $("#view-title").textContent = view.title ? view.title() : view.label;
    $("#avatar").textContent = profile().name.trim().charAt(0).toUpperCase();
    $("#view").innerHTML = view.render(s);
    document.title = `${view.label} · Selldial`;
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-menu],[data-go],[data-close],[data-conv],[data-cust],[data-conv-clear],[data-cust-clear],[data-sale-clear],[data-sale-tab],[data-promo-open],[data-promo-cancel],[data-promo-remove]");
    if (!el) return;
    const d = el.dataset;
    const opener = el.matches("tr") ? el.querySelector(".row-link") || el : el;
    try {
      if ("menu" in d) setMenu(!$(".nav").classList.contains("open"));
      else if ("close" in d) closeDrawer();
      else if (d.go) { setMenu(false); location.hash = `#/${d.go}`; }
      else if ("convClear" in d) { ui.convOutcome = "all"; ui.convQuery = ""; render(); }
      else if (d.saleTab) { ui.saleTab = d.saleTab; render(); $(`[data-sale-tab="${d.saleTab}"]`).focus(); }
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
      else if (d.conv) openConversation(d.conv, opener, d.from, d.step);
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
      render(); toast(`${code} added to the list.`); $("[data-promo-open]").focus();
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.name === "theme") {
      document.documentElement.dataset.theme = t.value === "light" ? "light" : "dark";
      try { localStorage.setItem("selldial-theme", t.value); } catch (err) { /* private mode: the choice lasts until reload */ }
    }
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
    if (e.key === "Escape") { if ($(".nav").classList.contains("open")) { setMenu(false); return $("[data-menu]").focus(); } return closeDrawer(); }
    if (e.key !== "Tab" || !$("#drawer").classList.contains("open")) return;
    const focusable = [...$("#drawer").querySelectorAll("button:not(:disabled), [href], input:not(:disabled), summary, [tabindex]:not([tabindex='-1'])")];
    if (!focusable.length) return e.preventDefault();
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  window.addEventListener("hashchange", () => { setMenu(false); closeDrawer(); render(); });

  const byRecent = (s) => s.conversations.sort((a, b) => a.started - b.started);

  // Live data: re-render when the server says something changed, unless the owner is typing or has a
  // select open. In that case wait until they leave the field so nothing they typed is wiped.
  let stale = false;
  // An open report keeps its place while new messages arrive: only the transcript is redrawn, and it follows the bottom if you were there.
  function refreshTranscript() {
    const box = openConvId && $("#transcript"), c = box && api.state.conversations.find((x) => x.id === openConvId);
    if (!c) return;
    const d = $("#drawer"), atEnd = d.scrollHeight - d.scrollTop - d.clientHeight < 40;
    box.innerHTML = transcriptHtml(talkOf(c));
    if (atEnd) d.scrollTop = d.scrollHeight;
  }
  const editing = () => { const a = document.activeElement; return a && $("#view").contains(a) && a.matches("input, textarea, select"); };
  function onLiveUpdate() {
    byRecent(api.state);
    refreshTranscript();
    if (editing()) { stale = true; return; }
    stale = false;
    render();
  }
  document.addEventListener("focusout", () => setTimeout(() => { if (stale && !editing()) onLiveUpdate(); }, 0));

  api.load().then(() => {
    byRecent(api.state);
    render();
    api.subscribe(onLiveUpdate, (st) => { document.documentElement.dataset.link = st; });
  });
})();
