(function () {
  "use strict";
  const { $, $$, esc } = Studio, A = Automata, fmt = A.fmtSet;
  let N = null, M = null, src = "", cur = 0, nameMode = Studio.store.get("subset.names", "D");

  const nfaView = new GraphView($("#nfaCanvas"), { title: "NFA", emptyText: "Your ε-NFA appears here." });
  const dfaView = new GraphView($("#dfaCanvas"), { title: "DFA being built", emptyText: "DFA states appear here, one subset at a time." });
  const player = new StepPlayer($("#transport"), { onStep: show, label: i => (M && M.steps[i] && M.steps[i].isNew && i ? "new state discovered" : ""), storageKey: "speed.subset" });
  const input = new AutomatonInput($("#input"), { kind: "nfa", storageKey: "subset.src", runLabel: "Convert", onRun: build });
  $("#names").value = nameMode;

  const name = i => A.dfaName(M, i, nameMode === "sets" ? "sets" : nameMode);
  const plainName = i => (nameMode === "letters" ? A.dfaName(M, i, "letters") : "D" + i);

  function dfaGraph() {
    return {
      nodes: M.D.map((d, i) => ({ id: "D" + i, label: nameMode === "sets" ? fmt(d.set) : name(i), sub: nameMode === "sets" ? "" : fmt(d.set), final: d.fin, start: i === 0, dead: d.dead, title: `${plainName(i)} = ${fmt(d.set)}${d.fin ? " (final)" : ""}${d.dead ? " (dead state)" : ""}` })),
      edges: M.trans.map(t => ({ from: "D" + t.f, to: "D" + t.t, sym: t.c }))
    };
  }

  function build(text, parsed) {
    try { M = A.build(parsed); }
    catch (e) {
      M = null; N = null;
      nfaView.setGraph(GraphView.fromNFA(parsed)); dfaView.clear();
      $("#narrative").innerHTML = `<div class="msg err">${esc(e.message)}</div>`;
      $("#workTable").innerHTML = ""; $("#stats").innerHTML = ""; $("#verify").innerHTML = ""; const es = $("#enfaStep"); if (es) es.innerHTML = "";
      return;
    }
    N = parsed; src = text;
    nfaView.setGraph(GraphView.fromNFA(N));
    dfaView.setGraph(dfaGraph());
    const marks = M.steps.map((s, i) => (s.isNew ? i : -1)).filter(i => i > 0);
    player.load(M.steps.length, marks, 0);
    results();
  }

  function viewsFor(i, phase) {
    const s = M.steps[i];
    const S = s.type === "init" ? [N.start] : M.D[s.from].set;
    const nfaClasses = {};
    S.forEach(q => (nfaClasses[q] = "in-s"));
    const hot = new Set();
    if (phase >= 1) { s.move.forEach(q => (nfaClasses[q] = (nfaClasses[q] ? nfaClasses[q] + " " : "") + "moved")); s.moveEdges.forEach(e => hot.add(e.join("|"))); }
    if (phase === 0 && s.type === "move") s.moveEdges.forEach(e => hot.add(e.join("|")));
    if (phase >= 2) { s.added.forEach(q => (nfaClasses[q] = "closure")); s.epsEdges.forEach(e => hot.add(e.join("|"))); }
    nfaView.setView({ classes: nfaClasses, hotEdges: hot, dimOthers: true, dimEdges: true });

    const visN = new Set(), visE = new Set();
    M.D.forEach((d, k) => { if (d.discovered <= (phase >= 2 ? i : i - (s.isNew ? 1 : 0)) || k === 0) visN.add("D" + k); });
    M.trans.forEach(t => { if (t.step < i || (t.step === i && phase >= 2)) visE.add(`D${t.f}|D${t.t}|${t.c}`); });
    const classes = {};
    if (s.type === "move") classes["D" + s.from] = "current";
    if (phase >= 2) classes["D" + s.to] = (classes["D" + s.to] ? classes["D" + s.to] + " " : "") + (s.isNew ? "fresh" : "current");
    const dHot = new Set(phase >= 2 && s.type === "move" ? [`D${s.from}|D${s.to}|${s.c}`] : []);
    dfaView.setView({ visibleNodes: visN, visibleEdges: visE, classes, hotEdges: dHot, pulse: phase >= 2 && s.isNew ? "D" + s.to : null });
  }

  async function show(i, info) {
    if (!M) return;
    cur = i;
    const s = M.steps[i];
    narrate(i);
    table(i);
    if (info && info.animate && info.ms > 0) {
      const ms = info.ms;
      viewsFor(i, 0);
      if (s.moveEdges.length) await nfaView.animate(s.moveEdges, ms * 0.38);
      if (cur !== i) return;
      viewsFor(i, 1);
      if (s.epsEdges.length) await nfaView.animate(s.epsEdges, ms * 0.28);
      if (cur !== i) return;
    }
    viewsFor(i, 2);
  }

  function stepText(i) {
    const s = M.steps[i], to = M.D[s.to];
    const finals = to.set.filter(q => N.finals.includes(q));
    const acc = to.fin ? `, and it is accepting because it contains the final state${finals.length > 1 ? "s" : ""} ${finals.join(", ")}` : "";
    if (s.type === "init") {
      return `Start with the ε-closure of the NFA start state ${N.start}: ${fmt(s.closure)}` + (s.added.length ? ` (${s.added.join(", ")} ${s.added.length > 1 ? "are" : "is"} reached by ε-moves)` : " (no ε-moves leave it)") + `. This set becomes ${plainName(0)}, the DFA start state${acc}.`;
    }
    let t = `Take ${plainName(s.from)} = ${fmt(M.D[s.from].set)} and the symbol “${s.c}”. `;
    if (!s.move.length) t += `No state in the set has a “${s.c}”-arrow, so the result is the empty set ∅ — the dead state. Once there, the DFA can never accept.`;
    else {
      t += `One “${s.c}”-arrow from these states reaches ${fmt(s.move)}. `;
      t += s.added.length ? `Following ε-moves adds ${s.added.join(", ")}, giving ${fmt(s.closure)}. ` : `No ε-moves add anything, so the set stays ${fmt(s.closure)}. `;
    }
    if (s.isNew) t += ` This subset is new, so it becomes ${plainName(s.to)}${s.move.length ? acc : ""}.`;
    else t += ` This subset is already ${plainName(s.to)}, so only the arrow ${plainName(s.from)} —${s.c}→ ${plainName(s.to)} is added.`;
    if (i === M.steps.length - 1) t += ` That was the last unprocessed pair: the DFA is complete with ${M.D.length} state${M.D.length > 1 ? "s" : ""}.`;
    return t;
  }
  function narrate(i) {
    const s = M.steps[i];
    const edges = list => list.map(e => `${e[0]}–${e[1]}→${e[2]}`).join(", ");
    let f;
    if (s.type === "init") {
      f = `<div><span class="k">start state</span><span>${esc(N.start)}</span></div>
           <div><span class="k">ε-closure</span><span>${esc(fmt(s.closure))}</span>${s.added.length ? `<span class="add">+${esc(s.added.join(", "))} via ${esc(edges(s.epsEdges))}</span>` : ""}</div>
           <div><span class="k">DFA start</span><span><b>${esc(plainName(0))}</b>${M.D[0].fin ? " · accepting" : ""}</span></div>`;
    } else {
      f = `<div><span class="k">S</span><span>${esc(plainName(s.from))} = ${esc(fmt(M.D[s.from].set))}</span></div>
           <div><span class="k">move(S, ${esc(s.c)})</span><span class="mv">${esc(fmt(s.move))}</span>${s.moveEdges.length ? `<span class="muted">via ${esc(edges(s.moveEdges))}</span>` : ""}</div>
           <div><span class="k">ε-closure</span><span>${esc(fmt(s.closure))}</span>${s.added.length ? `<span class="add">+${esc(s.added.join(", "))}</span>` : ""}</div>
           <div><span class="k">δ(${esc(plainName(s.from))}, ${esc(s.c)})</span><span><b>${esc(plainName(s.to))}</b>${s.isNew ? " · new" : " · existing"}${M.D[s.to].fin ? " · accepting" : ""}${M.D[s.to].dead ? " · dead" : ""}</span></div>`;
    }
    $("#narrative").innerHTML = `<div class="stepno">Step ${i + 1} of ${M.steps.length}${s.isNew ? " · new state" : ""}</div><p style="margin:6px 0 0">${esc(stepText(i))}</p><div class="formula">${f}</div>`;
  }

  function table(i) {
    const rows = M.D.map((d, k) => k).filter(k => k === 0 || M.D[k].discovered <= i);
    const s = M.steps[i];
    let h = `<table class="data"><thead><tr><th>DFA state</th><th>NFA subset</th>${N.alpha.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>`;
    rows.forEach(k => {
      h += `<tr${s.type === "move" && s.from === k ? ' class="now"' : ""}><td>${k === 0 ? "→ " : ""}${M.D[k].fin ? "* " : ""}<b>${esc(plainName(k))}</b></td><td class="set">${esc(fmt(M.D[k].set))}</td>`;
      N.alpha.forEach(c => {
        const t = M.trans.find(x => x.f === k && x.c === c);
        const done = t && t.step <= i, now = t && t.step === i;
        h += `<td class="set"${now ? ' style="background:var(--marker);color:#18213a;font-weight:700"' : ""}>${done ? esc(plainName(t.t)) + (now && s.isNew ? " ★" : "") : '<span class="muted">·</span>'}</td>`;
      });
      h += "</tr>";
    });
    $("#workTable").innerHTML = h + "</tbody></table>";
    $("#tableNote").textContent = `→ start · * accepting · ${rows.length} of ${M.D.length} states found`;
    let L = `<table class="data"><thead><tr><th>#</th><th>From</th><th>Symbol</th><th>move</th><th>ε-closure</th><th>Result</th></tr></thead><tbody>`;
    M.steps.slice(0, i + 1).forEach((t, k) => {
      L += `<tr${k === i ? ' class="now"' : ""}><td>${k + 1}</td>` + (t.type === "init" ? `<td>ε-closure(${esc(N.start)})</td><td>—</td><td>—</td>` : `<td>${esc(plainName(t.from))} ${esc(fmt(M.D[t.from].set))}</td><td>${esc(t.c)}</td><td class="set">${esc(fmt(t.move))}</td>`) + `<td class="set">${esc(fmt(t.closure))}</td><td>${esc(plainName(t.to))}${t.isNew ? " (new)" : ""}</td></tr>`;
    });
    $("#log").innerHTML = L + "</tbody></table>";
  }

  function results() {
    const dead = M.D.some(d => d.dead);
    const stats = [[N.states.length, "NFA states"], [M.D.length, "DFA states"], [M.D.filter(d => d.fin).length, "accepting DFA states"], [N.alpha.length, "input symbols"], [N.hasEps ? "yes" : "no", "ε-moves"], [dead ? "yes" : "no", "dead state ∅"], ["2^" + N.states.length + " = " + Math.pow(2, N.states.length), "worst-case bound"]];
    $("#stats").innerHTML = stats.map(s => `<div class="stat"><b>${esc(s[0])}</b><span>${esc(s[1])}</span></div>`).join("");

    // Intermediate step for ε-NFAs: show the equivalent NFA with the ε-moves removed,
    // exactly as in a hand solution (ε-NFA → NFA → DFA).
    if (N.hasEps) {
      const NE = A.removeEps(N);
      const cellCss = "border:1px solid var(--line,#ccc);padding:4px 8px;text-align:left";
      const monoCss = "font-family:ui-monospace,Consolas,monospace";
      // Step 1: ε-closure of every state
      const clRows = N.states.map(q => {
        const cl = A.closure(N, [q]);
        const fin = cl.some(s => N.finals.includes(s));
        return `<tr><td style="${cellCss};${monoCss}">${esc(q)}</td><td style="${cellCss};${monoCss}">${esc(A.fmtSet(cl))}</td><td style="${cellCss}">${fin ? "accepting (its ε-closure reaches a final state)" : "—"}</td></tr>`;
      }).join("");
      $("#enfaStep").innerHTML =
        '<details open class="enfa"><summary><b>How an ε-NFA becomes a DFA (ε-NFA → NFA → DFA)</b></summary>' +
        '<p class="small muted" style="margin:6px 0">Three stages, exactly as solved by hand. <b>Step 3</b> (the DFA) is the animated subset construction on the right.</p>' +
        '<h4 style="margin:12px 0 4px">Step 1 — ε-closure of each state</h4>' +
        '<p class="small muted" style="margin:0 0 6px">All states reachable using only ε-moves (always includes the state itself).</p>' +
        `<table style="border-collapse:collapse;font-size:13px"><thead><tr><th style="${cellCss}">state q</th><th style="${cellCss}">ε-closure(q)</th><th style="${cellCss}">note</th></tr></thead><tbody>${clRows}</tbody></table>` +
        '<h4 style="margin:14px 0 4px">Step 2 — equivalent NFA without ε-moves</h4>' +
        '<p class="small muted" style="margin:0 0 6px">δ′(q,a) = ε-closure(move(ε-closure(q), a)); a state is accepting if its ε-closure reaches an original final state (see the table above).</p>' +
        '<pre class="code" style="white-space:pre-wrap">' + esc(A.toText(NE)) + '</pre>' +
        '<h4 style="margin:14px 0 4px">Step 3 — subset construction → DFA</h4>' +
        '<p class="small muted" style="margin:0">The DFA on the right (and the working table below) is the subset construction of the ε-free NFA from Step 2. Its start state is ε-closure({' + esc(N.start) + '}) = ' + esc(A.fmtSet(A.closure(N, [N.start]))) + '.</p>' +
        '</details>';
    } else {
      $("#enfaStep").innerHTML = "";
    }

    let L = 0, total = 1;
    while (L < 12 && N.alpha.length && total + Math.pow(N.alpha.length, L + 1) <= 5000) { L++; total += Math.pow(N.alpha.length, L); }
    const q = [[]]; let bad = 0, n = 0, ex = null;
    for (let k = 0; k < q.length; k++) {
      const w = q[k]; n++;
      if (A.runNFA(N, w) !== A.runDFA(N, M, w)) { bad++; ex = ex || w; }
      if (w.length < L) N.alpha.forEach(c => q.push([...w, c]));
    }
    $("#verify").innerHTML = bad
      ? `<div class="msg err">✗ ${bad} strings disagree, for example “${esc(ex.join("") || "ε")}”.</div>`
      : `<div class="msg ok">✓ Verified: the NFA and the DFA agree on all ${n.toLocaleString()} strings up to length ${L}.</div>`;
  }

  $$("[data-view]").forEach(b => b.addEventListener("click", () => {
    const v = b.dataset.view;
    $$("[data-view]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#nfaCanvas").hidden = v === "dfa"; $("#dfaCanvas").hidden = v === "nfa";
    $("#canvases").style.gridTemplateColumns = v === "both" ? "" : "minmax(0,1fr)";
    setTimeout(() => { nfaView.fit(); dfaView.fit(); }, 30);
  }));
  $("#toggleInput").addEventListener("click", e => {
    const ws = $("#ws"), hide = !ws.classList.contains("collapsed");
    ws.classList.toggle("collapsed", hide);
    e.target.textContent = hide ? "Show input" : "Hide input";
    e.target.setAttribute("aria-expanded", String(!hide));
    setTimeout(() => { nfaView.fit(); dfaView.fit(); }, 40);
  });
  const narrow = window.matchMedia("(max-width: 1100px)");
  const layoutCanvases = () => { if ($("#canvases").style.gridTemplateColumns !== "minmax(0,1fr)") $("#canvases").style.gridTemplateColumns = narrow.matches ? "minmax(0,1fr)" : "minmax(0,1fr) minmax(0,1fr)"; };
  narrow.addEventListener("change", layoutCanvases); layoutCanvases();
  $("#names").addEventListener("change", e => { nameMode = e.target.value; Studio.store.set("subset.names", nameMode); if (M) { dfaView.setGraph(dfaGraph(), { keep: true }); show(cur); results(); } });
  $("#copyDfa").addEventListener("click", () => { if (!M) return; navigator.clipboard.writeText(A.dfaToText(N, M, nameMode === "letters" ? "letters" : "D")).then(() => Studio.toast("DFA copied as text."), () => Studio.toast("Copy failed.", "err")); });
  $("#share").addEventListener("click", () => {
    const enc = btoa(unescape(encodeURIComponent(input.getText()))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const url = location.origin + location.pathname + "#a=" + enc;
    if (url.length > 6000) return Studio.toast("This automaton is too large for a link; copy its text instead.", "err");
    navigator.clipboard.writeText(url).then(() => Studio.toast("Link copied. Anyone opening it sees this NFA."), () => Studio.toast("Copy failed: " + url, "err"));
  });

  function fromHash() {
    if (!/^#a=/.test(location.hash)) return false;
    try { const t = decodeURIComponent(escape(atob(location.hash.slice(3).replace(/-/g, "+").replace(/_/g, "/")))); input.setText(t, true); }
    catch (e) { Studio.toast("The share link is damaged; showing your last NFA instead.", "err"); input.run(); }
    return true;
  }
  window.addEventListener("hashchange", fromHash);
  const h = Studio.takeHandoff("subset.html");
  if (h && h.src) input.setText(h.src, true);
  else if (!fromHash()) input.run();
})();
