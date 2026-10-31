/*
 * GraphView — draws an automaton as an SVG state diagram that stays readable.
 *
 * Layout:   states in BFS layers from the start state, ordered with barycentre sweeps to reduce crossings
 *           (or a circle layout). Positions are computed for the whole graph up front, so states that
 *           appear later during a step-by-step replay never push others around.
 * Edges:    parallel transitions are merged into one arrow with a combined label; opposite directions
 *           curve to opposite sides; every edge is tested against every other state and bends further
 *           until it clears them. Self-loops are placed on the emptiest side of the state.
 * Labels:   placed with a collision check against states and other labels, with a halo so a crossing
 *           line never hides the text.
 * Input:    drag a state to move it (edges re-route live), drag the background to pan,
 *           Ctrl/⌘ + scroll or pinch to zoom, double-click to fit.
 */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  let uidCounter = 0;

  const NAME_W = 9.2, SUB_W = 7.1, LABEL_W = 9, MAX_R = 50, MIN_R = 24, RING = 5.5;

  class GraphView {
    constructor(host, opts) {
      this.host = host;
      this.opts = Object.assign({ title: "", legend: [], interactive: true, layout: "layered", emptyText: "Nothing to draw yet." }, opts || {});
      this.uid = "gv" + (++uidCounter);
      this.view = { x: 0, y: 0, k: 1 };
      this.userMoved = false;
      this.pos = {}; this.pinned = {};
      this.g = null; this.v = {};
      host.classList.add("canvas");
      host.innerHTML = `
        <div class="title">${esc(this.opts.title)}</div>
        <div class="tools">
          <button class="btn sm" data-act="out" title="Zoom out" aria-label="Zoom out">−</button>
          <button class="btn sm" data-act="in" title="Zoom in" aria-label="Zoom in">+</button>
          <button class="btn sm" data-act="fit" title="Fit to view (double-click the background)">Fit</button>
          <details class="more"><summary class="btn sm" title="More options" aria-label="More diagram options">⋯</summary>
            <div class="menu">
              <button class="btn sm quiet" data-act="tidy">Tidy layout (undo dragging)</button>
              <button class="btn sm quiet" data-act="layout">Circle layout</button>
              <button class="btn sm quiet" data-act="png">Download PNG</button>
              <button class="btn sm quiet" data-act="svg">Download SVG</button>
              <p class="tiny muted" style="margin:4px 8px 2px">Drag states to move them. Drag the background to pan. Ctrl + scroll or pinch to zoom.</p>
            </div>
          </details>
        </div>
        <svg class="graph" xmlns="${NS}" role="img" aria-label="${esc(this.opts.title || "State diagram")}">
          <defs>
            ${["def", "eps", "hot"].map(k => `<marker id="${this.uid}-${k}" viewBox="0 0 10 10" refX="9.2" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto-start-reverse"><path d="M0,0.6 L10,5 L0,9.4 z" style="fill:var(${k === "def" ? "--edge" : k === "eps" ? "--eps" : "--marker"})"/></marker>`).join("")}
            <marker id="${this.uid}-start" viewBox="0 0 10 10" refX="9.2" refY="5" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="14" orient="auto"><path d="M0,0.6 L10,5 L0,9.4 z" style="fill:var(--ink)"/></marker>
          </defs>
          <g class="vp"><g class="edges"></g><g class="labels"></g><g class="nodes"></g><g class="tokens"></g></g>
        </svg>
        <div class="legend"${this.opts.legend.length ? "" : " hidden"}>${this.opts.legend.map(l => `<span><i style="${l.style}"></i>${esc(l.text)}</span>`).join("")}</div>
        <div class="empty">${esc(this.opts.emptyText)}</div>`;
      this.svg = host.querySelector("svg");
      this.vp = host.querySelector(".vp");
      this.layers = { edges: host.querySelector(".edges"), labels: host.querySelector(".labels"), nodes: host.querySelector(".nodes"), tokens: host.querySelector(".tokens") };
      if (!this.opts.interactive) host.querySelector(".tools").hidden = true;
      host.querySelector(".tools").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        const a = b.dataset.act;
        if (!a) return;
        const menu = b.closest("details"); if (menu) menu.open = false;
        if (a === "in") this.zoomBy(1.2); else if (a === "out") this.zoomBy(1 / 1.2); else if (a === "fit") this.fit();
        else if (a === "tidy") { this.pinned = {}; this.relayout(); }
        else if (a === "layout") { this.opts.layout = this.opts.layout === "circle" ? "layered" : "circle"; b.textContent = this.opts.layout === "circle" ? "Layered layout" : "Circle layout"; this.pinned = {}; this.relayout(); }
        else if (a === "png") this.download("png"); else if (a === "svg") this.download("svg");
      });
      this.bindPointer();
      if (window.ResizeObserver) new ResizeObserver(() => { if (!this.userMoved) this.fit(); }).observe(host);
    }

    /* -------------------------------------------------------------- data */

    /** g = { nodes:[{id,label,sub,title,final,start,dead,x?,y?}], edges:[{from,to,sym}] } */
    setGraph(g, opts) {
      opts = opts || {};
      if (!g || !g.nodes || !g.nodes.length) { this.g = null; this.clear(); return; }
      const nodes = g.nodes.map(n => {
        const name = String(n.label != null ? n.label : n.id);
        let sub = n.sub != null ? String(n.sub) : "";
        const nameW = name.length * NAME_W;
        let r = Math.max(MIN_R, nameW / 2 + 9);
        if (sub) {
          const maxChars = Math.floor(((MAX_R - 8) * 2) / SUB_W);
          if (sub.length > maxChars) sub = sub.slice(0, maxChars - 1) + "…";
          r = Math.max(r, (sub.length * SUB_W) / 2 + 9, 26);
        }
        r = Math.min(MAX_R, r);
        return Object.assign({}, n, { name, subText: sub, r, rr: r + (n.final ? RING : 0) });
      });
      const byId = {}; nodes.forEach(n => (byId[n.id] = n));
      const groups = {};
      (g.edges || []).forEach(e => {
        if (!byId[e.from] || !byId[e.to]) return;
        const k = e.from + "\u0001" + e.to;
        (groups[k] = groups[k] || { key: k, from: e.from, to: e.to, syms: [] });
        if (!groups[k].syms.includes(e.sym)) groups[k].syms.push(e.sym);
      });
      Object.values(groups).forEach(gr => gr.syms.sort((a, b) => (a === "ε") - (b === "ε") || String(a).localeCompare(String(b))));
      const sameShape = this.g && opts.keep && this.g.nodes.length === nodes.length && nodes.every(n => this.pos[n.id]);
      this.g = { nodes, byId, groups: Object.values(groups), fixed: !!g.fixed };
      if (!sameShape) { this.pinned = {}; this.layout(); }
      this.route();
      this.render();
      this.applyView();
      if (!sameShape || !this.userMoved) this.fit();
      this.host.querySelector(".empty").hidden = true;
    }

    clear() {
      Object.values(this.layers).forEach(l => (l.innerHTML = ""));
      this.host.querySelector(".empty").hidden = false;
    }

    relayout() { if (!this.g) return; this.layout(); this.route(); this.render(); this.applyView(); this.fit(); }

    /* -------------------------------------------------------------- layout */

    layout() {
      const { nodes, groups } = this.g;
      if (this.g.fixed) { nodes.forEach(n => (this.pos[n.id] = { x: n.x, y: n.y })); return; }
      const ids = nodes.map(n => n.id), out = {}, inn = {};
      ids.forEach(i => { out[i] = []; inn[i] = []; });
      groups.forEach(e => { if (e.from !== e.to) { out[e.from].push(e.to); inn[e.to].push(e.from); } });
      const start = (nodes.find(n => n.start) || nodes[0]).id;
      const maxR = Math.max(...nodes.map(n => n.rr));

      if (this.opts.layout === "circle" || nodes.length > 40) {
        const order = [], seen = new Set();
        const bfs = s => { const q = [s]; seen.add(s); while (q.length) { const x = q.shift(); order.push(x); out[x].forEach(t => { if (!seen.has(t)) { seen.add(t); q.push(t); } }); } };
        bfs(start); ids.forEach(i => { if (!seen.has(i)) bfs(i); });
        const n = order.length, gap = maxR * 2 + 70, R = Math.max(110, (n * gap) / (2 * Math.PI));
        order.forEach((id, i) => {
          if (this.pinned[id]) return;
          const a = Math.PI + (2 * Math.PI * i) / n;
          this.pos[id] = { x: R * Math.cos(a), y: R * Math.sin(a) };
        });
        return;
      }

      // BFS ranks
      const rank = {}, layers = [];
      const place = (s, r0) => {
        const q = [s]; rank[s] = r0;
        while (q.length) {
          const x = q.shift();
          (layers[rank[x]] = layers[rank[x]] || []).push(x);
          out[x].forEach(t => { if (rank[t] === undefined) { rank[t] = rank[x] + 1; q.push(t); } });
        }
      };
      place(start, 0);
      ids.forEach(i => { if (rank[i] === undefined) place(i, layers.length); });
      // barycentre sweeps
      const idx = {};
      const reindex = () => layers.forEach(L => L.forEach((id, i) => (idx[id] = i - (L.length - 1) / 2)));
      reindex();
      for (let it = 0; it < 6; it++) {
        const down = it % 2 === 0;
        const order = down ? layers.map((_, i) => i) : layers.map((_, i) => layers.length - 1 - i);
        for (const r of order) {
          const L = layers[r];
          const bary = {};
          L.forEach(id => {
            const nb = [...inn[id], ...out[id]].filter(o => o !== id && Math.abs(rank[o] - r) === 1 && (down ? rank[o] < r : rank[o] > r));
            const all = nb.length ? nb : [...inn[id], ...out[id]].filter(o => o !== id && rank[o] !== r);
            bary[id] = all.length ? all.reduce((s, o) => s + idx[o], 0) / all.length : idx[id];
          });
          L.sort((a, b) => bary[a] - bary[b] || idx[a] - idx[b]);
          L.forEach((id, i) => (idx[id] = i - (L.length - 1) / 2));
        }
      }
      // long edges inside one column bend around neighbours; give tall columns a little stagger
      const colW = Math.max(150, maxR * 2 + 104), rowH = Math.max(104, maxR * 2 + 62);
      layers.forEach((L, r) => L.forEach((id, i) => {
        if (this.pinned[id]) return;
        const stagger = L.length > 2 ? (i % 2 ? 18 : -18) : 0;
        this.pos[id] = { x: r * colW + stagger, y: (i - (L.length - 1) / 2) * rowH };
      }));
    }

    /* -------------------------------------------------------------- edge routing */

    route() {
      const { nodes, groups, byId } = this.g, P = this.pos;
      const has = new Set(groups.map(g => g.from + "\u0001" + g.to));
      const incidentAngles = id => {
        const a = [];
        groups.forEach(g => {
          if (g.from === g.to) return;
          if (g.from === id) a.push(Math.atan2(P[g.to].y - P[id].y, P[g.to].x - P[id].x));
          if (g.to === id) a.push(Math.atan2(P[g.from].y - P[id].y, P[g.from].x - P[id].x));
        });
        return a;
      };
      const angDist = (a, b) => { const d = Math.abs(a - b) % (2 * Math.PI); return d > Math.PI ? 2 * Math.PI - d : d; };
      const freeAngle = (id, prefer, extra) => {
        const used = incidentAngles(id).concat(extra || []);
        let best = prefer, bestScore = -1;
        for (let k = 0; k < 16; k++) {
          const a = prefer + (k * Math.PI) / 8;
          const score = used.length ? Math.min(...used.map(u => angDist(a, u))) : Math.PI;
          const s2 = score - (k ? 0.02 : 0); // slight bias to the preferred direction
          if (s2 > bestScore + 1e-6) { bestScore = s2; best = a; }
        }
        return best;
      };
      const loopObstacles = [];
      const clearance = (pts, skip) => {
        let m = Infinity;
        for (const n of nodes) {
          if (skip.includes(n.id)) continue;
          const c = P[n.id];
          for (const p of pts) m = Math.min(m, Math.hypot(p.x - c.x, p.y - c.y) - n.rr);
        }
        for (const o of loopObstacles) {
          if (skip.includes(o.id)) continue;
          for (const p of pts) m = Math.min(m, Math.hypot(p.x - o.x, p.y - o.y) - o.r);
        }
        return m;
      };
      const quad = (a, c, b, t) => ({ x: (1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * c.x + t * t * b.x, y: (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * c.y + t * t * b.y });

      // the start arrow and loops are chosen first so ordinary edges can avoid them
      const startNode = nodes.find(n => n.start);
      this.startAngle = startNode ? freeAngle(startNode.id, Math.PI) : null;
      const loopAngle = {};
      groups.forEach(g => {
        if (g.from !== g.to) return;
        const extra = g.from === (startNode && startNode.id) ? [this.startAngle] : [];
        loopAngle[g.from] = freeAngle(g.from, -Math.PI / 2, extra);
        const n = byId[g.from], a = loopAngle[g.from], d = n.rr + 34;
        loopObstacles.push({ id: g.from, x: P[g.from].x + Math.cos(a) * d, y: P[g.from].y + Math.sin(a) * d, r: 26 });
      });
      this.loopObstacles = loopObstacles;

      for (const g of groups) {
        const a = P[g.from], b = P[g.to], na = byId[g.from], nb = byId[g.to];
        if (g.from === g.to) {
          const ang = loopAngle[g.from], r = na.rr, spread = 0.5, reach = r + 46;
          const p1 = { x: a.x + Math.cos(ang - spread) * r, y: a.y + Math.sin(ang - spread) * r };
          const p2 = { x: a.x + Math.cos(ang + spread) * (r + 2), y: a.y + Math.sin(ang + spread) * (r + 2) };
          const c1 = { x: a.x + Math.cos(ang - 0.62) * reach * 1.25, y: a.y + Math.sin(ang - 0.62) * reach * 1.25 };
          const c2 = { x: a.x + Math.cos(ang + 0.62) * reach * 1.25, y: a.y + Math.sin(ang + 0.62) * reach * 1.25 };
          g.d = `M${p1.x.toFixed(1)},${p1.y.toFixed(1)} C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
          g.loop = { ang, apex: { x: a.x + Math.cos(ang) * (reach + 2), y: a.y + Math.sin(ang) * (reach + 2) } };
          g.labelCands = [16, 26, 36].flatMap(dd => [0, 0.25, -0.25].map(da => ({ x: a.x + Math.cos(ang + da) * (reach + dd), y: a.y + Math.sin(ang + da) * (reach + dd) })));
          continue;
        }
        const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux;
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const rev = has.has(g.to + "\u0001" + g.from);
        const offs = rev ? [28, 50, 78, 110, 145, 185] : [0, 34, -34, 66, -66, 100, -100, 136, -136, 180, -180, 230, -230];
        let best = null;
        for (const off of offs) {
          const c = { x: mid.x + nx * off, y: mid.y + ny * off };
          const pts = []; for (let t = 0.06; t < 0.95; t += 0.045) pts.push(quad(a, c, b, t));
          const cl = clearance(pts, [g.from, g.to]);
          if (!best || cl > best.cl) best = { off, c, cl };
          if (cl >= 13) { best = { off, c, cl }; break; }
        }
        const c = best.c;
        const dirA = { x: c.x - a.x, y: c.y - a.y }, la = Math.hypot(dirA.x, dirA.y) || 1;
        const dirB = { x: c.x - b.x, y: c.y - b.y }, lb = Math.hypot(dirB.x, dirB.y) || 1;
        const s = { x: a.x + (dirA.x / la) * (na.rr + 1), y: a.y + (dirA.y / la) * (na.rr + 1) };
        const e = { x: b.x + (dirB.x / lb) * (nb.rr + 2), y: b.y + (dirB.y / lb) * (nb.rr + 2) };
        g.d = best.off === 0 ? `M${s.x.toFixed(1)},${s.y.toFixed(1)} L${e.x.toFixed(1)},${e.y.toFixed(1)}` : `M${s.x.toFixed(1)},${s.y.toFixed(1)} Q${c.x.toFixed(1)},${c.y.toFixed(1)} ${e.x.toFixed(1)},${e.y.toFixed(1)}`;
        g.loop = null;
        const side = best.off === 0 ? 1 : Math.sign(best.off);
        g.labelCands = [];
        for (const t of [0.5, 0.4, 0.6, 0.3, 0.7, 0.22, 0.78]) for (const dist of [13, 22]) for (const sd of [side, -side]) {
          const p = quad(s, best.off === 0 ? { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 } : c, e, t);
          g.labelCands.push({ x: p.x + nx * sd * dist, y: p.y + ny * sd * dist });
        }
      }
      this.placeLabels();
    }

    placeLabels() {
      const { nodes, groups } = this.g, P = this.pos, boxes = [];
      const hitsNode = (bx) => nodes.some(n => {
        const c = P[n.id], cx = Math.max(bx.x1, Math.min(c.x, bx.x2)), cy = Math.max(bx.y1, Math.min(c.y, bx.y2));
        return Math.hypot(cx - c.x, cy - c.y) < n.rr + 2;
      });
      (this.loopObstacles || []).forEach(o => boxes.push({ x1: o.x - o.r * 0.7, x2: o.x + o.r * 0.7, y1: o.y - o.r * 0.7, y2: o.y + o.r * 0.7, loop: o.id }));
      const hitsBox = (bx, self) => boxes.some(o => o.loop !== self && bx.x1 < o.x2 && bx.x2 > o.x1 && bx.y1 < o.y2 && bx.y2 > o.y1);
      const ordered = groups.slice().sort((x, y) => (y.from === y.to) - (x.from === x.to));
      for (const g of ordered) {
        const text = g.syms.join(","), w = text.length * LABEL_W + 10, h = 20;
        let chosen = null;
        for (const p of g.labelCands) {
          const bx = { x1: p.x - w / 2, x2: p.x + w / 2, y1: p.y - h / 2, y2: p.y + h / 2 };
          if (!hitsNode(bx) && !hitsBox(bx, g.from === g.to ? g.from : null)) { chosen = p; boxes.push(bx); break; }
        }
        if (!chosen) { chosen = g.labelCands[0]; boxes.push({ x1: chosen.x - w / 2, x2: chosen.x + w / 2, y1: chosen.y - h / 2, y2: chosen.y + h / 2 }); }
        g.label = chosen;
      }
    }

    /* -------------------------------------------------------------- rendering */

    render() {
      if (!this.g) return;
      const { nodes, groups } = this.g, P = this.pos, u = this.uid;
      this.layers.edges.innerHTML = groups.map(g => {
        const epsOnly = g.syms.every(s => s === "ε");
        return `<g class="g-edge${epsOnly ? " eps" : ""}" data-key="${esc(g.key)}"><path d="${g.d}" marker-end="url(#${u}-${epsOnly ? "eps" : "def"})"/></g>`;
      }).join("") + this.startArrow();
      this.layers.labels.innerHTML = groups.map(g => `<text class="g-label" data-key="${esc(g.key)}" x="${g.label.x.toFixed(1)}" y="${g.label.y.toFixed(1)}">${this.labelSpans(g, null, null)}</text>`).join("");
      this.layers.nodes.innerHTML = nodes.map(n => {
        const p = P[n.id];
        return `<g class="g-node${n.dead ? " dead" : ""}" data-id="${esc(n.id)}" transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})"><title>${esc(n.title || n.name)}</title>`
          + (n.final ? `<circle class="ring" r="${n.r + RING}"/>` : "")
          + `<circle class="body" r="${n.r}"/>`
          + (n.subText ? `<text class="name" y="-7">${esc(n.name)}</text><text class="sub" y="9">${esc(n.subText)}</text>` : `<text class="name">${esc(n.name)}</text>`)
          + `</g>`;
      }).join("");
      this.paintTransform();
    }

    startArrow() {
      const n = this.g.nodes.find(x => x.start);
      if (!n || this.startAngle == null) return "";
      const p = this.pos[n.id], a = this.startAngle;
      const x1 = p.x + Math.cos(a) * (n.rr + 34), y1 = p.y + Math.sin(a) * (n.rr + 34), x2 = p.x + Math.cos(a) * (n.rr + 2), y2 = p.y + Math.sin(a) * (n.rr + 2);
      return `<path class="g-start" d="M${x1.toFixed(1)},${y1.toFixed(1)} L${x2.toFixed(1)},${y2.toFixed(1)}" marker-end="url(#${this.uid}-start)"/>`;
    }

    labelSpans(g, visible, hot) {
      const syms = visible ? g.syms.filter(s => visible.has(g.from + "|" + g.to + "|" + s)) : g.syms;
      return syms.map((s, i) => {
        const cls = [s === "ε" ? "eps" : "", hot && hot.has(g.from + "|" + g.to + "|" + s) ? "hot" : ""].filter(Boolean).join(" ");
        return (i ? '<tspan>,</tspan>' : "") + `<tspan${cls ? ` class="${cls}"` : ""}>${esc(s)}</tspan>`;
      }).join("");
    }

    /**
     * Visual state. Every field is optional.
     *   visibleNodes: Set(id)            hidden otherwise (layout stays put)
     *   visibleEdges: Set("from|to|sym")
     *   classes: { id: "in-s moved …" }   extra CSS classes per node
     *   hotEdges: Set("from|to|sym")     highlighted transitions
     *   dimOthers: boolean               fade nodes without a class
     *   colors: { id: cssColor }          fill per node (equivalence classes)
     *   pulse: id                         one-off pulse on a node
     */
    setView(v) { this.v = v || {}; this.applyView(); }

    applyView() {
      if (!this.g) return;
      const v = this.v || {}, u = this.uid;
      const visN = v.visibleNodes, visE = v.visibleEdges, hot = v.hotEdges || new Set(), classes = v.classes || {}, colors = v.colors || {};
      this.layers.nodes.querySelectorAll(".g-node").forEach(el => {
        const id = el.dataset.id, n = this.g.byId[id];
        const extra = classes[id] || "";
        el.setAttribute("class", "g-node" + (n.dead ? " dead" : "") + (visN && !visN.has(id) ? " ghost" : "") + (extra ? " " + extra : "") + (v.dimOthers && !extra ? " dim" : ""));
        if (colors[id]) { el.setAttribute("data-class", "1"); el.style.setProperty("--cls", colors[id]); } else { el.removeAttribute("data-class"); el.style.removeProperty("--cls"); }
      });
      if (v.pulse != null && !reduceMotion()) {
        const el = this.layers.nodes.querySelector(`.g-node[data-id="${CSS.escape(String(v.pulse))}"]`);
        if (el) { el.getBoundingClientRect(); el.classList.add("pulse"); }
      }
      for (const g of this.g.groups) {
        const anyVisible = !visE || g.syms.some(s => visE.has(g.from + "|" + g.to + "|" + s));
        const hotSyms = g.syms.filter(s => hot.has(g.from + "|" + g.to + "|" + s));
        const epsOnly = g.syms.every(s => s === "ε");
        const el = this.layers.edges.querySelector(`.g-edge[data-key="${CSS.escape(g.key)}"]`);
        const lab = this.layers.labels.querySelector(`.g-label[data-key="${CSS.escape(g.key)}"]`);
        const hotCls = hotSyms.length ? (hotSyms.every(s => s === "ε") ? " hot-eps" : " hot") : "";
        const dim = v.dimEdges && !hotSyms.length;
        el.setAttribute("class", "g-edge" + (epsOnly ? " eps" : "") + (anyVisible ? "" : " ghost") + hotCls + (dim ? " dim" : "") + (v.addedEdges && v.addedEdges.has(g.from + "|" + g.to) ? " added" : ""));
        el.querySelector("path").setAttribute("marker-end", `url(#${u}-${hotCls === " hot" ? "hot" : (hotCls === " hot-eps" || epsOnly) ? "eps" : "def"})`);
        lab.setAttribute("class", "g-label" + (anyVisible ? "" : " ghost") + (dim ? " dim" : ""));
        lab.innerHTML = this.labelSpans(g, visE, hot);
      }
      const st = this.layers.edges.querySelector(".g-start");
      const startNode = this.g.nodes.find(n => n.start);
      if (st && startNode) st.style.opacity = visN && !visN.has(startNode.id) ? 0 : 1;
    }

    /* -------------------------------------------------------------- tokens */

    /** Animate dots along transitions. edges: [[from, sym, to], …]. Resolves when done. */
    animate(edges, ms) {
      if (!this.g || !edges || !edges.length || !ms || ms < 30 || reduceMotion()) return Promise.resolve();
      const runs = [];
      const seen = new Set();
      for (const [f, s, t] of edges) {
        const key = f + "\u0001" + t;
        if (seen.has(key + s)) continue;
        seen.add(key + s);
        const el = this.layers.edges.querySelector(`.g-edge[data-key="${CSS.escape(key)}"] path`);
        if (!el) continue;
        const dot = document.createElementNS(NS, "circle");
        dot.setAttribute("r", 6.5);
        dot.setAttribute("class", "g-token" + (s === "ε" ? " eps" : ""));
        this.layers.tokens.append(dot);
        runs.push({ el, dot, len: el.getTotalLength() });
      }
      if (!runs.length) return Promise.resolve();
      return new Promise(resolve => {
        const t0 = performance.now();
        const frame = now => {
          const k = Math.min(1, (now - t0) / ms), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          for (const r of runs) { const p = r.el.getPointAtLength(r.len * e); r.dot.setAttribute("cx", p.x); r.dot.setAttribute("cy", p.y); }
          if (k < 1) requestAnimationFrame(frame);
          else { runs.forEach(r => r.dot.remove()); resolve(); }
        };
        requestAnimationFrame(frame);
      });
    }

    /* -------------------------------------------------------------- view transform */

    bounds() {
      const xs = [], ys = [];
      for (const n of this.g.nodes) { const p = this.pos[n.id]; xs.push(p.x - n.rr, p.x + n.rr); ys.push(p.y - n.rr, p.y + n.rr); }
      for (const g of this.g.groups) {
        if (g.label) { xs.push(g.label.x - 24, g.label.x + 24); ys.push(g.label.y - 12, g.label.y + 12); }
        if (g.loop) { xs.push(g.loop.apex.x); ys.push(g.loop.apex.y); }
      }
      const s = this.g.nodes.find(n => n.start);
      if (s && this.startAngle != null) { const p = this.pos[s.id]; xs.push(p.x + Math.cos(this.startAngle) * (s.rr + 36)); ys.push(p.y + Math.sin(this.startAngle) * (s.rr + 36)); }
      return { x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
    }

    fit() {
      if (!this.g) return;
      const W = this.host.clientWidth || 600, H = this.host.clientHeight || 360, b = this.bounds();
      const pad = 34, top = this.opts.title ? 30 : 10;
      const fitK = Math.min(1.4, (W - pad * 2) / Math.max(1, b.x2 - b.x1), (H - pad * 2 - top) / Math.max(1, b.y2 - b.y1));
      const k = Math.max(this.opts.minScale || 0.72, fitK);
      const wide = (b.x2 - b.x1) * k > W - pad * 2;
      // when the diagram is wider than the canvas at a readable size, keep the start state in view; drag to pan
      this.view = { k, x: wide ? pad - b.x1 * k : (W - (b.x2 - b.x1) * k) / 2 - b.x1 * k, y: top / 2 + (H - (b.y2 - b.y1) * k) / 2 - b.y1 * k };
      this.userMoved = false;
      this.paintTransform();
    }
    zoomBy(f, cx, cy) {
      const W = this.host.clientWidth, H = this.host.clientHeight;
      cx = cx == null ? W / 2 : cx; cy = cy == null ? H / 2 : cy;
      const k = Math.max(0.2, Math.min(4, this.view.k * f)), r = k / this.view.k;
      this.view = { k, x: cx - (cx - this.view.x) * r, y: cy - (cy - this.view.y) * r };
      this.userMoved = true;
      this.paintTransform();
    }
    paintTransform() { this.vp.setAttribute("transform", `translate(${this.view.x.toFixed(2)},${this.view.y.toFixed(2)}) scale(${this.view.k.toFixed(4)})`); }

    bindPointer() {
      const svg = this.svg, pts = new Map();
      let drag = null, pinch = null, raf = 0;
      const local = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
      svg.addEventListener("pointerdown", e => {
        if (!this.g || e.button > 0) return;
        svg.setPointerCapture(e.pointerId);
        pts.set(e.pointerId, local(e));
        if (pts.size === 2) {
          const [p1, p2] = [...pts.values()];
          pinch = { d: Math.hypot(p1.x - p2.x, p1.y - p2.y), k: this.view.k, cx: (p1.x + p2.x) / 2, cy: (p1.y + p2.y) / 2 };
          drag = null; return;
        }
        const nodeEl = e.target.closest(".g-node");
        const p = local(e);
        if (nodeEl && this.opts.interactive && !this.g.fixed) drag = { type: "node", id: nodeEl.dataset.id, sx: p.x, sy: p.y, ox: this.pos[nodeEl.dataset.id].x, oy: this.pos[nodeEl.dataset.id].y, moved: false };
        else { drag = { type: "pan", sx: p.x, sy: p.y, ox: this.view.x, oy: this.view.y }; svg.classList.add("panning"); }
      });
      svg.addEventListener("pointermove", e => {
        if (!pts.has(e.pointerId)) return;
        pts.set(e.pointerId, local(e));
        if (pinch && pts.size === 2) {
          const [p1, p2] = [...pts.values()], d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
          this.zoomBy((pinch.k * d / pinch.d) / this.view.k, pinch.cx, pinch.cy);
          return;
        }
        if (!drag) return;
        const p = local(e);
        if (drag.type === "pan") { this.view.x = drag.ox + p.x - drag.sx; this.view.y = drag.oy + p.y - drag.sy; this.userMoved = true; this.paintTransform(); }
        else {
          if (!drag.moved && Math.hypot(p.x - drag.sx, p.y - drag.sy) < 3) return;
          drag.moved = true;
          this.pos[drag.id] = { x: drag.ox + (p.x - drag.sx) / this.view.k, y: drag.oy + (p.y - drag.sy) / this.view.k };
          this.pinned[drag.id] = true;
          if (!raf) raf = requestAnimationFrame(() => { raf = 0; this.route(); this.render(); this.applyView(); });
        }
      });
      const end = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) { drag = null; svg.classList.remove("panning"); } };
      svg.addEventListener("pointerup", end);
      svg.addEventListener("pointercancel", end);
      svg.addEventListener("wheel", e => {
        if (!this.g || !(e.ctrlKey || e.metaKey)) return;
        e.preventDefault();
        const p = local(e);
        this.zoomBy(Math.exp(-e.deltaY * 0.0022), p.x, p.y);
      }, { passive: false });
      svg.addEventListener("dblclick", e => { if (!e.target.closest(".g-node")) this.fit(); });
    }

    /* -------------------------------------------------------------- export */

    exportSVG() {
      if (!this.g) return null;
      const b = this.bounds(), pad = 24, w = b.x2 - b.x1 + pad * 2, h = b.y2 - b.y1 + pad * 2;
      const clone = this.svg.cloneNode(true);
      const src = this.svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
      const props = ["fill", "stroke", "stroke-width", "stroke-dasharray", "opacity", "font-family", "font-size", "font-weight", "paint-order", "text-anchor", "dominant-baseline"];
      src.forEach((el, i) => {
        if (!(el instanceof SVGElement)) return;
        const cs = getComputedStyle(el);
        props.forEach(p => { const v = cs.getPropertyValue(p); if (v) dst[i].style.setProperty(p, v); });
      });
      clone.querySelector(".vp").setAttribute("transform", `translate(${pad - b.x1},${pad - b.y1})`);
      clone.setAttribute("viewBox", `0 0 ${w} ${h}`);
      clone.setAttribute("width", w); clone.setAttribute("height", h);
      clone.removeAttribute("class");
      const bg = document.createElementNS(NS, "rect");
      bg.setAttribute("width", w); bg.setAttribute("height", h); bg.setAttribute("fill", getComputedStyle(this.host).backgroundColor || "#fff");
      clone.insertBefore(bg, clone.firstChild);
      return { text: new XMLSerializer().serializeToString(clone), w, h };
    }
    download(kind) {
      const out = this.exportSVG();
      if (!out) return;
      const name = (this.opts.title || "automaton").replace(/[^\w]+/g, "-").toLowerCase();
      const save = (blob, ext) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name + "." + ext; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500); };
      const blob = new Blob([out.text], { type: "image/svg+xml" });
      if (kind === "svg") return save(blob, "svg");
      const img = new Image(), url = URL.createObjectURL(blob);
      img.onload = () => {
        const c = document.createElement("canvas"); c.width = out.w * 2; c.height = out.h * 2;
        const ctx = c.getContext("2d"); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        c.toBlob(b => b && save(b, "png"));
      };
      img.onerror = () => { URL.revokeObjectURL(url); save(blob, "svg"); };
      img.src = url;
    }
  }

  /** Convert a parsed automaton (engine object) into GraphView data. */
  GraphView.fromNFA = function (N) {
    const reach = new Set(N.states.filter(s => !(N.unreachable || []).includes(s)));
    const nodes = N.states.map(s => ({ id: s, label: s, final: N.finals.includes(s), start: s === N.start, title: s + (N.finals.includes(s) ? " (final)" : "") + (reach.has(s) ? "" : " (unreachable)") }));
    const edges = [];
    for (const k in N.d) { const [f, c] = k.split("|"); N.d[k].forEach(t => edges.push({ from: f, to: t, sym: c })); }
    return { nodes, edges };
  };

  window.GraphView = GraphView;
})();
