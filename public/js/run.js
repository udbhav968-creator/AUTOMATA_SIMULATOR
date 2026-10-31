/* String run page: animates an automaton reading a string. */
(function () {
  "use strict";
  const { $, $$, esc } = Studio, A = Automata, fmt = A.fmtSet;
  let N = null, M = null, src = "", word = [], T = null, tree = null, view = "nfa", cur = 0, dfaPath = [];

  const nfaView = new GraphView($("#nfaCanvas"), { title: "Automaton", emptyText: "Load a machine to begin." });
  const treeView = new GraphView($("#treeCanvas"), { title: "Computation tree (every path)", emptyText: "Run a string to grow the tree." });
  const dfaView = new GraphView($("#dfaCanvas"), { title: "Equivalent DFA (one path)", emptyText: "Load a machine to begin." });
  const player = new StepPlayer($("#transport"), { onStep: show, storageKey: "speed.run", label: i => (T && T.steps[i] && T.steps[i].sym != null ? `read “${T.steps[i].sym}”` : "") });
  const input = new AutomatonInput($("#input"), { kind: "nfa", storageKey: "run.src", runLabel: "Load machine", onRun: load, rows: 9 });

  function load(text, parsed) {
    N = parsed; src = text;
    try { M = A.build(N); } catch (e) { M = null; Studio.toast(e.message + " The DFA view is off for this machine.", "err"); }
    nfaView.setGraph(GraphView.fromNFA(N));
    if (M) dfaView.setGraph({ nodes: M.D.map((d, i) => ({ id: "D" + i, label: "D" + i, sub: fmt(d.set), final: d.fin, start: i === 0, dead: d.dead, title: "D" + i + " = " + fmt(d.set) })), edges: M.trans.map(t => ({ from: "D" + t.f, to: "D" + t.t, sym: t.c })) });
    else dfaView.clear();
    $("#symbols").innerHTML = N.alpha.map(c => `<button class="btn sm" data-sym="${esc(c)}" title="Add “${esc(c)}”">${esc(c)}</button>`).join("") + '<button class="btn sm quiet" data-back title="Delete the last symbol">⌫</button><button class="btn sm quiet" data-clearw>Clear</button>';
    run();
  }

  function run() {
    if (!N) return;
    const raw = $("#w").value;
    word = A.tokenize(N, raw);
    if (word.length > A.LIMITS.stringLength) { Studio.toast(`Strings are limited to ${A.LIMITS.stringLength} symbols.`, "err"); word = word.slice(0, A.LIMITS.stringLength); }
    T = A.traceNFA(N, word);
    // DFA path (stops on an unknown symbol)
    dfaPath = [0];
    if (M) for (const c of word) { const t = M.tm[dfaPath[dfaPath.length - 1] + "|" + c]; if (t === undefined) break; dfaPath.push(t); }
    // computation tree with fixed tidy positions
    const valid = word.slice(0, T.stop ? T.stop.at : word.length);
    tree = A.computationTree(N, valid, 160);
    const pos = {}; let leaf = 0;
    const place = id => { const n = tree.nodes[id]; const kids = n.children || []; if (!kids.length) { pos[id] = leaf++; return pos[id]; } const ys = kids.map(place); pos[id] = (ys[0] + ys[ys.length - 1]) / 2; return pos[id]; };
    place(0);
    const gen = {}; tree.nodes.forEach(n => (gen[n.id] = n.parent < 0 ? 0 : gen[n.parent] + 1));
    treeView.setGraph({ fixed: true, nodes: tree.nodes.map(n => ({ id: "n" + n.id, label: n.state, x: gen[n.id] * 108, y: pos[n.id] * 64, final: N.finals.includes(n.state), start: n.id === 0, title: `${n.state} after ${n.depth} symbol(s)${n.status === "accept" ? " — accepting path" : n.status === "stuck" ? " — stuck" : ""}` })), edges: tree.nodes.filter(n => n.parent >= 0).map(n => ({ from: "n" + n.parent, to: "n" + n.id, sym: n.via })) });
    tape();
    traceTable();
    player.load(T.steps.length, T.steps.map((s, i) => (s.added && s.added.length ? i : -1)).filter(i => i > 0), 0);
    Studio.store.set("run.word", $("#w").value);
  }

  /** Tape: grey = already read, amber = the symbol read in this step, red = a symbol outside Σ. */
  function tape(i) {
    const s = T && T.steps[i || 0], at = s ? s.i : -1;
    if (!word.length) { $("#tape").innerHTML = '<div class="cell empty now">ε (empty string)</div>'; return; }
    $("#tape").innerHTML = word.map((c, k) => {
      let cls = "";
      if (k < at) cls = "done";
      else if (k === at) cls = s.invalid ? "bad now" : "now";
      else if (T.stop && k > T.stop.at) cls = "done";
      return `<div class="cell ${cls}" title="symbol ${k + 1}">${esc(c)}</div>`;
    }).join("");
  }

  function stepState(i) {
    const s = T.steps[i], last = i === T.steps.length - 1;
    const classes = {};
    if (s.invalid) s.before.forEach(q => (classes[q] = "reject"));
    else s.after.forEach(q => (classes[q] = s.added.includes(q) ? "closure" : "active"));
    if (last && !s.invalid) s.after.forEach(q => (classes[q] = N.finals.includes(q) && T.accepted ? "accept" : classes[q]));
    const hot = new Set([...s.moveEdges, ...s.epsEdges].map(e => e.join("|")));
    return { classes, hot };
  }

  async function show(i, info) {
    if (!T) return;
    cur = i;
    const s = T.steps[i];
    tape(i);
    narrate(i);
    highlightTrace(i);
    // NFA view
    if (info && info.animate && info.ms > 0 && view === "nfa" && !s.invalid) {
      const before = {}; s.before.forEach(q => (before[q] = "in-s"));
      nfaView.setView({ classes: before, hotEdges: new Set(s.moveEdges.map(e => e.join("|"))), dimOthers: true, dimEdges: true });
      if (s.moveEdges.length) await nfaView.animate(s.moveEdges, info.ms * 0.42);
      if (cur !== i) return;
      const moved = {}; s.afterMove.forEach(q => (moved[q] = "moved"));
      nfaView.setView({ classes: moved, hotEdges: new Set(s.epsEdges.map(e => e.join("|"))), dimOthers: true, dimEdges: true });
      if (s.epsEdges.length) await nfaView.animate(s.epsEdges, info.ms * 0.3);
      if (cur !== i) return;
    }
    const st = stepState(i);
    nfaView.setView({ classes: st.classes, hotEdges: st.hot, dimOthers: true, dimEdges: true });
    // DFA view
    if (M) {
      const k = Math.min(i, dfaPath.length - 1), d = dfaPath[k], prev = k > 0 ? dfaPath[k - 1] : null;
      const cls = { ["D" + d]: i === T.steps.length - 1 && !s.invalid ? (M.D[d].fin ? "accept" : "reject") : "active" };
      const hot = new Set(prev != null && word[k - 1] != null ? [`D${prev}|D${d}|${word[k - 1]}`] : []);
      if (info && info.animate && info.ms > 0 && view === "dfa" && prev != null) await dfaView.animate([["D" + prev, word[k - 1], "D" + d]], info.ms * 0.5);
      dfaView.setView({ classes: cls, hotEdges: hot, dimEdges: true });
    }
    // tree: reveal everything reached after i symbols
    const depth = s.i + 1;
    const vis = new Set(tree.nodes.filter(n => n.depth <= depth).map(n => "n" + n.id));
    const tcls = {};
    tree.nodes.forEach(n => {
      if (!vis.has("n" + n.id)) return;
      if (n.depth === depth && n.depth === word.length && !T.stop) tcls["n" + n.id] = n.status === "accept" ? "accept" : "reject";
      else if (n.depth === depth) tcls["n" + n.id] = "active";
      else if (n.status === "stuck" && n.depth < depth) tcls["n" + n.id] = "reject";
    });
    treeView.setView({ visibleNodes: vis, classes: tcls });
    verdict(i);
  }

  function verdict(i) {
    const el = $("#verdict"), last = i === T.steps.length - 1;
    if (!last) { el.className = "verdict wait"; el.textContent = `Reading… ${T.steps[i].after.length} active state${T.steps[i].after.length === 1 ? "" : "s"}`; return; }
    el.className = "verdict " + (T.accepted ? "yes" : "no");
    el.textContent = T.accepted ? "Accepted" : "Rejected";
  }

  function narrate(i) {
    const s = T.steps[i], last = i === T.steps.length - 1;
    let t;
    if (s.i < 0) t = `Before reading anything, the machine is in ε-closure(${N.start}) = ${fmt(s.after)}` + (s.added.length ? `: ${s.added.join(", ")} ${s.added.length > 1 ? "are" : "is"} reached through ε-moves.` : ".");
    else if (s.invalid) t = `Symbol ${s.i + 1} is “${s.sym}”, which is not in the alphabet {${N.alpha.join(",")}}. No transition can read it, so the string is rejected here.`;
    else {
      t = `Read symbol ${s.i + 1}, “${s.sym}”. From ${fmt(s.before)} the “${s.sym}”-arrows lead to ${fmt(s.afterMove)}.`;
      if (s.added.length) t += ` ε-moves then add ${s.added.join(", ")}, so the active set is ${fmt(s.after)}.`;
      else if (s.after.length) t += ` No ε-moves add anything.`;
      if (!s.after.length) t += " No state is active any more: every path has died, so the rest of the input cannot help.";
    }
    if (last) t += " " + T.reason;
    const dfa = M ? `<div><span class="k">DFA state</span><span>D${dfaPath[Math.min(i, dfaPath.length - 1)]}</span></div>` : "";
    $("#narrative").innerHTML = `<div class="stepno">Step ${i + 1} of ${T.steps.length}</div><p style="margin:6px 0 0">${esc(t)}</p><div class="formula"><div><span class="k">active states</span><span>${esc(fmt(s.invalid ? [] : s.after))}</span></div>${dfa}<div><span class="k">remaining input</span><span>${esc(word.slice(s.i + 1).join(N.alpha.every(a => a.length === 1) ? "" : " ") || "ε")}</span></div></div>`;
  }

  function traceTable() {
    let h = `<table class="data"><thead><tr><th>#</th><th>Read</th><th>move</th><th>ε-closure (active)</th>${M ? "<th>DFA</th>" : ""}</tr></thead><tbody>`;
    T.steps.forEach((s, i) => {
      h += `<tr data-i="${i}"><td>${i + 1}</td><td>${s.i < 0 ? "start" : esc(s.sym)}${s.invalid ? ' <span class="pill no">not in Σ</span>' : ""}</td><td class="set">${s.i < 0 ? "—" : esc(fmt(s.afterMove))}</td><td class="set">${esc(fmt(s.after))}</td>${M ? `<td>${dfaPath[i] != null ? "D" + dfaPath[i] : "—"}</td>` : ""}</tr>`;
    });
    $("#trace").innerHTML = h + "</tbody></table>" + (tree && tree.truncated ? '<p class="tiny muted" style="padding:6px 10px;margin:0">The computation tree was cut at 160 nodes; the active-state view is always complete.</p>' : "");
  }
  function highlightTrace(i) { $$("#trace tr[data-i]").forEach(r => r.classList.toggle("now", +r.dataset.i === i)); }

  /* ---------------------------------------------------------------- batch */
  function batch() {
    if (!N) return;
    const lines = $("#batch").value.split(/\r?\n/).map(l => l.trim()).filter((l, k, arr) => l !== "" || k < arr.length - 1).slice(0, 200);
    if (!lines.length) { $("#batchOut").innerHTML = '<div class="msg info">Write one string per line. Use ε for the empty string.</div>'; return; }
    let h = '<div class="table-wrap" style="max-height:300px"><table class="data"><thead><tr><th>String</th><th>NFA</th><th>DFA</th><th></th></tr></thead><tbody>';
    let disagree = 0;
    lines.forEach(l => {
      const w = A.tokenize(N, l === "ε" ? "" : l), bad = w.filter(c => !N.alpha.includes(c));
      const a = !bad.length && A.runNFA(N, w), b = M ? !bad.length && A.runDFA(N, M, w) : null;
      if (M && a !== b) disagree++;
      h += `<tr><td class="mono">${esc(l || "ε")}</td><td><span class="pill ${a ? "yes" : "no"}">${a ? "accept" : "reject"}</span>${bad.length ? ` <span class="tiny muted">“${esc(bad[0])}” ∉ Σ</span>` : ""}</td><td>${b == null ? "—" : `<span class="pill ${b ? "yes" : "no"}">${b ? "accept" : "reject"}</span>`}</td><td><button class="btn sm quiet" data-show="${esc(l === "ε" ? "" : l)}">Animate</button></td></tr>`;
    });
    $("#batchOut").innerHTML = h + "</tbody></table></div>" + (M ? `<p class="tiny ${disagree ? "bad" : "muted"}" style="margin:6px 0 0">${disagree ? disagree + " disagreements between NFA and DFA — please report this." : "NFA and DFA agree on every string."}</p>` : "");
  }

  /* ---------------------------------------------------------------- wiring */
  $("#go").addEventListener("click", run);
  $("#w").addEventListener("keydown", e => { if (e.key === "Enter") run(); });
  $("#symbols").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    const w = $("#w"), multi = N && !N.alpha.every(a => a.length === 1);
    if (b.dataset.sym != null) w.value = (w.value && multi ? w.value + " " : w.value) + b.dataset.sym;
    else if (b.dataset.back != null) w.value = multi ? w.value.trim().split(/\s+/).slice(0, -1).join(" ") : w.value.slice(0, -1);
    else if (b.dataset.clearw != null) w.value = "";
    run();
  });
  $("#runBatch").addEventListener("click", batch);
  $("#fillBatch").addEventListener("click", () => {
    if (!N) return;
    const out = [""], q = [[]], sep = N.alpha.every(a => a.length === 1) ? "" : " ";
    for (let k = 0; k < q.length && out.length < 12; k++) N.alpha.forEach(c => { const w = [...q[k], c]; q.push(w); if (out.length < 12) out.push(w.join(sep)); });
    $("#batch").value = out.map(w => w || "ε").join("\n");
    batch();
  });
  $("#batchOut").addEventListener("click", e => { const b = e.target.closest("[data-show]"); if (!b) return; $("#w").value = b.dataset.show; run(); player.play(); window.scrollTo({ top: 0, behavior: "smooth" }); });
  $$("[data-view]").forEach(b => b.addEventListener("click", () => {
    view = b.dataset.view;
    $$("[data-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#nfaCanvas").hidden = view !== "nfa"; $("#treeCanvas").hidden = view !== "tree"; $("#dfaCanvas").hidden = view !== "dfa";
    setTimeout(() => { nfaView.fit(); treeView.fit(); dfaView.fit(); }, 30);
  }));
  $("#toggleInput").addEventListener("click", e => {
    const ws = $("#ws"), hide = !ws.classList.contains("collapsed");
    ws.classList.toggle("collapsed", hide);
    e.target.textContent = hide ? "Show input" : "Hide input";
    e.target.setAttribute("aria-expanded", String(!hide));
    setTimeout(() => { nfaView.fit(); treeView.fit(); dfaView.fit(); }, 40);
  });

  Studio.context = () => ({ page: "String run simulator", automaton: input.getText(), step: T ? `String “${word.join("") || "ε"}”, step ${cur + 1} of ${T.steps.length}: active set ${fmt(T.steps[cur].after)}. ${cur === T.steps.length - 1 ? T.reason : ""}` : "" });
  Studio.chatChips = ["Why is this string rejected?", "Explain the active states", "Give me a string it accepts"];

  const h = Studio.takeHandoff("run.html");
  $("#w").value = h && h.word != null ? h.word : Studio.store.get("run.word", "aab");
  if (h && h.src) input.setText(h.src, true); else input.run();
})();
