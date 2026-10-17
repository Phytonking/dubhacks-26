/**
 * Selldial live screen (DESIGN.md): instrument panel for one call.
 *
 * Plays window.SELLDIAL_SESSION step by step. Once the agent exists, replace the player with a poll of
 * GET /sessions/{phone} that produces the same state shape. Money arrives in cents and is formatted here.
 */
(() => {
  const S = window.SELLDIAL_SESSION;
  const $ = (id) => document.getElementById(id);
  const LEAD_MS = 1600; // how long the empty state shows after a reset
  const speed = Number(new URLSearchParams(location.search).get("speed")) || 1;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // ---------- formatting ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const money = (cents, whole = false) =>
    (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  const signed = (cents) => (cents === 0 ? "—" : `${cents > 0 ? "+" : "−"}${money(Math.abs(cents))}`);
  function clock(at) {
    const [h, m, s] = S.clock_start.split(":").map(Number);
    const t = h * 3600 + m * 60 + s + Math.round(at);
    return [Math.floor(t / 3600) % 24, Math.floor(t / 60) % 60, t % 60].map((n) => String(n).padStart(2, "0")).join(":");
  }

  // ---------- icons: one stroke family (Lucide geometry) ----------
  const PATHS = {
    check: '<path d="M20 6 9 17l-5-5"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    minus: '<path d="M5 12h14"/>',
    phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    alert: '<path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
    pause: '<circle cx="12" cy="12" r="9"/><path d="M10 9v6M14 9v6"/>',
  };
  const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[name]}</svg>`;
  const STATE = {
    idle: { icon: "minus", text: "Not checked yet" },
    pass: { icon: "check", text: "Pass" },
    pending: { icon: "clock", text: "Pending" },
    blocked: { icon: "x", text: "Blocked" },
  };

  // ---------- state ----------
  let state, timers = [], shownSavings = 0, auditSeen = 0, mathKey = "";
  function initialState() {
    return {
      live: false, verified: false, items: [], thinking: null, rec: null,
      signalsOn: new Set(), guards: Object.fromEntries(S.guards.map((g) => [g.key, "idle"])),
      savings: 0, checkout: null, audit: [], handoff: null,
    };
  }

  function apply(step) {
    const st = state;
    if (step.type === "call") st.live = step.live;
    if (step.type === "say") st.items.push({ kind: "say", who: step.who, text: step.text });
    if (step.type === "thinking") { st.thinking = step.label; st.items.push({ kind: "event", label: step.label, running: true }); }
    if (step.type === "tool") {
      st.items = st.items.filter((i) => !i.running);
      st.items.push({ kind: "event", name: step.name, label: step.label });
      const g = step.guard ? Object.values(step.guard)[0] : "none";
      st.audit.unshift({ clock: clock(step.at), actor: "agent", action: `tool ${step.name}`, detail: step.detail, guard: g });
      if (step.verify) st.verified = true;
      if (step.recommendation) { st.rec = S.recommendation; st.thinking = null; }
      if (step.savings_cents != null) st.savings = step.savings_cents;
    }
    if (step.type === "owner") {
      st.items.push({ kind: "owner", text: step.text });
      st.audit.unshift({ clock: clock(step.at), actor: "owner", action: "approval.reply", detail: "YES by text", guard: "pass" });
    }
    for (const k of step.signals || step.keys || []) st.signalsOn.add(k);
    if (step.guard) Object.assign(st.guards, step.guard);
    if (step.checkout) st.checkout = { ...(st.checkout || {}), ...step.checkout };
    if (step.type === "handoff") st.handoff = step.summary;
    render();
  }

  // ---------- components ----------
  function TopBar() {
    $("bar").classList.toggle("handoff", !!state.handoff);
    if (!state.live) {
      $("session").innerHTML = `<span class="chip">${icon("pause")} No active call</span>`;
      return;
    }
    const channel = S.channel === "voice" ? `${icon("phone")} Voice` : `${icon("message")} Text`;
    const verify = state.verified
      ? `<span class="chip pass">${icon("check")} Verified</span>`
      : `<span class="chip pending">${icon("clock")} Not verified</span>`;
    const handoff = state.handoff
      ? `<span class="chip pending">${icon("alert")} Handed to a human</span><span class="handoff-note">${esc(state.handoff)}</span>`
      : "";
    $("session").innerHTML = `
      <span class="chip live"><span class="pulse" aria-hidden="true"></span>Live · ${channel}</span>
      <span class="caller"><span>Caller</span> ${esc(S.caller.name)}</span>${verify}${handoff}`;
  }

  function Transcript() {
    const el = $("transcript");
    $("t-meta").textContent = `${S.channel === "voice" ? "Voice" : "Text"} · ${S.line}`;
    if (!state.items.length) {
      el.innerHTML = `<div class="empty"><strong>Waiting for a call or text to ${esc(S.line)}.</strong>The conversation appears here as it happens.</div>`;
      return;
    }
    el.innerHTML = state.items.map((i) => {
      if (i.kind === "say") return `<div class="msg ${i.who}"><b>${i.who === "agent" ? "Selldial" : esc(S.caller.name)}</b>${esc(i.text)}</div>`;
      if (i.kind === "owner") return `<div class="event owner">${icon("message")} ${esc(i.text)}</div>`;
      return `<div class="event">${icon(i.running ? "clock" : "tool")} ${esc(i.label)}${i.running ? "…" : ""}</div>`;
    }).join("");
    el.scrollTop = el.scrollHeight;
  }

  function TradeinChart(t) {
    const W = 300, H = 104, L = 40, R = 30, T = 10, B = 18;
    const minY = 28000, maxY = 40000, maxX = t.weeks[t.weeks.length - 1];
    const x = (w) => L + (w / maxX) * (W - L - R);
    const y = (c) => T + (1 - (c - minY) / (maxY - minY)) * (H - T - B);
    const pts = t.weeks.map((w, i) => [x(w), y(t.cents[i])]);
    const now = t.cents[t.now_week], after = t.cents[t.wait_week];
    const band = [...pts.slice(t.now_week, t.wait_week + 1), [x(t.wait_week), y(now)]].map((p) => p.join(",")).join(" ");
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Trade-in value falls from ${money(now, true)} now to ${money(after, true)} after waiting ${t.wait_week} weeks">
      ${[30000, 34000, 38000].map((c) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(c)}" y2="${y(c)}"/><text x="${L - 6}" y="${y(c) + 4}" text-anchor="end">${money(c, true)}</text>`).join("")}
      <polygon class="band" points="${band}"/>
      <polyline class="line" points="${pts.map((p) => p.join(",")).join(" ")}"/>
      <circle class="dot-now" cx="${x(t.now_week)}" cy="${y(now)}" r="4"/>
      <circle class="dot-wait" cx="${x(t.wait_week)}" cy="${y(after)}" r="4"/>
      <text class="band-label" x="${x(t.wait_week) + 8}" y="${(y(now) + y(after)) / 2 + 4}">−${money(now - after, true)}</text>
      <text x="${x(0)}" y="${H - 3}" text-anchor="start">now</text>
      <text x="${x(t.wait_week)}" y="${H - 3}" text-anchor="middle">${t.wait_week} wk</text>
      <text x="${x(maxX)}" y="${H - 3}" text-anchor="end">${maxX} wk</text>
    </svg>`;
  }

  function OptionsTable(options) {
    const tag = { best: `<span class="tag">${icon("check")} Best</span>`, runner: `<span class="tag">Runner-up</span>`, current: `<span class="tag">Current</span>` };
    return `<table class="options">
      <caption class="sr-only">Options scored by the decision engine</caption>
      <thead><tr><th scope="col">Option</th><th scope="col">Due today</th><th scope="col">Monthly</th><th scope="col">Total</th><th scope="col">Δ vs. current</th></tr></thead>
      <tbody>${options.map((o) => `<tr class="opt-${o.role}">
        <td>${esc(o.label)}${tag[o.role] || ""}</td>
        <td>${money(o.today_cents)}</td><td>${money(o.monthly_cents)}</td><td>${money(o.total_cents)}</td><td>${signed(o.delta_cents)}</td>
      </tr>`).join("")}</tbody>
    </table>
    <p class="options-note">Total = financing payoff plus the new phone after promo and trade-in. Synthetic prices.</p>`;
  }

  function TheMath() {
    const key = state.thinking ? "thinking" : state.rec ? "rec" : "empty";
    if (key === mathKey) return;
    mathKey = key;
    const el = $("math");
    if (key === "thinking") {
      el.innerHTML = `<div aria-busy="true" aria-label="${esc(state.thinking)}" style="display:flex;flex-direction:column;gap:var(--space-xs)">
        <div class="skel" style="height:12px;width:24%"></div><div class="skel" style="height:30px;width:64%"></div><div class="skel" style="height:16px;width:88%"></div>
        <div class="math-grid"><div style="display:flex;flex-direction:column;gap:var(--space-2xs)">${[1, 2, 3, 4].map(() => '<div class="skel" style="height:22px"></div>').join("")}<div class="skel" style="height:56px"></div></div><div class="skel" style="height:150px"></div></div>
        ${[1, 2, 3].map(() => '<div class="skel" style="height:30px"></div>').join("")}</div>`;
      return;
    }
    const r = state.rec;
    if (!r) {
      el.innerHTML = `<div class="empty"><strong>No recommendation yet.</strong>The engine runs when the caller asks for something. Every answer shows its math and a runner-up.</div>`;
      return;
    }
    const buy = r.kind === "buy";
    el.innerHTML = `
      <div>
        <span class="verdict-label ${buy ? "buy" : ""}">${icon(buy ? "check" : "clock")} Best option</span>
        <h3 class="verdict-title">${esc(r.best)}</h3>
        <p class="verdict-reason">${esc(r.reason)}</p>
      </div>
      <div class="math-grid">
        <div>
          <dl class="sum">
            ${r.math.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${m.cents < 0 ? "−" : m === r.math[0] ? "" : "+"}${money(Math.abs(m.cents))}</dd></div>`).join("")}
            <div class="total"><dt>${esc(r.math_total.label)}</dt><dd>${money(r.math_total.cents)}</dd></div>
          </dl>
          <div class="saved">
            <span class="saved-label">Saved by waiting<small>vs. upgrading today · synthetic</small></span>
            <span class="saved-num num" id="saved-num">${money(shownSavings, true)}</span>
          </div>
        </div>
        <div class="aside-col">
          <div class="chart"><span class="chart-k"><span>Trade-in value</span><span>weeks from now</span></span>${TradeinChart(r.tradein)}</div>
          <div class="runner-up"><span class="k">Runner-up</span><span class="t">${esc(r.runner_up)}</span><p>${esc(r.runner_up_detail)}</p><div class="ruled">Ruled out: ${esc(r.ruled_out)}</div></div>
        </div>
      </div>
      ${OptionsTable(r.options)}`;
  }

  function SavingsCounter() {
    const el = $("saved-num"), target = state.savings;
    if (!el) { shownSavings = target; return; }
    if (reduceMotion.matches || target <= shownSavings) { shownSavings = target; el.textContent = money(target, true); return; }
    const from = shownSavings, start = performance.now(), dur = 900;
    shownSavings = target;
    const tick = (now) => {
      const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 4);
      if (shownSavings !== target || !el.isConnected) return;
      el.textContent = money(Math.round(from + (target - from) * e), true);
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function Guards() {
    $("guards").innerHTML = S.guards.map((g) => {
      const st = state.guards[g.key];
      const text = g.key === "approval" && st === "pending" ? `Waiting for ${S.owner.name}` : STATE[st].text;
      return `<li class="guard"><span><span class="guard-name">${esc(g.label)}</span><span class="guard-rule">R${g.rule}</span></span><span class="state ${st}">${icon(STATE[st].icon)} ${esc(text)}</span></li>`;
    }).join("");
  }

  function CheckoutCard() {
    const c = state.checkout, el = $("checkout");
    el.hidden = !c;
    if (!c) return;
    const approval = c.approval === "approved"
      ? `<span class="chip pass">${icon("check")} ${esc(S.owner.name)} said YES</span>`
      : c.approval === "denied" ? `<span class="chip blocked">${icon("x")} ${esc(S.owner.name)} said NO</span>`
      : `<span class="chip pending">${icon("clock")} Waiting for ${esc(S.owner.name)}</span>`;
    el.innerHTML = `
      <div class="region-head"><h2 id="c-title">Checkout</h2><span class="chip mock">MOCK</span></div>
      <dl aria-labelledby="c-title">
        <dt>${esc(c.item)}</dt><dd class="amount num">${money(c.amount_cents)}</dd>
        <dt>Owner limit</dt><dd class="num">${money(S.owner.limit_cents)}${c.amount_cents > S.owner.limit_cents ? `<span class="over">${money(c.amount_cents - S.owner.limit_cents)} over, approval required</span>` : ""}</dd>
        <dt>Approval</dt><dd>${approval}</dd>
        <dt>Card token</dt><dd class="mono">${esc(c.token)}</dd>
        <dt>Status</dt><dd>${c.charged ? `<span class="chip pass">${icon("check")} Charged (MOCK)</span>` : `<span class="chip">${icon("minus")} Not charged</span>`}</dd>
      </dl>`;
  }

  function SignalStrip() {
    $("signals").innerHTML = S.signals.map((s) => {
      const on = state.signalsOn.has(s.key);
      return `<li class="signal ${on ? "on" : ""}">${icon(on ? "check" : "circle")}<span>${esc(s.label)}${s.value ? ` <b>${esc(s.value)}</b>` : ""}</span><span class="sr-only">${on ? "used" : "not used yet"}</span></li>`;
    }).join("");
  }

  function AuditBand() {
    const el = $("audit");
    $("a-meta").textContent = state.audit.length ? `${state.audit.length} actions · newest first` : "newest first";
    if (!state.audit.length) { el.innerHTML = `<li class="audit-empty">No actions yet. Every tool call and guard check lands here.</li>`; auditSeen = 0; return; }
    const fresh = state.audit.length - auditSeen;
    auditSeen = state.audit.length;
    el.innerHTML = state.audit.map((a, i) => {
      const g = a.guard === "none" ? `<span class="g none">${icon("minus")} no guard</span>` : `<span class="g ${a.guard}">${icon(STATE[a.guard].icon)} ${a.guard}</span>`;
      return `<li class="${i < fresh ? "fresh" : ""}"><span class="clock">${a.clock}</span><span class="actor">${esc(a.actor)}</span><span>${esc(a.action)}</span><span class="detail">→ ${esc(a.detail)}</span>${g}</li>`;
    }).join("");
  }

  function render() {
    TopBar(); Transcript(); TheMath(); SavingsCounter(); Guards(); CheckoutCard(); SignalStrip(); AuditBand();
  }

  // ---------- demo player ----------
  function play() {
    timers.forEach(clearTimeout);
    timers = [];
    state = initialState();
    shownSavings = 0;
    mathKey = "";
    render();
    for (const step of S.steps) timers.push(setTimeout(() => apply(step), LEAD_MS + (step.at * 1000) / speed));
  }

  async function resetDemo() {
    play();
    const err = $("a-error");
    try {
      const res = await fetch("/api/demo/reset", { method: "POST" });
      if (!res.ok) throw new Error(res.status);
      err.hidden = true;
    } catch {
      err.hidden = true; // no backend in the web app: demo restarts locally
    }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    if (next === "dark") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try { localStorage.setItem("selldial:theme", next); } catch {}
  }

  // ---------- command palette ----------
  const COMMANDS = [
    { label: "Reset demo", hint: "R", run: resetDemo },
    { label: "Switch theme", hint: "light / dark", run: toggleTheme },
    { label: "Open console", hint: "approvals, handoffs", run: () => { location.href = "console.html"; } },
    { label: "Jump to audit log", hint: "graphite band", run: () => $("audit-band").focus() },
  ];
  let paletteOpen = false, paletteOpener = null, selected = 0, filtered = COMMANDS;

  function renderPalette() {
    const q = $("palette-input").value.trim().toLowerCase();
    filtered = COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
    selected = Math.min(selected, Math.max(0, filtered.length - 1));
    $("palette-list").innerHTML = filtered.length
      ? filtered.map((c, i) => `<li role="option" id="cmd-${i}" data-i="${i}" aria-selected="${i === selected}"><span>${esc(c.label)}</span><span class="hint">${esc(c.hint)}</span></li>`).join("")
      : `<li class="none" role="option" aria-disabled="true">No matching command</li>`;
    $("palette-input").setAttribute("aria-activedescendant", filtered.length ? `cmd-${selected}` : "");
  }
  function openPalette() {
    paletteOpener = document.activeElement;
    paletteOpen = true;
    selected = 0;
    $("palette-input").value = "";
    $("palette").hidden = false;
    $("palette-scrim").hidden = false;
    renderPalette();
    $("palette-input").focus();
  }
  function closePalette() {
    if (!paletteOpen) return;
    paletteOpen = false;
    $("palette").hidden = true;
    $("palette-scrim").hidden = true;
    if (paletteOpener?.isConnected) paletteOpener.focus();
  }
  function runCommand(i) {
    const cmd = filtered[i];
    if (!cmd) return;
    closePalette();
    cmd.run();
  }

  $("open-palette").addEventListener("click", openPalette);
  $("palette-scrim").addEventListener("click", closePalette);
  $("palette-input").addEventListener("input", () => { selected = 0; renderPalette(); });
  $("palette-list").addEventListener("click", (e) => { const li = e.target.closest("li[data-i]"); if (li) runCommand(Number(li.dataset.i)); });
  $("palette").addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!filtered.length) return;
      selected = (selected + (e.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length;
      renderPalette();
    } else if (e.key === "Enter") { e.preventDefault(); runCommand(selected); }
    else if (e.key === "Tab") { e.preventDefault(); } // the input is the only stop; keep focus inside
  });

  $("reset").addEventListener("click", resetDemo);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); paletteOpen ? closePalette() : openPalette(); return; }
    if (e.key === "Escape") return closePalette();
    if (paletteOpen || e.key.toLowerCase() !== "r" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
    resetDemo();
  });

  play();
})();
