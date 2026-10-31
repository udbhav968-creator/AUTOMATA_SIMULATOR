/*
 * Shared shell for every page: navigation rail, theme switch, toasts, safe storage,
 * a fetch helper that knows when the server is offline, and hand-off of automata between pages.
 * Exposes window.Studio.
 */
(function () {
  "use strict";

  const PAGES = [
    { group: "Simulate", items: [
      { href: "subset.html", label: "NFA → DFA", icon: "subset" },
      { href: "run.html", label: "String run", icon: "run" },
      { href: "minimize.html", label: "Minimise DFA", icon: "min" }
    ] },
    { group: "Practise", items: [
      { href: "practice.html", label: "Practice & exam", icon: "quiz" },
      { href: "bank.html", label: "Question bank", icon: "bank" },
      { href: "tutor.html", label: "AI tutor", icon: "chat" }
    ] },
    { group: "Reference", items: [
      { href: "theory.html", label: "Theory & design", icon: "book" },
      { href: "tools.html", label: "Language tools", icon: "tools" },
      { href: "tests.html", label: "Test suite", icon: "check" },
      { href: "report.html", label: "Project report", icon: "doc" }
    ] }
  ];
  const ICONS = {
    subset: '<circle cx="5" cy="12" r="3"/><circle cx="19" cy="6" r="3"/><circle cx="19" cy="18" r="3"/><path d="M8 11l8-4M8 13l8 4"/>',
    run: '<rect x="2" y="8" width="20" height="8" rx="2"/><path d="M8 8v8M14 8v8M11 3l-2 3h4z"/>',
    min: '<circle cx="7" cy="7" r="3"/><circle cx="7" cy="17" r="3"/><circle cx="18" cy="12" r="3.5"/><path d="M10 8l5 3M10 16l5-3"/>',
    quiz: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    bank: '<path d="M4 6h16M4 12h16M4 18h10"/><circle cx="19" cy="18" r="2"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/>',
    book: '<path d="M4 4h7a3 3 0 013 3v13a2 2 0 00-2-2H4zM20 4h-6"/><path d="M20 4v14h-6"/>',
    tools: '<path d="M14 6l4 4-8 8H6v-4z"/>',
    check: '<path d="M4 12l5 5L20 6"/>',
    doc: '<path d="M6 3h9l4 4v14H6z"/><path d="M9 12h7M9 16h7"/>'
  };
  const icon = (n, s) => `<svg width="${s || 18}" height="${s || 18}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ""}</svg>`;
  const BRAND = '<svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true"><path d="M2 20h8" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M8 16l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="20" r="11" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="26" cy="20" r="6.5" fill="var(--marker)" stroke="currentColor" stroke-width="2.2"/></svg>';

  /* ------------------------------------------------------------ utilities */
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /** localStorage that never throws (private mode, full quota, disabled storage). */
  const store = {
    get(k, fallback) { try { const v = localStorage.getItem("studio." + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { localStorage.setItem("studio." + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem("studio." + k); } catch (e) { /* ignore */ } }
  };
  const session = {
    get(k, fallback) { try { const v = sessionStorage.getItem("studio." + k); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; } },
    set(k, v) { try { sessionStorage.setItem("studio." + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del(k) { try { sessionStorage.removeItem("studio." + k); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------------------------------------ theme */
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  applyTheme(store.get("theme", "system"));

  /* ------------------------------------------------------------ toasts */
  function toast(text, kind, ms) {
    let host = $(".toasts");
    if (!host) { host = document.createElement("div"); host.className = "toasts"; host.setAttribute("role", "status"); host.setAttribute("aria-live", "polite"); document.body.append(host); }
    const t = document.createElement("div");
    t.className = "toast " + (kind || "");
    t.textContent = text;
    host.append(t);
    setTimeout(() => t.remove(), ms || 3800);
  }

  /** Confirmation dialog that returns a Promise<boolean>. */
  function confirmBox(title, body, okLabel) {
    return new Promise(resolve => {
      const d = document.createElement("dialog");
      d.innerHTML = `<h2>${esc(title)}</h2><p class="muted">${esc(body)}</p><div class="row" style="justify-content:flex-end;margin-top:14px"><button class="btn" value="no">Cancel</button><button class="btn primary" value="yes">${esc(okLabel || "OK")}</button></div>`;
      document.body.append(d);
      d.addEventListener("click", e => { const v = e.target.closest("button") && e.target.closest("button").value; if (v) { d.close(); d.remove(); resolve(v === "yes"); } });
      d.addEventListener("cancel", () => { d.remove(); resolve(false); });
      d.showModal();
    });
  }

  /* ------------------------------------------------------------ server access */
  let serverState = null; // null = unknown, otherwise the /api/health payload or { down: true }
  async function api(url, opts) {
    opts = opts || {};
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), opts.timeout || 45000);
    let r;
    try {
      r = await fetch(url, { method: opts.method || (opts.body ? "POST" : "GET"), headers: { "content-type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: ctrl.signal });
    } catch (e) {
      const err = new Error(e.name === "AbortError" ? "The server did not answer in time." : "The server is not running. Start it with: node server.js");
      err.offline = true;
      throw err;
    } finally { clearTimeout(timer); }
    let j = null;
    try { j = await r.json(); } catch (e) { const err = new Error("The server sent an unreadable reply (is this a static host without server.js?)."); err.offline = true; throw err; }
    if (!r.ok) { const err = new Error((j && j.error) || "Request failed (" + r.status + ")"); err.status = r.status; err.data = j; throw err; }
    return j;
  }
  async function health(force) {
    if (serverState && !force) { paintStatus(); return serverState; }
    try { serverState = await api("/api/health", { timeout: 6000 }); }
    catch (e) { serverState = { down: true }; }
    paintStatus();
    return serverState;
  }
  function paintStatus() {
    $$(".status[data-ai]").forEach(el => {
      const s = serverState;
      if (!s) { el.className = "status"; el.lastChild.textContent = "Checking tutor…"; return; }
      if (s.down) { el.className = "status down"; el.lastChild.textContent = "Server offline — built-in tutor"; }
      else if (s.ai) { el.className = "status on"; el.lastChild.textContent = "Gemini tutor ready"; }
      else { el.className = "status off"; el.lastChild.textContent = "Built-in tutor (no Gemini key)"; }
    });
  }

  /* ------------------------------------------------------------ hand-off between pages */
  /** Send an automaton (or other payload) to another page and open it. */
  function handoff(page, payload) {
    session.set("handoff." + page, { ...payload, at: Date.now() });
    location.href = page;
  }
  function takeHandoff(page) {
    const v = session.get("handoff." + page, null);
    session.del("handoff." + page);
    if (!v || Date.now() - v.at > 10 * 60 * 1000) return null;
    return v;
  }
  /** The automaton most recently used anywhere (for the report and tutor pages). */
  const lastAutomaton = {
    get: () => store.get("last.automaton", null),
    set: (src, from) => store.set("last.automaton", { src, from, at: Date.now() })
  };

  /* ------------------------------------------------------------ shell */
  function mountShell() {
    const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    const app = document.createElement("div");
    app.className = "app";
    const nav = PAGES.map(g => `<h2>${g.group}</h2>` + g.items.map(i => `<a class="nav" href="${i.href}"${i.href === here ? ' aria-current="page"' : ""}>${icon(i.icon)}<span>${i.label}</span></a>`).join("")).join("");
    const theme = store.get("theme", "system");
    app.innerHTML = `<nav class="rail" id="rail" aria-label="Main">
        <a class="brand" href="index.html">${BRAND}<div><b>Automata Studio</b><span>CSET302 simulator</span></div></a>
        ${nav}
        <div class="foot">
          <div class="status" data-ai><i></i><span>Checking tutor…</span></div>
          <div class="seg" role="group" aria-label="Colour theme">${["light", "system", "dark"].map(t => `<button type="button" data-theme-set="${t}" aria-pressed="${t === theme}">${t[0].toUpperCase() + t.slice(1)}</button>`).join("")}</div>
        </div>
      </nav>
      <div class="topbar"><button class="btn icon" id="menuBtn" aria-label="Open menu" aria-expanded="false"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button><a class="brand" href="index.html">${BRAND}<div><b>Automata Studio</b></div></a></div>`;
    const main = document.querySelector("main.page");
    document.body.prepend(app);
    if (main) app.append(main);
    const rail = $("#rail"), menu = $("#menuBtn");
    let scrim = null;
    const close = () => { rail.classList.remove("open"); menu.setAttribute("aria-expanded", "false"); if (scrim) { scrim.remove(); scrim = null; } };
    menu.addEventListener("click", () => {
      if (rail.classList.contains("open")) return close();
      rail.classList.add("open"); menu.setAttribute("aria-expanded", "true");
      scrim = document.createElement("div"); scrim.className = "scrim"; scrim.addEventListener("click", close); document.body.append(scrim);
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
    $$("[data-theme-set]").forEach(b => b.addEventListener("click", () => {
      const t = b.dataset.themeSet; store.set("theme", t); applyTheme(t);
      $$("[data-theme-set]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      document.dispatchEvent(new CustomEvent("studio:theme"));
    }));
    health();
  }

  /** True when the user is typing, so global keyboard shortcuts stay out of the way. */
  const typing = e => { const t = e.target; return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)); };

  window.Studio = { esc, $, $$, debounce, store, session, toast, confirmBox, api, health, handoff, takeHandoff, lastAutomaton, icon, typing, context: null };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mountShell); else mountShell();
})();
