/* Canvas editor: build an NFA by hand — place state circles, draw transition
   wires, mark the start and accepting states. Emits engine text via onChange.
   The serialize() logic is pure (no DOM) so it can be unit-tested in Node. */
(function (root) {
  "use strict";
  const SVGNS = "http://www.w3.org/2000/svg";
  const R = 22;               // node radius
  const el = (t, a) => { const n = document.createElementNS(SVGNS, t); for (const k in a) n.setAttribute(k, a[k]); return n; };

  class CanvasEditor {
    constructor(host, opts) {
      this.host = host;
      this.opts = opts || {};
      this.model = { nodes: [], start: null, edges: [] };  // edges: {from,to,sym}
      this.mode = "move";
      this.sel = null;      // selected node id
      this.pending = null;  // transition source id
      this.build();
    }

    // ---------- pure serialization (NO DOM — safe in Node) ----------
    static serialize(model) {
      const nodes = model.nodes || [], edges = model.edges || [];
      if (!nodes.length) return "# draw a state to begin";
      const ids = nodes.map(n => n.id);
      const start = model.start && ids.includes(model.start) ? model.start : ids[0];
      const finals = nodes.filter(n => n.final).map(n => n.id);
      const groups = {};
      for (const e of edges) {
        if (!ids.includes(e.from) || !ids.includes(e.to)) continue;
        const k = e.from + "|" + e.sym;
        (groups[k] = groups[k] || []).push(e.to);
      }
      const lines = ["# automaton drawn by hand", "states: " + ids.join(", "), "start: " + start];
      if (finals.length) lines.push("final: " + finals.join(", "));
      Object.keys(groups).forEach(k => {
        const [from, sym] = k.split("|");
        const tos = Array.from(new Set(groups[k]));
        lines.push(from + "," + sym + " = " + tos.join(","));
      });
      return lines.join("\n");
    }

    emit() { if (this.opts.onChange) this.opts.onChange(CanvasEditor.serialize(this.model)); }
    changed() { this.paint(); this.emit(); }

    // ---------- model helpers ----------
    nextId() { let i = 0; const used = new Set(this.model.nodes.map(n => n.id)); while (used.has("q" + i)) i++; return "q" + i; }
    node(id) { return this.model.nodes.find(n => n.id === id); }
    addNode(x, y) {
      const n = { id: this.nextId(), x, y, final: false };
      this.model.nodes.push(n);
      if (!this.model.start) this.model.start = n.id;
      this.sel = n.id; this.changed();
    }
    removeNode(id) {
      this.model.nodes = this.model.nodes.filter(n => n.id !== id);
      this.model.edges = this.model.edges.filter(e => e.from !== id && e.to !== id);
      if (this.model.start === id) this.model.start = this.model.nodes[0] ? this.model.nodes[0].id : null;
      if (this.sel === id) this.sel = null;
      this.changed();
    }
    addEdge(from, to) {
      const raw = (typeof prompt === "function"
        ? prompt("Transition symbol(s) — comma-separate several; use ε, e or eps for epsilon:", "a") : "a");
      if (raw == null) return;
      const syms = raw.split(",").map(s => s.trim()).filter(Boolean).map(s => /^(eps|epsilon|e|λ|ε)$/i.test(s) ? "ε" : s);
      for (const sym of syms) {
        if (!this.model.edges.some(e => e.from === from && e.to === to && e.sym === sym)) this.model.edges.push({ from, to, sym });
      }
      this.changed();
    }

    // ---------- load existing text (browser; needs Automata global) ----------
    load(text) {
      const A = (typeof Automata !== "undefined" ? Automata : root.Automata);
      this.model = { nodes: [], start: null, edges: [] };
      let N = null; try { N = A && text && text.trim() ? A.parse(text) : null; } catch (e) { N = null; }
      if (N && N.states.length) {
        const cx = 300, cy = 170, rad = Math.min(130, 40 + N.states.length * 14);
        N.states.forEach((s, i) => {
          const ang = -Math.PI / 2 + (2 * Math.PI * i) / N.states.length;
          this.model.nodes.push({ id: s, x: Math.round(cx + rad * Math.cos(ang)), y: Math.round(cy + rad * Math.sin(ang)), final: N.finals.includes(s) });
        });
        this.model.start = N.start;
        Object.keys(N.d).forEach(k => {
          const [from, sym] = k.split("|");
          N.d[k].forEach(to => this.model.edges.push({ from, to, sym }));
        });
      }
      this.sel = null; this.pending = null; this.paint();
    }

    // ---------- DOM ----------
    build() {
      this.host.innerHTML =
        '<div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
        '<button class="btn sm" data-cmode="move">Move</button>' +
        '<button class="btn sm" data-cmode="state">+ State</button>' +
        '<button class="btn sm" data-cmode="transition">+ Transition</button>' +
        '<button class="btn sm" data-cmode="delete">Delete</button>' +
        '<span style="width:10px"></span>' +
        '<button class="btn sm quiet" data-caction="start">Set start</button>' +
        '<button class="btn sm quiet" data-caction="final">Toggle accept</button>' +
        '<button class="btn sm quiet" data-caction="clear">Clear</button>' +
        '</div>' +
        '<div class="c-hint small" style="margin-bottom:6px"></div>';
      const svg = el("svg", { viewBox: "0 0 600 340", role: "img" });
      svg.style.width = "100%"; svg.style.height = "320px";
      svg.style.border = "1px solid var(--line,#ccc)"; svg.style.borderRadius = "10px"; svg.style.touchAction = "none";
      const defs = el("defs");
      const mk = (id, color) => { const m = el("marker", { id, viewBox: "0 0 10 10", refX: "9", refY: "5", markerWidth: "7", markerHeight: "7", orient: "auto-start-reverse" }); m.appendChild(el("path", { d: "M0,0 L10,5 L0,10 z", fill: color })); return m; };
      defs.appendChild(mk("ca-arrow", "#667")); defs.appendChild(mk("ca-arrow-hot", "#2E5496"));
      svg.appendChild(defs);
      this.svg = svg; this.host.appendChild(svg);

      this.host.querySelectorAll("[data-cmode]").forEach(b => b.addEventListener("click", () => { this.mode = b.dataset.cmode; this.pending = null; this.paint(); }));
      this.host.querySelectorAll("[data-caction]").forEach(b => b.addEventListener("click", () => this.action(b.dataset.caction)));
      svg.addEventListener("click", e => { if (e.target === svg || e.target.tagName === "rect") this.onBg(e); });
      this.paint();
    }

    action(a) {
      if (a === "clear") { this.model = { nodes: [], start: null, edges: [] }; this.sel = this.pending = null; this.changed(); return; }
      if (!this.sel) { this.setHint("Select a state first (use Move, then click a circle)."); return; }
      if (a === "start") this.model.start = this.sel;
      if (a === "final") { const n = this.node(this.sel); if (n) n.final = !n.final; }
      this.changed();
    }

    toLocal(e) { const p = this.svg.createSVGPoint(); p.x = e.clientX; p.y = e.clientY; const m = this.svg.getScreenCTM(); return m ? p.matrixTransform(m.inverse()) : { x: e.offsetX, y: e.offsetY }; }
    onBg(e) { if (this.mode === "state") { const p = this.toLocal(e); this.addNode(Math.round(p.x), Math.round(p.y)); } else { this.sel = null; this.pending = null; this.paint(); } }

    onNode(e, id) {
      e.stopPropagation();
      if (this.mode === "delete") return this.removeNode(id);
      if (this.mode === "transition") {
        if (!this.pending) { this.pending = id; this.setHint("Now click the target state (click the same state for a self-loop)."); this.paint(); }
        else { const from = this.pending; this.pending = null; this.addEdge(from, id); }
        return;
      }
      // move / select
      this.sel = id; this.paint();
      if (this.mode === "move") {
        const n = this.node(id); if (!n) return;
        const move = ev => { const p = this.toLocal(ev); n.x = Math.round(p.x); n.y = Math.round(p.y); this.paint(); };
        const up = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); this.emit(); };
        document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
      }
    }

    setHint(t) { const h = this.host.querySelector(".c-hint"); if (h) h.textContent = t; }

    paint() {
      const svg = this.svg; if (!svg) return;
      [...svg.querySelectorAll(".ca-el")].forEach(n => n.remove());
      const add = n => { n.classList.add("ca-el"); svg.appendChild(n); return n; };
      const byId = {}; this.model.nodes.forEach(n => (byId[n.id] = n));

      // group edges by from|to for display (merge symbols)
      const pairs = {};
      for (const e of this.model.edges) { const k = e.from + "\u0001" + e.to; (pairs[k] = pairs[k] || { from: e.from, to: e.to, syms: [] }); if (!pairs[k].syms.includes(e.sym)) pairs[k].syms.push(e.sym); }
      Object.values(pairs).forEach(p => {
        const a = byId[p.from], b = byId[p.to]; if (!a || !b) return;
        const label = p.syms.join(",");
        if (p.from === p.to) {
          const path = add(el("path", { d: `M ${a.x - 8} ${a.y - R} C ${a.x - 40} ${a.y - R - 46}, ${a.x + 40} ${a.y - R - 46}, ${a.x + 8} ${a.y - R}`, fill: "none", stroke: "#667", "stroke-width": "1.6", "marker-end": "url(#ca-arrow)" }));
          add(el("text", { x: a.x, y: a.y - R - 40, "text-anchor": "middle", "font-size": "13", fill: "#333" })).textContent = label;
        } else {
          const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
          const reverse = pairs[p.to + "\u0001" + p.from];
          const bend = reverse ? 26 : 0, nx = -uy, ny = ux;
          const sx = a.x + ux * R, sy = a.y + uy * R, ex = b.x - ux * R, ey = b.y - uy * R;
          const mx = (sx + ex) / 2 + nx * bend, my = (sy + ey) / 2 + ny * bend;
          add(el("path", { d: `M ${sx} ${sy} Q ${mx} ${my} ${ex} ${ey}`, fill: "none", stroke: "#667", "stroke-width": "1.6", "marker-end": "url(#ca-arrow)" }));
          const lx = (sx + ex) / 2 + nx * (bend + 12), ly = (sy + ey) / 2 + ny * (bend + 12);
          add(el("text", { x: lx, y: ly, "text-anchor": "middle", "font-size": "13", fill: "#333" })).textContent = label;
        }
      });

      // nodes
      this.model.nodes.forEach(n => {
        if (this.model.start === n.id) {
          add(el("path", { d: `M ${n.x - R - 26} ${n.y} L ${n.x - R - 2} ${n.y}`, stroke: "#2E5496", "stroke-width": "1.8", "marker-end": "url(#ca-arrow-hot)" }));
        }
        const g = add(el("g", { style: "cursor:pointer" }));
        const stroke = n.id === this.pending ? "#c0392b" : (n.id === this.sel ? "#2E5496" : "#334");
        g.appendChild(el("circle", { cx: n.x, cy: n.y, r: R, fill: "#fff", stroke, "stroke-width": n.id === this.sel || n.id === this.pending ? "2.4" : "1.6" }));
        if (n.final) g.appendChild(el("circle", { cx: n.x, cy: n.y, r: R - 4, fill: "none", stroke, "stroke-width": "1.2" }));
        const tx = el("text", { x: n.x, y: n.y + 4, "text-anchor": "middle", "font-size": "13", "font-weight": "600", fill: "#223" }); tx.textContent = n.id; g.appendChild(tx);
        g.addEventListener("pointerdown", e => this.onNode(e, n.id));
      });

      const hints = { move: "Drag circles to move. Click a circle to select it, then Set start / Toggle accept.", state: "Click an empty spot to add a state.", transition: "Click the source state, then the target (same state = self-loop).", delete: "Click a state to delete it and its transitions." };
      this.setHint(hints[this.mode] || "");
      this.host.querySelectorAll("[data-cmode]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.cmode === this.mode)));
    }
  }

  if (typeof module !== "undefined" && module.exports) module.exports = CanvasEditor;
  else root.CanvasEditor = CanvasEditor;
})(typeof window !== "undefined" ? window : globalThis);
