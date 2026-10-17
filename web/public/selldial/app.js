/** Selldial console: home, overview, conversations, customers, sales, settings and about. */
(() => {
  const api = window.SelldialAPI;
  const CUST = window.SELLDIAL_CUSTOMERS;
  const $ = (sel, root = document) => root.querySelector(sel);

  // ---------- formatting ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents, whole = false) => cents == null ? "—" : (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  const num = (n) => n.toLocaleString("en-US");
  const pct = (a, b) => `${((a / b) * 100).toFixed(1)}%`;
  const ago = (min) => {
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m ago` : `${h}h ago`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const cap = (s) => String(s).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
  const CHANNEL = { voice: "Voice", sms: "SMS", imessage: "iMessage" };
  const ICON = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
  };
  const icon = (n) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n]}</svg>`;

  // ---------- per-viewer settings (browser storage, best effort) ----------
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(`selldial:${key}`); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`selldial:${key}`, JSON.stringify(value)); } catch {} },
  };
  const profile = () => ({ name: "Eshaan", email: "eshaan@selldial.demo", role: "Sales lead", ...store.get("profile", {}) });
  const CHANNELS = [
    { key: "voice", name: "Voice calls", via: "Photon 2.0", on: true },
    { key: "sms", name: "SMS", via: "Photon 2.0", on: true },
    { key: "imessage", name: "iMessage", via: "Photon 2.0", on: true },
    { key: "whatsapp", name: "WhatsApp", via: "WhatsApp Business API", on: false },
    { key: "rcs", name: "RCS", via: "Carrier messaging", on: false },
    { key: "webchat", name: "Web chat", via: "Embeddable widget", on: false },
  ];
  const channelState = () => ({ ...Object.fromEntries(CHANNELS.map((c) => [c.key, c.on])), ...store.get("channels", {}) });

  function statusChip(c) {
    if (c.status === "live") return `<span class="chip ok"><span class="dot pulse"></span>Live</span>`;
    if (c.status === "awaiting_approval") return `<span class="chip warn">Awaiting owner</span>`;
    if (c.status === "handoff") return `<span class="chip bad">Handed off</span>`;
    if (c.outcome === "purchased") return `<span class="chip brand">Purchased</span>`;
    if (c.outcome === "waited") return `<span class="chip info">Advised to wait</span>`;
    return `<span class="chip">Closed</span>`;
  }
  const riskChip = (r) => `<span class="chip ${r === "high" ? "bad" : r === "medium" ? "warn" : "ok"}">${cap(r)} risk</span>`;

  function stats(s) {
    const convs = s.conversations;
    const purchased = convs.filter((c) => c.outcome === "purchased");
    const waited = convs.filter((c) => c.outcome === "waited");
    return {
      revenue: purchased.reduce((n, c) => n + c.amount_cents, 0), purchases: purchased.length,
      waited: waited.length, saved: waited.reduce((n, c) => n + c.saved_cents, 0),
      live: convs.filter((c) => c.status === "live").length,
      pendingApprovals: s.approvals.filter((a) => a.status === "texted"),
      openHandoffs: s.handoffs.filter((h) => !h.claimed_by),
    };
  }

  // ---------- views ----------
  const VIEWS = {
    home: { label: "Home", sub: () => new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }), render: renderHome, title: () => `Welcome back, ${profile().name}` },
    overview: { label: "Overview", sub: "What your Selldial line did today", render: renderOverview },
    conversations: { label: "Conversations", sub: "Every call and text, with the agent's reasoning", render: renderConversations },
    customers: { label: "Customers", sub: "Household accounts from the sandbox dataset", render: renderCustomers },
    sales: { label: "Sales", sub: "Conversions, revenue and the plans behind them", render: renderSales },
    settings: { label: "Settings", sub: "Profile, appearance, promo codes and channels", render: renderSettings },
    about: { label: "About", sub: "Who we are and how Selldial works", render: renderAbout },
  };
  const ui = { convFilter: "all", convQuery: "", convRegion: "all", convTime: "all", convCustomer: "all", custQuery: "", custSegment: "all", custRegion: "all", custRisk: "all", promoEdit: null };

  function convRow(c, compact) {
    return `<tr class="clickable" data-conv="${esc(c.id)}">
      <td><button class="row-link" type="button" data-conv="${esc(c.id)}" aria-label="Open conversation with ${esc(c.customer)}">${esc(c.customer)}</button><div class="small muted">${esc(CHANNEL[c.channel])} · ${esc(c.region || "—")}</div></td>
      <td>${esc(c.intent)}${!compact && c.recommendation ? `<div class="small muted">→ ${esc(c.recommendation.pick)}</div>` : ""}</td>
      <td>${statusChip(c)}</td>
      ${compact ? "" : `<td class="right num">${c.amount_cents != null ? money(c.amount_cents) : c.saved_cents ? `<span class="muted">saved ${money(c.saved_cents)}</span>` : "—"}</td>`}
      <td class="right small muted num">${ago(c.started)}</td>
    </tr>`;
  }

  function needsList(k) {
    const items = [
      ...k.pendingApprovals.map((a) => `<li class="row">
        <div><div class="title">${esc(a.customer)} · ${money(a.amount_cents)}</div>
        <div class="small muted">Waiting for ${esc(a.owner)} to text YES · sent ${ago(a.sent)}</div></div>
        <div class="row"><button class="btn" data-resend="${esc(a.id)}">Resend text</button><button class="btn danger" data-cancel="${esc(a.id)}">Cancel</button></div></li>`),
      ...k.openHandoffs.map((h) => `<li class="row">
        <div><div class="title">${esc(h.customer)}</div><div class="small muted">${esc(h.reason)} · waiting ${ago(h.waiting).replace(" ago", "")}</div></div>
        <button class="btn primary" data-claim="${esc(h.id)}">Claim</button></li>`),
    ];
    return items.length ? `<ul class="list">${items.join("")}</ul>` : `<div class="empty">Nothing waiting on you.</div>`;
  }

  function renderHome(s) {
    const k = stats(s), sales = s.sales, live = s.conversations.find((c) => c.status === "live");
    const atRisk = CUST.customers.filter((c) => c.churn_risk === "high").slice(0, 4);
    return `
      <div class="grid split">
        <div class="grid" style="align-content:start">
          <div class="card hero-card">
            <div class="card-body">
              ${live ? `<div class="row"><div><span class="chip ok"><span class="dot pulse"></span>Live now</span>
                <div class="hero-line">${esc(live.customer)} is on a ${esc(CHANNEL[live.channel]).toLowerCase()} call: ${esc(live.intent)}</div>
                <div class="small muted">Selldial's pick so far: ${esc(live.recommendation?.pick || "still listening")}</div></div>
                <a class="btn primary" href="live.html">${icon("phone")} Watch live</a></div>`
              : `<div class="hero-line">No calls right now.</div>`}
            </div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Needs you</h2><span class="small muted">${plural(k.pendingApprovals.length, "approval")} · ${plural(k.openHandoffs.length, "handoff")}</span></div>
            ${needsList(k)}
          </div>
          <div class="card">
            <div class="card-head"><h2>Recent conversations</h2><button class="btn ghost" data-go="conversations">View all</button></div>
            <div class="table-wrap"><table><tbody>${s.conversations.slice(0, 4).map((c) => convRow(c, true)).join("")}</tbody></table></div>
          </div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card">
            <div class="card-head"><h2>This month</h2><span class="small muted">synthetic</span></div>
            <dl class="statlist">
              <div><dt>Revenue</dt><dd class="num">${money(sales.revenue_cents, true)}</dd></div>
              <div><dt>Conversions</dt><dd class="num">${num(sales.funnel.purchased)} <span class="muted small">${pct(sales.funnel.purchased, sales.funnel.contacts)}</span></dd></div>
              <div><dt>Told to wait</dt><dd class="num">${num(sales.funnel.waited)}</dd></div>
              <div><dt>Saved for customers</dt><dd class="num ok-text">${money(sales.saved_for_customers_cents, true)}</dd></div>
            </dl>
            <div class="card-foot"><button class="btn ghost" data-go="sales">Open sales ${icon("arrow")}</button></div>
          </div>
          <div class="card">
            <div class="card-head"><h2>Customers to call back</h2><button class="btn ghost" data-go="customers">All customers</button></div>
            <ul class="list">${atRisk.map((c) => `<li class="has-btn"><button class="list-btn" type="button" data-cust="${esc(c.id)}">
              <span class="row"><span class="title">${esc(c.name)}</span>${riskChip(c.churn_risk)}</span>
              <span class="small muted" style="display:block">${esc(c.note)}</span></button></li>`).join("") || `<li class="empty">No high-risk customers.</li>`}</ul>
          </div>
        </div>
      </div>`;
  }

  function renderOverview(s) {
    const k = stats(s), a = CUST.analytics;
    const chMax = Math.max(...Object.values(a.support_channels));
    return `
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Revenue closed today</div><div class="value num">${money(k.revenue)}</div><div class="hint">${plural(k.purchases, "purchase")} via Visa checkout</div></div>
        <div class="card kpi accent"><div class="label">Talked out of a sale</div><div class="value num">${k.waited}</div><div class="hint">${money(k.saved)} kept in customers' pockets</div></div>
        <div class="card kpi"><div class="label">Needs you</div><div class="value num">${k.pendingApprovals.length + k.openHandoffs.length}</div><div class="hint">${plural(k.pendingApprovals.length, "approval")} · ${plural(k.openHandoffs.length, "handoff")}</div></div>
        <div class="card kpi"><div class="label">Accounts in dataset</div><div class="value num">${num(a.accounts)}</div><div class="hint">${num(a.lines)} lines</div></div>
      </div>
      <div class="grid split">
        <div class="card">
          <div class="card-head"><h2>Recent conversations</h2><button class="btn ghost" data-go="conversations">View all</button></div>
          <div class="table-wrap"><table><tbody>${s.conversations.slice(0, 6).map((c) => convRow(c, true)).join("")}</tbody></table></div>
        </div>
        <div class="grid" style="align-content:start">
          <div class="card"><div class="card-head"><h2>Needs you</h2></div>${needsList(k)}</div>
          <div class="card">
            <div class="card-head"><h2>Support contacts by channel</h2><span class="small muted">sandbox data</span></div>
            <div class="card-body bars">${Object.entries(a.support_channels).map(([ch, n]) => `
              <div class="bar-row"><span>${cap(ch)}</span><span class="bar"><span style="width:${(n / chMax) * 100}%"></span></span><span class="num small">${num(n)}</span></div>`).join("")}
            </div>
          </div>
        </div>
      </div>`;
  }

  function renderConversations(s) {
    const filters = [["all", "All"], ["live", "Live"], ["awaiting_approval", "Awaiting owner"], ["handoff", "Handed off"], ["closed", "Closed"]];
    const regions = [...new Set(s.conversations.map((c) => c.region).filter(Boolean))].sort();
    const customers = [...new Set(s.conversations.map((c) => c.customer))].sort();
    const within = { all: Infinity, hour: 60, today: 24 * 60, week: 7 * 24 * 60 }[ui.convTime];
    const q = ui.convQuery.toLowerCase();
    const rows = s.conversations
      .filter((c) => ui.convFilter === "all" || c.status === ui.convFilter)
      .filter((c) => ui.convRegion === "all" || c.region === ui.convRegion)
      .filter((c) => ui.convCustomer === "all" || c.customer === ui.convCustomer)
      .filter((c) => c.started <= within)
      .filter((c) => !q || [c.customer, c.intent, c.recommendation?.pick].join(" ").toLowerCase().includes(q));
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    return `
      <div class="filters" style="margin-bottom:12px">
        <div class="seg" role="group" aria-label="Filter by status">${filters.map(([v, l]) => `<button data-conv-filter="${v}" aria-pressed="${ui.convFilter === v}">${l}</button>`).join("")}</div>
        <label class="select"><span>Region</span><select data-ui="convRegion">${opt("all", ui.convRegion, "All regions")}${regions.map((r) => opt(r, ui.convRegion, r)).join("")}</select></label>
        <label class="select"><span>Time</span><select data-ui="convTime">${[["all", "Any time"], ["hour", "Last hour"], ["today", "Today"], ["week", "Last 7 days"]].map(([v, l]) => opt(v, ui.convTime, l)).join("")}</select></label>
        <label class="select"><span>Customer</span><select data-ui="convCustomer">${opt("all", ui.convCustomer, "All customers")}${customers.map((c) => opt(c, ui.convCustomer, c)).join("")}</select></label>
        <input class="search" id="conv-search" type="search" aria-label="Search conversations" placeholder="Search intent or pick…" value="${esc(ui.convQuery)}">
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Intent → agent's pick</th><th>Status</th><th class="right">Amount</th><th class="right">Started</th></tr></thead>
        <tbody>${rows.map((c) => convRow(c, false)).join("") || `<tr><td colspan="5" class="empty">No conversations match these filters.</td></tr>`}</tbody>
      </table></div></div>`;
  }

  function renderCustomers() {
    const all = CUST.customers;
    const segs = [...new Set(all.map((c) => c.segment))].sort(), regions = [...new Set(all.map((c) => c.region))].sort();
    const q = ui.custQuery.toLowerCase();
    const rows = all
      .filter((c) => ui.custSegment === "all" || c.segment === ui.custSegment)
      .filter((c) => ui.custRegion === "all" || c.region === ui.custRegion)
      .filter((c) => ui.custRisk === "all" || c.churn_risk === ui.custRisk)
      .filter((c) => !q || [c.name, c.id, c.plan, c.note].join(" ").toLowerCase().includes(q));
    const opt = (v, cur, label) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
    return `
      <div class="filters" style="margin-bottom:12px">
        <input class="search" id="cust-search" type="search" aria-label="Search customers" placeholder="Search name, account, plan…" value="${esc(ui.custQuery)}">
        <label class="select"><span>Segment</span><select data-ui="custSegment">${opt("all", ui.custSegment, "All segments")}${segs.map((x) => opt(x, ui.custSegment, cap(x))).join("")}</select></label>
        <label class="select"><span>Region</span><select data-ui="custRegion">${opt("all", ui.custRegion, "All regions")}${regions.map((x) => opt(x, ui.custRegion, x)).join("")}</select></label>
        <label class="select"><span>Churn risk</span><select data-ui="custRisk">${[["all", "Any"], ["high", "High"], ["medium", "Medium"], ["low", "Low"]].map(([v, l]) => opt(v, ui.custRisk, l)).join("")}</select></label>
        <span class="small muted">${plural(rows.length, "customer")}</span>
      </div>
      <div class="card"><div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Segment</th><th>Plan</th><th class="right">Lines</th><th class="right">Monthly bill</th><th class="right">Financing left</th><th>Churn risk</th></tr></thead>
        <tbody>${rows.map((c) => `<tr class="clickable" data-cust="${esc(c.id)}">
          <td><button class="row-link" type="button" data-cust="${esc(c.id)}" aria-label="Open ${esc(c.name)}">${esc(c.name)}</button><div class="small muted mono">${esc(c.id)} · ${esc(c.region)}</div></td>
          <td>${esc(cap(c.segment))}<div class="small muted">${c.tenure_months} mo tenure</div></td>
          <td>${esc(c.plan || "—")}</td>
          <td class="right num">${c.lines}</td>
          <td class="right num">${money(c.monthly_cents)}</td>
          <td class="right num">${c.financing_cents ? money(c.financing_cents) : "—"}</td>
          <td>${riskChip(c.churn_risk)}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">No customers match these filters.</td></tr>`}</tbody>
      </table></div></div>
      <p class="small muted" style="margin-top:12px">Source: ${esc(CUST.source)}.</p>`;
  }

  function Funnel(f) {
    // Four steps; each node flows from one parent, like a simple Sankey.
    const cols = [
      [{ id: "contacts", label: "Called or texted", v: f.contacts }],
      [{ id: "verified", label: "Verified", v: f.verified, from: "contacts" }, { id: "drop1", label: "Dropped off", v: f.contacts - f.verified, from: "contacts", muted: true }],
      [{ id: "recommended", label: "Got a recommendation", v: f.recommended, from: "verified" }, { id: "drop2", label: "Dropped off", v: f.verified - f.recommended, from: "verified", muted: true }],
      [{ id: "purchased", label: "Purchased", v: f.purchased, from: "recommended", kind: "buy" }, { id: "waited", label: "Advised to wait", v: f.waited, from: "recommended", kind: "save" },
       { id: "nochange", label: "No change needed", v: f.no_change, from: "recommended", kind: "save" }, { id: "drop3", label: "Dropped off", v: f.dropped, from: "recommended", muted: true }],
    ];
    const W = 960, H = 330, scale = 250 / f.contacts, gap = 18, xs = [0, 250, 500, 750], nodeW = 8;
    const pos = {}, out = {};
    cols.forEach((col, ci) => { let y = 24; col.forEach((n) => { const h = Math.max(3, n.v * scale); pos[n.id] = { x: xs[ci], y, h, n }; out[n.id] = y; y += h + gap; }); });
    let bands = "", nodes = "", labels = "";
    cols.flat().forEach((n) => {
      const p = pos[n.id];
      if (n.from) {
        const src = pos[n.from], sy = out[n.from]; out[n.from] += p.h;
        const x1 = src.x + nodeW, x2 = p.x, mx = (x1 + x2) / 2;
        bands += `<path class="band ${n.muted ? "muted" : n.kind || ""}" d="M${x1},${sy} C${mx},${sy} ${mx},${p.y} ${x2},${p.y} L${x2},${p.y + p.h} C${mx},${p.y + p.h} ${mx},${sy + p.h} ${x1},${sy + p.h} Z"/>`;
      }
      nodes += `<rect class="node ${n.muted ? "muted" : n.kind || ""}" x="${p.x}" y="${p.y}" width="${nodeW}" height="${p.h}" rx="2"/>`;
      labels += `<text class="lbl" x="${p.x + 16}" y="${p.y + 13}">${esc(n.label)}</text><text class="sub" x="${p.x + 16}" y="${p.y + 30}">${num(n.v)} · ${pct(n.v, f.contacts)}</text>`;
    });
    const steps = xs.map((x, i) => `<text class="step" x="${x}" y="12">Step ${i + 1}</text>`).join("");
    return `<svg class="funnel" viewBox="0 0 ${W} ${H}" role="img" aria-label="Sales funnel: ${num(f.contacts)} contacts, ${num(f.verified)} verified, ${num(f.recommended)} recommended, ${num(f.purchased)} purchased, ${num(f.waited)} advised to wait, ${num(f.no_change)} no change">${steps}${bands}${nodes}${labels}</svg>`;
  }

  function renderSales(s) {
    const sa = s.sales, f = sa.funnel, a = CUST.analytics;
    const weekMax = Math.max(...sa.revenue_by_week_cents), planMax = Math.max(...sa.by_plan.map((p) => p.revenue_cents));
    const families = [
      ["Experience Beyond", "experience_beyond"], ["Experience More", "experience_more"], ["Essentials", "essentials"], ["Legacy plans", "legacy"],
    ];
    const planRows = families.map(([title, fam]) => {
      const plans = CUST.plans.filter((p) => p.family === fam);
      const main = plans.filter((p) => !["community", "partner", "senior_55"].includes(p.variant));
      const variants = plans.filter((p) => ["community", "partner", "senior_55"].includes(p.variant));
      return main.map((p) => `<div class="plan">
        <div class="plan-head"><div><div class="plan-name">${esc(p.name)}</div><div class="small muted">${title}${p.synthetic ? " · synthetic" : ""}</div></div>
          <div class="plan-price num">${money(p.first_line_cents, true)}<span class="small muted">/mo, 1 line</span></div></div>
        <ul class="perks">${p.features.map((x) => `<li>${icon("check")}${esc(x)}</li>`).join("")}</ul>
        ${variants.length && p === main[0] ? `<div class="small muted">Also offered with ${variants.map((v) => cap(v.variant).replace("Senior 55", "55+")).join(", ")} savings from ${money(Math.min(...variants.map((v) => v.first_line_cents)), true)}/mo</div>` : ""}
      </div>`).join("");
    }).join("");
    return `
      <div class="grid kpis">
        <div class="card kpi"><div class="label">Revenue</div><div class="value num">${money(sa.revenue_cents, true)}</div><div class="hint">${esc(sa.window)} · synthetic</div></div>
        <div class="card kpi"><div class="label">Conversion rate</div><div class="value num">${pct(f.purchased, f.contacts)}</div><div class="hint">${num(f.purchased)} of ${num(f.contacts)} contacts</div></div>
        <div class="card kpi"><div class="label">Average order</div><div class="value num">${money(sa.avg_order_cents, true)}</div><div class="hint">device + plan change</div></div>
        <div class="card kpi accent"><div class="label">Saved for customers</div><div class="value num">${money(sa.saved_for_customers_cents, true)}</div><div class="hint">${num(f.waited + f.no_change)} told to wait or keep their setup</div></div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2>Sales funnel</h2><span class="small muted">${esc(sa.window)} · synthetic</span></div>
        <div class="card-body funnel-wrap">${Funnel(f)}</div>
      </div>
      <div class="grid split" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2>Revenue by plan</h2></div>
          <div class="card-body bars">${sa.by_plan.map((p) => `<div class="bar-row wide"><span>${esc(p.plan)}<span class="small muted"> · ${p.orders} orders</span></span><span class="bar accent"><span style="width:${(p.revenue_cents / planMax) * 100}%"></span></span><span class="num small">${money(p.revenue_cents, true)}</span></div>`).join("")}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Revenue by week</h2></div>
          <div class="card-body"><div class="cols">${sa.revenue_by_week_cents.map((c, i) => `<div class="col"><span class="col-bar" style="height:${(c / weekMax) * 100}%"></span><span class="num small">${money(c, true)}</span><span class="small muted">Week ${i + 1}</span></div>`).join("")}</div></div>
        </div>
      </div>
      <div class="grid split" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2>Conversions by channel</h2></div>
          <div class="card-body bars">${sa.by_channel.map((c) => `<div class="bar-row"><span>${esc(c.channel)}</span><span class="bar accent"><span style="width:${(c.conversions / sa.by_channel[0].conversions) * 100}%"></span></span><span class="num small">${c.conversions}</span></div>`).join("")}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2>Average bill by segment</h2><span class="small muted">sandbox data, ${num(a.accounts)} accounts</span></div>
          <div class="card-body bars">${Object.entries(a.avg_bill_by_segment_cents).map(([seg, c]) => `<div class="bar-row"><span>${cap(seg)}</span><span class="bar"><span style="width:${(c / Object.values(a.avg_bill_by_segment_cents)[0]) * 100}%"></span></span><span class="num small">${money(c, true)}</span></div>`).join("")}</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><h2>Plans and what's included</h2><span class="small muted">first-line price with AutoPay</span></div>
        <div class="plans">${planRows}</div>
      </div>`;
  }

  function renderSettings(s) {
    const p = profile(), theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light", ch = channelState();
    const e = ui.promoEdit || { code: "", applies_to: "Devices", kind: "cents", amount: "", requires: "" };
    return `
      <div class="settings">
        <section class="card">
          <div class="card-head"><h2>Profile</h2><span class="small muted">signed in with ${esc(store.get("provider", "T-Mobile"))}</span></div>
          <form class="card-body form" id="profile-form">
            <label class="field"><span>Name</span><input name="name" value="${esc(p.name)}" required autocomplete="name"></label>
            <label class="field"><span>Email</span><input name="email" type="email" value="${esc(p.email)}" autocomplete="email"></label>
            <label class="field"><span>Role</span><input name="role" value="${esc(p.role)}"></label>
            <div><button class="btn primary" type="submit">Save profile</button></div>
          </form>
        </section>
        <section class="card">
          <div class="card-head"><h2>Appearance</h2></div>
          <div class="card-body">
            <div class="seg" role="group" aria-label="Theme">${[["light", "Light"], ["dark", "Dark"]].map(([v, l]) => `<button data-theme-set="${v}" aria-pressed="${theme === v}">${l}</button>`).join("")}</div>
            <p class="small muted" style="margin:12px 0 0">Applies to the console, the live screen and sign-in on this browser.</p>
          </div>
        </section>
        <section class="card span-2">
          <div class="card-head"><h2>Promo codes</h2><span class="small muted">the agent can offer only these (guard rule 1)</span></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Code</th><th>Applies to</th><th class="right">Max</th><th>Requires</th><th></th></tr></thead>
            <tbody>${s.policy.discounts.map((d) => `<tr>
              <td class="mono">${esc(d.code)}</td><td>${esc(d.applies_to)}</td>
              <td class="right num">${d.max_pct != null ? `${d.max_pct}%` : money(d.max_cents)}</td>
              <td class="muted">${esc(d.requires || "—")}</td>
              <td class="right"><button class="btn ghost" data-promo-edit="${esc(d.code)}">Edit</button></td></tr>`).join("")}</tbody>
          </table></div>
          <form class="card-body form promo-form" id="promo-form">
            <label class="field"><span>Code</span><input name="code" value="${esc(e.code)}" required pattern="[A-Za-z0-9_]{3,24}" title="3–24 letters, numbers or underscores" ${ui.promoEdit ? "readonly" : ""}></label>
            <label class="field"><span>Applies to</span><select name="applies_to">${["Devices", "Plans", "Accessories", "Flagship devices"].map((x) => `<option${x === e.applies_to ? " selected" : ""}>${x}</option>`).join("")}</select></label>
            <label class="field"><span>Type</span><select name="kind"><option value="cents"${e.kind === "cents" ? " selected" : ""}>Dollar amount</option><option value="pct"${e.kind === "pct" ? " selected" : ""}>Percent</option></select></label>
            <label class="field"><span>Max value</span><input name="amount" type="number" min="1" step="1" value="${esc(e.amount)}" required inputmode="numeric"></label>
            <label class="field wide"><span>Requires</span><input name="requires" value="${esc(e.requires)}" placeholder="e.g. Eligible trade-in"></label>
            <div class="row" style="justify-content:flex-start"><button class="btn primary" type="submit">${ui.promoEdit ? "Update code" : "Add code"}</button>${ui.promoEdit ? `<button class="btn ghost" type="button" data-promo-cancel>Cancel</button>` : ""}</div>
          </form>
        </section>
        <section class="card span-2">
          <div class="card-head"><h2>Channels</h2><span class="small muted">where customers can reach your Selldial line</span></div>
          <ul class="list">${CHANNELS.map((c) => `<li class="row">
            <div><div class="title">${esc(c.name)}</div><div class="small muted">${esc(c.via)}</div></div>
            <label class="toggle"><input type="checkbox" data-channel="${c.key}"${ch[c.key] ? " checked" : ""}><span class="track" aria-hidden="true"></span><span class="sr-only">${esc(c.name)} enabled</span><span class="toggle-text">${ch[c.key] ? "On" : "Off"}</span></label>
          </li>`).join("")}</ul>
        </section>
      </div>`;
  }

  function renderAbout() {
    return `
      <div class="about">
        <section class="card about-lead">
          <div class="card-body">
            <img src="logo.svg" alt="" width="44" height="60">
            <h2 class="about-title">The phone line that tells you when not to buy.</h2>
            <p>Selldial is a sales line for carriers that answers calls and texts, recommends what a customer should actually do, and argues against its own sale when waiting is the better deal. Every recommendation comes from deterministic code that shows its math; the language model only handles the conversation.</p>
          </div>
        </section>
        <section class="card">
          <div class="card-head"><h2>How it works</h2></div>
          <ol class="steps card-body">
            <li><b>Listen.</b> A customer calls or texts the line. Caller ID loads their household, and nothing changes until they verify.</li>
            <li><b>Do the math.</b> The decision engine compares buying now, waiting for a promo, or changing nothing, using device age, financing, trade-in value and plan.</li>
            <li><b>Show the runner-up.</b> The agent explains the best option in one sentence and names the next best one.</li>
            <li><b>Ask the owner.</b> Purchases over the household limit go to the account owner by text. Checkout runs only after their YES.</li>
          </ol>
        </section>
        <section class="card">
          <div class="card-head"><h2>What we believe</h2></div>
          <ul class="steps card-body">
            <li><b>Honest beats pushy.</b> Customers who are told to wait come back to buy.</li>
            <li><b>The owner holds the card.</b> No purchase above the limit without a text YES.</li>
            <li><b>Show your work.</b> Every number on screen comes from a tool result and lands in the audit log.</li>
          </ul>
        </section>
        <section class="card">
          <div class="card-head"><h2>Built at DubHacks 26</h2></div>
          <div class="card-body">
            <p style="margin-top:0">Selldial started as a hackathon project in Seattle for the Visa, T-Mobile, Photon and VEYZL tracks. It runs on Python and FastAPI, Photon for voice and messaging, Claude or Gemini for conversation, and a Visa sandbox checkout.</p>
            <p class="small muted" style="margin-bottom:0">All customer data, prices and payments in this console are synthetic. Selldial is not a T-Mobile product.</p>
          </div>
        </section>
      </div>`;
  }

  // ---------- drawers ----------
  let drawerOpener = null;
  function showDrawer(html) {
    $("#drawer").innerHTML = html;
    if (!$("#drawer").classList.contains("open")) drawerOpener = document.activeElement;
    $("#drawer").classList.add("open");
    $("#drawer").inert = false;
    $("#drawer-backdrop").hidden = false;
    $("#drawer-close").focus();
  }
  const drawerHead = (title, sub) => `<div class="drawer-head"><div class="row"><div><h2 class="title" id="drawer-title" style="font-size:17px;margin:0">${esc(title)}</h2><div class="small muted">${sub}</div></div>
    <button class="btn ghost" id="drawer-close" type="button">Close</button></div></div>`;

  function openConversation(id) {
    const c = api.state.conversations.find((x) => x.id === id);
    if (!c) return toast("That conversation isn't in this snapshot.");
    const r = c.recommendation;
    showDrawer(`${drawerHead(c.customer, `${esc(c.intent)} · <span class="mono">${esc(c.id)}</span>`)}
      <div class="drawer-body">
        <div class="meta">
          <div><span>Channel</span>${esc(CHANNEL[c.channel])}</div>
          <div><span>Region</span>${esc(c.region || "—")}</div>
          <div><span>Status</span>${statusChip(c)}</div>
        </div>
        ${r ? `<div><p class="section-label">Recommendation</p><div class="rec"><div class="pick">${esc(r.pick)}</div><div class="why">${esc(r.reason)}</div><div class="runner"><b>Runner-up:</b> ${esc(r.runner_up)}</div></div></div>` : ""}
        <div><p class="section-label">Transcript and actions</p><div class="transcript">
          ${c.events.map((e) => {
            const cls = e.kind === "guard" ? `guard ${e.ok ? "ok" : "blocked"}` : e.kind;
            const tag = e.kind === "tool" ? `<span class="tag">${esc(e.name)}</span>` : e.kind === "guard" ? `<span class="tag">rule ${e.rule}</span>` : "";
            return `<div class="ev ${cls}"><div class="time">${e.t ? `${e.t}m` : "now"}</div><div class="bubble">${tag}${esc(e.text)}</div></div>`;
          }).join("")}
        </div></div>
      </div>`);
  }

  function openCustomer(id) {
    const c = CUST.customers.find((x) => x.id === id);
    if (!c) return;
    showDrawer(`${drawerHead(c.name, `<span class="mono">${esc(c.id)}</span> · ${esc(c.region)}`)}
      <div class="drawer-body">
        <div class="meta">
          <div><span>Segment</span>${esc(cap(c.segment))}</div>
          <div><span>Tenure</span>${c.tenure_months} months</div>
          <div><span>Churn risk</span>${riskChip(c.churn_risk)}</div>
          <div><span>Lines</span>${c.lines}</div>
          <div><span>Monthly bill</span><span class="num">${money(c.monthly_cents)}</span></div>
          <div><span>Financing left</span><span class="num">${c.financing_cents ? money(c.financing_cents) : "—"}</span></div>
        </div>
        <div><p class="section-label">Situation</p><div class="rec"><div class="pick">${esc(c.note)}</div><div class="runner">Plan: ${esc(c.plan || "—")} · prefers ${esc(c.contact_preference)} · ${plural(c.support_contacts, "support contact")}</div></div></div>
        <div><p class="section-label">Selldial would look at</p><div class="small">${esc(cap(c.theme))}</div></div>
      </div>`);
  }

  function closeDrawer() {
    if (!$("#drawer").classList.contains("open")) return;
    $("#drawer").classList.remove("open");
    $("#drawer").inert = true;
    $("#drawer-backdrop").hidden = true;
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

  function setTheme(theme) {
    if (theme === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("selldial:theme", theme); } catch {}
  }

  // ---------- shell ----------
  const current = () => { const v = location.hash.replace("#/", ""); return VIEWS[v] ? v : "home"; };

  function render() {
    const s = api.state, v = current(), k = stats(s), view = VIEWS[v];
    const counts = { home: k.pendingApprovals.length + k.openHandoffs.length, conversations: k.live };
    $("#nav").innerHTML = Object.entries(VIEWS).map(([key, x]) => `
      <button class="nav-link" data-go="${key}" ${key === v ? 'aria-current="page"' : ""}>
        <span>${x.label}</span>${counts[key] ? `<span class="badge">${counts[key]}</span>` : ""}
      </button>`).join("");
    $("#line-card").innerHTML = `<span class="muted">Selldial line</span><strong class="num">${esc(s.line.number)}</strong>
      <span><span class="dot pulse"></span>${esc(s.line.carrier)} · ${k.live} live now</span>`;
    $("#view-title").textContent = view.title ? view.title() : view.label;
    $("#view-sub").textContent = typeof view.sub === "function" ? view.sub() : view.sub;
    $("#mode-pill").textContent = api.mode === "live" ? "Live backend" : "Demo data";
    $("#mode-pill").className = `mode-pill ${api.mode}`;
    $("#view").innerHTML = view.render(s);
    document.title = `${view.label} · Selldial`;
  }

  document.addEventListener("click", async (e) => {
    const el = e.target.closest("[data-go],[data-conv],[data-cust],[data-claim],[data-resend],[data-cancel],[data-conv-filter],[data-theme-set],[data-promo-edit],[data-promo-cancel]");
    if (!el) return;
    const d = el.dataset;
    try {
      if (d.go) location.hash = `#/${d.go}`;
      else if (d.claim) { await api.claimHandoff(d.claim, profile().name); toast("Handoff claimed"); render(); }
      else if (d.resend) { await api.resendApproval(d.resend); toast("Text resent to the owner"); render(); }
      else if (d.cancel) {
        if (!confirm("Cancel this order and release the Visa hold?")) return;
        await api.cancelApproval(d.cancel); toast("Order cancelled, hold released"); render();
      }
      else if (d.convFilter) { ui.convFilter = d.convFilter; render(); }
      else if (d.themeSet) { setTheme(d.themeSet); render(); }
      else if (d.promoEdit) {
        const p = api.state.policy.discounts.find((x) => x.code === d.promoEdit);
        ui.promoEdit = { code: p.code, applies_to: p.applies_to, kind: p.max_pct != null ? "pct" : "cents", amount: p.max_pct != null ? p.max_pct : p.max_cents / 100, requires: p.requires || "" };
        render(); $("#promo-form input[name=amount]").focus();
      }
      else if ("promoCancel" in d) { ui.promoEdit = null; render(); }
      else if (d.cust) openCustomer(d.cust);
      else if (d.conv) openConversation(d.conv);
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target, data = Object.fromEntries(new FormData(form));
    try {
      if (form.id === "profile-form") {
        store.set("profile", { name: data.name.trim() || "there", email: data.email.trim(), role: data.role.trim() });
        toast("Profile saved"); render();
      } else if (form.id === "promo-form") {
        const amount = Number(data.amount);
        if (!Number.isInteger(amount) || amount <= 0) return toast("Enter a whole number above zero");
        if (data.kind === "pct" && amount > 100) return toast("A percent discount can't be over 100");
        await api.savePromo({ code: data.code, applies_to: data.applies_to, requires: data.requires.trim(), active: true,
          max_pct: data.kind === "pct" ? amount : null, max_cents: data.kind === "cents" ? amount * 100 : null });
        toast(ui.promoEdit ? "Promo code updated" : "Promo code added");
        ui.promoEdit = null; render();
      }
    } catch (err) {
      toast(err.message);
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (t.dataset.ui) { ui[t.dataset.ui] = t.value; render(); $(`[data-ui="${t.dataset.ui}"]`)?.focus(); }
    if (t.dataset.channel) {
      store.set("channels", { ...channelState(), [t.dataset.channel]: t.checked });
      t.closest(".toggle").querySelector(".toggle-text").textContent = t.checked ? "On" : "Off";
    }
  });

  document.addEventListener("input", (e) => {
    const map = { "conv-search": "convQuery", "cust-search": "custQuery" };
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
  $("#refresh").addEventListener("click", async () => { await api.load(); byRecent(api.state); render(); toast(api.mode === "live" ? "Refreshed" : "Backend not reachable, showing demo data"); });
  api.load().then(() => { byRecent(api.state); render(); });
})();
